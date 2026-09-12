/**
 * Git over IPC.
 *
 * Thin on purpose: every handler here is a name, a guard and a call into `../git.ts`. The work is
 * there; what belongs at this layer is only the decision about which requests are allowed to reach
 * it — the renderer can name any path, and a repository the user never opened is not one of them.
 */

import { ipcMain } from "electron";
import { avatarsFor, githubAvatar } from "../avatars.ts";
import { findLocalCheckout } from "../git-remote.ts";
import { generalScratchDir, type PrBrief, prScratchDir, scratchRoots, writePrBrief } from "../scratch.ts";
import {
	collectWorkspaceDiff,
	readDiffBlob,
	type DiffBlob,
	commitAll,
	commitDiff,
	commitDiffSummary,
	commitStaged,
	createBranch,
	createWorktree,
	deleteBranch,
	diffRefs,
	gitLog,
	gitStatus,
	initRepo,
	listBranches,
	listRepos,
	listWorktrees,
	pruneWorktrees,
	pullBranch,
	pushBranch,
	fetchRemotes,
	FETCH_TIMEOUT_MS,
	QUIET_FETCH_TIMEOUT_MS,
	removeWorktree,
	stagePaths,
	switchBranch,
	type WorktreeCreateOptions,
	discardPaths,
	unstagePaths,
	workspaceStat,
	getReleaseInfo,
	bumpVersionFiles,
	triggerReleaseDryRun,
	getWorkflowRunStatus,
	listWorkflowRuns,
	publishReleaseTag,
	generateCommitMessage,
} from "../git.ts";
import {
	accounts,
	commentOnPullRequest,
	listPullRequests,
	pullRequestDetail,
	pullRequestDiff,
	renameAccount,
	reviewPullRequest,
	setAccountEnabled,
	signIn,
	signOut,
} from "../forge/index.ts";

import { FORGE_KINDS, type ForgeKind, type ReviewVerdict } from "../forge/types.ts";
import { RemoteCalls } from "../remote-calls.ts";

export interface GitIpcDeps {
	/** Whether a path lies inside a project the user has opened. */
	insideAProject(target: string): boolean;
}

