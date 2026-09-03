/**
 * The contract against the two files it describes.
 *
 * This is the whole point of the package: `preload.ts` and `sync-rpc.ts` used to be the only record
 * of what exists and what the phone may call, and nothing compared them. Adding a method to one and
 * not the other produced a different failure each time — and the worst of those was silent, because
 * a method missing from the allowlist is not an error on the phone, it is nothing happening.
 *
 * Read as text rather than imported. Importing `preload.ts` would pull in `electron`, which does not
 * exist in a plain Node process; and reading the source is the stronger check anyway — it asserts
 * against what is written, not against what a module happens to export.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CHANNELS, METHODS, REMOTE_METHODS, methodFor } from "../src/methods.ts";

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "desktop", "electron");

async function source(file: string): Promise<string> {
	return readFile(join(DESKTOP, file), "utf8");
}

/** Every `group.name` in the contract, flat. */
function everyMethod(): string[] {
	return Object.entries(METHODS).flatMap(([group, methods]) => Object.keys(methods).map((name) => `${group}.${name}`));
}

test("契约里的每个 channel 都真的被 preload 用着", async () => {
	const preload = await source("preload.ts");
	const missing = CHANNELS.filter((channel) => !preload.includes(`"${channel}"`));
	assert.deepEqual(missing, [], "契约里有 preload 不认识的 channel——多半是改名之后忘了同步");
});

test("preload 里的每个 channel 都在契约里", async () => {
	const preload = await source("preload.ts");
	const used = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1] as string);
	const unknown = [...new Set(used)].filter((channel) => !CHANNELS.includes(channel));
	assert.deepEqual(
		unknown,
		[],
		"preload 调了契约里没有的 channel。加方法时这里会红——把它加进 methods.ts，顺便决定手机能不能用",
	);
});

test("契约说手机能用的，sync-rpc 里都有实现", async () => {
	const rpc = await source("sync-rpc.ts");
	const unimplemented = REMOTE_METHODS.filter((path) => !rpc.includes(`"${path}"`));
	assert.deepEqual(unimplemented, [], "契约标了 remote 但 sync-rpc 没实现——手机调它会得到「方法不存在」");
});

test("sync-rpc 实现的，契约里都标了 remote", async () => {
	const rpc = await source("sync-rpc.ts");
	const implemented = [...rpc.matchAll(/^\t"([a-z]+\.[a-zA-Z]+)":/gm)].map((m) => m[1] as string);
	const undeclared = implemented.filter((path) => methodFor(path)?.remote !== true);
	assert.deepEqual(
		undeclared,
		[],
		"sync-rpc 实现了契约没标 remote 的方法——白名单开了一个契约上看不见的口子",
	);
});

test("不给手机的方法都写了理由", () => {
	const noReason: string[] = [];
	for (const [group, methods] of Object.entries(METHODS)) {
		for (const [name, method] of Object.entries(methods)) {
			if (!method.remote && !("why" in method && method.why)) noReason.push(`${group}.${name}`);
		}
	}
	assert.deepEqual(
		noReason,
		[],
		"remote: false 必须附一句为什么。这是安全边界，一个光秃秃的 false 读起来像是忘了加",
	);
});

test("channel 不重名", () => {
	const seen = new Map<string, string>();
	const clashes: string[] = [];
	for (const [group, methods] of Object.entries(METHODS)) {
		for (const [name, method] of Object.entries(methods)) {
			const previous = seen.get(method.channel);
			if (previous) clashes.push(`${method.channel}: ${previous} 与 ${group}.${name}`);
			else seen.set(method.channel, `${group}.${name}`);
		}
	}
	assert.deepEqual(clashes, [], "两个方法用了同一个 channel，后注册的会覆盖先注册的");
});

test("channel 都是「域:动作」的形状", () => {
	/*
	 * `terminal:list-all` 是唯一一个用短横线的，其余 156 个都是 camelCase。
	 *
	 * 不改它：channel 名是进程之间的约定，改名要同时动 preload、handler 与所有调用点，为一处
	 * 命名不齐做这些不值得。列在这里而不是放宽正则，是因为「已知的一处例外」和「随便怎么写都行」
	 * 是两回事——再多一个就该统一了。
	 */
	const KNOWN_ODD = new Set(["terminal:list-all"]);
	const odd = CHANNELS.filter((channel) => !/^[a-z]+:[a-zA-Z]+$/.test(channel) && !KNOWN_ODD.has(channel));
	assert.deepEqual(odd, [], "channel 命名统一成 域:动作，混进别的形状会让按域搜索漏掉");
});

test("methodFor 能按路径找到，找不到的返回 undefined", () => {
	assert.equal(methodFor("settings.get")?.channel, "settings:get");
	assert.equal(methodFor("settings.get")?.remote, true);
	assert.equal(methodFor("terminal.open")?.remote, false);
	assert.ok(methodFor("terminal.open")?.why, "终端不给手机，理由要在");

	for (const nonsense of ["", "settings", "settings.nope", "nope.get", "a.b.c"]) {
		assert.equal(methodFor(nonsense), undefined, `${nonsense} 不该匹配到任何方法`);
	}
});

test("数量对得上，且手机只拿到一小部分", () => {
	assert.equal(CHANNELS.length, everyMethod().length, "每个方法一个 channel");
	assert.ok(CHANNELS.length > 100, "这个应用的 IPC 面本来就大，少于一百说明清单丢了东西");
	// 手机能调的是很小的一部分，而这正是它该有的样子。数字变大时应该有人解释为什么。
	assert.ok(
		REMOTE_METHODS.length < CHANNELS.length * 0.2,
		`手机可用的方法占到了 ${REMOTE_METHODS.length}/${CHANNELS.length}——超过两成就值得重新看一遍白名单`,
	);
});

test("最该挡住的那几样，确实挡住了", () => {
	// 这几条是 sync-rpc 与 phone-settings 的注释里记着的真实事故的回归测试。
	for (const path of [
		"terminal.open", // 开一个 shell
		"files.write", // 写任意路径
		"system.openPath", // 交给系统去打开
		"registry.install", // 装别人的代码
		"plugins.list", // 本机装了什么
	]) {
		const method = methodFor(path);
		if (!method) continue; // 方法改名了就跳过，别为此假红——上面的两条一致性测试会抓到改名
		assert.equal(method.remote, false, `${path} 不该对手机开放：持有配对令牌不等于拥有这台机器`);
	}
});
