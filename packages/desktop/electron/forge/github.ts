/**
 * GitHub, over its own API rather than through `gh`.
 *
 * Same two GraphQL queries `gh` would have run underneath, minus the process, the install and the
 * single shared identity. What that buys, beyond not depending on a CLI: GitHub Enterprise works
 * by typing an address, and two accounts on two hosts are two tabs rather than a re-login.
 *
 * The awkward part is one line of it. Enterprise serves REST from `/api/v3` and GraphQL from
 * `/api/graphql` — siblings, not parent and child — so the GraphQL root is computed rather than
 * appended.
 */

import { parseUnifiedDiff } from "../diff-parse.ts";
import type { PullRequestDetail, PullRequestSummary, WorkspaceDiffFile } from "../ipc-shapes.ts";
import { BUCKETS, dedupe, parseSearch, PER_BUCKET, SEARCH_QUERY, toSummary } from "../pr-summary.ts";
import { nativeText } from "../i18n.ts";
import { ForgeError } from "./errors.ts";
import { DETAIL_QUERY, type DetailNode, toDetail } from "./github-gql.ts";
import { DIFF_TIMEOUT_MS, json, text } from "./http.ts";
import type { ForgeConnection, ForgeDriver, ForgeIdentity, ReviewVerdict } from "./types.ts";

/** `owner/name`, refused rather than guessed at — every path below interpolates both halves. */
function split(repo: string): { owner: string; name: string } {
	const parts = repo.split("/").filter(Boolean);
	if (parts.length < 2) throw new ForgeError(nativeText("forge.badRepoName", { repo }), 0);
	return { owner: parts[parts.length - 2], name: parts[parts.length - 1] };
}

/** Where this instance answers GraphQL, which is not under the REST root on Enterprise. */
function graphqlRoot(conn: ForgeConnection): string {
	const base = conn.account.baseUrl.replace(/\/+$/, "");
	return base === "https://github.com" ? "https://api.github.com" : `${base}/api`;
}

/**
 * One GraphQL request, with its errors treated as errors.
 *
 * GraphQL delivers failure with a 200 and an `errors` array, so it has to be looked for rather
 * than caught. Rate limiting is exactly that shape — the failure this query exists to avoid — and
 * reporting it as an empty list would be the worst of both.
 */
async function graphql<T>(conn: ForgeConnection, query: string, variables: Record<string, unknown>): Promise<T> {
	const body = await json<{ data?: T; errors?: { message?: string; type?: string }[] }>(conn, "/graphql", {
		method: "POST",
		root: graphqlRoot(conn),
		body: { query, variables },
	});
	if (body.errors?.length) {
		const message = body.errors.map((e) => e.message).filter(Boolean).join("; ");
		const limited = body.errors.some((e) => e.type === "RATE_LIMITED") || /rate limit/i.test(message);
		throw new ForgeError(limited ? nativeText("forge.githubRateLimited") : message || nativeText("forge.githubRejected"), 0);
	}
	if (!body.data) throw new ForgeError(nativeText("forge.githubNoData"), 0);
	return body.data;
}

export const github: ForgeDriver = {
	kind: "github",

	async identify(conn: ForgeConnection): Promise<ForgeIdentity> {
		const user = await json<{ login?: string; name?: string; avatar_url?: string }>(conn, "/user");
		if (!user?.login) throw new ForgeError(nativeText("forge.noUserInfo"), 0);
		return { login: user.login, name: user.name || user.login, avatarUrl: user.avatar_url ?? null };
	},

	/**
	 * The three buckets in one request.
	 *
	 * Three aliased searches rather than three calls, because GitHub rate-limits the REST search
	 * endpoint at thirty requests a minute — separate from and far smaller than the ordinary budget
	 * — and this list refreshes itself on a timer. Measured, the whole thing costs one point of the
	 * five thousand an hour that GraphQL charges against.
	 */
	async list(conn: ForgeConnection): Promise<PullRequestSummary[]> {
		const data = await graphql<Record<string, unknown>>(conn, SEARCH_QUERY, {
			...Object.fromEntries(BUCKETS.map(({ relation, query }) => [relation, query])),
			n: PER_BUCKET,
		});
		const found = parseSearch({ data });
		return dedupe(BUCKETS.map(({ relation }) => found[relation].map((node) => toSummary(node, relation, conn.account.id))));
	},

	async detail(conn: ForgeConnection, repo: string, number: number): Promise<PullRequestDetail> {
		const { owner, name } = split(repo);
		const data = await graphql<{ repository?: { pullRequest?: DetailNode | null } | null }>(conn, DETAIL_QUERY, {
			owner,
			name,
			number,
		});
		const node = data.repository?.pullRequest;
		if (!node) throw new ForgeError(nativeText("forge.pullRequestMissing", { repo, number }), 404);
		return toDetail(conn.account.id, repo, node);
	},

	/**
	 * The diff, asked for by content negotiation rather than assembled from a file list.
	 *
	 * `application/vnd.github.diff` returns exactly what `git diff` would print, which is the one
	 * format this app already has a parser for. The per-file endpoint would mean paginating a
	 * hundred files to rebuild something GitHub will hand over whole.
	 */
	async diff(conn: ForgeConnection, repo: string, number: number): Promise<WorkspaceDiffFile[]> {
		const { owner, name } = split(repo);
		const raw = await text(conn, `/repos/${owner}/${name}/pulls/${number}`, {
			accept: "application/vnd.github.diff",
			timeoutMs: DIFF_TIMEOUT_MS,
		});
		return parseUnifiedDiff(raw);
	},

	async comment(conn: ForgeConnection, repo: string, number: number, body: string): Promise<void> {
		const { owner, name } = split(repo);
		// The issues endpoint, not the pulls one: on GitHub a conversation comment belongs to the
		// issue behind the pull request, and `/pulls/{n}/comments` is for comments on lines of code.
		await json(conn, `/repos/${owner}/${name}/issues/${number}/comments`, { method: "POST", body: { body } });
	},

	async review(conn: ForgeConnection, repo: string, number: number, verdict: ReviewVerdict, body: string): Promise<void> {
		const { owner, name } = split(repo);
		const event = verdict === "approve" ? "APPROVE" : verdict === "request-changes" ? "REQUEST_CHANGES" : "COMMENT";
		await json(conn, `/repos/${owner}/${name}/pulls/${number}/reviews`, {
			method: "POST",
			body: { event, ...(body.trim() ? { body } : {}) },
		});
	},
};
