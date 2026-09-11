/**
 * 读得懂已经存在的 `【文件名】`，并且不让它出现在人眼前。
 *
 * 这些记号一度是写进草稿正文的，用来记住附件在句子里的位置。代价是每次拖文件都往输入框里塞一
 * 串方括号，发出去以后气泡里又是一遍文件名——而同一张图的缩略图就挂在气泡外面。记号因此不再产
 * 生了（见 `attachment-placeholders.ts`），但升级前存下的草稿和转录里的消息还带着它们：解析要
 * 继续对，给人看的那一份里要剥干净。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { placeAttachments, placeholderFor, isAttachmentBody, stripPlaceholders } from "../src/lib/attachment-placeholders.ts";

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

test("没有占位符的附件不会被丢掉", () => {
	// 如今这是常态：记号不再写进草稿，所有附件都从这条路走，由 `buildOutgoing` 排在正文前面。
	const { segments, unplaced } = placeAttachments("随便说点什么", [file("orphan.md")]);
	assert.deepEqual(segments, [{ kind: "text", text: "随便说点什么" }]);
	assert.deepEqual(unplaced.map((f) => f.name), ["orphan.md"]);
});

test("正文全是占位符时不会产生空的文本段", () => {
	const { segments } = placeAttachments(placeholderFor("only.png"), [file("only.png")]);
	assert.equal(segments.length, 1);
	assert.equal(segments[0].kind, "file");
});

test("给人看的那一份里，认得出的记号被剥掉", () => {
	// 气泡里只剩人打的字；文件本身画在气泡外面那一排上，一个文件只出现一次。
	assert.equal(
		stripPlaceholders(`看这张 ${placeholderFor("a.png")} 再看 ${placeholderFor("b.md")} 谢谢`, [file("a.png"), file("b.md")]),
		"看这张 再看 谢谢",
		"记号让位之后留下的空档要收干净，不能剩下一段莫名其妙的空白",
	);
});

test("只附了文件、一个字没打，剥完是空的", () => {
	// 正是客户截图里那条：气泡里装着四个文件名，而人什么都没说。空字符串让气泡整个不渲染。
	const files = [file("a.png"), file("b.mov"), file("c.pdf")];
	const text = files.map((f) => placeholderFor(f.name)).join("");
	assert.equal(stripPlaceholders(text, files), "");
});

test("认不出来的记号不动它", () => {
	assert.equal(stripPlaceholders("这个【重要】要注意", [file("a.md")]), "这个【重要】要注意");
	assert.equal(stripPlaceholders("一句没有方括号的话", [file("a.md")]), "一句没有方括号的话");
});

test("认得出哪一段文本是附件正文，哪一段是人打的字", () => {
	// 编辑已发出的消息时靠它把正文原样搬过去——认错了就等于把文件弄丢了。
	assert.equal(isAttachmentBody("\n\n### Attached file: a.md\n```\nhi\n```\n\n"), true);
	assert.equal(isAttachmentBody("\n\n[Attached file: a.zip (application/zip) — contents not included]\n\n"), true);
	assert.equal(isAttachmentBody("帮我看看 【a.md】"), false);
	assert.equal(isAttachmentBody("### Attached file: 这是我自己写的标题"), false, "得是我们生成的那种，前面有两个换行");
});
