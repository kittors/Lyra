/**
 * Branches, and the door to everything else git-related.
 *
 * Branch operations live here because they are what the panel opens on. The rest — status, diffs,
 * history, repositories — is re-exported from the modules that own it, so a caller says
 * `from "./git.ts"` and does not have to know which file a function moved to.
 */

import { git } from "./git-exec.ts";

export { type RemoteResult } from "./git-exec.ts";
export { type GitOperation, type RemoteState } from "./git-remote-state.ts";
export { collectWorkspaceDiff, readDiffBlob, type DiffBlob } from "./git-diff.ts";
export {
	commitAll,
	discardPaths,
	gitStatus,
	stagePaths,
	unstagePaths,
	workspaceStat,
	type GitCommit,
	type GitStatus,
	type GitStatusFile,
} from "./git-status.ts";
export {
	commitDiff,
	commitDiffSummary,
	commitStaged,
	createBranch,
	deleteBranch,
	diffRefs,
	gitLog,
	fetchRemotes,
	pullBranch,
	pushBranch,
	FETCH_TIMEOUT_MS,
	QUIET_FETCH_TIMEOUT_MS,
} from "./git-history.ts";
export {
	createWorktree,
	initRepo,
	listRepos,
	listWorktrees,
	pruneWorktrees,
	removeWorktree,
	type RepoRef,
	type WorktreeCreateOptions,
	type WorktreeResult,
} from "./git-repos.ts";
export {
	bumpVersionFiles,
	getReleaseInfo,
	getWorkflowRunStatus,
	listWorkflowRuns,
	publishReleaseTag,
	triggerReleaseDryRun,
	type ReleaseInfo,
	type WorkflowRunStatus,
	type WorkflowRunSummary,
} from "./git-release.ts";
export { generateCommitMessage } from "./git-commit-message.ts";

/**
 * Whether this directory is inside a working tree — and if git would not say, why not.
 *
 * The catch used to swallow everything, and that is a different claim than it looks: `git` missing
 * from `PATH`, a directory that cannot be read, a repository git refuses to touch — all of them
 * came back as `false`, and the window said 「不是 Git 仓库，这个目录还没有版本控制」 about a
 * directory with a perfectly good `.git` in it. The one answer nobody could act on, because it
 * describes a state that is not the one they are in.
 *
 * Naming it in a log was not enough either: the log is somewhere the user cannot see, so the window
 * still showed the same wrong sentence with an 「初始化仓库」 button under it — offering to run
 * `git init` inside a repository. So the reason comes back with the answer and is put on screen.
 *
 * Three of these are worth telling apart, because the fix for each is different:
 *
 *     fatal: detected dubious ownership in repository at '…'   — a checkout owned by another user
 *     spawn git ENOENT                                          — no git on PATH at all
 *     fatal: not a git repository                               — git answering the question
 */
export interface RepoProbe {
	repo: boolean;
	/** What stopped git from answering, in the user's language. Absent when it did answer. */
	problem?: string;
}

export async function probeRepo(cwd: string): Promise<RepoProbe> {
	try {
		return { repo: (await git(cwd, ["rev-parse", "--is-inside-work-tree"])).trim() === "true" };
	} catch (error) {
		const said = String((error as { stderr?: string })?.stderr ?? (error as Error)?.message ?? error).trim();
		const first = said.split("\n")[0] ?? said;

		// git's own way of saying no — the only case where "not a repository" is the truth.
		if (/not a git repository/i.test(said)) return { repo: false };

		if (/ENOENT/.test(said) && /spawn git/i.test(said)) {
			return { repo: false, problem: "找不到 git 命令。请确认已安装 git，并且它在系统 PATH 里。" };
		}
		if (/dubious ownership/i.test(said)) {
			const match = /repository at '(.+?)'/.exec(said);
			const where = match?.[1] ?? cwd;
			return {
				repo: false,
				problem: `git 拒绝读取这个仓库，因为它属于另一个用户。可以执行：git config --global --add safe.directory ${where}`,
			};
		}
		return { repo: false, problem: `git 没能读取这个目录：${first}` };
	}
}

/** The same question, for the callers that only branch on the answer. */
export async function isGitRepo(cwd: string): Promise<boolean> {
	return (await probeRepo(cwd)).repo;
}

