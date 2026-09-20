/**
 * 自己发出去的那条消息，气泡里画什么。
 *
 * 两件事在这里钉住：
 *
 * 一、**主会话和侧边聊天画的是同一件东西**。侧边聊天从前把所有文本块拼起来直接摊开，于是
 *    `### Attached file: image.png` 这种写给模型的记号原样出现在人眼前，而同一条消息在主会话
 *    里画的是一枚胶囊。现在两边都先看 `displayText`。
 *
 * 二、**markdown 走不走，看有没有附件标记**。没有标记就整段交给 markdown（`# 需求1` 是标题，
 *    不是一行井号）；有标记就保持行内，否则块级的 markdown 会把一句话切成三行。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { MessageRow } from "../../src/features/sidechat/MessageRow.tsx";
import { UserMessage } from "../../src/features/conversation/UserMessage.tsx";
import { mount } from "../helpers/mount.ts";

test("气泡把 markdown 画出来，而不是照抄井号和星号", async () => {
	const text = "# 需求1\n请检查**所有**已编辑文件";
	const view = await mount(h(UserMessage, { index: 0, message: { role: "user", content: [{ type: "text", text }], timestamp: 0 } }));
	try {
		const bubble = view.find(".ly-user-bubble");
		assert.equal(bubble.querySelectorAll("h1").length, 1, "「# 需求1」是标题");
		assert.equal(bubble.querySelectorAll("strong").length, 1, "「**所有**」是加粗");
		assert.ok(!(bubble.textContent ?? "").includes("#"), "井号是标记，不该留在字里");
	} finally { await view.unmount(); }
});

test("带附件标记的那一句保持行内，不被 markdown 切成几行", async () => {
	const message = {
		role: "user" as const,
		content: [{ type: "text" as const, text: "照着 【图片 1】 改一版" }],
		displayText: "照着 【图片 1】 改一版",
		attachments: [{ name: "shot.png", label: "图片 1", kind: "image" }],
		timestamp: 0,
	};
	const view = await mount(h(UserMessage, { index: 0, message }));
	try {
		const bubble = view.find(".ly-user-bubble");
		assert.equal(bubble.querySelectorAll(".ly-attachment-token").length, 1, "标记画成一枚胶囊");
		// 一个段落，不是「段落、胶囊、段落」三块。
		assert.equal(bubble.querySelectorAll("p").length, 1);
		const shown = bubble.textContent ?? "";
		assert.ok(shown.includes("照着") && shown.includes("图片 1") && shown.includes("改一版"));
	} finally { await view.unmount(); }
});

test("侧边聊天画的是人打的那句话，不是展开给模型的那一串", async () => {
	/*
	 * `content` 是送给模型的：附件正文被展开进去，带着 `### Attached file:` 的标题。
	 * `displayText` 是同一条消息里人实际打的字。气泡要画后者。
	 */
	const message = {
		role: "user" as const,
		content: [
			{ type: "text" as const, text: "\n\n### Attached file: image.png\n```\n二进制\n```\n\n" },
			{ type: "text" as const, text: "让主聊天看看这里面有什么内容吗？" },
		],
		displayText: "让主聊天看看这里面有什么内容吗？",
		attachments: [{ name: "image.png", label: "图片 1", kind: "image" }],
		timestamp: 0,
	};
	const view = await mount(h(MessageRow, { index: 0, message }));
	try {
		const bubble = view.find(".ly-user-bubble");
		const shown = bubble.textContent ?? "";
		assert.ok(shown.includes("让主聊天看看"), "人打的那句话在");
		assert.ok(!shown.includes("Attached file"), "写给模型的记号不该出现在气泡里");
		assert.ok(!shown.includes("二进制"), "附件正文更不该");
	} finally { await view.unmount(); }
});

test("老消息没有 displayText 时，仍然照原来的拼法画出来", async () => {
	// 升级之前发的侧边聊天消息没有这两个字段——少一枚胶囊，好过整条消息不见。
	const message = {
		role: "user" as const,
		content: [{ type: "text" as const, text: "一条老消息" }],
		timestamp: 0,
	};
	const view = await mount(h(MessageRow, { index: 0, message }));
	try {
		assert.ok((view.find(".ly-user-bubble").textContent ?? "").includes("一条老消息"));
	} finally { await view.unmount(); }
});
