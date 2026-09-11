/**
 * 一份带附件的草稿，变成发出去的那一条。
 *
 * 三件事在这里落地，而它们都是客户截图里那条消息暴露出来的：
 *
 *   - 附件整体走在正文前面，按人放进去的先后。从前「图片一律最前、文档一律最后」，后来改成
 *     靠正文里的 `【文件名】` 记住位置——记号如今不写了，次序仍然得在。
 *   - 气泡里那一份不带记号，也不带附件正文。一份上千行的 md 铺进自己发出的消息里，和气泡里
 *     多出一遍文件名，是同一个毛病的两种长相。
 *   - 只附了文件、一个字没打时，给人看的那份是空的——气泡因此整个不渲染，而不是渲染出一个
 *     装着四个文件名的壳。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOutgoing } from "../src/features/composer/outgoing.ts";
import { placeholderFor } from "../src/lib/attachment-placeholders.ts";

const png = { name: "shot.png", mimeType: "image/png", kind: "image", data: "AAAA", isText: false };
const doc = { name: "notes.md", mimeType: "text/markdown", kind: "text", text: "hello", isText: true };
const mov = { name: "clip.mov", mimeType: "video/quicktime", kind: "video", isText: false };

const draft = (text: string, attachments: typeof png[] | unknown[] = []) => ({
	text,
	attachments: attachments as never,
	sessionRefs: [],
});

test("附件走在正文前面，按放进去的先后", async () => {
	const outgoing = await buildOutgoing(draft("这几个文件看一下", [png, doc, mov]), "/tmp");
	assert.ok(outgoing);
	assert.deepEqual(
		outgoing.content.map((block) => (block.type === "image" ? "<image>" : block.text.slice(0, 34))),
		[
			// 图片自己装不下字，所以名字和序号写在紧挨着它的前一块里。
			"\n\n### Attachment 1 of 3, image: sh",
			"<image>",
			"\n\n### Attachment 2 of 3, text: not",
			"\n\n[Attachment 3 of 3, video: clip.",
			"这几个文件看一下",
		],
		"材料在前问题在后，而且 png/md/mov 的先后就是人放进去的先后",
	);
});

test("每份附件都带着它的位置，人才能说「第二张」", async () => {
	/*
	 * 人指认附件用的是序数加门类——「第二张截图」「excel 文件 1」——几乎从不是文件名。
	 *
	 * 从前图片是**赤裸的图片块**送过去的：三张截图在模型眼里是三团无法区分的像素，既不知道叫什么，
	 * 更不知道谁是第二张。于是「第二张截图里的报错」只能靠猜，而猜错的时候没有任何迹象。
	 */
	const shotA = { ...png, name: "screen-a.png" };
	const shotB = { ...png, name: "screen-b.png" };
	const shotC = { ...png, name: "screen-c.png" };
	const sheet = { name: "报表.xlsx", mimeType: "application/vnd.ms-excel", kind: "excel", text: "## 库存\n苹果,12", isText: true };

	const outgoing = await buildOutgoing(draft("第二张截图里的报错，对照 excel 文件 1 看一下", [shotA, sheet, shotB, shotC]), "/tmp");
	assert.ok(outgoing);
	const labels = outgoing.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.filter((text) => /Attachment \d/.test(text));

	assert.equal(labels.length, 4, "四份附件，四个标题");
	assert.match(labels[0]!, /Attachment 1 of 4, image 1 of 3: screen-a\.png/, "全局序号和同类序号都要有");
	assert.match(labels[1]!, /Attachment 2 of 4, excel: 报表\.xlsx/, "只有一份的门类不写「1 of 1」，那是噪音");
	assert.match(labels[2]!, /Attachment 3 of 4, image 2 of 3: screen-b\.png/, "「第二张图」得能直接查到");
	assert.match(labels[3]!, /Attachment 4 of 4, image 3 of 3: screen-c\.png/);
});

test("只有一份附件时不写编号——「第 1 份，共 1 份」是废话", async () => {
	const outgoing = await buildOutgoing(draft("看看", [doc]), "/tmp");
	assert.ok(outgoing);
	const body = outgoing.content.find((b) => b.type === "text" && b.text.includes("hello"));
	assert.ok(body && body.type === "text");
	assert.match(body.text, /### Attached file: notes\.md/, "退回原来那个朴素的写法");
	assert.doesNotMatch(body.text, /Attachment 1 of 1/);
});

test("气泡里那份不含附件正文", async () => {
	const outgoing = await buildOutgoing(draft("帮我看看", [doc]), "/tmp");
	assert.ok(outgoing);
	assert.equal(outgoing.displayText, "帮我看看");
	assert.ok(
		outgoing.content.some((block) => block.type === "text" && block.text.includes("hello")),
		"正文本身仍然要送到模型那儿去，只是不进气泡",
	);
});

test("只附了文件、一个字没打，给人看的那份是空的", async () => {
	const outgoing = await buildOutgoing(draft("", [png, mov]), "/tmp");
	assert.ok(outgoing);
	assert.equal(outgoing.displayText, "", "气泡靠这个决定要不要渲染——空壳气泡就是这么来的");
	assert.deepEqual(outgoing.attachments?.map((f) => f.name), ["shot.png", "clip.mov"], "附件本身一个都不能少");
});

test("升级前存下的草稿：记号还认，但不留给人看", async () => {
	const text = `看这张 ${placeholderFor("shot.png")} 说说看`;
	const outgoing = await buildOutgoing(draft(text, [png]), "/tmp");
	assert.ok(outgoing);
	assert.deepEqual(
		outgoing.content.map((block) => (block.type === "image" ? "<image>" : block.text)),
		["看这张 ", "\n\n### Attached file: shot.png\n\n", "<image>", " 说说看"],
		"记号还在的那些，位置照旧认——图片前面多了一行说它是谁",
	);
	assert.equal(outgoing.displayText, "看这张 说说看", "但气泡里不留文件名");
});
