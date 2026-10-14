/**
 * The credential channels' gates: what a renderer sends is rebuilt field by field before the broker
 * sees it, and what goes back carries no value. A field these drop is a field the vault never gets;
 * one they let through unchecked is a way to put anything into it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { addInputOf, patchOf, resultOf, submissionOf } from "../electron/credential-input.ts";

test("卡片提交只收认得的字段，值必须是字符串", () => {
	assert.deepEqual(submissionOf({ values: { password: "p4ss", token: 42, extra: "x", __proto__: { username: "evil" } }, remember: "yes", useSaved: true, more: 1 }), {
		values: { password: "p4ss" },
		remember: false,
		useSaved: true,
	});
	assert.deepEqual(submissionOf(null), { values: {}, remember: false, useSaved: false });
});

test("添加：类型不认得就留空让 broker 拒绝；空地址等于不限", () => {
	const input = addInputOf({ name: " nas ", kind: "certificate", title: "NAS", target: "  ", approval: "sometimes", values: { password: "x" } });
	assert.equal(input.name, "nas");
	assert.equal(input.kind, "", "an unknown kind is not guessed into a known one");
	assert.equal("target" in input, false);
	assert.equal("approval" in input, false);
	assert.deepEqual(addInputOf({ name: "gh", kind: "token", title: "GitHub", target: "https://github.com", approval: "never", values: { token: "t" } }), {
		name: "gh",
		kind: "token",
		title: "GitHub",
		target: "https://github.com",
		approval: "never",
		values: { token: "t" },
	});
});

test("修改：清空地址是 null（改成不限），没给就是不动；值只在给了对象时才换", () => {
	assert.deepEqual(patchOf({ target: "" }), { target: null });
	assert.deepEqual(patchOf({ target: null }), { target: null });
	assert.deepEqual(patchOf({ title: "新名字" }), { title: "新名字" });
	assert.deepEqual(patchOf({ values: "nope" }), {});
	assert.deepEqual(patchOf({ values: { password: "new", private_key: 7 } }), { values: { password: "new" } });
});

test("回给页面的结果里没有值", () => {
	const result = resultOf({ ok: true, record: { name: "nas", kind: "login", title: "NAS", username: "admin", createdAt: 1, approval: "per-conversation", values: { password: "nas-pass-123" } } });
	assert.equal(JSON.stringify(result).includes("nas-pass-123"), false);
	assert.deepEqual(result, { ok: true, meta: { name: "nas", kind: "login", title: "NAS", username: "admin", createdAt: 1, approval: "per-conversation", saved: true } });
	assert.deepEqual(resultOf({ ok: false, problem: "exists" }), { ok: false, problem: "exists" });
});
