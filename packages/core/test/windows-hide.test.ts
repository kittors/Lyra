/**
 * 起控制台程序时，不给 Windows 弹控制台窗口的机会。
 *
 * Electron 主进程没有自己的控制台，被编辑器、计划任务拉起的 CLI 往往也没有。这样的宿主在 Windows
 * 上启动 `node.exe`、`rg.exe` 这类控制台程序而不带 `windowsHide`，系统就给子进程新开一个控制台：
 * 一个黑窗口闪一下，还抢走焦点。这只在 Windows 上看得见，而单测大多跑在别的系统上，所以这里不起
 * 真进程，截下 `spawn` 看它拿到的选项——这个问题的全部就在选项里。
 *
 * 截下来的子进程一出生就报「没有这个程序」，调用方各自走没有它时的那条路，测试不等任何真东西。
 * core 里其余起子进程的地方各有自己的测试守着这个选项（taskkill 在 `mcp-client.test.ts`）；
 * 这里是没有别处可放的那几处。
 */

import assert from "node:assert/strict";
import childProcess, { ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";
import { TsServerBackend } from "../src/lsp/tsserver.ts";
import { grepTool } from "../src/tools/grep.ts";

type SpawnCall = { file: string; args: readonly string[]; options: SpawnOptions };

/** 截下这条测试里的每一次 `spawn`，结束时还原——包括 ESM 那份绑定，它不会自己跟着变。 */
function recordSpawns(t: TestContext): SpawnCall[] {
	const calls: SpawnCall[] = [];
	const spawn = t.mock.method(childProcess, "spawn", (file: string, args: readonly string[], options: SpawnOptions) => {
		calls.push({ file, args, options });
		const child = new ChildProcess();
		/*
		 * 没 spawn 过的 ChildProcess 也带着一个进程句柄，而它的 kill() 落到 pid 0 上——发给整个
		 * 进程组，test runner 连同启动它的 shell 一起收到 SIGTERM。语言服务器的 dispose 会 kill。
		 */
		child.kill = () => false;
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		Object.assign(child, { stdout, stderr });
		queueMicrotask(() => {
			child.emit("error", Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" }));
			stdout.end();
			stderr.end();
		});
		return child;
	});
	syncBuiltinESMExports();
	t.after(() => {
		spawn.mock.restore();
		syncBuiltinESMExports();
	});
	return calls;
}

async function tempDir(t: TestContext): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "ly-windows-hide-"));
	t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }));
	return dir;
}

test("起语言服务器不给 node.exe 开控制台窗口", async (t) => {
	/*
	 * CLI 下 `process.execPath` 就是 `node.exe`。服务器空闲十分钟会被回收、下次问再起，所以漏了
	 * 这个选项闪的不止一次。
	 */
	const backend = new TsServerBackend();
	if (!(await backend.available())) {
		t.skip("这台机器上没有 tsserver");
		return;
	}
	const root = await tempDir(t);
	const calls = recordSpawns(t);
	await backend.start(root);
	await backend.dispose();
	assert.deepEqual(calls.map((call) => call.file), [process.execPath]);
	assert.equal(calls[0].options.windowsHide, true);
});

test("grep 起 rg 不开控制台窗口", async (t) => {
	/* 模型每一次搜索都要起它，最常见的一处；json 与纯文本两种输出各起一次，两次都要带。 */
	const root = await tempDir(t);
	await writeFile(join(root, "a.txt"), "needle\n");
	const calls = recordSpawns(t);
	const result = await grepTool.execute({ pattern: "needle" }, { cwd: root, sessionId: "s", state: new Map<string, unknown>() });
	const rg = calls.filter((call) => call.file === "rg");
	assert.equal(rg.length, 2, "先 --json，再退到纯文本");
	for (const call of rg) assert.equal(call.options.windowsHide, true);
	// rg「不在」之后由内置扫描接手：截下 spawn 没有改变工具的答案。
	assert.match(result.content.map((part) => ("text" in part ? part.text : "")).join(""), /a\.txt:1:needle/);
});
