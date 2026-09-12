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
import { readdir, readFile } from "node:fs/promises";
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

test("preload 是从契约生成的，而不是另抄一份", async () => {
	/*
	 * 这两条测试原本比对的是「契约里的每个 channel 字符串是否出现在 preload 的源码里」，
	 * 反过来也比一次。那在 preload 手写 157 个 `ipcRenderer.invoke("…")` 的时候是对的检查。
	 *
	 * 现在 preload 遍历 `METHODS` 生成它们，源码里一个 channel 字面量都没有——旧的比对方式
	 * 会永远失败，而它要防的问题（两处名字不一致）已经不可能发生了：名字只有一处。
	 *
	 * 于是改为检查那个前提本身还成立：preload 确实在读契约，并且没有偷偷写死 channel。
	 */
	const preload = await source("preload.ts");

	assert.match(preload, /from "@lyra\/contract"/, "preload 必须从契约读方法表");
	assert.match(preload, /Object\.entries\(METHODS\)/, "并且是遍历它来生成 invoke");

	/*
	 * 手写的 channel 字面量。
	 *
	 * 事件订阅仍然是手写的（`ipcRenderer.on("terminal:data", …)`），那是有意的——推送不在
	 * `METHODS` 里。所以这里只挑 `invoke` 的调用来看。
	 */
	const hardcoded = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1] as string);
	assert.deepEqual(
		hardcoded,
		[],
		"preload 里出现了写死的 invoke channel——那正是这次改动要消灭的第二处拼写",
	);
});


/**
 * 主进程注册的 channel。
 *
 * 大多是 `ipcMain.handle("git:stat", …)` 这样的字面量；`git.ts` 里有一处是从一张
 * `[["git:stage", stagePaths], …] as const` 的表上循环注册的，所以名字仍是字面量，只是不在
 * `handle(` 后面。两种都收，另外把「channel 是个变量」的调用点数出来——那种形状这套读源码的
 * 检查看不见，允许存在但不允许悄悄变多。
 */
async function registeredChannels(): Promise<{ channels: Set<string>; dynamic: number }> {
	const files = (await readdir(DESKTOP, { recursive: true, withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
		.map((entry) => join(entry.parentPath, entry.name));

	const channels = new Set<string>();
	let dynamic = 0;
	for (const file of files) {
		const text = await readFile(file, "utf8");
		for (const match of text.matchAll(/ipcMain\.handle(?:Once)?\(\s*"([^"]+)"/g)) channels.add(match[1] as string);
		// `ipcMain.handle(channel, …)` — 名字不在这一行，它在同一文件的表里。
		dynamic += [...text.matchAll(/ipcMain\.handle(?:Once)?\(\s*[A-Za-z_$][\w$]*/g)].length;
		for (const match of text.matchAll(/\[\s*"([a-z]+:[a-zA-Z-]+)"\s*,\s*\w+\s*\]/g)) channels.add(match[1] as string);
	}
	return { channels, dynamic };
}

test("主进程注册的 channel 和契约一一对应", async () => {
	/*
	 * 契约原本只和 `preload.ts`、`sync-rpc.ts` 比对过，也就是说三处名字里有一处从来没人看：
	 * 真正接电话的那一处。两个方向都会坏，坏法不一样——
	 *
	 *   契约有、主进程没有 → preload 照样生成一个方法，点下去抛
	 *     `No handler registered for 'x:y'`，而且是点到那个按钮的那一刻才抛
	 *   主进程有、契约没有 → 这个 handler 谁也叫不到，是死代码；或者它绕过了契约，
	 *     那手机能不能调它就没有任何地方写着
	 *
	 * 现在两个方向都比。
	 */
	const { channels, dynamic } = await registeredChannels();
	const declared = new Set(CHANNELS);

	const unimplemented = CHANNELS.filter((channel) => !channels.has(channel));
	assert.deepEqual(unimplemented, [], "契约声明了但主进程没注册——渲染进程调它会得到「没有 handler」");

	const undeclared = [...channels].filter((channel) => !declared.has(channel));
	assert.deepEqual(undeclared, [], "主进程注册了契约里没有的 channel——它要么是死代码，要么绕过了契约");

	assert.equal(channels.size, CHANNELS.length, "数量也要对上");
	assert.equal(dynamic, 1, "`ipcMain.handle(变量)` 的调用点只有 git.ts 那一处表驱动；多出来的这套检查看不见");
});

test("契约说手机能用的，sync-rpc 里都有实现", async () => {
	const rpc = await source("sync-rpc.ts");
	const unimplemented = REMOTE_METHODS.filter((path) => !rpc.includes(`"${path}"`));
	assert.deepEqual(unimplemented, [], "契约标了 remote 但 sync-rpc 没实现——手机调它会得到「方法不存在」");
});

test("sync-rpc 实现的，契约里都标了 remote", async () => {
	const rpc = await source("sync-rpc.ts");
	/*
	 * `[a-zA-Z]` on both halves, not `[a-z]` on the first.
	 *
	 * The original pattern required a lowercase-only group name and so never saw `subAgents.list` —
	 * a method the phone could call that the contract had no entry for. The test passed for months
	 * by not looking at it. Any regex that decides *what to check* is itself worth checking.
	 */
	const implemented = [...rpc.matchAll(/^\t"([a-zA-Z]+\.[a-zA-Z]+)":/gm)].map((m) => m[1] as string);
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
	 * `terminal:list-all` 是唯一一个用短横线的，其余都是 camelCase。
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

test("数量对得上，且手机能力是逐项审过的清单", () => {
	assert.equal(CHANNELS.length, everyMethod().length, "每个方法一个 channel");
	assert.ok(CHANNELS.length > 100, "这个应用的 IPC 面本来就大，少于一百说明清单丢了东西");
	/*
	 * A percentage stopped measuring the thing it claimed to protect once the phone gained complete
	 * conversation, task, side-chat and read-only file surfaces: one safe domain can legitimately
	 * add several methods, while one dangerous method can stay below any ratio. An exact list makes
	 * every new capability a reviewed test change and still fails closed when somebody flips one
	 * remote flag casually.
	 */
	assert.deepEqual(
		REMOTE_METHODS,
		[
			"settings.get",
			"settings.save",
			"workspace.info",
			"sessions.list",
			"sessions.create",
			"sessions.open",
			"sessions.transcript",
			"sessions.trajectory",
			// The delta endpoint reads the same paired session scope as the full trajectory.
			"sessions.trajectoryChanges",
			"sessions.fork",
			"sessions.remove",
			"sessions.setArchived",
			"sessions.capabilities",
			"sessions.rename",
			"sessions.compact",
			"sessions.contextBreakdown",
			"agent.prompt",
			"agent.editMessage",
			"agent.abort",
			"agent.approve",
			"agent.setModel",
			"agent.setThinking",
			"subAgents.list",
			"subAgents.detail",
			"subAgents.steer",
			"subAgents.abort",
			"subAgents.dismiss",
			"subAgents.dismissFinished",
			"sideChat.setModel",
			"sideChat.state",
			"sideChat.ask",
			"sideChat.editAndResend",
			"sideChat.abort",
			"sideChat.reset",
			"tasks.list",
			"tasks.cancel",
			"tasks.dismiss",
			"tasks.resume",
			"files.list",
			"files.read",
			"commands.list",
			"rules.preview",
			"rules.keep",
			"rules.decline",
			"git.generalScratch",
			"git.scratchRoots",
		],
		"手机白名单发生了变化；请逐项确认能力和安全边界后更新这里",
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
