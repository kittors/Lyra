/**
 * Tests for Git worktree management, creation, auto-creation and cleanup.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import {
	autoCreateSessionWorktree,
	cleanOldWorktrees,
	createWorktree,
	pruneWorktrees,
	removeWorktree,
	resolveWorktreesRoot,
} from "../electron/git-worktrees.ts";
import { listWorktrees } from "../electron/git-repos.ts";
import { DEFAULT_SETTINGS } from "@lyra/core";

const exec = promisify(execFile);

let dir: string;
let origin: string;
let root: string;

async function git(args: string[], cwd = dir): Promise<string> {
	const { stdout } = await exec("git", args, { cwd });
	return stdout;
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "lyra-wt-test-"));
	dir = join(root, "work");
	origin = join(root, "origin.git");

	await exec("git", ["init", "--bare", "--initial-branch=main", origin]);
	await exec("git", ["init", "--initial-branch=main", dir]);
	await git(["config", "user.email", "test@example.com"]);
	await git(["config", "user.name", "Test"]);
	await writeFile(join(dir, "README.md"), "# Test\n");
	await git(["add", "."]);
	await git(["commit", "-m", "initial commit"]);
	await git(["remote", "add", "origin", origin]);
	await git(["push", "-u", "origin", "main"]);
});

after(async () => {
	await rm(root, { recursive: true, force: true }).catch(() => {});
});

test("resolveWorktreesRoot handles default and custom paths", () => {
	const defaultPath = resolveWorktreesRoot();
	assert.ok(defaultPath.length > 0);
	assert.ok(defaultPath.includes("worktrees"));

	const custom = resolveWorktreesRoot("~/my-custom-worktrees");
	assert.ok(!custom.startsWith("~"));
	assert.ok(custom.includes("my-custom-worktrees"));
});

test("createWorktree creates a linked worktree and listWorktrees lists it", async () => {
	const res = await createWorktree(dir, "feature/wt-1");
	assert.equal(res.ok, true);
	assert.ok(res.path && existsSync(res.path));
	assert.equal(res.branch, "feature/wt-1");

	const trees = await listWorktrees(dir);
	assert.ok(trees.length >= 2);
	const linked = trees.find((t) => t.path === res.path);
	assert.ok(linked);
	assert.equal(linked.worktree, true);
	assert.equal(linked.branch, "feature/wt-1");
});

test("removeWorktree removes a linked worktree and cleans it up", async () => {
	const created = await createWorktree(dir, "feature/wt-to-remove");
	assert.equal(created.ok, true);
	assert.ok(created.path && existsSync(created.path));

	const removed = await removeWorktree(dir, created.path);
	assert.equal(removed.ok, true);
	assert.equal(existsSync(created.path), false);

	const trees = await listWorktrees(dir);
	assert.ok(!trees.some((t) => t.path === created.path));
});

test("autoCreateSessionWorktree creates dedicated worktree when enabled in settings", async () => {
	const customSettings = {
		...DEFAULT_SETTINGS,
		worktrees: {
			autoCreateOnNewSession: true,
			rootDir: join(root, "session-worktrees"),
		},
	};

	const res = await autoCreateSessionWorktree(dir, customSettings, "session-12345678");
	assert.equal(res.worktreeCreated, true);
	assert.ok(res.cwd.includes("session-worktrees"));
	assert.ok(existsSync(res.cwd));

	// Test disabled setting
	const disabledSettings = {
		...DEFAULT_SETTINGS,
		worktrees: {
			autoCreateOnNewSession: false,
		},
	};
	const resDisabled = await autoCreateSessionWorktree(dir, disabledSettings, "session-999");
	assert.equal(resDisabled.worktreeCreated, false);
	assert.equal(resDisabled.cwd, dir);
});

test("cleanOldWorktrees prunes excess worktrees above keepLimit while protecting active ones", async () => {
	// Create multiple worktrees
	const wt1 = await createWorktree(dir, "cleanup/wt-1");
	const wt2 = await createWorktree(dir, "cleanup/wt-2");
	const wt3 = await createWorktree(dir, "cleanup/wt-3");

	assert.ok(wt1.path && wt2.path && wt3.path);

	const cleanSettings = {
		...DEFAULT_SETTINGS,
		worktrees: {
			autoCleanOld: true,
			keepLimit: 2,
		},
	};

	// wt1 is active, should not be deleted
	const active = new Set([wt1.path]);
	const cleanedCount = await cleanOldWorktrees(dir, cleanSettings, active);
	assert.ok(cleanedCount >= 1);
	assert.equal(existsSync(wt1.path), true, "active session worktree must be preserved");

	await pruneWorktrees(dir);
});

/**
 * The guard has to hold whatever the path looks like.
 *
 * On Windows it did not, and the failure was silent and destructive: `git worktree list` prints
 * `C:/Users/...` while everything else in the app produces `C:\Users\...`, so the set of active
 * worktrees never matched and the cleanup deleted the checkout the session was running in. The
 * spelling below is the one git would have produced; the assertion is that it is still recognised.
 */
