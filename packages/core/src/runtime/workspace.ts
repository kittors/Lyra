/**
 * 这个工作目录是什么——主仓库、隔离副本，还是别的东西。
 *
 * 只回答一个问题，而这个问题只有一个用处：告诉模型「在这里改代码，用户的主工作树会不会看见」。
 * 答案决定它拿运行时证据的方式——已经在副本里就直接动手，不在就先开一个（见 `prompt/system.ts`
 * 里那条「思考用的改动放隔离副本」）。
 *
 * 不读会话的 `workspaceSetup`：那个字段是**一次性的待办标记**（「这个会话要建一个 worktree」），
 * `session-hub.ts` 建完就把它清成 `undefined`。拿它当「当前在不在副本里」会在建好之后立刻答错。
 */

import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 这个目录是不是一个 git worktree。
 *
 * 判据是 `.git` 本身：主仓库里它是目录，worktree 里它是一个写着 `gitdir:` 的文件。但**文件不等于
 * worktree**——submodule 的 `.git` 也是文件，而 submodule 里的改动是用户实实在在的改动，不是副本里
 * 的草稿。两者靠 gitdir 指向哪儿区分：worktree 指向 `…/.git/worktrees/<name>`，submodule 指向
 * `…/.git/modules/<name>`。
 *
 * 任何拿不准的情况一律返回 false，因为两个方向的代价差得很远：误判「不在副本里」最多让它多开一个
 * 副本，白费几秒；误判「在副本里」会让它以为可以随便改，然后直接动用户的工作树。
 */
export async function isIsolatedWorktree(cwd: string): Promise<boolean> {
	try {
		const dotGit = join(cwd, ".git");
		const stat = await lstat(dotGit);
		// 目录 = 主仓库。也挡住了符号链接：`lstat` 不跟随，指向别处的 `.git` 不算副本。
		if (!stat.isFile()) return false;
		const pointer = await readFile(dotGit, "utf8");
		return /^\s*gitdir:\s*.*[/\\]worktrees[/\\]/m.test(pointer);
	} catch {
		// 不存在、读不动、权限不够——都算「不确定」，而不确定就按不在副本里处理。
		return false;
	}
}
