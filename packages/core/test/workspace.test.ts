/**
 * 「这个目录是不是一份隔离副本」——用真的 git 仓库问，不用桩。
 *
 * 这个判断只有一个用处：告诉模型在这里改代码，用户的主工作树会不会看见。答错的代价是不对称的，所以
 * 每一种「看起来像副本但不是」的东西都要单独钉一遍——尤其是 submodule，它的 `.git` 同样是一个文件，
 * 而它里面的改动是用户实实在在的改动。
 *
 * 夹具用真的 `git worktree add` 和 `git submodule add` 造：这两样东西的磁盘形状是 git 自己定的，
 * 手写一个 `.git` 文件去测，测的是我对 git 的记忆，不是 git 的行为。
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { isIsolatedWorktree } from "../src/runtime/workspace.ts";

const run = promisify(execFile);

/** 一个有一次提交的仓库——没有提交就开不了 worktree。 */
async function repo(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-ws-"));
	const git = (...args: string[]) => run("git", ["-C", dir, ...args]);
	await git("init", "-q");
	await git("config", "user.email", "t@t.test");
	await git("config", "user.name", "t");
	await git("config", "commit.gpgsign", "false");
	await writeFile(join(dir, "a.txt"), "a\n");
	await git("add", "-A");
	await git("commit", "-q", "-m", "init");
	return dir;
}

test("a real worktree is an isolated copy", async () => {
	const main = await repo();
	const wt = join(main, "..", `wt-${Date.now()}`);
	try {
		await run("git", ["-C", main, "worktree", "add", "--detach", wt, "HEAD"]);
		assert.equal(await isIsolatedWorktree(wt), true);
	} finally {
		await run("git", ["-C", main, "worktree", "remove", "--force", wt]).catch(() => {});
		await rm(main, { recursive: true, force: true });
	}
});

test("the main repository is not", async () => {
	// 主仓库里 `.git` 是目录，而在这里改代码用户当然看得见。
	const main = await repo();
	try {
		assert.equal(await isIsolatedWorktree(main), false);
	} finally {
		await rm(main, { recursive: true, force: true });
	}
});

test("a submodule is not, even though its .git is also a file", async () => {
	/*
	 * 这条是这个文件存在的主要理由。
	 *
	 * submodule 的 `.git` 和 worktree 的一样是个写着 `gitdir:` 的文件，只判断「文件还是目录」会把它
	 * 认成副本——然后模型以为自己在草稿里，动的却是用户真正的子模块。两者的区别只在 gitdir 指向哪：
	 * worktree 是 `…/worktrees/<name>`，submodule 是 `…/modules/<name>`。
	 */
	const parent = await repo();
	const child = await repo();
	try {
		// `-c` 而不是 `git config`：submodule 的 clone 跑在子进程里，仓库级那份配置它读不到。
		await run("git", ["-c", "protocol.file.allow=always", "-C", parent, "submodule", "add", "-q", child, "sub"]);
		assert.equal(await isIsolatedWorktree(join(parent, "sub")), false);
	} finally {
		await rm(parent, { recursive: true, force: true });
		await rm(child, { recursive: true, force: true });
	}
});

test("a plain directory that is not a repository is not", async () => {
	const dir = await mkdtemp(join(tmpdir(), "lyra-plain-"));
	try {
		assert.equal(await isIsolatedWorktree(dir), false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a path that does not exist is not", async () => {
	// 读不动、不存在、没权限——都算拿不准，而拿不准一律落在安全的那一边。
	assert.equal(await isIsolatedWorktree(join(tmpdir(), `lyra-missing-${Date.now()}`)), false);
});

test("a malformed .git pointer is not", async () => {
	const cases = ["", "gitdir:", "not a pointer at all\n", "gitdir: /somewhere/else\n"];
	for (const body of cases) {
		const dir = await mkdtemp(join(tmpdir(), "lyra-bad-"));
		try {
			await writeFile(join(dir, ".git"), body);
			assert.equal(await isIsolatedWorktree(dir), false, `畸形指针不该被当成副本：${JSON.stringify(body)}`);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

test("a .git symlink pointing at a real worktree pointer is not", async () => {
	/*
	 * `lstat` 不跟随符号链接，所以一个指向别处的 `.git` 不算副本。
	 *
	 * 这不是假想的形状：把 `.git` 软链出去是有人真的会做的事，而链接的那一头指到哪，这个函数管不着。
	 * 管不着的东西按拿不准处理。
	 */
	const dir = await mkdtemp(join(tmpdir(), "lyra-link-"));
	try {
		const real = join(dir, "real-pointer");
		await mkdir(join(dir, "work"));
		await writeFile(real, "gitdir: /tmp/whatever/.git/worktrees/x\n");
		await symlink(real, join(dir, "work", ".git"));
		assert.equal(await isIsolatedWorktree(join(dir, "work")), false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

/*
 * 每一个组装系统提示的地方，都要说清楚自己在什么工作区里。
 *
 * 这个项目反复栽在同一件事上：字段加了、类型也对、就是没人传。而这个字段漏传不会报错——它是可选的，
 * 缺省按「不在副本里」算，于是一个真的跑在 worktree 上的会话被告知去再开一个副本，谁也不会发现。
 *
 * 对着 `isGitRepo` 数，不数调用点：两个字段回答的是同一个问题的两半（这是不是仓库、是不是副本），
 * 永远出现在同一个对象里。哪天多出一个组装提示的地方，它也会被这条一起管住。
 */
test("every place that builds a system prompt says which kind of workspace it is in", async () => {
	const { readdir, readFile } = await import("node:fs/promises");
	const { fileURLToPath } = await import("node:url");
	const root = fileURLToPath(new URL("../src/", import.meta.url));

	const walk = async (dir: string): Promise<string[]> => {
		const out: string[] = [];
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) out.push(...(await walk(full)));
			else if (entry.name.endsWith(".ts")) out.push(full);
		}
		return out;
	};

	let sites = 0;
	for (const file of await walk(root)) {
		const source = await readFile(file, "utf8");
		// 类型声明本身不算调用点。
		if (file.endsWith("prompt/system.ts")) continue;
		const declares = (source.match(/^\s*isGitRepo:/gm) ?? []).length;
		if (declares === 0) continue;
		const isolated = (source.match(/^\s*isolatedWorktree:/gm) ?? []).length;
		assert.equal(isolated, declares, `${file} 说了自己是不是 git 仓库，却没说是不是隔离副本`);
		sites += declares;
	}
	assert.ok(sites >= 3, `只找到 ${sites} 个组装点，这条测试大概没在查它以为在查的东西`);
});
