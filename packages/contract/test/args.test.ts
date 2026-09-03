/**
 * The checks that stand between a WebSocket frame and the session store.
 *
 * These are the only inputs in the application that are not written by our own renderer, so they
 * are the only place where "what if it is a number" is a real question rather than a compile error.
 *
 * The tests are mostly about *refusing* rather than accepting: the old helper accepted everything
 * and turned it into `""`, which is how a malformed request became a lookup for a session named
 * empty-string and failed somewhere unrelated.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { all, bool, content, index, oneOf, optionalStr, path, record, str, text } from "../src/args.ts";

test("str: 空、超长、非字符串都被拒", () => {
	assert.equal(str("abc", "id").ok, true);
	// 这几个是旧的 s() 会悄悄变成 "" 的东西。
	for (const bad of [undefined, null, 42, {}, [], true]) {
		const r = str(bad, "id");
		assert.equal(r.ok, false, `${JSON.stringify(bad)} 不该通过`);
		if (!r.ok) assert.match(r.detail, /必须是字符串/);
	}
	assert.equal(str("", "id").ok, false, "空串不是一个 id");
	assert.equal(str("x".repeat(201), "id").ok, false, "超长要拒");
});

test("str: 拒绝的说明里不含被拒的值", () => {
	const r = str("超级机密的令牌值", "token");
	// 通过是因为它是合法字符串；这里要验的是失败路径不会把值写进日志。
	assert.equal(r.ok, true);
	const bad = str(12345, "token");
	if (!bad.ok) assert.doesNotMatch(bad.detail, /12345/, "说明里不该出现原始值");
});

test("optionalStr: 缺省允许，给了就要合法", () => {
	assert.deepEqual(optionalStr(undefined, "x"), { ok: true, value: undefined });
	assert.deepEqual(optionalStr(null, "x"), { ok: true, value: undefined });
	assert.equal(optionalStr("v", "x").ok, true);
	assert.equal(optionalStr(7, "x").ok, false, "给了就必须是字符串");
});

test("path: 只接受绝对路径", () => {
	for (const good of ["/Users/a/b", "C:\\Users\\a", "\\\\server\\share"]) {
		assert.equal(path(good, "cwd").ok, true, `${good} 应该通过`);
	}
	for (const bad of ["relative/path", "./x", "../escape", ""]) {
		assert.equal(path(bad, "cwd").ok, false, `${bad} 不该通过`);
	}
});

test("text: 允许空串，但不允许非字符串或超大", () => {
	assert.equal(text("", "prompt").ok, true, "空提示是合法的，只是没内容");
	assert.equal(text("x".repeat(2_000_001), "prompt").ok, false);
	assert.equal(text(null, "prompt").ok, false);
});

test("oneOf: 集合之外一律拒，且说明列出可选值", () => {
	const r = oneOf("dark", "theme", ["light", "dark", "system"] as const);
	assert.deepEqual(r, { ok: true, value: "dark" });

	const bad = oneOf("neon", "theme", ["light", "dark"] as const);
	assert.equal(bad.ok, false);
	if (!bad.ok) assert.match(bad.detail, /light \/ dark/);
});

test("bool: 不接受 \"false\" 与 0", () => {
	assert.equal(bool(true, "archived").ok, true);
	assert.equal(bool(false, "archived").ok, true);
	// 这两个是最容易被强制转换掉的：`"false"` 是真值，`0` 是假值。
	assert.equal(bool("false", "archived").ok, false);
	assert.equal(bool(0, "archived").ok, false);
});

test("index: 非负整数", () => {
	assert.equal(index(0, "i").ok, true);
	for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3"]) {
		assert.equal(index(bad, "i").ok, false, `${bad} 不该通过`);
	}
});

test("record: 数组与 null 都不是对象", () => {
	assert.equal(record({ a: 1 }, "options").ok, true);
	assert.equal(record([], "options").ok, false);
	assert.equal(record(null, "options").ok, false);
});

test("content: 字符串或分段数组，分段要有合法的 type", () => {
	assert.equal(content("你好", "content").ok, true);
	assert.equal(content([{ type: "text", text: "x" }], "content").ok, true);
	assert.equal(content([{ type: "image", data: "..." }], "content").ok, true);

	assert.equal(content([{ type: "script" }], "content").ok, false, "未知的分段类型要拒");
	assert.equal(content([null], "content").ok, false);
	assert.equal(content(Array.from({ length: 65 }, () => ({ type: "text" })), "content").ok, false, "分段过多要拒");
	assert.equal(content(42, "content").ok, false);
});

test("all: 返回第一个失败，全过时按顺序给出值", () => {
	const good = all(str("a", "x"), index(1, "y"), bool(true, "z"));
	assert.deepEqual(good, { ok: true, value: ["a", 1, true] });

	const bad = all(str("a", "x"), index(-1, "y"), bool("no", "z"));
	assert.equal(bad.ok, false);
	// 第一个失败的是 y，不是 z——顺序有意义，报错要指向最先出错的那个。
	if (!bad.ok) assert.match(bad.detail, /y/);
});
