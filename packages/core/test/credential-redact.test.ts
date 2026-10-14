/**
 * Masking known values: every form a value takes on its way through a shell, and only those.
 *
 * The forms follow GitHub Actions' masker. What this file holds that one to is the cases it misses
 * or gets wrong elsewhere: a value in the middle of base64 (Actions encodes the shifted value whole),
 * a stream that splits a value across chunks, and a screenshot whose base64 must never be touched —
 * OpenHands masked inside one and every later request in that conversation was a 400.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Redactor, StreamRedactor, variants } from "../src/credentials/redact.ts";

const SECRET = "hunter2-Ze9&q!";
const mask = new Redactor([{ label: "kzhy-root", value: SECRET }]);

test("原文、JSON 转义、URL 编码都换成标记", () => {
	assert.equal(mask.text(`pw=${SECRET};`), "pw=[credential:kzhy-root];");
	assert.equal(mask.text(JSON.stringify({ pw: `${SECRET}"` })).includes(SECRET), false);
	assert.equal(mask.text(`https://x/?p=${encodeURIComponent(SECRET)}`), "https://x/?p=[credential:kzhy-root]");
});

test("base64 在三种字节对齐下、夹在别的数据中间也认得出来", () => {
	for (const prefix of ["", "u", "us", "user:", "root:x"]) {
		const encoded = Buffer.from(`${prefix}${SECRET}and-more-after`).toString("base64");
		const masked = mask.text(encoded);
		assert.notEqual(masked, encoded, `prefix "${prefix}": the value inside the base64 was found`);
		assert.match(masked, /\[credential:kzhy-root\]/);
	}
});

test("PowerShell 按 & 切开打印的两半各自被换掉", () => {
	const halves = variants(SECRET);
	assert.ok(halves.includes("hunter2-Ze9&"), "the part before the last &");
	assert.ok(halves.includes("q!") === false, "a half shorter than six characters is not registered");
});

test("短值只换原文，不派生变体", () => {
	const short = new Redactor([{ label: "pin", value: "4821" }]);
	assert.equal(short.text("pin 4821 ok"), "pin [credential:pin] ok");
	assert.deepEqual(variants("4821"), ["4821"]);
});

test("长的先换：一个值包含另一个值时整段换掉", () => {
	const both = new Redactor([
		{ label: "short", value: "abcdef12" },
		{ label: "long", value: "abcdef12345678" },
	]);
	assert.equal(both.text("x abcdef12345678 y abcdef12 z"), "x [credential:long] y [credential:short] z");
});

test("工具结果：文本换掉，图片和 data URL 原样不动", () => {
	const picture = Buffer.from(`noise${SECRET}noise`).toString("base64").repeat(200);
	const result = mask.result({
		content: [
			{ type: "text", text: `printed ${SECRET}` },
			{ type: "image", data: picture, mimeType: "image/png" },
		],
		details: { url: `https://x/?p=${SECRET}`, shot: `data:image/png;base64,${picture}`, blob: picture, when: new Date(0), nested: [{ line: SECRET }] },
	});
	assert.equal((result.content[0] as { text: string }).text, "printed [credential:kzhy-root]");
	assert.equal((result.content[1] as { data: string }).data, picture, "an image is never rewritten");
	const details = result.details as Record<string, unknown>;
	assert.equal(details.url, "https://x/?p=[credential:kzhy-root]");
	assert.equal(details.shot, `data:image/png;base64,${picture}`);
	assert.equal(details.blob, picture, "a long base64 string is left alone");
	assert.ok(details.when instanceof Date, "a Date stays a Date");
	assert.deepEqual(details.nested, [{ line: "[credential:kzhy-root]" }]);
});

test("共享引用不是环；真的环会抛出，由出口层拦下", () => {
	const shared = { a: SECRET };
	const result = mask.result({ content: [], details: { one: shared, two: shared } });
	assert.deepEqual(result.details, { one: { a: "[credential:kzhy-root]" }, two: { a: "[credential:kzhy-root]" } });
	const cycle: Record<string, unknown> = {};
	cycle.self = cycle;
	assert.throws(() => mask.result({ content: [], details: cycle }));
});

test("没有值的会话一字不改、原样返回", () => {
	const empty = new Redactor([]);
	const result = { content: [{ type: "text" as const, text: SECRET }] };
	assert.equal(empty.result(result), result);
	assert.equal(empty.empty, true);
});

test("流：值被切在两块之间也能接住", () => {
	const stream = new StreamRedactor(() => mask);
	let out = "";
	for (const chunk of ["log: hunt", "er2-Ze", "9&q! done\n"]) out += stream.push(chunk);
	out += stream.flush();
	assert.equal(out, "log: [credential:kzhy-root] done\n");
});

test("流：末尾不可能是值的开头时一个字也不扣——长期运行的命令不会少最后一行", () => {
	const stream = new StreamRedactor(() => mask);
	assert.equal(stream.push("Server ready on port 3000\n"), "Server ready on port 3000\n");
	// Only what could still grow into the value is held back.
	assert.equal(stream.push("then hunt"), "then ");
	assert.equal(stream.flush(), "hunt");
});
