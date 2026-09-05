/**
 * 没有 `text` 作用域的规则时，文本增量零缓冲（05 §验收）。
 *
 * 流规则的代价是每个 delta 一次正则加一份累积缓冲。一个只盯工具参数的规则集，不该让每一段
 * 散文都在内存里累加——那是在为没人看的东西付钱。以前这条只有代码里一句「常见情况一个布尔」
 * 的注释，现在是一个能读的数字。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { StreamRuleMonitor } from "../src/rules/stream.ts";
import type { Rule } from "../src/rules/types.ts";

function rule(scopes: Rule["scopes"]): Rule {
	return {
		name: "r",
		path: "/tmp/r.md",
		content: "别。",
		conditions: [/NEEDLE/],
		scopes,
		interrupt: "always",
		repeat: "once",
		source: "workspace",
		bucket: "stream",
	};
}

const LONG_REPLY = "x".repeat(1024);

test("只有工具作用域时，一万段散文过去，缓冲仍是零", () => {
	const monitor = new StreamRuleMonitor([rule([{ kind: "tool" }])]);
	monitor.startTurn();
	for (let i = 0; i < 10_000; i++) monitor.feed({ source: "text", delta: LONG_REPLY, key: "text" });
	assert.equal(monitor.bufferedChars, 0, "nothing watches prose, so nothing keeps it");
});

test("对照：有 text 作用域时缓冲会涨，但封顶", () => {
	const monitor = new StreamRuleMonitor([rule([{ kind: "text" }])]);
	monitor.startTurn();
	for (let i = 0; i < 200; i++) monitor.feed({ source: "text", delta: LONG_REPLY, key: "text" });
	assert.ok(monitor.bufferedChars > 0, "prose is kept for the pattern to see");
	assert.ok(monitor.bufferedChars <= 64 * 1024, `and bounded: ${monitor.bufferedChars}`);
});

test("工具参数只在有人盯着时才缓冲，作用域各管各的", () => {
	const monitor = new StreamRuleMonitor([rule([{ kind: "text" }])]);
	monitor.startTurn();
	for (let i = 0; i < 100; i++) monitor.feed({ source: "tool", delta: LONG_REPLY, key: "tool:1", toolName: "bash" });
	assert.equal(monitor.bufferedChars, 0);
});
