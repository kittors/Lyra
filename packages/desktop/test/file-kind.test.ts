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
