/**
 * Commits, and the differences between them.
 *
 * `gitLog` carries the parent ids because the graph beside it is drawn from them; without those the
 * column of dots would be a list, not a history.
 */

import { computeDiff } from "@lyra/core";
import type { GitCommit, WorkspaceDiffFile } from "./ipc-types.ts";
import { readBlobs, type BlobRead } from "./git-blobs.ts";
import { git, run, runRemote, MAX_FILES, type RemoteResult } from "./git-exec.ts";
import { capHunks, classify } from "./git-diff.ts";
import { defaultRemote } from "./git-remote-state.ts";
import { EMPTY_TREE, LOG_FORMAT } from "./git-status.ts";
import { gitBranch, isGitRepo } from "./git.ts";

export async function gitLog(cwd: string, limit = 60, ref?: string): Promise<GitCommit[]> {
	if (!(await isGitRepo(cwd))) return [];
	const out = await git(cwd, [
		"log",
		"--topo-order",
		`--max-count=${Math.min(limit, 300)}`,
		`--format=${LOG_FORMAT}`,
		...(ref ? [ref] : []),
	]).catch(() => "");

	return out
		.split("\x1e")
		.map((record) => record.replace(/^\n/, ""))
		.filter(Boolean)
		.map((record) => {
			const [sha, shortSha, subject, author, date, refs, parents] = record.split("\x1f");
			return {
				sha,
				shortSha,
				subject,
				parents: (parents ?? "").split(" ").filter(Boolean),
				author,
				date,
				refs: (refs ?? "")
					.split(", ")
					.map((name) => name.replace(/^HEAD -> /, "").trim())
					.filter((name) => name && name !== "HEAD"),
			};
		});
}

/**
 * Which files changed, from `--name-status -z`.
 *
 * Parsing has to be a walk — a rename spends three tokens where everything else spends two, so the
 * position of the next entry depends on the current one.
 */
function parseNameStatus(names: string): { path: string; status: WorkspaceDiffFile["status"] }[] {
	const wanted: { path: string; status: WorkspaceDiffFile["status"] }[] = [];
	const tokens = names.split("\0").filter(Boolean);
	for (let i = 0; i < tokens.length && wanted.length < MAX_FILES; i++) {
		const code = tokens[i];
		if (!/^[A-Z]/.test(code)) continue;
		// A rename spends three tokens: the code, the old path and the new one.
		const isRename = code.startsWith("R");
		const path = tokens[isRename ? i + 2 : i + 1];
		if (isRename) i += 2;
		else i += 1;
		if (!path) continue;
		wanted.push({ path, status: classify(code[0]) });
	}
	return wanted;
}

/**
 * Line counts per path, from `--numstat -z`.
 *
 * The format writes `added\tremoved\tpath\0` for an ordinary change, and for a rename writes the
 * counts followed by an empty path field and then the two paths as their own NUL-terminated fields
 * — so the record length is not fixed and the walk has to look at what it just read. A binary file
 * has `-` for both counts, which is git saying there is no line to count rather than zero of them.
 *
 * Keyed by the destination path, which is what `--name-status` reports and what is shown.
 */
export function parseNumstat(stats: string): Map<string, { added: number; removed: number; binary: boolean }> {
	const counts = new Map<string, { added: number; removed: number; binary: boolean }>();
	const fields = stats.split("\0");
	for (let i = 0; i < fields.length; i++) {
		const field = fields[i];
		if (!field) continue;
		const match = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(field);
		if (!match) continue;
		const [, addedRaw, removedRaw, inline] = match;
		// An empty trailing path means the two rename paths follow as their own fields.
		const path = inline || fields[i + 2];
		if (!inline) i += 2;
		if (!path) continue;
		counts.set(path, {
			added: addedRaw === "-" ? 0 : Number(addedRaw),
			removed: removedRaw === "-" ? 0 : Number(removedRaw),
			binary: addedRaw === "-",
		});
	}
	return counts;
}

/**
 * The file list alone — what changed, and by how many lines, without reading any of it.
 *
 * `diffRefs` answers the same question but pays for every file's before and after blob and then
 * diffs each one in JS. On this repository's largest commit that is 125 files, 250 blob reads and
 * a few hundred kilobytes of hunks over IPC: measured at 557ms, against 15ms for the name list and
 * 26ms for the counts. The panel spends that time showing a placeholder and then jumps from its
 * height to the real one — a jolt whose size is the whole list.
 *
 * So the list arrives on its own first and the contents follow. Nothing here is a second source of
 * truth: the counts come from `--numstat`, which is what a collapsed row shows, and the hunks that
 * arrive later carry their own counts computed from the diff, which is what an opened row shows.
 * Where the two can disagree — a file git reports as binary, marked `-` — the row says so instead
 * of claiming a number.
 */
