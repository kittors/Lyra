/**
 * What an attached file is, and whether its bytes may enter a prompt.
 *
 * The failure this exists for: attaching a file meant `file.text()` on anything that was not an
 * image, so a `.doc` — a compound binary document — was decoded as UTF-8 and several thousand
 * replacement characters were pasted into the message and sent. The person saw their contract as
 * noise, and so did the model.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileKind, isReadableAsText, looksBinary, KIND_LABEL } from "../src/features/composer/attachments/file-kind.ts";

test("the formats people actually attach are recognised", () => {
	const expected: [string, string][] = [
		["合同.doc", "word"],
		["合同.docx", "word"],
		["report.pdf", "pdf"],
		["数据.xlsx", "excel"],
		["数据.xls", "excel"],
		["slides.pptx", "powerpoint"],
		["slides.key", "powerpoint"],
		["demo.mp4", "video"],
		["clip.mov", "video"],
		["voice.m4a", "audio"],
		["photo.HEIC", "image"],
		["bundle.zip", "archive"],
		["app.dmg", "archive"],
		["font.woff2", "font"],
		["a.out.exe", "binary"],
		["notes.md", "text"],
		["main.ts", "text"],
	];
	for (const [name, kind] of expected) {
		assert.equal(fileKind(name), kind, `${name} 应该识别为 ${kind}`);
	}
});

test("nothing but text may have its contents pasted into a prompt", () => {
	for (const kind of ["word", "pdf", "excel", "powerpoint", "video", "audio", "archive", "binary", "font", "image"] as const) {
		assert.equal(isReadableAsText(kind), false, `${KIND_LABEL[kind]} 的字节不该进 prompt`);
	}
	assert.equal(isReadableAsText("text"), true);
});

test("the MIME type answers when the name does not", () => {
	assert.equal(fileKind("noextension", "application/pdf"), "pdf");
	assert.equal(fileKind("noextension", "application/msword"), "word");
	assert.equal(fileKind("noextension", "video/quicktime"), "video");
	assert.equal(
		fileKind("noextension", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
		"powerpoint",
	);
});

/*
 * A file with no extension and no type is usually text — `Dockerfile`, `LICENSE`, a script somebody
 * forgot to name — so it is read, and then checked. The bytes have the last word.
 */
test("an unknown file is treated as text, and its bytes still get checked", () => {
	assert.equal(fileKind("Dockerfile"), "text");
	assert.equal(fileKind("LICENSE"), "text");
});

test("binary bytes are caught even when the name says otherwise", () => {
	// A NUL is the giveaway; no text encoding produces one in ordinary content.
	assert.equal(looksBinary(new Uint8Array([0x68, 0x69, 0x00, 0x21])), true);
	// A compound document's header, which is what a .doc actually starts with.
	assert.equal(looksBinary(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00])), true);
	// Dense control bytes, without a NUL.
	assert.equal(looksBinary(new Uint8Array(Array.from({ length: 100 }, (_, i) => (i % 3 ? 0x41 : 0x01)))), true);
});

test("ordinary text is not mistaken for binary", () => {
	const enc = new TextEncoder();
	assert.equal(looksBinary(enc.encode("hello\nworld\t— 中文也算文本\r\n")), false);
	assert.equal(looksBinary(enc.encode('{"a": 1}')), false);
	assert.equal(looksBinary(new Uint8Array()), false, "空文件不是二进制");
});

test("every kind has something to call it", () => {
	for (const kind of Object.keys(KIND_LABEL)) {
		assert.ok(KIND_LABEL[kind as keyof typeof KIND_LABEL].length > 0);
	}
});

test("csv 和 tsv 画成表格，但内容照样进得了 prompt", () => {
	/*
	 * 门类扛了两个决定，于是图标对了、读取坏了。
	 *
	 * `csv` 被归进 `excel` 是为了画表格图标——一列数字顶着文档图标确实不像话。但同一个门类还被
	 * `isReadableAsText` 拿去决定「内容能不能进 prompt」，结果一个**纯文本文件**被当成二进制拒掉：
	 * 附一个 csv 上去，模型只收到一个文件名。
	 */
	for (const name of ["data.csv", "汇总.tsv", "DATA.CSV"]) {
		assert.equal(fileKind(name), "excel", `${name} 的图标该是表格`);
		assert.ok(isReadableAsText(fileKind(name), name), `${name} 是纯文本，内容该进 prompt`);
	}
});

test("真正的二进制表格仍然不当文本读", () => {
	// 上一条放行的是扩展名，不是门类——别把 xlsx 也一起放进来。
	for (const name of ["报表.xlsx", "旧表.xls", "a.xlsb"]) {
		assert.equal(isReadableAsText(fileKind(name), name), false, name);
	}
});

test("不给名字时退回按门类判断，不会误放行", () => {
	// 旧调用点只传门类。那时候拿不到扩展名，保守一点：只有 text 放行。
	assert.equal(isReadableAsText("excel"), false);
	assert.equal(isReadableAsText("text"), true);
});
