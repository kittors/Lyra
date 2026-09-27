/**
 * GitLab, whose merge requests are pull requests with different words on them.
 *
 * The mapping is mostly mechanical — `iid` is the number, `opened` is `OPEN`, a note is a comment
 * — and the three places it is not are worth knowing:
 *
 * 1. There is no `reviewDecision`. Approval is its own resource, so the verdict a row draws comes
 *    from a second request rather than from a field.
 * 2. "Request changes" does not exist as an event. Unapproving and saying why is the closest
 *    honest equivalent, and it is what the GitLab UI itself leaves behind.
 * 3. A merge request carries no line counts. `changes_count` is a file count as a string, capped
 *    at `"1000+"`; the additions and deletions only exist inside the diff, which is loaded when
 *    somebody opens the code tab and not before.
 */

import type { PullRequestDetail, PullRequestSummary, WorkspaceDiffFile } from "../ipc-shapes.ts";
import { parseUnifiedDiff } from "../diff-parse.ts";
import { nativeText } from "../i18n.ts";
import type { Relation } from "../pr-summary.ts";
import { assembleDiff } from "./patch.ts";
import { DIFF_TIMEOUT_MS, json } from "./http.ts";
import type { ForgeConnection, ForgeDriver, ForgeIdentity, ReviewVerdict } from "./types.ts";

/** Enough to see everything current without turning the list into an archive. */
const PER_BUCKET = 30;

interface RawMr {
	iid: number;
	title: string;
	description?: string;
	state?: string;
	draft?: boolean;
	work_in_progress?: boolean;
	created_at: string;
	updated_at: string;
	web_url: string;
	source_branch?: string;
	target_branch?: string;
	user_notes_count?: number;
	changes_count?: string;
	merge_status?: string;
	detailed_merge_status?: string;
	has_conflicts?: boolean;
	labels?: string[];
	author?: { username?: string; name?: string; avatar_url?: string } | null;
	reviewers?: { username?: string }[] | null;
	references?: { full?: string } | null;
	head_pipeline?: { status?: string; web_url?: string } | null;
	pipeline?: { status?: string; web_url?: string } | null;
}

/**
 * `group/project` for a merge request.
 *
 * `references.full` is `group/project!12`, which is the only field carrying the path — the list
 * endpoint returns `project_id` and nothing else, and resolving a numeric id would be one request
 * per distinct project on every refresh. The web URL is the fallback, and it has to survive
 * subgroups (`a/b/c/-/merge_requests/1`), which is what the `/-/` split is for.
 */