/**
 * The branch that is checked out, or null when none is.
 *
 * `symbolic-ref` and nothing else, for two reasons that pull the same way.
 *
 * It is the only one that answers the question. `rev-parse --abbrev-ref HEAD` returns the *string*
 * `"HEAD"` on a detached checkout rather than failing — so every caller that wrote `if (!branch)`
 * was reading "not on a branch" as "on a branch called HEAD". `pushBranch` was one of them, and it
 * went on to run `push -u origin HEAD`, which git refuses with `not a full refname`. A checkout at
 * a tag, a bisect, and every rebase in progress all land here.
 *
 * And it is right about a repository with no commits, which is why `rev-parse` was paired with it
 * to begin with: there is no commit to resolve, but HEAD already names the branch the first commit
 * will land on, and `symbolic-ref` reads that name. So one call answers both cases where two used
 * to, and the one it drops is the one that was lying.
 */
export async function gitBranch(cwd: string): Promise<string | null> {
	return git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])
		.then((out) => out.trim() || null)
		.catch(() => null);
}

export interface BranchList {
	current: string | null;
	local: string[];
	/** Remote-tracking branches, minus the ones that already have a local counterpart. */
	remote: string[];
}

/** Local and remote branches, for the switcher in the composer. */
export async function listBranches(cwd: string): Promise<BranchList> {
	if (!(await isGitRepo(cwd))) return { current: null, local: [], remote: [] };

	const [current, refs] = await Promise.all([
		gitBranch(cwd),
		/*
		 * The full ref path, not the short name, because the short name cannot be classified.
		 *
		 * `%(refname:short)` is ambiguous in both directions. `refs/remotes/origin/HEAD` shortens to
		 * plain `origin` — no slash — so a "does it contain a slash" test filed the remote's own
		 * symbolic pointer under local branches, and it appeared in the switcher as a branch called
		 * `origin` that cannot be checked out. And a local branch is very often `feat/something`,
		 * which has a slash and was therefore filed under remotes: on a repository that names its
		 * branches that way, nearly every local branch showed up in the wrong half of the menu.
		 *
		 * The prefix says which it is, exactly, and costs nothing to read.
		 */
		git(cwd, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]).catch(() => ""),
	]);

	const local: string[] = [];
	const remote: string[] = [];
	for (const line of refs.split("\n")) {
		const ref = line.trim();
		if (!ref) continue;
		if (ref.startsWith("refs/heads/")) {
			local.push(ref.slice("refs/heads/".length));
		} else if (ref.startsWith("refs/remotes/")) {
			const name = ref.slice("refs/remotes/".length);
			// `origin/HEAD` is a symbolic pointer, not somewhere you can check out.
			if (name.endsWith("/HEAD")) continue;
			remote.push(name);
		}
	}

	const known = new Set(local);
	return {
		current,
		local: local.sort(),
		// A remote branch whose short name already exists locally would just check out the local one.
		remote: remote.filter((r) => !known.has(r.split("/").slice(1).join("/"))).sort(),
	};
}

/**
 * Switch branches, refusing rather than clobbering.
 *
 * `git switch` stops on its own when uncommitted work would be overwritten; the message it
 * prints is more useful than anything this layer could invent, so it is passed straight
 * through to the user.
 */
export async function switchBranch(cwd: string, branch: string): Promise<{ ok: boolean; error?: string }> {
	try {
		/*
		 * A remote branch is not a place you can stand, so switching to one means creating a local
		 * branch that follows it.
		 *
		 * `git switch origin/main` fails outright — "a branch is expected, got remote branch" — and
		 * that error went straight to the user as if they had done something wrong, from a menu that
		 * had just offered them the entry. `--track` makes the local branch, names it after the
		 * remote's own short name, and sets the upstream in one step.
		 *
		 * Decided by looking rather than by parsing the name: `feat/x` is a perfectly ordinary local
		 * branch, and telling the two apart by counting slashes is what produced the bug above.
		 */
		const isLocal = await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
			.then(() => true)
			.catch(() => false);
		await git(cwd, isLocal ? ["switch", branch] : ["switch", "--track", branch]);
		return { ok: true };
	} catch (cause) {
		const message = cause instanceof Error && "stderr" in cause ? String(cause.stderr) : String(cause);
		return { ok: false, error: message.trim() || "切换分支失败" };
	}
}
