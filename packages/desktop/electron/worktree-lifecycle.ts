/**
 * A conversation's own worktree over its life: what state it is in, taking it back, checking it out
 * again.
 *
 * One rule runs through the file, the one Claude's desktop app keeps: the branch outlives the folder.
 * A worktree is a checkout of a branch, so once its work is committed the folder can go and come back
 * at no cost — the commits are on the branch. What is not committed is the only thing that can be
 * lost, and nothing here throws it away unless a person was told what would go and agreed. See ADR-0038.
 */

import { existsSync } from "node:fs";
import { relative, sep } from "node:path";
import type { SessionMeta } from "@lyra/core";
import { git, run } from "./git-exec.ts";
import type { WorktreeState } from "./worktree-types.ts";
import { canonicalPath, samePath } from "./path-key.ts";

export type { WorktreeState };

export type Owned = Pick<SessionMeta, "cwd" | "worktree">;


const succeeds = (cwd: string, args: string[]) => git(cwd, args).then(() => true, () => false);
const output = (cwd: string, args: string[]) => git(cwd, args).then((text) => text.trim(), () => null);

/** The checkout a folder is in, or null outside one. */
export async function repoRoot(dir: string): Promise<string | null> {
	return existsSync(dir) ? (await output(dir, ["rev-parse", "--show-toplevel"])) || null : null;
}

/**
 * The worktree's own top folder. `cwd` is that folder — or, for a project that is one package of a
 * repository, the package inside it (`autoCreateSessionWorktree`): the same arithmetic, run backwards
 * when the folder is not there to ask.
 */
export async function worktreeRootOf(meta: Owned): Promise<string | null> {
	if (!meta.worktree) return null;
	if (existsSync(meta.cwd)) return repoRoot(meta.cwd);
	const repo = await repoRoot(meta.worktree.project);
	if (!repo) return null;
	const inside = relative(canonicalPath(repo), canonicalPath(meta.worktree.project));
	return inside && meta.cwd.endsWith(`${sep}${inside}`) ? meta.cwd.slice(0, -(inside.length + 1)) : meta.cwd;
}

async function branchExists(repo: string, name: string): Promise<boolean> {
	return succeeds(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
}

/**
 * The branch to merge back into and sync from: the one the worktree was cut from, else the repository's
 * default — what `origin/HEAD` names, else `main`, else `master`. Null when none of them is a branch here.
 */
export async function baseOf(repo: string, recorded?: string): Promise<string | null> {
	const remote = ((await output(repo, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])) ?? "").replace(/^origin\//, "");
	for (const name of [recorded, remote, "main", "master"]) if (name && (await branchExists(repo, name))) return name;
	return null;
}

/**
 * The commits of work in `range` — merges left out. Syncing leaves a merge commit on the worktree's branch
 * and merging back leaves one on the base; counted, a worktree just merged read "1 behind" and one just
 * synced "3 ahead" for two commits of its own, inviting a sync or a merge with nothing in it.
 */
export async function countCommits(repo: string, range: string): Promise<number> {
	return Number((await output(repo, ["rev-list", "--count", "--no-merges", range])) ?? 0) || 0;
}

/** Changed and untracked files. Ignored ones are not changes anyone made, and stay out of it. */
export async function uncommittedFiles(dir: string): Promise<string[]> {
	const text = await git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).catch(() => "");
	const files: string[] = [];
	const entries = text.split("\0");
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.length < 4) continue;
		files.push(entry.slice(3));
		// A rename or copy carries its old path as the entry after it.
		if (entry[0] === "R" || entry[0] === "C") i++;
	}
	return files;
}

