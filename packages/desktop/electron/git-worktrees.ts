/**
 * Git worktree management, creation, auto-creation and cleanup.
 *
 * Provides dedicated worktrees so that AI sessions can run in clean, isolated checkouts
 * without interfering with the user's primary working tree or active branch.
 */

import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { Settings } from "@lyra/core";
import { git } from "./git-exec.ts";
import { isGitRepo } from "./git.ts";
import { canonicalPath, pathKey } from "./path-key.ts";

export interface WorktreeCreateOptions {
	/** Custom target directory, if not default */
	targetDir?: string;
	/** Whether to fetch upstream before creating */
	fetchUpstream?: boolean;
	/** Base ref/commit/branch to start from, e.g. "HEAD" or "main" */
	baseRef?: string;
}

export interface WorktreeResult {
	ok: boolean;
	path?: string;
	branch?: string;
	error?: string;
}

/**
 * Resolves the configured root directory for worktrees.
 * Supports "~" expansion and defaults to "~/.lyra/worktrees" or project sibling.
 */
export function resolveWorktreesRoot(customRootDir?: string): string {
	if (customRootDir && customRootDir.trim()) {
		const trimmed = customRootDir.trim();
		if (trimmed.startsWith("~")) {
			return join(homedir(), trimmed.slice(1));
		}
		return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
	}
	return join(process.env.LYRA_HOME || join(homedir(), ".lyra"), "worktrees");
}

/**
 * Fetch updates from remotes if git repository has remotes configured.
 */
async function fetchUpstreamQuietly(cwd: string): Promise<void> {
	try {
		await git(cwd, ["fetch", "--all", "--prune"]);
	} catch {
		// Fetch failure (e.g. offline) shouldn't block worktree creation
	}
}

/**
 * Creates a git worktree for a specific repository.
 *
 * If targetDir is not supplied, places worktree in:
 * 1. settings.worktrees.rootDir / <repo-name>-<branch> (if configured)
 * 2. or sibling of repo: <repo-parent>/<repo-name>-<branch>
 */
export async function createWorktree(
	cwd: string,
	branch: string,
	options: WorktreeCreateOptions = {},
): Promise<WorktreeResult> {
	if (!(await isGitRepo(cwd))) return { ok: false, error: "当前项目不是 Git 仓库" };

	const safe = branch.trim().replace(/[^\w.\-/]/g, "-");
	if (!safe) return { ok: false, error: "分支名不能为空" };

	if (options.fetchUpstream) {
		await fetchUpstreamQuietly(cwd);
	}

	const root = await git(cwd, ["rev-parse", "--show-toplevel"])
		.then((out) => out.trim())
		.catch(() => cwd);

	const repoName = basename(root) || "repo";
	const branchFolder = safe.replace(/\//g, "-");

	let target = options.targetDir;
	if (!target) {
		target = join(root, "..", `${repoName}-${branchFolder}`);
	}

	try {
		// Ensure parent directory exists
		await mkdir(join(target, ".."), { recursive: true });
		// `-B` so re-running with the same name resets or creates branch cleanly
		const args = ["worktree", "add", "-B", safe, target];
		if (options.baseRef) {
			args.push(options.baseRef);
		}
		await git(cwd, args);
		/*
		 * The canonical spelling, not the one that was passed in.
		 *
		 * `target` is built with `join(root, "..", name)`, so it carries whatever separators, `..`
		 * segments and short names came in with it. Callers keep this path and later compare it
		 * against `git worktree list`, which prints the resolved long form — and a comparison that
		 * cannot match is what let the cleanup delete a worktree that was in use.
		 */
		return { ok: true, path: canonicalPath(target), branch: safe };
	} catch (cause) {
		const message = cause instanceof Error && "stderr" in cause ? String(cause.stderr) : String(cause);
		return { ok: false, error: message.trim() || "创建工作树失败" };
	}
}

/**
 * Removes a git worktree and prunes git metadata.
 */
export async function removeWorktree(
	cwd: string,
	worktreePath: string,
	force = true,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const args = ["worktree", "remove"];
		if (force) args.push("--force");
		args.push(worktreePath);
		await git(cwd, args);
		await git(cwd, ["worktree", "prune"]);
		return { ok: true };
	} catch (cause) {
		// If git worktree remove fails because folder is missing or deleted, fallback to prune & manual rm
		try {
			if (existsSync(worktreePath)) {
				await rm(worktreePath, { recursive: true, force: true });
			}
			await git(cwd, ["worktree", "prune"]);
			return { ok: true };
		} catch (fallbackError) {
			const message = cause instanceof Error && "stderr" in cause ? String(cause.stderr) : String(cause);
			return { ok: false, error: message.trim() || String(fallbackError) };
		}
	}
}

