/**
 * 每个手机能调的方法，都要有一份参数规格。
 *
 * `sync-rpc.ts` 里有两张表：`RPC` 说「这个方法做什么」，`ARGS` 说「它的参数得长什么样」。两张
 * 表分开是有意的——一个是实现，一个是边界——但分开的代价就是它们会走散，而走散的方向只有一个
 * 是危险的：`RPC` 里多出一个方法而 `ARGS` 里没有。
 *
 * 分发层对没有规格的方法是**拒绝**而不是放行，所以走散的后果是那个方法不能用，而不是它不设防。
 * 这条测试把「不能用」提前到提交之前。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(new URL("../electron/sync-rpc.ts", import.meta.url));

/** 从一张表字面量里取出它的键。读源码而不是导入，因为导入会把 electron 拖进来。 */
function keysOf(source: string, table: string): string[] {
	const start = source.indexOf(`const ${table}`);
	assert.notEqual(start, -1, `源码里找不到 ${table}`);
	const body = source.slice(start, source.indexOf("\n};", start));
	return [...body.matchAll(/^\t"([a-zA-Z]+\.[a-zA-Z]+)":/gm)].map((m) => m[1] as string).sort();
}

test("RPC 与 ARGS 两张表一一对应", async () => {
	const source = await readFile(SOURCE, "utf8");
	const rpc = keysOf(source, "RPC");
	const args = keysOf(source, "ARGS");

	assert.ok(rpc.length >= 15, `RPC 只有 ${rpc.length} 项，多半是正则没匹配上`);

	const unchecked = rpc.filter((m) => !args.includes(m));
	assert.deepEqual(
		unchecked,
		[],
		"这些方法有实现但没有参数规格——分发层会拒绝它们，等于手机上静默失效",
	);

	const orphaned = args.filter((m) => !rpc.includes(m));
	assert.deepEqual(orphaned, [], "这些方法有参数规格但没有实现——多半是改名之后忘了同步");
});

test("分发层对没有规格的方法拒绝，而不是放行", async () => {
	const source = await readFile(SOURCE, "utf8");
	// 这段逻辑是「fail closed」的全部依据，改动它要有意识。
	assert.match(
		source,
		/const check = ARGS\[method\];\s*\n\s*if \(!check\) return \{ ok: false, error: "invalid-args" \};/,
		"分发层必须在没有规格时拒绝——放行等于新方法默认不设防",
	);
});

test("旧的 s() 强制转换没有回潮", async () => {
	const source = await readFile(SOURCE, "utf8");
	/*
	 * `const s = (value) => typeof value === "string" ? value : ""` 是这次要替换掉的东西：它把
	 * 任何非字符串变成空串，于是一个畸形请求变成了「查找 id 为空的会话」，失败在别处。
	 *
	 * 它还留着（handler 里仍在用，作为类型收窄），但校验必须发生在它之前。这条断言守的是
	 * ARGS 表本身还在被调用。
	 */
	assert.match(source, /const problem = check\(args\);/, "校验必须真的被执行");
});