export async function isMerging(dir: string): Promise<boolean> {
	return succeeds(dir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
}

export async function conflictedFiles(dir: string): Promise<string[]> {
	return (await git(dir, ["diff", "--name-only", "--diff-filter=U", "-z"]).catch(() => "")).split("\0").filter(Boolean);
}

export async function worktreeState(meta: Owned): Promise<WorktreeState | null> {
	if (!meta.worktree) return null;
	const repo = await repoRoot(meta.worktree.project);
	if (!repo) return null;
	const root = await worktreeRootOf(meta);
	const present = Boolean(root && existsSync(root));
	const { branch } = meta.worktree;
	const base = await baseOf(repo, meta.worktree.base);
	const counted = base && (await branchExists(repo, branch));
	const merging = present && root ? await isMerging(root) : false;
	return {
		branch,
		base,
		present,
		ahead: counted ? await countCommits(repo, `${base}..${branch}`) : 0,
		behind: counted ? await countCommits(repo, `${branch}..${base}`) : 0,
		uncommitted: present && root ? (await uncommittedFiles(root)).length : 0,
		merging,
		conflicted: merging && root ? await conflictedFiles(root) : [],
	};
}

/** Whether `root` is one of `repo`'s linked worktrees — asked of git, never inferred from the folder's name. */
async function isWorktreeOf(repo: string, root: string): Promise<boolean> {
	if (samePath(repo, root)) return false;
	const listed = (await output(repo, ["worktree", "list", "--porcelain"])) ?? "";
	return listed.split("\n").some((line) => line.startsWith("worktree ") && samePath(line.slice("worktree ".length), root));
}

export interface Reclaimed {
	/** The folder is gone. */
	removed: boolean;
	/** It stayed: it holds changes nobody agreed to lose. */
	kept?: "uncommitted";
	/** The branch went too, everything on it being in its base already. */
	branchDropped?: boolean;
}

/**
 * Take a conversation's worktree back.
 *
 * The folder goes and the branch stays, so the commits are still there and the folder can be checked
 * out again (`restoreWorktree`). One holding uncommitted changes is kept unless `discardUncommitted` —
 * set only once a person was told what would go. `dropMergedBranch` also deletes the branch when every
 * commit on it is already in its base, where deleting it loses nothing.
 */
export async function reclaimWorktree(meta: Owned, options: { discardUncommitted?: boolean; dropMergedBranch?: boolean } = {}): Promise<Reclaimed> {
	if (!meta.worktree) return { removed: false };
	const repo = await repoRoot(meta.worktree.project);
	if (!repo) return { removed: false };
	const root = await worktreeRootOf(meta);
	let removed = false;
	if (root && existsSync(root)) {
		// Never the project itself, and never a folder git does not list as one of its worktrees.
		if (!(await isWorktreeOf(repo, root))) return { removed: false };
		const dirty = (await uncommittedFiles(root)).length > 0 || (await isMerging(root));
		if (dirty && !options.discardUncommitted) return { removed: false, kept: "uncommitted" };
		// `--force` only for what was agreed to: plain `remove` refuses a worktree with anything in it.
		removed = (await run(repo, ["worktree", "remove", ...(dirty ? ["--force"] : []), root])).ok;
		if (!removed) return { removed: false };
		await run(repo, ["worktree", "prune"]);
	}
	let branchDropped = false;
	const { branch } = meta.worktree;
	if (options.dropMergedBranch && (await branchExists(repo, branch))) {
		const base = await baseOf(repo, meta.worktree.base);
		if (base && base !== branch && (await succeeds(repo, ["merge-base", "--is-ancestor", branch, base]))) {
			branchDropped = (await run(repo, ["branch", "-D", branch])).ok;
		}
	}
	return { removed, branchDropped };
}

export type Restored = { ok: true; fresh: boolean } | { ok: false; error: string };

/**
 * Check a conversation's worktree out again where it was, after it was taken back. From its branch
 * while the branch is there; cut afresh from the base when it is not (`fresh`) — which loses nothing,
 * since a branch is only dropped once its commits are in the base.
 *
 * Where it was, not under today's layout: the conversation's own history names its files by absolute
 * path, and the model goes on from that history.
 */
export async function restoreWorktree(meta: Owned): Promise<Restored> {
	if (!meta.worktree) return { ok: false, error: "no worktree" };
	const repo = await repoRoot(meta.worktree.project);
	if (!repo) return { ok: false, error: `${meta.worktree.project}: not a git repository` };
	const root = await worktreeRootOf(meta);
	if (!root) return { ok: false, error: "no place to put it" };
	// A folder deleted by hand leaves its registration behind, and git will not add over it.
	await run(repo, ["worktree", "prune"]);
	const { branch } = meta.worktree;
	if (await branchExists(repo, branch)) {
		const done = await run(repo, ["worktree", "add", root, branch]);
		return done.ok ? { ok: true, fresh: false } : { ok: false, error: done.error ?? "git worktree add" };
	}
	const base = await baseOf(repo, meta.worktree.base);
	if (!base) return { ok: false, error: "no branch to start it from" };
	const done = await run(repo, ["worktree", "add", "-b", branch, root, base]);
	return done.ok ? { ok: true, fresh: true } : { ok: false, error: done.error ?? "git worktree add" };
}

/**
 * A conversation in use again whose worktree was taken back: checked out again, or — when it cannot be —
 * what its meta becomes instead. It goes on in the project rather than not at all, and says why
 * (`worktreeError`). Null when there was nothing to do, or it was done.
 */
export async function bringBackWorktree(meta: Owned): Promise<Pick<SessionMeta, "cwd" | "worktree" | "worktreeError"> | null> {
	if (!meta.worktree || existsSync(meta.cwd)) return null;
	const restored = await restoreWorktree(meta);
	return restored.ok ? null : { cwd: meta.worktree.project, worktree: undefined, worktreeError: restored.error };
}