async function diffSummary(
	cwd: string,
	base: string,
	head: string,
): Promise<{ files: WorkspaceDiffFile[] }> {
	if (!(await isGitRepo(cwd))) return { files: [] };

	// Both at once: they are independent reads of the same commit and one need not wait for the other.
	const [names, stats] = await Promise.all([
		git(cwd, ["diff", "--name-status", "-z", base, head]).catch(() => ""),
		git(cwd, ["diff", "--numstat", "-z", base, head]).catch(() => ""),
	]);

	const counts = parseNumstat(stats);

	const files = parseNameStatus(names).map(({ path, status }) => {
		const count = counts.get(path);
		return {
			path,
			status,
			added: count?.added ?? 0,
			removed: count?.removed ?? 0,
			hunks: [],
			binary: count?.binary ?? false,
		} satisfies WorkspaceDiffFile;
	});

	return { files };
}

/** A commit's file list, without its contents. Pairs with `commitDiff`. */
export async function commitDiffSummary(cwd: string, sha: string) {
	const parent = await git(cwd, ["rev-parse", "--verify", `${sha}^`])
		.then((out) => out.trim())
		.catch(() => EMPTY_TREE);
	return diffSummary(cwd, parent, sha);
}

/**
 * The diff between any two points in history.
 *
 * One implementation for three questions — what a commit changed, how two branches differ, what
 * is staged — because to git they are the same question with different endpoints. `base` of
 * `null` means the index, which is how the staged view gets its content.
 */
export async function diffRefs(
	cwd: string,
	base: string,
	head: string | null,
): Promise<{ files: WorkspaceDiffFile[]; added: number; removed: number }> {
	if (!(await isGitRepo(cwd))) return { files: [], added: 0, removed: 0 };

	const range = head ? [base, head] : ["--cached", base];
	const names = await git(cwd, ["diff", "--name-status", "-z", ...range]).catch(() => "");

	/*
	 * The name list is parsed first, then the blobs are fetched together.
	 *
	 * Parsing has to be a walk — a rename spends three tokens where everything else spends two, so
	 * the position of the next entry depends on the current one. Fetching does not: each file's two
	 * blobs are independent, and reading them one file after another meant two process spawns of
	 * pure waiting per file. See `mapLimit`.
	 */
	const wanted = parseNameStatus(names);

	/*
	 * Both sides in two batches, rather than two `git show` processes per file.
	 *
	 * The "before" side is whichever ref the comparison starts from; the "after" side is the other
	 * ref, or the index when there is no second ref — `:path` is how git names a staged blob, and
	 * it goes through `cat-file` like any other revision. An empty revision string is a side that
	 * does not exist (an addition has no before, a deletion has no after) and reads back as null.
	 */
	const befores = await readBlobs(
		cwd,
		wanted.map(({ path, status }) => (status === "added" ? "" : `${head ? base : "HEAD"}:${path}`)),
	);
	const afters = await readBlobs(
		cwd,
		wanted.map(({ path, status }) => (status === "deleted" ? "" : head ? `${head}:${path}` : `:${path}`)),
	);

	const files: WorkspaceDiffFile[] = [];
	let added = 0;
	let removed = 0;

	wanted.forEach(({ path, status }, i) => {
		const before = textOf(befores[i], status === "added");
		const after = textOf(afters[i], status === "deleted");
		// Null means a blob too large to diff; the file is dropped rather than half-reported.
		if (before === null || after === null) return;
		// Counted from the diff itself rather than from `--numstat`, so the totals and the hunks
		// on screen can never disagree.
		const diff = computeDiff(before, after);
		added += diff.added;
		removed += diff.removed;
		files.push({ path, status, added: diff.added, removed: diff.removed, hunks: capHunks(diff.hunks) });
	});

	return { files, added, removed };
}

/**
 * One side of a comparison as text: empty when it does not exist, null when it is too large.
 *
 * The two used to be told apart by `blobAt` returning `""` for a missing object and `null` for an
 * oversized one, and the distinction is load-bearing: empty is a side of the diff, null drops the
 * file from the list entirely. `absent` says the caller already knows there is no such side, which
 * is not the same as git having failed to find one.
 */
function textOf(read: BlobRead | null, absent: boolean): string | null {
	if (absent || !read) return "";
	return read.content ? read.content.toString("utf8") : null;
}

/** A commit's own diff — against its parent, or against nothing if it is the first. */
export async function commitDiff(cwd: string, sha: string) {
	const parent = await git(cwd, ["rev-parse", "--verify", `${sha}^`])
		.then((out) => out.trim())
		.catch(() => EMPTY_TREE);
	return diffRefs(cwd, parent, sha);
}

