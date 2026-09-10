/**
 * 附件在句子里的位置，和它的正文该出现在哪儿。
 *
 * 两件事一起测，因为它们是同一个决定的两半：占位符决定顺序，`displayText` 决定气泡里看到什么。
 * 客户报的是后者——引用一份上千行的 md，整份正文就铺在自己发出的那条消息里，想翻回上面很费劲。
 * 前者是同一条反馈里的另一半：图片一律排在最前、文档一律缀在最后，人放进去的先后被丢掉了。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { placeAttachments, placeholderFor, isAttachmentBody } from "../src/lib/attachment-placeholders.ts";

const file = (name: string) => ({ name });

test("占位符按出现的位置把正文切开", () => {
	const { segments, unplaced } = placeAttachments(`看这张 ${placeholderFor("a.png")} 再看 ${placeholderFor("b.md")} 谢谢`, [
		file("a.png"),
		file("b.md"),
	]);
	assert.deepEqual(
		segments.map((s) => (s.kind === "text" ? s.text : `<${s.file.name}>`)),
		["看这张 ", "<a.png>", " 再看 ", "<b.md>", " 谢谢"],
	);
	assert.deepEqual(unplaced, []);
});

test("同名的两份，按出现次序各认各的", () => {
	const first = file("shot.png");
	const second = file("shot.png");
	const { segments } = placeAttachments(`${placeholderFor("shot.png")}和${placeholderFor("shot.png")}`, [first, second]);
	const files = segments.filter((s) => s.kind === "file");
	assert.equal(files.length, 2);
	assert.equal((files[0] as { file: unknown }).file, first);
	assert.equal((files[1] as { file: unknown }).file, second);
});

test("认不出来的【】是普通标点，原样留着", () => {
	// 中文里方括号到处都是，一句「这个【重要】」不是在引用任何东西。
	const { segments, unplaced } = placeAttachments("这个【重要】要注意", [file("a.md")]);
	assert.deepEqual(segments, [{ kind: "text", text: "这个【重要】要注意" }]);
	assert.deepEqual(unplaced.map((f) => f.name), ["a.md"], "没被认走的附件仍然要发出去");
});

test("没有占位符的附件不会被丢掉，落在末尾", () => {
	// 人可以把那句话删掉，队列里退回来的草稿也没有光标可写——不能因此就不发。
	const { segments, unplaced } = placeAttachments("随便说点什么", [file("orphan.md")]);
	assert.deepEqual(segments, [{ kind: "text", text: "随便说点什么" }]);
	assert.deepEqual(unplaced.map((f) => f.name), ["orphan.md"]);
});

test("正文全是占位符时不会产生空的文本段", () => {
	const { segments } = placeAttachments(placeholderFor("only.png"), [file("only.png")]);
	assert.equal(segments.length, 1);
	assert.equal(segments[0].kind, "file");
});

test("认得出哪一段文本是附件正文，哪一段是人打的字", () => {
	// 编辑已发出的消息时靠它把正文原样搬过去——认错了就等于把文件弄丢了。
	assert.equal(isAttachmentBody("\n\n### Attached file: a.md\n```\nhi\n```\n\n"), true);
	assert.equal(isAttachmentBody("\n\n[Attached file: a.zip (application/zip) — contents not included]\n\n"), true);
	assert.equal(isAttachmentBody("帮我看看 【a.md】"), false);
	assert.equal(isAttachmentBody("### Attached file: 这是我自己写的标题"), false, "得是我们生成的那种，前面有两个换行");
});
