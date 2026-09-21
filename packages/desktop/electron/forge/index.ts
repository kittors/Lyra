/**
 * Every account, as one list.
 *
 * The drivers each know one host. This knows that a person has several, and that the answer to
 * "what is waiting on me" is all of them at once — a work GitLab, a personal GitHub, the company's
 * Gitea — sorted by when they last moved rather than by which server they came from.
 *
 * The rule that shapes everything here: one host being unreachable must not empty the list. A VPN
 * that is not connected takes out the self-hosted account and nothing else, so failures are
 * collected per account and reported beside the rows that did arrive, never instead of them.
 */

import { randomUUID } from "node:crypto";
import type { PullRequestDetail, PullRequestSummary, WorkspaceDiffFile } from "../ipc-shapes.ts";
import { defaultLabel, normalizeServer, sameIdentity } from "./accounts.ts";
import { describe } from "./errors.ts";
import { gitea } from "./gitea.ts";
import { gitee } from "./gitee.ts";
import { github } from "./github.ts";
import { gitlab } from "./gitlab.ts";
import type { ForgeAccount, ForgeConnection, ForgeDriver, ForgeKind, ReviewVerdict } from "./types.ts";
import { accountById, listAccounts, removeAccount, saveAccount, tokenFor, updateAccount } from "./vault.ts";

const DRIVERS: Record<ForgeKind, ForgeDriver> = { github, gitlab, gitee, gitea };

export type ListResult = {
	pullRequests: PullRequestSummary[];
	/** What each account has to say for itself, keyed by id. Absent means it answered. */
	errors: Record<string, string>;
	/** Set only when there is nothing else to say: no accounts, or every one of them failed. */
	error?: string;
};

/**
 * The connection for an account, or a message saying why there is not one.
 *
 * A missing token is its own case rather than a generic failure: it means the keychain rejected
 * something it stored — a copied home directory, a keychain entry removed — and the fix is to sign
 * in again, which is worth saying out loud.
 */
async function connect(accountId: string): Promise<ForgeConnection> {
	const account = await accountById(accountId);
	if (!account) throw new Error("这个账号已经不在了，去设置里重新添加");
	const token = await tokenFor(accountId);
	if (!token) throw new Error(`${account.label} 的令牌读不出来了，去设置里重新填一次`);
	return { account, token };
}

const driverFor = (kind: ForgeKind): ForgeDriver => DRIVERS[kind];

/**
 * The one search in flight, handed to everyone who asks while it is running.
 *
 * The list refreshes itself — on a timer, when the window comes back, and whenever somebody
 * presses the arrow — so two requests for the same answer at the same time is the normal case, not
 * a theoretical one. Each is a round trip per account, and the second cannot return anything the
 * first will not.
 */
let inFlight: Promise<ListResult> | null = null;

export function listPullRequests(): Promise<ListResult> {
	if (!inFlight) {
		inFlight = collect().finally(() => {
			inFlight = null;
		});
	}
	return inFlight;
}

async function collect(): Promise<ListResult> {
	const accounts = (await listAccounts()).filter((account) => account.enabled);
	if (accounts.length === 0) {
		return { pullRequests: [], errors: {}, error: "还没有添加代码托管账号" };
	}

	const results = await Promise.all(
		accounts.map(async (account) => {
			try {
				const conn = await connect(account.id);
				return { account, rows: await driverFor(account.kind).list(conn), error: null as string | null };
			} catch (error) {
				return { account, rows: [] as PullRequestSummary[], error: describe(error) };
			}
		}),
	);

	const errors: Record<string, string> = {};
	for (const result of results) {
		if (result.error) errors[result.account.id] = result.error;
		/*
		 * The last outcome is remembered, so a tab can explain itself before anything is fetched.
		 *
		 * Written only when it changed. This runs every 45 seconds, and rewriting a file holding
		 * every one of the user's tokens on a timer, to record that nothing happened, is not a thing
		 * to do casually.
		 */
		if ((result.account.lastError ?? "") !== (result.error ?? "")) {
			await updateAccount(result.account.id, { lastError: result.error ?? "" }).catch(() => {});
		}
	}

	const pullRequests = results.flatMap((result) => result.rows).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	// Every account failing is one message, not four identical ones under an empty list.
	const allFailed = results.every((result) => result.error);
	return {
		pullRequests,
		errors,
		...(allFailed ? { error: results.length === 1 ? results[0].error! : "所有账号都没能读到 Pull Request" } : {}),
	};
}

