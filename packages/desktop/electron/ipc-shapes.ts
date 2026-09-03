/**
 * The values that cross the process boundary, as shapes.
 *
 * Separate from the API surface that carries them: a snapshot of a session means the same thing
 * whether it arrived by invoke, by event or out of a file, and half of these are re-exports of
 * core's own types — the boundary does not get to have its own idea of what a session is.
 */

import type { BranchList } from "./git.ts";

export type { GitCommit, GitStatus, GitStatusFile, RepoRef } from "./git.ts";

/** The shape every diff view consumes, whatever produced it. */
export interface RefDiff {
	files: WorkspaceDiffFile[];
	added: number;
	removed: number;
}

export type { BranchList };
import type {
	ContextBreakdown,
	Registry,
	RegistryEntry,
	ContextSegmentKey,
	McpServerStatus,
	Plugin,
	QueuedTask,
	SessionMeta,
	Skill,
} from "@lyra/core";

export type { ContextBreakdown, ContextSegmentKey, QueuedTask, Registry, RegistryEntry };

/**
 * Which project the window is pointed at.
 *
 * It used to carry uncommitted line counts as well, on the strength of a comment saying the review
 * panel's header showed them. Nothing did — the counter above the composer polls `git.stat`, which
 * is where a number that changes while you watch belongs. Two fields nobody read cost every reader
 * of this record a full working-tree diff; see `workspace-info.ts`.
 */
export interface WorkspaceInfo {
	path: string;
	name: string;
	isGitRepo: boolean;
	branch: string | null;
	/**
	 * Why git could not say whether this is a repository, when it could not say.
	 *
	 * Distinct from `isGitRepo: false`, which means git answered no. This is the case where the
	 * question never got through — git missing, a checkout owned by someone else — and where the
	 * panel would otherwise offer to `git init` a directory that is already a repository.
	 */
	gitProblem?: string;
}

export interface SessionSnapshot {
	meta: SessionMeta;
	messages: import("@lyra/core").Message[];
	running: boolean;
	pendingApprovals: { id: string; kind: string; title: string; detail: string }[];
	/** Message positions where history was summarised, so the mark survives a reload. */
	compactions?: number[];
}

/**
 * The side chat's own transcript. Memory-only by design — it is gone when the app restarts,
 * and never reaches the session log.
 */
export interface SideChatSnapshot {
	messages: import("@lyra/core").Message[];
	running: boolean;
}

export interface FileEntry {
	name: string;
	/** Absolute, so the renderer never has to join paths itself. */
	path: string;
	isDirectory: boolean;
	size: number;
}

/**
 * What came of a create, rename, copy or delete.
 *
 * One shape for all of them so the panel has one thing to handle. `code` is what makes a failure
 * actionable rather than merely reported: `exists` is the one the caller can retry after asking
 * whether to replace, and the panel's replace prompt keys off exactly that.
 */
export interface FileOpResult {
	ok: boolean;
	/** What the operation produced: the file created, the path renamed to, the free name found. */
	path?: string;
	error?: string;
	code?: "exists" | "denied" | "descendant" | "invalid";
}

export interface FileContents {
	text: string;
	/** True when the file was longer than the read cap and only its head is here. */
	truncated: boolean;
	bytes: number;
	/** Set instead of `text` when the bytes are not text at all. */
	binary?: boolean;
	/** Last-modified time, so an editor can notice the file changed underneath it. */
	modifiedAt: number;
}

export interface AgentCapabilities {
	skills: Skill[];
	skillDiagnostics: { path: string; message: string }[];
	plugins: Plugin[];
	pluginDiagnostics: { path: string; message: string }[];
	mcp: McpServerStatus[];
	agents: { name: string; description: string; source: string; tools: string[] | "*" }[];
	toolNames: string[];
}

export interface ProviderTestResult {
	ok: boolean;
	latencyMs: number;
	message: string;
	/** Model ids the endpoint reported, when it exposes a listing. */
	models?: string[];
}