function repoOf(mr: RawMr): string {
	const full = mr.references?.full ?? "";
	const cut = full.indexOf("!");
	if (cut > 0) return full.slice(0, cut);
	try {
		const path = new URL(mr.web_url).pathname.replace(/^\//, "");
		const at = path.indexOf("/-/");
		return at > 0 ? path.slice(0, at) : path;
	} catch {
		return full;
	}
}

/** A project path as GitLab wants it in a URL: one encoded segment, slashes and all. */
const projectId = (repo: string) => encodeURIComponent(repo.replace(/^\/+|\/+$/g, ""));

/** Pipeline status, in the three outcomes a reviewer acts on. Null when nothing ran. */
function pipelineState(status: string | undefined): PullRequestSummary["checkState"] {
	const raw = (status ?? "").toLowerCase();
	if (!raw) return null;
	if (raw === "success" || raw === "skipped" || raw === "manual") return "pass";
	if (raw === "failed" || raw === "canceled" || raw === "cancelled") return "fail";
	return "pending";
}

function toSummary(mr: RawMr, relation: Relation, accountId: string): PullRequestSummary {
	const pipeline = mr.head_pipeline ?? mr.pipeline ?? null;
	return {
		accountId,
		repo: repoOf(mr),
		number: mr.iid,
		title: mr.title,
		author: mr.author?.username ?? mr.author?.name ?? "unknown",
		avatarUrl: mr.author?.avatar_url ?? null,
		state: (mr.state ?? "opened").toUpperCase() === "OPENED" ? "OPEN" : (mr.state ?? "").toUpperCase(),
		isDraft: mr.draft === true || mr.work_in_progress === true,
		url: mr.web_url,
		createdAt: mr.created_at,
		updatedAt: mr.updated_at,
		comments: mr.user_notes_count ?? 0,
		relation,
		// Only the diff knows, and the diff is not loaded to draw a row. Null draws nothing, which
		// is honest; zero would draw `+0 −0` on a merge request that changes a thousand lines.
		additions: null,
		deletions: null,
		headRefName: mr.source_branch || null,
		checkState: pipelineState(pipeline?.status),
		reviewDecision: null,
	};
}

/**
 * The three buckets, as three queries GitLab actually has.
 *
 * `reviews_for_me` and `created_by_me` are exact. The third is not: GitLab has no "I reviewed
 * this" scope, and `approved_by_usernames` — the nearest thing — is a paid feature. So it is asked
 * for, and a failure is allowed to mean "this instance does not do that" rather than an error on
 * a screen. The other two buckets are the ones people actually work from.
 */
const BUCKETS: { relation: Relation; query: Record<string, string | number | string[]> }[] = [
	{ relation: "reviewing", query: { scope: "reviews_for_me" } },
	{ relation: "authored", query: { scope: "created_by_me" } },
	{ relation: "reviewed", query: { scope: "all" } },
];

export const gitlab: ForgeDriver = {
	kind: "gitlab",

	async identify(conn: ForgeConnection): Promise<ForgeIdentity> {
		const user = await json<{ username?: string; name?: string; avatar_url?: string }>(conn, "/user");
		if (!user?.username) throw new Error(nativeText("forge.noUserInfo"));
		return { login: user.username, name: user.name || user.username, avatarUrl: user.avatar_url ?? null };
	},

	async list(conn: ForgeConnection): Promise<PullRequestSummary[]> {
		const me = conn.account.login;
		const results = await Promise.allSettled(
			BUCKETS.map(({ relation, query }) =>
				json<RawMr[]>(conn, "/merge_requests", {
					query: {
						...query,
						state: "opened",
						per_page: PER_BUCKET,
						order_by: "updated_at",
						// The third bucket is only meaningful with this filter, and it is the one that
						// may be refused — which is why it is on the query rather than filtered after.
						...(relation === "reviewed" ? { "approved_by_usernames[]": [me] } : {}),
					},
				}).then((list) => (list ?? []).map((mr) => toSummary(mr, relation, conn.account.id))),
			),
		);

		/*
		 * A bucket that failed is dropped, not fatal — unless all of them failed.
		 *
		 * The approved-by filter is a paid feature and 400s on the free tier, which must not empty a
		 * list that the other two queries answered perfectly well. But a bad token fails all three,
		 * and reporting that as "no merge requests" is the failure mode this whole file exists to
		 * avoid, so the first error is rethrown when nothing at all came back.
		 */
		const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
		if (ok.length === 0) throw results.find((r) => r.status === "rejected")?.reason ?? new Error(nativeText("forge.noMergeRequests"));

		const seen = new Set<string>();
		return ok
			.flat()
			.filter((mr) => (seen.has(`${mr.repo}!${mr.number}`) ? false : seen.add(`${mr.repo}!${mr.number}`)))
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	},

	async detail(conn: ForgeConnection, repo: string, number: number): Promise<PullRequestDetail> {
		const at = `/projects/${projectId(repo)}/merge_requests/${number}`;
		const [mr, notes, approvals, commits] = await Promise.all([
			json<RawMr>(conn, at),
			json<RawNote[]>(conn, `${at}/notes`, { query: { per_page: 100, sort: "asc", order_by: "created_at" } }).catch(() => []),
			json<RawApprovals>(conn, `${at}/approvals`).catch(() => ({}) as RawApprovals),
			json<RawCommit[]>(conn, `${at}/commits`, { query: { per_page: 100 } }).catch(() => []),
		]);

		const summary = toSummary(mr, "authored", conn.account.id);
		const pipeline = mr.head_pipeline ?? mr.pipeline ?? null;
		// Human notes only. GitLab writes an entry for every assignment, label and milestone change,
		// and a conversation that is nine parts bookkeeping is one nobody reads.
		const said = (notes ?? []).filter((note) => !note.system);
		const approvedBy = (approvals.approved_by ?? []).map((a) => a.user?.username ?? "").filter(Boolean);

		return {
			...summary,
			reviewDecision: approvals.approved ? "APPROVED" : (approvals.approvals_required ?? 0) > 0 ? "REVIEW_REQUIRED" : null,
			body: mr.description ?? "",
			additions: 0,
			deletions: 0,
			// `"1000+"` for anything past the cap, which `parseInt` reads as 1000 — the right answer
			// for a number whose only job is to say "a lot".
			changedFiles: Number.parseInt(mr.changes_count ?? "0", 10) || 0,
			headRefName: mr.source_branch ?? "",
			baseRefName: mr.target_branch ?? "",
			comments: said.length,
			threads: said.map((note) => ({
				author: note.author?.username ?? "unknown",
				body: note.body ?? "",
				createdAt: note.created_at ?? "",
			})),
			reviews: approvedBy.map((login) => ({ author: login, state: "APPROVED", body: "", submittedAt: "" })),
			reviewers: [
				...(mr.reviewers ?? []).map((r) => ({ login: r.username ?? "", state: "REQUESTED" })),
				...approvedBy.map((login) => ({ login, state: "APPROVED" })),
			].filter((r) => r.login),
			/*
			 * The pipeline as a single check, rather than its jobs.
			 *
			 * Its jobs are another request against another endpoint, for a list the header only
			 * summarises anyway — and the link goes to the page where the failing job is named,
			 * which is where somebody is heading the moment it is red.
			 */
			checks: pipeline?.status
				? {
						total: 1,
						passed: pipelineState(pipeline.status) === "pass" ? 1 : 0,
						failed: pipelineState(pipeline.status) === "fail" ? 1 : 0,
						pending: pipelineState(pipeline.status) === "pending" ? 1 : 0,
						items: [
							{
								name: `流水线 · ${pipeline.status}`,
								state: pipelineState(pipeline.status) ?? "pending",
								...(pipeline.web_url ? { url: pipeline.web_url } : {}),
							},
						],
					}
				: null,
			mergeable: mr.has_conflicts ? "CONFLICTING" : mr.detailed_merge_status === "mergeable" || mr.merge_status === "can_be_merged" ? "MERGEABLE" : "UNKNOWN",
			labels: mr.labels ?? [],
			commits: (commits ?? []).map((commit) => ({
				sha: (commit.short_id || commit.id || "").slice(0, 7),
				headline: commit.title ?? "",
				author: commit.author_name ?? "",
				at: commit.created_at ?? "",
			})),
		};
	},

	async diff(conn: ForgeConnection, repo: string, number: number): Promise<WorkspaceDiffFile[]> {
		const body = await json<{ changes?: RawChange[] }>(conn, `/projects/${projectId(repo)}/merge_requests/${number}/changes`, {
			timeoutMs: DIFF_TIMEOUT_MS,
		});
		return parseUnifiedDiff(
			assembleDiff(
				(body.changes ?? []).map((change) => ({
					oldPath: change.old_path ?? change.new_path ?? "",
					newPath: change.new_path ?? change.old_path ?? "",
					patch: change.diff ?? "",
					added: change.new_file,
					deleted: change.deleted_file,
					renamed: change.renamed_file,
				})),
			),
		);
	},

	async comment(conn: ForgeConnection, repo: string, number: number, body: string): Promise<void> {
		await json(conn, `/projects/${projectId(repo)}/merge_requests/${number}/notes`, { method: "POST", body: { body } });
	},

	/**
	 * The three verdicts, two of which GitLab has.
	 *
	 * A change request is a note plus an unapproval, in that order: the note is the part that
	 * matters to the author, so it goes first and a failure to unapprove afterwards does not lose
	 * it. Unapproving something you never approved is a no-op GitLab answers with 404, which is
	 * why it is allowed to fail quietly.
	 */
	async review(conn: ForgeConnection, repo: string, number: number, verdict: ReviewVerdict, body: string): Promise<void> {
		const at = `/projects/${projectId(repo)}/merge_requests/${number}`;
		if (body.trim()) await json(conn, `${at}/notes`, { method: "POST", body: { body } });
		if (verdict === "approve") await json(conn, `${at}/approve`, { method: "POST" });
		if (verdict === "request-changes") await json(conn, `${at}/unapprove`, { method: "POST" }).catch(() => {});
	},
};

interface RawNote {
	body?: string;
	created_at?: string;
	system?: boolean;
	author?: { username?: string } | null;
}

interface RawApprovals {
	approved?: boolean;
	approvals_required?: number;
	approved_by?: { user?: { username?: string } }[];
}

interface RawCommit {
	id?: string;
	short_id?: string;
	title?: string;
	created_at?: string;
	author_name?: string;
}

interface RawChange {
	old_path?: string;
	new_path?: string;
	diff?: string;
	new_file?: boolean;
	deleted_file?: boolean;
	renamed_file?: boolean;
}