export async function createBranch(cwd: string, name: string, from?: string) {
	const clean = name.trim();
	if (!clean) return { ok: false, error: "分支名不能为空" };
	return run(cwd, ["switch", "-c", clean, ...(from ? [from] : [])]);
}

export async function deleteBranch(cwd: string, name: string, force = false) {
	return run(cwd, ["branch", force ? "-D" : "-d", name]);
}

/**
 * How long each remote call may take.
 *
 * A silent fetch is a background nicety and must never be felt, so it gives up quickly. A fetch
 * someone pressed a button for is allowed to be slow, because they are watching it and can cancel.
 * Push and pull can legitimately take minutes on a large repository, so their bound is only there
 * to stop the panel being held forever by a host that never answers.
 */
export const QUIET_FETCH_TIMEOUT_MS = 8_000;
export const FETCH_TIMEOUT_MS = 20_000;
const PUSH_PULL_TIMEOUT_MS = 120_000;

/** The remotes this repository has, in config order. */
async function remoteNames(cwd: string): Promise<string[]> {
	const out = await git(cwd, ["remote"]).catch(() => "");
	return out.split("\n").map((name) => name.trim()).filter(Boolean);
}

export async function pushBranch(cwd: string, { signal }: { signal?: AbortSignal } = {}): Promise<RemoteResult> {
	/*
	 * `gitBranch` is `symbolic-ref` now, so this guard finally means what it says.
	 *
	 * It used to be `rev-parse --abbrev-ref HEAD`, which answers with the string "HEAD" on a
	 * detached checkout rather than failing — so this ran `push -u origin HEAD`, and git refused it
	 * with `The destination you provided is not a full refname`. Every rebase in progress and every
	 * checked-out tag hit that.
	 */
	const branch = await gitBranch(cwd);
	if (!branch) return { ok: false, error: "当前不在任何分支上" };

	// `-u` on the first push, so the branch gains an upstream instead of failing for want of one.
	const hasUpstream = await git(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"]).then(() => true).catch(() => false);
	if (hasUpstream) return runRemote(cwd, ["push"], { timeoutMs: PUSH_PULL_TIMEOUT_MS, signal });

	/*
	 * Not `origin`, whichever remote this repository actually has.
	 *
	 * Hardcoding `origin` fails outright on a repository whose remote is called anything else, and
	 * the failure is a git error about a remote that does not exist rather than anything the panel
	 * could have said up front.
	 */
	const remotes = await remoteNames(cwd);
	const remote = defaultRemote(remotes);
	if (!remote) {
		return {
			ok: false,
			error: remotes.length === 0 ? "仓库没有配置远端" : "有多个远端，请先设置上游分支",
		};
	}
	return runRemote(cwd, ["push", "-u", remote, branch], { timeoutMs: PUSH_PULL_TIMEOUT_MS, signal });
}

export async function pullBranch(cwd: string, { signal }: { signal?: AbortSignal } = {}): Promise<RemoteResult> {
	// `--ff-only`: a merge commit, or worse a conflict, is not something to start from a button.
	return runRemote(cwd, ["pull", "--ff-only"], { timeoutMs: PUSH_PULL_TIMEOUT_MS, signal });
}

/**
 * Ask the remote what it has, so `ahead` and `behind` are about the present.
 *
 * Without this they are computed against whatever the remote-tracking refs last recorded, which for
 * a panel that never fetched is whenever the repository was last cloned or pulled by hand. `behind`
 * in particular could not become non-zero at all.
 *
 * A repository with no remotes returns ok rather than running anything: `git fetch` there exits 0
 * having done nothing, and reporting that as a successful refresh invites the reasonable conclusion
 * that the numbers on screen were just confirmed.
 */
export async function fetchRemotes(
	cwd: string,
	{ signal, timeoutMs = FETCH_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RemoteResult> {
	const remotes = await remoteNames(cwd);
	if (remotes.length === 0) return { ok: true };
	return runRemote(cwd, ["fetch", "--prune"], { timeoutMs, signal });
}

/**
 * Commit what is staged.
 *
 * Unlike `commitAll`, which the composer's bar uses, this one records exactly what the panel
 * shows as staged — the whole point of having an index in front of you.
 */
export async function commitStaged(cwd: string, message: string): Promise<{ ok: boolean; error?: string }> {
	const trimmed = message.trim();
	if (!trimmed) return { ok: false, error: "提交信息不能为空" };
	const staged = await git(cwd, ["diff", "--cached", "--name-only"]).catch(() => "");
	if (!staged.trim()) return { ok: false, error: "没有已暂存的改动" };
	return run(cwd, ["commit", "-m", trimmed]);
}
