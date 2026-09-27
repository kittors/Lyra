/**
 * Gitee, which has no way to ask "what is waiting on me".
 *
 * Every other host here answers that in one request. Gitee's API is per-repository all the way
 * down — its published surface has no cross-repository pull request search, and its only global
 * endpoints are for issues — so the list is built the only way it can be: take the repositories
 * this account touched most recently, ask each one for its open pull requests, and sort out who
 * they belong to here.
 *
 * That is a real cost and it is spent carefully. The repository list is cached, the scan is capped
 * at the ones actually being worked in, and the requests are pooled rather than fired at once —
 * because the failure mode of getting this wrong is not slowness, it is being rate-limited by the
 * host and showing an empty list.
 *
 * Two buckets rather than three: Gitee models a reviewer as an assignee or a tester, and has no
 * notion of "pull requests I have already reviewed". Inventing one would mean guessing.
 */

import { parseUnifiedDiff } from "../diff-parse.ts";
import { nativeText } from "../i18n.ts";
import type { PullRequestDetail, PullRequestSummary, WorkspaceDiffFile } from "../ipc-shapes.ts";
import { ForgeError } from "./errors.ts";
import { assembleDiff, type PatchFile } from "./patch.ts";
import { DIFF_TIMEOUT_MS, json, pooled } from "./http.ts";
import type { ForgeConnection, ForgeDriver, ForgeIdentity, ReviewVerdict } from "./types.ts";

/**
 * How many repositories one refresh looks at.
 *
 * Sorted by last push, so these are the ones being worked in rather than the ones that exist. Past
 * about twenty the requests cost more than the rows are worth — a repository nobody has pushed to
 * in months rarely has a pull request waiting on you today.
 */
const SCAN_REPOS = 20;

/** At once. Gitee is stricter about bursts than about volume. */
const CONCURRENCY = 5;

/** How long the repository list is reused. Long enough that a 45-second refresh does not re-ask. */
const REPOS_TTL_MS = 10 * 60_000;

const repoCache = new Map<string, { at: number; repos: string[] }>();

interface RawPull {
	number: number;
	title: string;
	body?: string;
	state?: string;
	draft?: boolean;
	mergeable?: boolean;
	html_url: string;
	created_at: string;
	updated_at: string;
	comments?: number;
	user?: { login?: string; avatar_url?: string; name?: string } | null;
	head?: { ref?: string; repo?: { full_name?: string } | null } | null;
	base?: { ref?: string; repo?: { full_name?: string } | null } | null;
	assignees?: ({ login?: string } | null)[] | null;
	testers?: ({ login?: string } | null)[] | null;
	labels?: { name?: string }[] | null;
}

function split(repo: string): { owner: string; name: string } {
	const parts = repo.split("/").filter(Boolean);
	if (parts.length < 2) throw new ForgeError(nativeText("forge.badRepoName", { repo }), 0);
	return { owner: parts[parts.length - 2], name: parts[parts.length - 1] };
}

/** The repositories to scan, cached so a periodic refresh does not re-list them every time. */
async function repositories(conn: ForgeConnection): Promise<string[]> {
	const hit = repoCache.get(conn.account.id);
	if (hit && Date.now() - hit.at < REPOS_TTL_MS) return hit.repos;

	const list = await json<{ full_name?: string }[]>(conn, "/user/repos", {
		query: { sort: "pushed", direction: "desc", per_page: 100 },
	});
	const repos = (list ?? []).map((repo) => repo.full_name ?? "").filter(Boolean).slice(0, SCAN_REPOS);
	repoCache.set(conn.account.id, { at: Date.now(), repos });
	return repos;
}

const named = (people: ({ login?: string } | null)[] | null | undefined, me: string) =>
	(people ?? []).some((person) => (person?.login ?? "").toLowerCase() === me);

