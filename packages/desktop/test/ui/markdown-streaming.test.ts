/**
 * How a reply that is still being written is drawn — see `useSmoothText` and `stream-tail.ts`.
 *
 * Pinned here: a big chunk arriving at once is let out a little at a time rather than popping in whole;
 * new characters fade in; after the reply ends the remaining characters still play out and fade before
 * the original text is swapped back in, rather than the whole block popping in solid the moment it ends;
 * and half-written bold is drawn bold, with no asterisks showing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import type { AssistantMessage } from "@lyra/core";
import { Markdown } from "../../src/features/conversation/Markdown.tsx";
import { MessageRow } from "../../src/features/conversation/rows.tsx";
import { ThinkingBlock } from "../../src/features/conversation/ThinkingBlock.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { mount } from "../helpers/mount.ts";

const frames = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

test("一次进来的一大段按节奏放出来，写完之后剩下的字照常放完", async () => {
	const first = "第一段。";
	const burst = `${first}${"后面一口气进来的字。".repeat(20)}`;
	const view = await mount(h(Markdown, { text: first, streaming: true }));
	try {
		assert.equal(view.text(), first, "挂上时已有的字不重放");

		await view.rerender(h(Markdown, { text: burst, streaming: true }));
		await frames(50);
		const partial = view.text().length;
		assert.ok(partial > first.length && partial < burst.length, `应该只放出一部分，实际 ${partial}/${burst.length}`);

		await frames(1200);
		assert.equal(view.text(), burst, "积压的字在约定时间内放完");

		const more = `${burst}${"再来一段。".repeat(20)}`;
		await view.rerender(h(Markdown, { text: more, streaming: true }));
		await view.rerender(h(Markdown, { text: more, streaming: false }));
		assert.ok(view.text().length < more.length, "结束那一刻不整段蹦出来");
		await frames(1500);
		assert.equal(view.text(), more, "剩下的字放完");
		assert.equal(view.all(".ly-fade-char").length, 0, "淡完之后换回纯文本");
	} finally {
		await view.unmount();
	}
});

test("写到一半的加粗画成加粗；写完之后画的是原文", async () => {
	const view = await mount(h(Markdown, { text: "这是 **加粗", streaming: true }));
	try {
		assert.equal(view.find("strong").textContent, "加粗");
		assert.ok(!view.text().includes("*"), "星号是标记，不该露出来");

		await view.rerender(h(Markdown, { text: "这是 **加粗", streaming: false }));
		await frames(600);
		assert.equal(view.all("strong").length, 0, "写完了还没收口，那就是作者写的原样");
	} finally {
		await view.unmount();
	}
});

test("主会话里正在输出的那段正文按流式来画", async () => {
	/*
	 * The wiring itself needs guarding: the main session's row once decided by the "latest stretch of
	 * reasoning" marker, which body rows never get, so the streaming rendering never once switched on in
	 * the main session while the unit tests were all green.
	 */
	const message: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "这是 **加粗" }],
		api: "anthropic-messages",
		provider: "qa",
		model: "model",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "pending",
		timestamp: 1,
	};
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(MessageRow, { message, index: 0, upTo: 1 }) }));
	try {
		assert.equal(view.find("strong").textContent, "加粗");
		assert.ok(!view.text().includes("**"), "星号是标记，不该露出来");
	} finally {
		await view.unmount();
	}
});

test("输出中的新字淡入，写完之后不留淡入用的 span", async () => {
	const view = await mount(h(Markdown, { text: "第一句。", streaming: true }));
	try {
		await view.rerender(h(Markdown, { text: "第一句。第二句接着来。", streaming: true }));
		await frames(40);
		assert.ok(view.all(".ly-fade-char").length > 0, "新出现的字应该是淡入的");
		assert.equal(view.text(), "第一句。第二句接着来。".slice(0, view.text().length), "淡入不改变字本身");

		await view.rerender(h(Markdown, { text: "第一句。第二句接着来。", streaming: false }));
		assert.ok(view.all(".ly-fade-char").length > 0, "结束那一刻不掐掉正在进行的淡入");
		await frames(1000);
		assert.equal(view.all(".ly-fade-char").length, 0, "淡完之后是纯文本");
		assert.equal(view.text(), "第一句。第二句接着来。");
	} finally {
		await view.unmount();
	}
});

test("看着写完的回复，底下那行操作是长出来的；打开历史时不演", async () => {
	const base: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "好的，需要的时候叫我。" }],
		api: "anthropic-messages",
		provider: "qa",
		model: "model",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "pending",
		timestamp: 1,
	};
	const live = await mount(h(I18nProvider, { locale: "zh-CN", children: h(MessageRow, { message: base, index: 0, upTo: 1 }) }));
	try {
		await live.rerender(h(I18nProvider, { locale: "zh-CN", children: h(MessageRow, { message: { ...base, stopReason: "stop" }, index: 0, upTo: 1 }) }));
		assert.equal(live.all(".ly-actions-in").length, 1, "写完的那一刻展开，而不是一下子多出一行把回复顶上去");
	} finally {
		await live.unmount();
	}

	const history = await mount(h(I18nProvider, { locale: "zh-CN", children: h(MessageRow, { message: { ...base, stopReason: "stop" }, index: 0, upTo: 1 }) }));
	try {
		assert.equal(history.all(".ly-actions-in").length, 0);
	} finally {
		await history.unmount();
	}
});

test("输出中的代码块，新来的字也淡入；写完之后是原样的代码", async () => {
	const head = "看这段：\n\n```ts\nconst a = 1;\n";
	const code = `${head}${Array.from({ length: 40 }, (_, i) => `const n${i} = ${i};`).join("\n")}\n\`\`\``;
	const view = await mount(h(Markdown, { text: head, streaming: true }));
	try {
		await view.rerender(h(Markdown, { text: code, streaming: true }));
		await frames(60);
		assert.ok(view.all(".ly-code-block .ly-fade-char").length > 0, "代码块里新出现的字应该是淡入的");
		const shown = view.find(".ly-code-block pre").textContent ?? "";
		assert.ok(code.includes(shown), "淡入和分段不改变代码本身");

		await view.rerender(h(Markdown, { text: code, streaming: false }));
		await frames(1500);
		assert.equal(view.all(".ly-fade-char").length, 0, "淡完之后是纯文本");
		assert.equal(view.find(".ly-code-block pre").textContent, code.slice(code.indexOf("const a"), code.lastIndexOf("\n```")));
	} finally {
		await view.unmount();
	}
});

test("思考行写出来的字淡入，淡完并回纯文本", async () => {
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(ThinkingBlock, { text: "先看看", redacted: false, live: true }) }));
	try {
		await view.rerender(h(I18nProvider, { locale: "zh-CN", children: h(ThinkingBlock, { text: "先看看这个文件里写了什么", redacted: false, live: true }) }));
		await frames(80);
		assert.ok(view.all("[data-ly-thinking] .ly-fade-char").length > 0, "新写的字应该是淡入的");
		await frames(1500);
		assert.equal(view.all("[data-ly-thinking] .ly-fade-char").length, 0, "淡完之后并回纯文本");
		assert.ok(view.text().includes("先看看这个文件里写了什么"));
	} finally {
		await view.unmount();
	}
});
