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
