/**
 * Repositories inside a workspace, and worktrees inside a repository.
 *
 * A monorepo with three checkouts under it is one workspace with three repos — not three
 * workspaces. Finding them is a bounded walk: deep node_modules trees are not worth the seconds.
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { git } from "./git-exec.ts";
import { gitBranch, isGitRepo } from "./git.ts";
import { canonicalPath } from "./path-key.ts";
import {
	createWorktree,
	pruneWorktrees,
	removeWorktree,
	type WorktreeCreateOptions,
	type WorktreeResult,
} from "./git-worktrees.ts";

export { createWorktree, pruneWorktrees, removeWorktree, type WorktreeCreateOptions, type WorktreeResult };

/** Runs a git command for its effect, turning failure into readable text rather than a throw. */

export interface RepoRef {
	/** Absolute path to the working directory of this repository. */
	path: string;
	/** Path relative to the workspace, or the folder name for the workspace root itself. */
	label: string;
	branch: string | null;
	/** True when this is a linked worktree rather than the main checkout. */
	worktree: boolean;
}

/** Directories never worth descending into when looking for repositories. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "build", "target", "vendor", ".next", ".venv"]);

/**
 * Every git repository under the workspace, not just the workspace itself.
 *
 * A workspace is a folder someone opened, and plenty of people keep several repositories side
 * by side in one — a frontend and a backend, or a set of services versioned apart on purpose.
 * With one repository assumed, the panel showed whichever one happened to be at the root and
 * silently ignored the rest.
 *
 * Two levels deep, because that covers the layouts people actually use (`~/work/*`, `repo/*`)
 * and stops the scan from walking an entire home directory.
 */
export async function listRepos(root: string): Promise<RepoRef[]> {
	const found: RepoRef[] = [];

	if (await isGitRepo(root)) {
		found.push({ path: root, label: basename(root), branch: await gitBranch(root), worktree: false });
	}

	const walk = async (dir: string, depth: number) => {
		if (depth > 2 || found.length >= 24) return;
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
			const child = join(dir, entry.name);
			// `.git` can be a directory (a normal clone) or a file (a linked worktree).
			const isRepo = await stat(join(child, ".git")).then(() => true).catch(() => false);
			if (isRepo) {
				if (!found.some((repo) => repo.path === child)) {
					found.push({
						path: child,
						label: relative(root, child) || basename(child),
						branch: await gitBranch(child),
						worktree: false,
					});
				}
				// A repository's own subdirectories are its business, not ours.
				continue;
			}
			await walk(child, depth + 1);
		}
	};
	await walk(root, 1);

	return found;
}

/**
 * The worktrees attached to a repository.
 *
 * A worktree is a second checkout of the same repository on a different branch, which is how
 * people keep a review and their own work open at once. They share one history, so the panel
 * treats them as places to switch to rather than as separate repositories.
 */
export async function listWorktrees(cwd: string): Promise<RepoRef[]> {
	if (!(await isGitRepo(cwd))) return [];
	const out = await git(cwd, ["worktree", "list", "--porcelain"]).catch(() => "");
	const trees: RepoRef[] = [];
	let path: string | null = null;
	let branch: string | null = null;

	const flush = (isMain: boolean) => {
		if (!path) return;
		// Canonical, so a caller can compare this against a path it built itself — git prints
		// forward slashes even on Windows, where nothing else in the app does. See `path-key.ts`.
		const at = canonicalPath(path);
		trees.push({ path: at, label: basename(at), branch, worktree: !isMain });
		path = null;
		branch = null;
	};

	for (const line of out.split("\n")) {
		if (line.startsWith("worktree ")) {
			flush(trees.length === 0);
			path = line.slice("worktree ".length);
		} else if (line.startsWith("branch ")) {
			branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
		} else if (line.startsWith("detached")) {
			branch = null;
		}
	}
	flush(trees.length === 0);

	// The first entry is the main checkout; the rest are the linked ones.
	return trees.map((tree, index) => ({ ...tree, worktree: index > 0 }));
}

/**
 * Turn a plain directory into a repository.
 *
 * Offered because the panel is often looking at a project that was just created — by the agent,
 * a minute ago — and "not a repository" is a state with an obvious next step rather than a dead
 * end. Nothing is committed: the first commit is a decision, and the panel is right there for it.
 */
export async function initRepo(cwd: string): Promise<{ ok: boolean; error?: string }> {
	if (await isGitRepo(cwd)) return { ok: true };
	try {
		await git(cwd, ["init"]);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