export interface SyncStatus {
	running: boolean;
	port: number;
	token: string | null;
	/**
	 * This machine's own IPv4 addresses, best-first.
	 *
	 * Ranked rather than merely listed: a development machine holds several, and the ones belonging
	 * to Docker bridges and VPN adapters are unreachable from the phone while looking exactly as
	 * plausible as the real one. See `localAddresses`.
	 */
	addresses: string[];
	clients: number;
	/** Ready-to-scan pairing payload for the mobile app, over the LAN. */
	pairingUrl: string | null;
	/** A reverse proxy or port forward that routes to this desktop, as configured. */
	publicUrl: string | null;
	/** A relay both sides dial out to, as configured. See `Settings.sync.relayUrl`. */
	relayUrl: string | null;
}

/**
 * A pull request as the list shows it.
 *
 * `relation` is why it is in the list at all, and what decides which group it appears under. The
 * three nullable fields come from a second request: search does not return them, and fetching
 * them per row would mean thirty round trips to decorate a list nobody has clicked yet.
 */
export interface PullRequestSummary {
	/**
	 * Which signed-in account this row came from.
	 *
	 * Carried on the row rather than looked up from the repository, because the repository is not
	 * enough to answer it: the same `owner/name` can exist on github.com and on a company's own
	 * GitHub Enterprise, and two accounts on one host is the ordinary case for anyone with a work
	 * identity. Everything done to a pull request afterwards — reading it, commenting, approving —
	 * goes back through the account it arrived on.
	 */
	accountId: string;
	repo: string;
	number: number;
	title: string;
	author: string;
	/**
	 * Where the author's picture is, as GitHub named it — not the picture.
	 *
	 * The page never fetches this itself; the main process turns it into a data URL on request.
	 * Carried per row rather than derived from the login because `github.com/<login>.png` is wrong
	 * for the accounts that post the most: a bot's picture belongs to the app, not to a user of the
	 * same name.
	 */
	avatarUrl: string | null;
	state: string;
	isDraft: boolean;
	url: string;
	createdAt: string;
	updatedAt: string;
	comments: number;
	relation: "reviewing" | "authored" | "reviewed";
	additions: number | null;
	deletions: number | null;
	headRefName: string | null;
	/**
	 * What CI says about the head commit, in the three outcomes a reviewer acts on.
	 *
	 * Null when the repository runs no checks at all, which is a different thing from "none have
	 * finished" — one draws nothing, the other draws a pending mark.
	 */
	checkState: PullRequestCheck["state"] | null;
	/** GitHub's verdict: `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or null when unasked. */
	reviewDecision: string | null;
}

/** One review already left on a pull request. */
export interface PullRequestReview {
	author: string;
	state: string;
	body: string;
	submittedAt: string;
}

/** A top-level comment. Line comments live on the diff and are not part of this. */
export interface PullRequestComment {
	author: string;
	body: string;
	createdAt: string;
}

/** Everything the detail pane shows, which is one request for the row that was opened. */
export interface PullRequestDetail extends PullRequestSummary {
	body: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	headRefName: string;
	baseRefName: string;
	threads: PullRequestComment[];
	reviews: PullRequestReview[];
	reviewers: { login: string; state: string }[];
	/** Null when the repository runs no checks at all, which is different from "none passed". */
	checks: { total: number; passed: number; failed: number; pending: number; items: PullRequestCheck[] } | null;
	mergeable: string;
	labels: string[];
	/** What was pushed, oldest first — the other half of the timeline. */
	commits: PullRequestCommit[];
}

/** One commit on the branch, trimmed to what a timeline row shows. */
export interface PullRequestCommit {
	sha: string;
	headline: string;
	author: string;
	at: string;
}

export interface WorkspaceDiffFile {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed" | "untracked";
	added: number;
	removed: number;
	hunks: import("@lyra/core").DiffHunk[];
	/**
	 * Not text, so there are no hunks and the counts are zero.
	 *
	 * A PNG has changed or it has not; there is no third answer and no line to point at. Saying so
	 * is what lets the panel show the picture instead of the bytes — and, just as importantly, what
	 * keeps the file *listed*. Before this, a changed image was silently dropped from the review
	 * entirely, because the only way the reader knew a file was binary was that it had failed to
	 * produce text.
	 */
	binary?: boolean;
	/** Size in bytes of whichever side exists, so a binary row can say something concrete. */
	bytes?: number;
}

/** One CI check, reduced to the three outcomes a reviewer acts on. */
export interface PullRequestCheck {
	name: string;
	state: "pass" | "fail" | "pending";
	/** Where to go read it. Absent for checks GitHub reports without a details page. */
	url?: string;
}