test("a worktree in use is protected however its path is spelled", async () => {
	const keep = await createWorktree(dir, "spelling/in-use");
	const doomed = await createWorktree(dir, "spelling/idle-1");
	const alsoDoomed = await createWorktree(dir, "spelling/idle-2");
	assert.ok(keep.path && doomed.path && alsoDoomed.path);

	const settings = { ...DEFAULT_SETTINGS, worktrees: { autoCleanOld: true, keepLimit: 1 } };

	/*
	 * Built by hand, not with `join`.
	 *
	 * `join` normalises the `..` away, which would make this string identical to `keep.path` and
	 * the test vacuous — it passed before the fix on macOS for exactly that reason. Written out, it
	 * is a different string naming the same directory, which is the whole situation being tested.
	 */
	const awkward = `${keep.path}/../${basename(keep.path)}`;
	assert.notEqual(awkward, keep.path, "the awkward spelling must actually differ, or this proves nothing");

	const cleaned = await cleanOldWorktrees(dir, settings, new Set([awkward]));

	assert.ok(cleaned >= 1, "the idle worktrees should still be cleaned");
	assert.equal(existsSync(keep.path), true, "the worktree in use must survive an odd spelling");

	await pruneWorktrees(dir);
});

/*
 * 兜底的 `rm -rf` 只碰 git 自己认的工作树。
 *
 * `removeWorktree` 在 `git worktree remove` 失败之后会兜底删目录，而「这根本不是一棵工作树」
 * 正是它最常见的失败原因——于是传进去一个普通目录，git 拒绝，兜底把它整个删掉。这个函数由
 * `git:removeWorktree` 直接暴露给渲染进程，也就是说一个任意路径就能触发一次递归删除。
 *
 * 目录里放东西，是因为空目录被删掉和没被删掉太像；有内容时「还在」才是个有力的断言。
 */
test("不是工作树的目录，删不掉", async () => {
	const bystander = join(root, "not-a-worktree");
	await mkdtemp(join(root, "x-")).catch(() => {});
	await exec("mkdir", ["-p", bystander]);
	await writeFile(join(bystander, "重要文件.txt"), "别删我\n");

	const result = await removeWorktree(dir, bystander);

	assert.equal(result.ok, false, "它不是工作树，这次调用就该失败");
	assert.equal(existsSync(bystander), true, "目录必须还在——这是这条测试的全部意义");
	assert.equal(existsSync(join(bystander, "重要文件.txt")), true, "里面的东西也在");
});

test("真的工作树照样删得掉", async () => {
	// 上面那条守卫如果写死了，这条会红：它证明收紧的是「不是工作树」而不是「删不了了」。
	const made = await createWorktree(dir, "wt-removable", DEFAULT_SETTINGS);
	assert.equal(made.ok, true, made.error);
	assert.ok(made.path);

	const result = await removeWorktree(dir, made.path);
	assert.equal(result.ok, true, result.error);
	assert.equal(existsSync(made.path), false);
});
