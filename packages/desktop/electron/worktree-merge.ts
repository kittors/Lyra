/**
 * Merging a conversation's worktree back into the branch it came from, and bringing that branch's new
 * commits into the worktree.
 *
 * Both refuse rather than guess: uncommitted changes, a merge already under way, the base checked out
 * in some other worktree. A conflict merging back is backed out at once — the checkout people work in
 * is never left half-merged — and reported with its files, so the conversation can sync, settle them
 * in its own worktree, and merge again cleanly. A conflict syncing stays where it is, in the worktree,
 * which is the place it is meant to be resolved. Nothing is pushed. See ADR-0038.
 */

import { existsSync } from "node:fs";
import { git, run } from "./git-exec.ts";
import { samePath } from "./path-key.ts";
import { baseOf, conflictedFiles, countCommits, isMerging, repoRoot, uncommittedFiles, worktreeRootOf, type Owned } from "./worktree-lifecycle.ts";
import type { MergeOutcome, Refusal, SyncOutcome } from "./worktree-types.ts";

export type { MergeOutcome, SyncOutcome };

type Located = { repo: string; root: string | null; base: string; branch: string };
type Refused = { kind: "refused"; reason: Refusal; detail?: string };

/** The repository, the base, and the worktree's folder — null when it has been taken back. */
async function locate(meta: Owned): Promise<Located | Refused> {
	if (!meta.worktree) return { kind: "refused", reason: "gone" };
	const repo = await repoRoot(meta.worktree.project);
	if (!repo) return { kind: "refused", reason: "gone" };
	const base = await baseOf(repo, meta.worktree.base);
	if (!base) return { kind: "refused", reason: "no-base" };
	const root = await worktreeRootOf(meta);
	return { repo, root: root && existsSync(root) ? root : null, base, branch: meta.worktree.branch };
}

/** Which of `repo`'s worktrees has `branch` checked out, the main one included; null when none does. */
async function checkedOutAt(repo: string, branch: string): Promise<string | null> {
	const listed = await git(repo, ["worktree", "list", "--porcelain"]).catch(() => "");
	let path: string | null = null;
	for (const line of listed.split("\n")) {
		if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
		else if (line === `branch refs/heads/${branch}` && path) return path;
	}
	return null;
}

export async function mergeIntoBase(meta: Owned): Promise<MergeOutcome> {
	const at = await locate(meta);
	if ("kind" in at) return at;
	const { repo, root, base, branch } = at;
	/*
	 * A worktree that was taken back is merged all the same: its commits are on the branch, and it held
	 * nothing uncommitted — a folder with changes in it is never taken (`reclaimWorktree`).
	 */
	if (root) {
		const files = (await uncommittedFiles(root)).length;
		if (files > 0) return { kind: "uncommitted", files };
		if (await isMerging(root)) return { kind: "refused", reason: "syncing" };
	}
	const commits = await countCommits(repo, `${base}..${branch}`);
	if (commits === 0) return { kind: "nothing", base };
	const message = `Merge branch '${branch}'`;
	const holder = await checkedOutAt(repo, base);
	if (holder === null) return mergeUnchecked(repo, base, branch, message, commits);
	// Checked out in another worktree: moving it would leave that folder's files behind its own HEAD.
	if (!samePath(holder, repo)) return { kind: "refused", reason: "elsewhere", detail: holder };
	return mergeInCheckout(repo, base, branch, message, commits);
}

/**
 * Where the base is checked out — the project's own folder — so that folder's files move with it.
 * Backed out on any failure, a conflict included.
 */
async function mergeInCheckout(repo: string, base: string, branch: string, message: string, commits: number): Promise<MergeOutcome> {
	if (await isMerging(repo)) return { kind: "refused", reason: "busy" };
	const done = await run(repo, ["merge", "--no-ff", "--no-edit", "-m", message, branch]);
	if (done.ok) return { kind: "merged", commits, base };
	const conflicted = await conflictedFiles(repo);
	if (await isMerging(repo)) await run(repo, ["merge", "--abort"]);
	return conflicted.length > 0 ? { kind: "conflict", files: conflicted, base } : { kind: "refused", reason: "failed", detail: done.error };
}

/**
 * With the base checked out nowhere, no folder's files have to change: the merge is computed
 * (`merge-tree`), committed and the branch moved — the steps `git merge` takes, minus writing files
 * nobody has open. The move names the old tip, so a commit landing in between fails it instead of
 * being overwritten.
 */
async function mergeUnchecked(repo: string, base: string, branch: string, message: string, commits: number): Promise<MergeOutcome> {
	const result = await git(repo, ["merge-tree", "--write-tree", "--name-only", "--no-messages", base, branch]).then(
		(text) => ({ clean: true, text, code: 0 }),
		(error: { stdout?: string; code?: number }) => ({ clean: false, text: String(error.stdout ?? ""), code: error.code ?? -1 }),
	);
	const lines = result.text.trim().split("\n");
	if (!result.clean) {
		// Exit 1 is a conflict — the tree, then the files in it. Anything else is git failing.
		if (result.code === 1 && lines.length > 1) return { kind: "conflict", files: [...new Set(lines.slice(1).filter(Boolean))], base };
		return { kind: "refused", reason: "failed", detail: result.text.trim() || "git merge-tree" };
	}
	const [tree] = lines;
	const baseTip = await git(repo, ["rev-parse", `refs/heads/${base}`]).then((text) => text.trim(), () => "");
	const branchTip = await git(repo, ["rev-parse", `refs/heads/${branch}`]).then((text) => text.trim(), () => "");
	const commit = tree && baseTip && branchTip ? await git(repo, ["commit-tree", tree, "-p", baseTip, "-p", branchTip, "-m", message]).then((text) => text.trim(), () => "") : "";
	if (!commit) return { kind: "refused", reason: "failed", detail: "git commit-tree" };
	const moved = await run(repo, ["update-ref", `refs/heads/${base}`, commit, baseTip]);
	return moved.ok ? { kind: "merged", commits, base } : { kind: "refused", reason: "failed", detail: moved.error };
}

/**
 * The base's new commits into the worktree, as a merge. A conflict is left in progress for whoever is
 * working there — the conversation, or a person — to settle and commit; `abortSync` backs it out.
 */
export async function syncFromBase(meta: Owned): Promise<SyncOutcome> {
	const at = await locate(meta);
	if ("kind" in at) return at;
	const { repo, root, base, branch } = at;
	// Syncing writes into the folder, so there has to be one.
	if (!root) return { kind: "refused", reason: "gone" };
	if (await isMerging(root)) return { kind: "conflict", files: await conflictedFiles(root), base };
	const files = (await uncommittedFiles(root)).length;
	if (files > 0) return { kind: "uncommitted", files };
	const commits = await countCommits(repo, `${branch}..${base}`);
	if (commits === 0) return { kind: "up-to-date", base };
	const done = await run(root, ["merge", "--no-edit", base]);
	if (done.ok) return { kind: "synced", commits, base };
	const conflicted = await conflictedFiles(root);
	if (conflicted.length > 0) return { kind: "conflict", files: conflicted, base };
	if (await isMerging(root)) await run(root, ["merge", "--abort"]);
	return { kind: "refused", reason: "failed", detail: done.error };
}

/** Back out a sync left waiting on conflicts. True when nothing is waiting any more. */
export async function abortSync(meta: Owned): Promise<boolean> {
	const root = await worktreeRootOf(meta);
	if (!root || !existsSync(root) || !(await isMerging(root))) return true;
	return (await run(root, ["merge", "--abort"])).ok;
}
