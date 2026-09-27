/**
 * 一份已经发出去的附件，按什么画、能不能在面板里预览。
 *
 * 用户报上来的那一条：消息带了一份 `调研-UI 参考知识库.md`，气泡上方画成了一张裂开的图（alt 是文件名），
 * 右键菜单里有「复制图片」，「预览」点了没反应。转录里那份记录其实是对的（`kind: "text"`），错在渲染端
 * 给每一份带路径的附件都算了一个图片地址——那一处在 `UserMessage` 里修掉了，挂载测试在
 * `test/ui/sent-attachments.test.ts`。
 *
 * 这里管的是它的另一半：转录里要是真躺着一份被记成图片的文档（旧版本、同步、将来哪个入口写错），渲染端
 * 也得认得出来。`sentKind` 就是那道复核。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { sentKind } from "../src/features/composer/attachments/file-kind.ts";
import { previewableInPanel } from "../src/features/composer/attachments/display.ts";

test("记对了的门类原样用：用户那份 md 就是文本", () => {
	assert.equal(sentKind({ name: "调研-UI 参考知识库.md", kind: "text", mimeType: "text/markdown" }), "text");
	assert.equal(sentKind({ name: "报价单.xlsx", kind: "excel" }), "excel");
	assert.equal(sentKind({ name: "image.png", kind: "image", mimeType: "image/png" }), "image");
});

test("被记成图片的文档，名字和类型说不是，就不是", () => {
	assert.equal(sentKind({ name: "调研-UI 参考知识库.md", kind: "image", mimeType: "text/markdown" }), "text");
	assert.equal(sentKind({ name: "调研-UI 参考知识库.md", kind: "image" }), "text");
	assert.equal(sentKind({ name: "合同.pdf", kind: "image", mimeType: "application/pdf" }), "pdf");
	assert.equal(sentKind({ name: "notes", kind: "image", mimeType: "text/plain" }), "text");
});

test("真的图片过得了复核：扩展名或类型总有一样说得出「图」", () => {
	// 剪贴板编的名字、区域截图那种翻译过的名字，靠的是 mimeType。
	assert.equal(sentKind({ name: "区域截图", kind: "image", mimeType: "image/png" }), "image");
	assert.equal(sentKind({ name: "区域截图 2026-09-26 20.00.00", kind: "image", mimeType: "image/png" }), "image");
	assert.equal(sentKind({ name: "shot.heic", kind: "image" }), "image");
	// 两样都没有：没有别的证据可听，只能信记下来的。
	assert.equal(sentKind({ name: "屏幕截图", kind: "image" }), "image");
});

test("没记门类、或者记了一个不认识的，按名字和类型现算", () => {
	assert.equal(sentKind({ name: "a.md" }), "text");
	assert.equal(sentKind({ name: "a.png" }), "image");
	assert.equal(sentKind({ name: "a.md", kind: "document" }), "text");
	// 原型链上的名字不算门类：拿它去查 KIND_LABEL 查出来的是一个函数。
	assert.equal(sentKind({ name: "a.md", kind: "toString" }), "text");
	assert.equal(sentKind({ name: "a.md", kind: null, mimeType: null }), "text");
});

test("面板打开之后看得到的是它本身，才给「预览」", () => {
	for (const [kind, name] of [
		["text", "调研-UI 参考知识库.md"],
		["text", "main.ts"],
		["excel", "门店.csv"],
		["excel", "报价单.xlsx"],
		["pdf", "合同.pdf"],
		["word", "方案.docx"],
		["binary", "cache.sqlite"],
	] as const) {
		assert.equal(previewableInPanel(kind, name), true, name);
	}
	for (const [kind, name] of [
		["archive", "源码.zip"],
		["word", "老合同.doc"],
		["powerpoint", "汇报.pptx"],
		["design", "首页.sketch"],
		["binary", "tool.exe"],
		["excel", "表.numbers"],
	] as const) {
		assert.equal(previewableInPanel(kind, name), false, name);
	}
});