test("契约里的每个 channel 都真的被主进程注册着", async () => {
	/*
	 * 这条测试是一次真实故障之后加的，而它抓的东西比看起来窄——正因为那次故障恰好绕过了所有
	 * 别的检查。
	 *
	 * 把 preload 改成从契约生成时，提取旧 preload 的脚本按「属性名往下找最近的 invoke」配对。
	 * 而 `mediaUrl` 与 `prewarm` 不是 invoke（一个是纯字符串拼接，一个是 `ipcRenderer.send`），
	 * 于是它们抢走了下一行的 channel，`files.create` 与 `terminal.attach` 整个消失。
	 *
	 * 当时所有检查都过了：契约 157 个方法配 157 个 channel、逐个 channel 都在主进程注册着、
	 * 真窗口里 157 个方法名也都挂在 `window.lyra` 上——因为 `mediaUrl` 顶着 `files:create` 的
	 * 位置站在那儿。直到十条 e2e 红了，报 `window.lyra.files.create is not a function`。
	 *
	 * 能抓住它的检查是「每个 channel 都有人注册」加上「没有两个方法共用一个 channel」——前者
	 * 会发现 `files:create` 被一个不发 IPC 的属性占着，后者会发现总数对不上。
	 *
	 * 不检查方法名与 channel 的动作段是否逐字一致：`importInto ↔ files:import`、
	 * `fetchRegistry ↔ registry:fetch` 这类差异是既有命名，有七处，改它们要动三个文件加所有
	 * 调用点，而它们从来没出过问题。
	 */
	const { METHODS, CHANNELS } = await import("@lyra/contract");

	// 主进程注册的 channel，从源码读——handler 是分散注册的，导入它们会把 electron 拖进来。
	const { readdir, readFile } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const dir = fileURLToPath(new URL("../electron/ipc", import.meta.url));
	let sources = "";
	for (const name of await readdir(dir)) {
		if (name.endsWith(".ts")) sources += await readFile(join(dir, name), "utf8");
	}
	// 动态注册的那些（sessions、agent）在别处，一并读进来。
	const electron = fileURLToPath(new URL("../electron", import.meta.url));
	for (const name of await readdir(electron)) {
		if (name.endsWith(".ts")) sources += await readFile(join(electron, name), "utf8");
	}

	const unregistered = CHANNELS.filter((channel) => !sources.includes(`"${channel}"`));
	assert.deepEqual(
		unregistered,
		[],
		"契约里的 channel 没有对应的 handler——要么是拼错了，要么是某个不发 IPC 的属性占了它的位置",
	);

	// 一个 channel 只能属于一个方法。共用意味着有一个方法没有自己的通道。
	const owners = new Map<string, string>();
	const shared: string[] = [];
	for (const [group, methods] of Object.entries(METHODS)) {
		for (const [name, method] of Object.entries(methods)) {
			const previous = owners.get(method.channel);
			if (previous) shared.push(`${method.channel}: ${previous} 与 ${group}.${name}`);
			else owners.set(method.channel, `${group}.${name}`);
		}
	}
	assert.deepEqual(shared, [], "两个方法共用一个 channel");
});

test("契约里的每个方法，preload 生成它时都会撞上一个真 handler", async () => {
	/*
	 * 上一条测试抓不住那次故障，这一条能——差别值得写下来。
	 *
	 * 故障的形状是：`mediaUrl`（一个纯字符串拼接、根本不发 IPC 的属性）顶着 `files:create` 的
	 * channel 站在契约里，而真正的 `create` 消失了。上一条检查「每个 channel 都有人注册」——
	 * 通过，因为 `files:create` 的 handler 好好地在那儿；检查「没有两个方法共用 channel」——
	 * 也通过，因为占位的只有一个。
	 *
	 * 真正的矛盾在别处：`mediaUrl` 在 preload 里是手写的（它必须手写，它不是 IPC），于是生成器
	 * 又为它生成了一个走 `files:create` 的函数，然后被手写的那个覆盖掉。结果是这个 channel 在
	 * 渲染进程里没有任何入口，而契约声称它有。
	 *
	 * 所以判据是：**契约里的方法名，不能和 preload 手写的属性重名**。重名意味着契约把一个
	 * 非 IPC 的东西登记成了 IPC，而那个 channel 就此无人可达。
	 */
	const preload = await readFile(fileURLToPath(new URL("../electron/preload.ts", import.meta.url)), "utf8");
	const { METHODS } = await import("@lyra/contract");

	// preload 里手写的属性名，从 `extras` 那个对象里取。
	const extras = preload.slice(preload.indexOf("const extras"), preload.indexOf("contextBridge.exposeInMainWorld"));
	const handWritten = new Map<string, string[]>();
	let group = "";
	for (const line of extras.split("\n")) {
		const g = /^\t(\w+): \{/.exec(line);
		if (g) {
			group = g[1] as string;
			continue;
		}
		if (/^\t\},?$/.test(line)) {
			group = "";
			continue;
		}
		const m = /^\t\t(\w+):/.exec(line);
		if (m && group) handWritten.set(group, [...(handWritten.get(group) ?? []), m[1] as string]);
	}

	const clashes: string[] = [];
	for (const [g, methods] of Object.entries(METHODS)) {
		for (const name of Object.keys(methods)) {
			if (handWritten.get(g)?.includes(name)) clashes.push(`${g}.${name}`);
		}
	}

	assert.deepEqual(
		clashes,
		[],
		"契约登记的方法与 preload 手写的属性重名——手写的会覆盖生成的，那个 channel 就此在渲染进程里无人可达。" +
			"这正是 files.create 那次故障：mediaUrl 顶着 files:create 的位置，而 create 消失了",
	);
});