function toSummary(pull: RawPull, repo: string, relation: PullRequestSummary["relation"], accountId: string): PullRequestSummary {
	return {
		accountId,
		repo,
		number: pull.number,
		title: pull.title,
		author: pull.user?.login ?? pull.user?.name ?? "unknown",
		avatarUrl: pull.user?.avatar_url ?? null,
		state: (pull.state ?? "open").toUpperCase(),
		isDraft: pull.draft === true,
		url: pull.html_url,
		createdAt: pull.created_at,
		updatedAt: pull.updated_at,
		comments: pull.comments ?? 0,
		relation,
		// Gitee reports line counts per file and only on request; a row is not worth that.
		additions: null,
		deletions: null,
		headRefName: pull.head?.ref || null,
		// No commit status API to ask.
		checkState: null,
		reviewDecision: null,
	};
}

export const gitee: ForgeDriver = {
	kind: "gitee",

	async identify(conn: ForgeConnection): Promise<ForgeIdentity> {
		const user = await json<{ login?: string; name?: string; avatar_url?: string }>(conn, "/user");
		if (!user?.login) throw new ForgeError(nativeText("forge.noUserInfo"), 0);
		return { login: user.login, name: user.name || user.login, avatarUrl: user.avatar_url ?? null };
	},

	async list(conn: ForgeConnection): Promise<PullRequestSummary[]> {
		const me = conn.account.login.toLowerCase();
		const repos = await repositories(conn);

		const perRepo = await pooled(repos, CONCURRENCY, async (repo) => {
			const { owner, name } = split(repo);
			/*
			 * One request per repository, then sorted out here.
			 *
			 * Gitee will filter by `author` and by `assignee`, but those are two requests for two
			 * buckets — forty requests instead of twenty, for an answer both of them are already in.
			 */
			const pulls = await json<RawPull[]>(conn, `/repos/${owner}/${name}/pulls`, {
				query: { state: "open", sort: "updated", direction: "desc", per_page: 100 },
			}).catch(() => [] as RawPull[]);

			return (pulls ?? []).flatMap((pull) => {
				const mine = (pull.user?.login ?? "").toLowerCase() === me;
				const asked = named(pull.assignees, me) || named(pull.testers, me);
				// Order matters: something you wrote *and* were asked to test is yours first.
				if (mine) return [toSummary(pull, repo, "authored", conn.account.id)];
				if (asked) return [toSummary(pull, repo, "reviewing", conn.account.id)];
				return [];
			});
		});

		return perRepo.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	},

	async detail(conn: ForgeConnection, repo: string, number: number): Promise<PullRequestDetail> {
		const { owner, name } = split(repo);
		const at = `/repos/${owner}/${name}/pulls/${number}`;
		const [pull, comments, commits] = await Promise.all([
			json<RawPull>(conn, at),
			json<RawComment[]>(conn, `${at}/comments`, { query: { per_page: 100 } }).catch(() => []),
			json<RawCommit[]>(conn, `${at}/commits`).catch(() => []),
		]);

		const summary = toSummary(pull, repo, "authored", conn.account.id);
		return {
			...summary,
			body: pull.body ?? "",
			// Only `/files` knows, and that is the diff — loaded when the code tab is opened.
			additions: 0,
			deletions: 0,
			changedFiles: 0,
			headRefName: pull.head?.ref ?? "",
			baseRefName: pull.base?.ref ?? "",
			comments: comments?.length ?? pull.comments ?? 0,
			threads: (comments ?? []).map((comment) => ({
				author: comment.user?.login ?? "unknown",
				body: comment.body ?? "",
				createdAt: comment.created_at ?? "",
			})),
			// Gitee records an approval as a state change on the pull request, not as a review with a
			// body — so there is nothing to list here that the reviewer line does not already say.
			reviews: [],
			reviewers: [
				...(pull.assignees ?? []).map((person) => ({ login: person?.login ?? "", state: "REQUESTED" })),
				...(pull.testers ?? []).map((person) => ({ login: person?.login ?? "", state: "REQUESTED" })),
			].filter((r) => r.login),
			checks: null,
			mergeable: pull.mergeable === false ? "CONFLICTING" : "MERGEABLE",
			labels: (pull.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
			commits: (commits ?? []).map((commit) => ({
				sha: (commit.sha ?? "").slice(0, 7),
				headline: (commit.commit?.message ?? "").split("\n")[0],
				author: commit.author?.login || commit.commit?.author?.name || "",
				at: commit.commit?.author?.date ?? "",
			})),
		};
	},

	/**
	 * The changed files, whose shape is not the one Gitee documents.
	 *
	 * Its Swagger says `patch` is a string and `status` is a string. Against the live API, `patch`
	 * is an object — the same one GitLab returns for a change, right down to the field names — and
	 * `status` is `null`. So the object is what is read, with the flat string kept as a fallback
	 * for whatever version does return one, and `status` is ignored in favour of the flags on the
	 * patch, which are the ones that are actually populated.
	 *
	 * `too_large` is Gitee declining to send a diff at all. Marked as binary rather than dropped:
	 * the file did change, and a review that silently omits it is worse than one that says there is
	 * nothing to show.
	 */
	async diff(conn: ForgeConnection, repo: string, number: number): Promise<WorkspaceDiffFile[]> {
		const { owner, name } = split(repo);
		const files = await json<RawFile[]>(conn, `/repos/${owner}/${name}/pulls/${number}/files`, {
			timeoutMs: DIFF_TIMEOUT_MS,
		});
		return parseUnifiedDiff(assembleDiff(toPatchFiles(files ?? [])));
	},

	async comment(conn: ForgeConnection, repo: string, number: number, body: string): Promise<void> {
		const { owner, name } = split(repo);
		await json(conn, `/repos/${owner}/${name}/pulls/${number}/comments`, { method: "POST", body: { body } });
	},

	/**
	 * Approving is an endpoint; the other two are comments.
	 *
	 * Gitee has one review verb — 审查通过 — and no way to record a rejection. Saying so in a
	 * comment is what a person would do anyway, and it is the whole of what the author will see;
	 * pretending there is a verdict behind it would be a claim this app cannot back up.
	 */
	async review(conn: ForgeConnection, repo: string, number: number, verdict: ReviewVerdict, body: string): Promise<void> {
		const { owner, name } = split(repo);
		const at = `/repos/${owner}/${name}/pulls/${number}`;
		if (body.trim()) await json(conn, `${at}/comments`, { method: "POST", body: { body } });
		if (verdict === "approve") await json(conn, `${at}/review`, { method: "POST" });
	},
};

/**
 * Gitee's file list, as the shape `patch.ts` reassembles.
 *
 * Exported for the tests, because this is the one mapping here that cannot be read off the docs:
 * against the live API `patch` is an *object* — GitLab's change, field for field — and `status` is
 * `null`, where the published Swagger declares both as strings. Whatever a future version does,
 * the two forms are both handled and this is where that is checked.
 */
export function toPatchFiles(files: RawFile[]): PatchFile[] {
	return files.map((file) => {
		const patch = typeof file.patch === "string" ? null : (file.patch ?? null);
		const body = (patch ? patch.diff : typeof file.patch === "string" ? file.patch : "") ?? "";
		const oldPath = patch?.old_path || file.filename || "";
		const newPath = patch?.new_path || file.filename || oldPath;
		const renamed = patch?.renamed_file === true || file.status === "renamed";
		return {
			oldPath,
			newPath,
			patch: body,
			added: patch?.new_file === true || file.status === "added",
			deleted: patch?.deleted_file === true || file.status === "removed",
			renamed,
			/*
			 * `too_large` is Gitee declining to send the diff at all.
			 *
			 * Marked as binary rather than dropped: the file did change, and a review that silently
			 * omits it is worse than one that says there is nothing to show. Same for a file with no
			 * body and no rename — there is nothing to draw either way.
			 */
			binary: patch?.too_large === true || (!body && !renamed),
		};
	});
}

interface RawComment {
	body?: string;
	created_at?: string;
	user?: { login?: string } | null;
}

interface RawCommit {
	sha?: string;
	author?: { login?: string } | null;
	commit?: { message?: string; author?: { name?: string; date?: string } } | null;
}

export interface RawFile {
	filename?: string;
	/** Documented as a string; observed to be null. Read only as a fallback. */
	status?: string | null;
	/** Documented as a string; observed to be GitLab's change object. Both are handled. */
	patch?: string | RawPatch | null;
}

interface RawPatch {
	diff?: string;
	old_path?: string;
	new_path?: string;
	new_file?: boolean;
	deleted_file?: boolean;
	renamed_file?: boolean;
	too_large?: boolean;
}
