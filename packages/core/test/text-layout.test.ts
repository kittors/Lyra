/**
 * `decodeText` / `encodeText`, the pair read, edit and write share.
 *
 * The property everything rests on is the round trip: a file decoded and encoded again, untouched,
 * comes back byte for byte. Anything less and an edit of one line rewrites the rest of the file.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeInput, decodeText, encodeText } from "../src/tools/text-layout.ts";

const BOM = "\uFEFF";

test("解码再编码，字节原样还原", () => {
	const samples = [
		"",
		BOM,
		"one line, no break",
		"a\nb\n",
		"a\r\nb\r\n",
		`${BOM}a\r\nb`,
		"a\r\nb\nc\r\n",
		"progress 10%\rprogress 20%\r\ndone\r\n",
		"lone \r in an LF file\n",
		`${BOM}${BOM}double`,
	];
	for (const raw of samples) {
		const { text, layout } = decodeText(raw);
		assert.equal(encodeText(text, layout), raw, JSON.stringify(raw));
	}
});

test("整篇 CRLF 才规范化；混用的、带孤立 \\r 的原样不动", () => {
	assert.deepEqual(decodeText("a\r\nb\r\n"), { text: "a\nb\n", layout: { bom: false, eol: "\r\n" } });
	assert.deepEqual(decodeText("a\nb"), { text: "a\nb", layout: { bom: false, eol: "\n" } });
	assert.deepEqual(decodeText("a\r\nb\nc"), { text: "a\r\nb\nc", layout: { bom: false, eol: null } });
	assert.deepEqual(decodeText("a\rb\r\nc"), { text: "a\rb\r\nc", layout: { bom: false, eol: null } });
	assert.deepEqual(decodeText("a\rb\nc"), { text: "a\rb\nc", layout: { bom: false, eol: "\n" } });
});

test("BOM 单独记下，不算第一行的字", () => {
	assert.deepEqual(decodeText(`${BOM}head\r\n`), { text: "head\n", layout: { bom: true, eol: "\r\n" } });
	// Only the first one is a BOM; a second is a character of the text.
	assert.equal(decodeText(`${BOM}${BOM}x`).text, `${BOM}x`);
});

test("编码时残留的 CRLF 不会变成 \\r\\r\\n", () => {
	assert.equal(encodeText("a\r\nb\nc", { bom: false, eol: "\r\n" }), "a\r\nb\r\nc");
});

test("模型给的文本：跟随文件的形式，混用的文件原样比对", () => {
	assert.equal(decodeInput("a\r\nb", { bom: false, eol: "\r\n" }), "a\nb");
	assert.equal(decodeInput("a\r\nb", { bom: false, eol: "\n" }), "a\nb");
	assert.equal(decodeInput("a\r\nb", { bom: false, eol: null }), "a\r\nb");
	assert.equal(decodeInput(`${BOM}x`, { bom: true, eol: "\n" }), `${BOM}x`, "片段开头的 U+FEFF 是一个字符，不是 BOM");
});