export function registerGitIpc({ insideAProject }: GitIpcDeps): void {
	ipcMain.handle("git:myPullRequests", async () => listPullRequests());

	/*
	 * Everything about one pull request is addressed by account first.
	 *
	 * `owner/name` is not enough to find it any more: the same path exists on github.com and on a
	 * company's own GitHub Enterprise, and which token may read it is exactly the difference. The
	 * id travels on the row, so the renderer never has to work out which host a click belongs to.
	 */
	ipcMain.handle("git:pullRequest", async (_event, accountId: string, repo: string, number: number) =>
		pullRequestDetail(accountId, repo, number),
	);

	ipcMain.handle("git:pullRequestDiff", async (_event, accountId: string, repo: string, number: number) =>
		pullRequestDiff(accountId, repo, number),
	);

	ipcMain.handle("git:commentOnPullRequest", async (_event, accountId: string, repo: string, number: number, body: string) =>
		commentOnPullRequest(accountId, repo, number, body),
	);

	ipcMain.handle(
		"git:reviewPullRequest",
		async (_event, accountId: string, repo: string, number: number, verdict: ReviewVerdict, body: string) =>
			reviewPullRequest(accountId, repo, number, verdict, body),
	);

	/*
	 * The accounts themselves, which are the only part of this the renderer may change.
	 *
	 * Tokens go in and never come out. `forge:accounts` returns identities without secrets, and
	 * there is deliberately no channel that reads one back — a token that can be asked for over IPC
	 * is a token that ends up in a devtools panel.
	 */
	// No `encrypted` flag any more: the seal no longer depends on the machine having a keyring, so
	// there is no longer a case where it is false. See `forge/vault.ts`.
	ipcMain.handle("forge:kinds", async () => ({ kinds: FORGE_KINDS }));

	ipcMain.handle("forge:accounts", async () => accounts());

	ipcMain.handle("forge:signIn", async (_event, input: { kind: ForgeKind; baseUrl: string; token: string; label?: string }) =>
		signIn(input),
	);

	ipcMain.handle("forge:signOut", async (_event, id: string) => signOut(id));

	ipcMain.handle("forge:setEnabled", async (_event, id: string, enabled: boolean) => setAccountEnabled(id, enabled));

	ipcMain.handle("forge:rename", async (_event, id: string, label: string) => renameAccount(id, label));

	ipcMain.handle("git:branches", async (_event, cwd: string) => listBranches(cwd));

	/*
	 * 改仓库状态的那几条，和提交走同一道边界。
	 *
	 * 这五条从前一条守卫都没有，而它们都会写：切分支动工作区、建/删工作树动目录、`init` 会在
	 * 任意路径上造一个仓库。最要命的是 `removeWorktree`——它在 `git worktree remove` 失败之后
	 * 兜底 `rm -rf`，也就是说渲染进程拿着一个任意路径就能触发一次递归删除。那一侧也收紧了
	 * （只删 `git worktree list` 认得的路径），这里是同一件事的第二层：先问它在不在已打开的
	 * 项目里。
	 */
	ipcMain.handle("git:switchBranch", async (_event, cwd: string, branch: string) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return switchBranch(cwd, branch);
	});

	ipcMain.handle("git:createWorktree", async (_event, cwd: string, branch: string, options?: WorktreeCreateOptions) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return createWorktree(cwd, branch, options);
	});
	ipcMain.handle("git:removeWorktree", async (_event, cwd: string, worktreePath: string) => {
		// 两个路径都要问：`cwd` 决定问哪个仓库，`worktreePath` 是真正会被删掉的那个。
		if (!insideAProject(cwd) || !insideAProject(worktreePath)) {
			return { ok: false, error: "该目录不在已打开的项目内" };
		}
		return removeWorktree(cwd, worktreePath);
	});
	ipcMain.handle("git:pruneWorktrees", async (_event, cwd: string) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return pruneWorktrees(cwd);
	});

	ipcMain.handle("git:stat", async (_event, cwd: string) => workspaceStat(cwd));

	ipcMain.handle("git:commit", async (_event, cwd: string, message: string) => {
		// Same boundary as reading and writing files. Committing is the most consequential thing
		// the renderer can ask for — it stages everything under a directory — so it is the last
		// place to leave unchecked.
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return commitAll(cwd, message);
	});

	ipcMain.handle("git:repos", async (_event, root: string) => listRepos(root));

	ipcMain.handle("git:worktrees", async (_event, cwd: string) => listWorktrees(cwd));
	ipcMain.handle("git:init", async (_event, cwd: string) => {
		// 在任意目录上造一个仓库也是写。这一条服务的场景是「面板正看着一个刚建出来的项目」，
		// 那个目录本来就是已打开的项目，所以守卫不挡正常用法。
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return initRepo(cwd);
	});

	/*
	 * 下面这些只读的没有加守卫，说明一下为什么。
	 *
	 * 它们问的是分支、状态、历史、diff，不改变任何东西。威胁模型是渲染进程被 XSS——那种情况下
	 * 「读到别的仓库的提交记录」确实不好，但和上面那批「改别的仓库、删别的目录」不是一个量级，
	 * 而 `git:repos` 这类本来就要能看项目之外（它的用途就是找仓库）。
	 *
	 * 也就是说：这不是漏了，是划在这里。要改这条线的人，先想清楚 `git:repos` 怎么办。
	 */
	ipcMain.handle("git:status", async (_event, cwd: string) => gitStatus(cwd));

	ipcMain.handle("git:log", async (_event, cwd: string, limit?: number, ref?: string) => gitLog(cwd, limit, ref));

	ipcMain.handle("git:commitDiff", async (_event, cwd: string, sha: string) => commitDiff(cwd, sha));
	// The same commit, listed but not read — see `diffSummary`.
	ipcMain.handle("git:commitDiffSummary", async (_event, cwd: string, sha: string) => commitDiffSummary(cwd, sha));

	ipcMain.handle("git:diffRefs", async (_event, cwd: string, base: string, head: string | null) =>
		diffRefs(cwd, base, head),
	);

	/*
	 * The writing half, behind the same boundary as committing.
	 *
	 * Staging, discarding and branch surgery all reach outside the renderer's sandbox and are
	 * hard or impossible to undo — `discard` in particular deletes untracked files outright.
	 */
	for (const [channel, action] of [
		["git:stage", stagePaths],
		["git:unstage", unstagePaths],
		["git:discard", discardPaths],
	] as const) {
		ipcMain.handle(channel, async (_event, cwd: string, paths: string[]) => {
			if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
			return action(cwd, paths);
		});
	}

	ipcMain.handle("git:commitStaged", async (_event, cwd: string, message: string) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return commitStaged(cwd, message);
	});

	ipcMain.handle("git:generateCommitMessage", async (_event, cwd: string) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return generateCommitMessage(cwd);
	});

	ipcMain.handle("git:createBranch", async (_event, cwd: string, name: string, from?: string) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return createBranch(cwd, name, from);
	});

	ipcMain.handle("git:deleteBranch", async (_event, cwd: string, name: string, force?: boolean) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return deleteBranch(cwd, name, force);
	});

	/** The push / pull / fetch currently in flight, addressable by the token that started them. */
	const remoteCalls = new RemoteCalls();

	ipcMain.handle("git:push", async (_event, cwd: string, token?: string) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return remoteCalls.run(token, (signal) => pushBranch(cwd, { signal }));
	});

	ipcMain.handle("git:pull", async (_event, cwd: string, token?: string) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return remoteCalls.run(token, (signal) => pullBranch(cwd, { signal }));
	});

	ipcMain.handle("git:fetch", async (_event, cwd: string, token?: string, quiet?: boolean) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return remoteCalls.run(token, (signal) =>
			fetchRemotes(cwd, { signal, timeoutMs: quiet ? QUIET_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS }),
		);
	});

	ipcMain.handle("git:cancelRemote", async (_event, token: string) => {
		remoteCalls.cancel(token);
	});

	ipcMain.handle("diff:workspace", async (_event, cwd: string, base?: "head" | "index") => collectWorkspaceDiff(cwd, base));

	/*
	 * One side of a binary file, so the review can show the thing rather than describe it.
	 *
	 * A changed image is the common case by a distance, and "这个文件没有可以按行对比的内容" tells
	 * you nothing you could not already see from the file name. The bytes come back as a data URL
	 * because that is what an `<img>` takes and because it keeps this out of the media protocol,
	 * which serves the working tree only — the deleted side of a diff exists nowhere but in git.
	 *
	 * Guarded twice: the directory has to be a project the user opened, and the path has to resolve
	 * inside it. A diff panel that could be asked for `../../.ssh/id_rsa` as a data URL would be a
	 * file-read primitive wearing a picture frame.
	 */
	ipcMain.handle(
		"diff:blob",
		async (_event, cwd: string, path: string, side: "head" | "work"): Promise<DiffBlob | null> => {
			if (!insideAProject(cwd)) return null;
			return readDiffBlob(cwd, path, side);
		},
	);

	/*
	 * The scratch directory a pull request's conversation lives in.
	 *
	 * Here rather than in the renderer because it has to exist on disk before a session can be
	 * created in it, and because the app's home is the main process's to know. Returning the path
	 * lets the renderer use the ordinary session IPC for everything after this — a review chat is
	 * a normal session that simply is not in a project.
	 */
	ipcMain.handle("scratch:roots", async () => scratchRoots());

	/*
	 * The scratch directory for a conversation about this pull request, with the facts left in it.
	 *
	 * Only reached when the repository is not among the user's projects. `PR.md` is refreshed each
	 * time: a description edited on GitHub should not go on being answered from a copy taken weeks
	 * ago.
	 */
	ipcMain.handle("scratch:forPullRequest", async (_event, pr: PrBrief) => {
		const dir = await prScratchDir(pr.repo, pr.number);
		await writePrBrief(dir, pr).catch(() => {});
		return dir;
	});

	ipcMain.handle("scratch:general", async () => generalScratchDir());

	/*
	 * An avatar as a data URL, so the renderer never reaches out to github.com itself.
	 *
	 * Keeping the page's CSP narrow is worth one IPC round trip: widening `img-src` for a 20pt
	 * circle would widen it for every rendered comment body too.
	 */
	ipcMain.handle("git:avatar", async (_event, login: string) => githubAvatar(login));

	/*
	 * The same thing for a whole list, which is how the pull request pane asks.
	 *
	 * Capped rather than trusted. The renderer decides how many names to send, and a list that
	 * somehow grew unbounded would otherwise become an unbounded number of outbound requests — the
	 * cap is above anything the pane can actually draw (three buckets of thirty) and well below
	 * anything worth worrying about.
	 */
	ipcMain.handle("git:avatars", async (_event, people: { login: string; url?: string | null; accountId?: string }[]) => {
		// Resolved here rather than sent from the renderer: the account list is the main process's,
		// and a page that could name a host to fetch from is a page that widened the CSP by proxy.
		const known = new Map((await accounts()).map((account) => [account.id, account]));
		return avatarsFor(Array.isArray(people) ? people.slice(0, 120) : [], (id) => known.get(id) ?? null);
	});

	/*
	 * Which of the user's own projects is this repository, if any.
	 *
	 * Deliberately only their project list — not a scan of the disk. A checkout the user has never
	 * added is not somewhere the app should start working in unasked, and "not in the list" is the
	 * answer that sends this to a project-less conversation, which is the honest outcome.
	 */
	ipcMain.handle("git:findLocalCheckout", async (_event, repo: string, candidates: string[]) =>
		findLocalCheckout(repo, candidates),
	);

	/*
	 * Release management handlers: inspect, bump, dry-run, and publish tag.
	 */
	ipcMain.handle("git:releaseInfo", async (_event, cwd: string) => {
		if (!insideAProject(cwd)) return null;
		return getReleaseInfo(cwd);
	});

	ipcMain.handle("git:bumpVersion", async (_event, cwd: string, newVersion: string) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return bumpVersionFiles(cwd, newVersion);
	});

	ipcMain.handle("git:triggerDryRun", async (_event, cwd: string) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return triggerReleaseDryRun(cwd);
	});

	ipcMain.handle("git:listWorkflowRuns", async (_event, cwd: string, limit?: number) => {
		if (!insideAProject(cwd)) return [];
		return listWorkflowRuns(cwd, limit);
	});

	ipcMain.handle("git:workflowRunStatus", async (_event, cwd: string, runId: number) => {
		if (!insideAProject(cwd)) return null;
		return getWorkflowRunStatus(cwd, runId);
	});

	ipcMain.handle("git:publishReleaseTag", async (_event, cwd: string, version: string) => {
		if (!insideAProject(cwd)) return { ok: false, error: "该目录不在已打开的项目内" };
		return publishReleaseTag(cwd, version);
	});
}