/**
 * Prunes worktree metadata for unreachable or deleted worktrees.
 */
export async function pruneWorktrees(cwd: string): Promise<{ ok: boolean; error?: string }> {
	if (!(await isGitRepo(cwd))) return { ok: false, error: "当前项目不是 Git 仓库" };
	try {
		await git(cwd, ["worktree", "prune"]);
		return { ok: true };
	} catch (cause) {
		const message = cause instanceof Error && "stderr" in cause ? String(cause.stderr) : String(cause);
		return { ok: false, error: message.trim() || "清理工作树失败" };
	}
}

/**
 * Auto-creates a dedicated worktree for a new AI session if enabled in settings.
 */
export async function autoCreateSessionWorktree(
	projectCwd: string,
	settings: Settings,
	sessionId: string,
): Promise<{ cwd: string; worktreeCreated: boolean; branch?: string }> {
	if (!settings.worktrees?.autoCreateOnNewSession) {
		return { cwd: projectCwd, worktreeCreated: false };
	}
	if (!(await isGitRepo(projectCwd))) {
		return { cwd: projectCwd, worktreeCreated: false };
	}

	const branchName = `lyra/session-${sessionId.slice(0, 8)}`;
	const root = await git(projectCwd, ["rev-parse", "--show-toplevel"])
		.then((out) => out.trim())
		.catch(() => projectCwd);
	const repoName = basename(root) || "repo";

	let targetDir: string;
	if (settings.worktrees.rootDir && settings.worktrees.rootDir.trim()) {
		const baseDir = resolveWorktreesRoot(settings.worktrees.rootDir);
		targetDir = join(baseDir, `${repoName}-${sessionId.slice(0, 8)}`);
	} else {
		targetDir = join(root, "..", `${repoName}-${sessionId.slice(0, 8)}`);
	}

	const result = await createWorktree(projectCwd, branchName, {
		targetDir,
		fetchUpstream: settings.worktrees.fetchUpstreamBeforeCreate ?? false,
	});

	if (result.ok && result.path) {
		return { cwd: result.path, worktreeCreated: true, branch: branchName };
	}
	return { cwd: projectCwd, worktreeCreated: false };
}

/**
 * Cleans up old managed worktrees when exceeding keepLimit or when autoCleanOld is enabled.
 */
export async function cleanOldWorktrees(
	repoCwd: string,
	settings: Settings,
	activeSessionCwds: Set<string> = new Set(),
): Promise<number> {
	if (!settings.worktrees?.autoCleanOld) return 0;
	if (!(await isGitRepo(repoCwd))) return 0;

	const keepLimit = Math.max(1, settings.worktrees.keepLimit ?? 15);
	const out = await git(repoCwd, ["worktree", "list", "--porcelain"]).catch(() => "");
	/*
	 * Canonical spellings on both sides of the guard below.
	 *
	 * These two sets of paths come from different places — one from git's output, one from
	 * `path.join` in the caller — and on Windows they never matched: git prints forward slashes.
	 * The effect was not a cosmetic mismatch but the guard silently never firing, so the cleanup
	 * deleted the worktree of whatever session was running. See `path-key.ts`.
	 */
	const active = new Set([...activeSessionCwds].map(pathKey));
	const worktrees: { path: string; isMain: boolean }[] = [];
	let currentPath: string | null = null;

	const flush = (isMain: boolean) => {
		if (currentPath) {
			worktrees.push({ path: currentPath, isMain });
			currentPath = null;
		}
	};

	for (const line of out.split("\n")) {
		if (line.startsWith("worktree ")) {
			flush(worktrees.length === 0);
			currentPath = line.slice("worktree ".length);
		}
	}
	flush(worktrees.length === 0);

	const linkedTrees = worktrees.filter((w) => !w.isMain);
	if (linkedTrees.length <= keepLimit) return 0;

	// Sort linked trees by modification time (oldest first)
	const withStats = await Promise.all(
		linkedTrees.map(async (tree) => {
			try {
				const s = await stat(tree.path);
				return { path: tree.path, mtime: s.mtimeMs };
			} catch {
				return { path: tree.path, mtime: 0 };
			}
		}),
	);

	withStats.sort((a, b) => a.mtime - b.mtime);
	const excess = withStats.length - keepLimit;
	let cleaned = 0;

	for (let i = 0; i < withStats.length && cleaned < excess; i++) {
		const target = withStats[i];
		// Do not delete a worktree that is currently used by a live session
		if (active.has(pathKey(target.path))) continue;
		const res = await removeWorktree(repoCwd, target.path, true);
		if (res.ok) cleaned++;
	}

	return cleaned;
}