export async function pullRequestDetail(
	accountId: string,
	repo: string,
	number: number,
): Promise<{ detail?: PullRequestDetail; error?: string }> {
	try {
		const conn = await connect(accountId);
		return { detail: await driverFor(conn.account.kind).detail(conn, repo, number) };
	} catch (error) {
		return { error: describe(error) };
	}
}

export async function pullRequestDiff(
	accountId: string,
	repo: string,
	number: number,
): Promise<{ files: WorkspaceDiffFile[]; error?: string }> {
	try {
		const conn = await connect(accountId);
		return { files: await driverFor(conn.account.kind).diff(conn, repo, number) };
	} catch (error) {
		return { files: [], error: describe(error) };
	}
}

export async function commentOnPullRequest(
	accountId: string,
	repo: string,
	number: number,
	body: string,
): Promise<{ error?: string }> {
	if (!body.trim()) return { error: "评论不能为空" };
	try {
		const conn = await connect(accountId);
		await driverFor(conn.account.kind).comment(conn, repo, number, body);
		return {};
	} catch (error) {
		return { error: describe(error) };
	}
}

export async function reviewPullRequest(
	accountId: string,
	repo: string,
	number: number,
	verdict: ReviewVerdict,
	body: string,
): Promise<{ error?: string }> {
	// Every host refuses a change request with no explanation, and the errors they return for it
	// are opaque. Answering here costs a round trip nobody has to think about.
	if (verdict === "request-changes" && !body.trim()) return { error: "请求修改需要说明理由" };
	try {
		const conn = await connect(accountId);
		await driverFor(conn.account.kind).review(conn, repo, number, verdict, body);
		return {};
	} catch (error) {
		return { error: describe(error) };
	}
}

/**
 * Prove a token works, then keep it.
 *
 * Verified before it is stored, always. A token saved without being checked is an account that
 * looks fine in settings and produces an empty list on a screen somewhere else, and the distance
 * between those two places is where the confusion lives. This way the failure lands on the form,
 * next to the field that caused it, while the person still has the token on their clipboard.
 */
export async function signIn(input: {
	kind: ForgeKind;
	baseUrl: string;
	token: string;
	label?: string;
}): Promise<{ account?: ForgeAccount; error?: string }> {
	const baseUrl = normalizeServer(input.baseUrl);
	if (!baseUrl) return { error: "服务地址填得不对，应该像 https://gitlab.com" };
	if (!input.token.trim()) return { error: "把令牌粘贴进来" };

	const draft: ForgeAccount = {
		id: randomUUID(),
		kind: input.kind,
		baseUrl,
		label: input.label?.trim() || "",
		login: "",
		avatarUrl: null,
		addedAt: Date.now(),
		enabled: true,
	};

	try {
		const identity = await driverFor(input.kind).identify({ account: draft, token: input.token.trim() });
		// Re-adding an account is nearly always a replaced token, and answering that with a second
		// tab for the same person is how a list of accounts becomes a list of attempts.
		const existing = (await listAccounts()).find((a) => sameIdentity(a, { ...draft, login: identity.login }));
		const account: ForgeAccount = {
			...draft,
			id: existing?.id ?? draft.id,
			login: identity.login,
			avatarUrl: identity.avatarUrl,
			label: draft.label || existing?.label || defaultLabel(identity),
			addedAt: existing?.addedAt ?? draft.addedAt,
			enabled: true,
			lastError: "",
		};
		await saveAccount(account, input.token.trim());
		return { account };
	} catch (error) {
		return { error: describe(error) };
	}
}

export async function accounts(): Promise<ForgeAccount[]> {
	return listAccounts();
}

export async function setAccountEnabled(id: string, enabled: boolean): Promise<ForgeAccount | null> {
	return updateAccount(id, { enabled });
}

export async function renameAccount(id: string, label: string): Promise<ForgeAccount | null> {
	const trimmed = label.trim();
	const account = await accountById(id);
	if (!account) return null;
	return updateAccount(id, { label: trimmed || defaultLabel({ login: account.login, name: account.login, avatarUrl: null }) });
}

export async function signOut(id: string): Promise<void> {
	await removeAccount(id);
}
