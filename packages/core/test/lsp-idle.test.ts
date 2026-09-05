/**
 * 语言服务器空闲之后会被回收——计划 18 §11：「空闲 10 分钟后服务器被回收（进程数验证）」。
 *
 * 一台 tsserver 几百兆，而一个会话开着一整天里真正问它的时间加起来不到十分钟。这里前三条
 * 用假 backend 测计时器的接线，最后一条起一台真的 tsserver、等它被回收、然后**数进程**——
 * 验收条款说的是进程数，一个 `disposed = true` 的标志位证明不了那个。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CodeIntelManager, IDLE_MS } from "../src/lsp/manager.ts";
import { TsServerBackend } from "../src/lsp/tsserver.ts";
import type { CodeIntelBackend } from "../src/lsp/types.ts";

let root: string;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-lsp-idle-"));
	await mkdir(join(root, "src"), { recursive: true });
	await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
	await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }));
});
after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

/** 记着自己被起了几次、被杀了几次的假 backend。 */
function counting() {
	const counts = { started: 0, disposed: 0 };
	let up = false;
	const backend: CodeIntelBackend = {
		name: "fake",
		extensions: [".ts"],
		available: async () => true,
		start: async () => {
			counts.started += 1;
			up = true;
		},
		ready: () => up,
		references: async () => [],
		definition: async () => [],
		diagnostics: async () => [],
		rename: async () => [],
		dispose: async () => {
			counts.disposed += 1;
			up = false;
		},
	};
	return { backend, counts };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("默认十分钟——计划定的数", () => {
	assert.equal(IDLE_MS, 10 * 60 * 1000);
});

test("空闲到期就回收，下次问再起", async () => {
	const { backend, counts } = counting();
	const manager = new CodeIntelManager([backend], { idleMs: 40 });

	assert.ok(await manager.acquire(join(root, "src", "a.ts"), root), "第一次起来了");
	assert.equal(counts.started, 1);

	await tick(90);
	assert.equal(counts.disposed, 1, "空闲到期该被回收");
	assert.equal(backend.ready(), false);

	assert.ok(await manager.acquire(join(root, "src", "a.ts"), root), "回收之后再问，重新起");
	assert.equal(counts.started, 2, "是重新起了，不是复用一个死的");
	await manager.dispose();
});

test("一直有人问，就一直不回收", async () => {
	/*
	 * 计时器是「距上次使用」不是「距启动」。一个每三分钟问一次的会话，服务器该一直活着——
	 * 否则它每次问都在等冷启动，而那正是回收要避免的代价反过来落到最活跃的那个人头上。
	 */
	const { backend, counts } = counting();
	const manager = new CodeIntelManager([backend], { idleMs: 60 });
	await manager.acquire(join(root, "src", "a.ts"), root);

	for (let i = 0; i < 4; i += 1) {
		await tick(30);
		await manager.acquire(join(root, "src", "a.ts"), root);
	}
	assert.equal(counts.disposed, 0, "120ms 里每 30ms 问一次，60ms 的空闲上限一次都没到");

	await tick(100);
	assert.equal(counts.disposed, 1, "停下来之后才回收");
	await manager.dispose();
});

test("显式 dispose 之后计时器不会再回来补一刀", async () => {
	const { backend, counts } = counting();
	const manager = new CodeIntelManager([backend], { idleMs: 30 });
	await manager.acquire(join(root, "src", "a.ts"), root);
	await manager.dispose();
	assert.equal(counts.disposed, 1);

	await tick(70);
	assert.equal(counts.disposed, 1, "会话结束时杀过一次，空闲计时器不该再杀一次死的");
});

test("真的 tsserver：空闲之后进程没了", { timeout: 60_000 }, async (t) => {
	/*
	 * 数进程，不数标志位。验收条款写的是「进程数验证」，因为一个 `disposed = true` 挡不住
	 * 子进程还在——`kill` 发出去了不等于它死了。
	 */
	const backend = new TsServerBackend();
	if (!(await backend.available())) {
		t.skip("这台机器上没有 tsserver");
		return;
	}
	const manager = new CodeIntelManager([backend], { idleMs: 300 });
	const got = await manager.acquire(join(root, "src", "a.ts"), root);
	if (!got) {
		// 冷启动可能超过 READY_WAIT_MS；再等一次
		await tick(3000);
	}
	const pid = backend.pid;
	assert.ok(pid, "起来了就该有 pid");
	assert.doesNotThrow(() => process.kill(pid, 0), "进程活着");

	await tick(1200);
	/*
	 * ESRCH = 没有这个进程。`kill(pid, 0)` 不发信号，只问在不在。
	 */
	assert.throws(() => process.kill(pid, 0), (err: NodeJS.ErrnoException) => err.code === "ESRCH", "空闲到期后进程该没了");
	assert.equal(backend.pid, null);
	await manager.dispose();
});
