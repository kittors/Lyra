/**
 * 侧边聊天和子智能体面板，跟主会话是不是同一套手感（二轮）。
 *
 * 反馈原话是「主会话的输入框完成度高，侧边聊天和子智能体的实现就比较差」。这里钉住的是那几处差：
 *
 *   - 子智能体的草稿按子智能体存：给 A 写到一半切到 B，那半句话不能跟过去；
 *   - 子智能体的发送键就是发送键：发出去的带着给人看的那一份，发送中也不变成一颗会停掉整个子智能体
 *     的停止键；
 *   - 子智能体转录：主 Agent 交代的任务画成任务卡片，人说的话画成气泡（不是整篇附件正文），夹在
 *     一条回复中间的工具调用不会凭空消失；
 *   - 侧边聊天正在答的时候按回车是排队，答完自己发出去；编辑一句带文件的问题，文件跟着过去；
 *   - 侧边聊天的工具调用和主会话一样收成一行。
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";

import type { Message, SubAgentSummary, UserContent } from "@lyra/core";
import { SubAgentPanel } from "../../src/features/subagents/SubAgentPanel.tsx";
import { SubAgentTranscript } from "../../src/features/subagents/SubAgentMessageRow.tsx";
import { MessageRow } from "../../src/features/sidechat/MessageRow.tsx";
import { QueueList } from "../../src/features/composer/QueuedMessages.tsx";
import { sideChatOf, useSide } from "../../src/features/dock/sideStore.ts";
import { useApp } from "../../src/store/index.ts";
import { useSubAgents } from "../../src/store/subAgents.ts";
import { click, fire, mount, press } from "../helpers/mount.ts";

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function running(id: string, over: Partial<SubAgentSummary> = {}): SubAgentSummary {
	return { id, agent: "explore", description: `任务 ${id}`, status: "running", startedAt: Date.now() - 2000, toolCalls: 0, depth: 1, usage: zero, ...over };
}

function brief(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1, origin: "parent" };
}

function reply(content: Extract<Message, { role: "assistant" }>["content"], stopReason: "stop" | "toolUse" = "stop"): Message {
	return { role: "assistant", content, api: "anthropic-messages", provider: "p", model: "m", usage: zero, stopReason, timestamp: 2 } as Message;
}

/** 像人那样打字：受控输入框里直接赋 value 会被 React 盖掉，得走原生 setter。 */
async function type(field: HTMLTextAreaElement, text: string): Promise<void> {
	const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
	assert.ok(setter);
	setter.call(field, text);
	await fire(field, new Event("input", { bubbles: true }));
}

let steered: unknown[][];

beforeEach(() => {
	steered = [];
	useApp.setState({ activeSessionId: "s", messages: [], toolRuns: {}, drafts: {} });
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			subAgents: {
				steer: async (...args: unknown[]) => {
					steered.push(args);
					return true;
				},
				abort: async () => true,
				dismiss: async () => "removed",
			},
			sideChat: { ask: async () => undefined, editAndResend: async () => undefined, reset: async () => undefined, state: async () => null },
			tasks: { list: async () => [] },
		},
	});
});

afterEach(() => {
	useSubAgents.setState({ agents: [], transcripts: {}, focused: null, loading: [] });
	useSide.setState({ chats: {} });
});

test("子智能体的草稿按子智能体存：给 A 写到一半切到 B，那半句话不跟过去", async () => {
	useSubAgents.setState({ agents: [running("a"), running("b", { startedAt: Date.now() - 1000 })], transcripts: { a: [brief("去找 A")], b: [brief("去找 B")] }, focused: "a", loading: [] });
	const view = await mount(h(SubAgentPanel));
	try {
		const field = () => view.find<HTMLTextAreaElement>("textarea");
		await type(field(), "给 A 的半句");
		await act(async () => useSubAgents.getState().focus("b"));
		assert.equal(field().value, "", "换到 B，框是空的——那半句不是说给 B 的");
		await act(async () => useSubAgents.getState().focus("a"));
		assert.equal(field().value, "给 A 的半句", "回到 A，它还在");
	} finally {
		await act(async () => useSubAgents.setState({ agents: [running("a", { status: "done" }), running("b", { status: "done" })] }));
		await view.unmount();
	}
});

test("子智能体的发送键就是发送键：带着给人看的那一份送出去，框清空", async () => {
	useSubAgents.setState({ agents: [running("a")], transcripts: { a: [brief("去找")] }, focused: "a", loading: [] });
	const view = await mount(h(SubAgentPanel));
	try {
		const field = view.find<HTMLTextAreaElement>("textarea");
		await type(field, "别看测试目录");
		const send = view.find<HTMLButtonElement>("[data-ly-composer-send], button[aria-label='发送']");
		assert.notEqual(send.getAttribute("aria-label"), "停止", "发送键不是停止键");
		await press(field, "Enter");
		await act(async () => {});
		assert.equal(steered.length, 1);
		const [sessionId, id, content, display] = steered[0] as [string, string, UserContent[], { displayText: string }];
		assert.equal(sessionId, "s");
		assert.equal(id, "a");
		assert.deepEqual(content, [{ type: "text", text: "别看测试目录" }]);
		assert.equal(display.displayText, "别看测试目录", "给人看的那一份跟着走，面板才画得出这句话本身");
		assert.equal(view.find<HTMLTextAreaElement>("textarea").value, "");
	} finally {
		await act(async () => useSubAgents.setState({ agents: [running("a", { status: "done" })] }));
		await view.unmount();
	}
});

test("子智能体转录：交代的任务是一张卡片，人说的话是气泡而不是整篇附件，中间的工具调用不丢", async () => {
	const messages: Message[] = [
		brief("去找登录入口"),
		reply([
			{ type: "text", text: "先看看目录" },
			{ type: "toolCall", id: "c1", name: "ls", arguments: { path: "src" } },
			{ type: "text", text: "再读入口文件" },
			{ type: "toolCall", id: "c2", name: "read", arguments: { path: "src/app.ts" } },
		], "toolUse"),
		{ role: "toolResult", toolCallId: "c1", toolName: "ls", content: [{ type: "text", text: "app.ts" }], isError: false, timestamp: 3 } as Message,
		{ role: "toolResult", toolCallId: "c2", toolName: "read", content: [{ type: "text", text: "…" }], isError: false, timestamp: 3 } as Message,
		{
			role: "user",
			content: [{ type: "text", text: "看看【报告.md】" }, { type: "text", text: "\n\n### Attached file: 报告.md\n```\n第一章 很长很长的正文\n```" }],
			displayText: "看看【报告.md】",
			attachments: [{ name: "报告.md", kind: "text" }],
			timestamp: 4,
		},
	];
	const view = await mount(h(SubAgentTranscript, { messages }));
	try {
		const brief = view.find("[data-sub-brief]");
		assert.match(brief.textContent ?? "", /主 Agent 交代的任务.*去找登录入口/);
		assert.equal(view.all("[data-spoken-bubble]").length, 1, "只有人自己说的那一句是气泡");
		const bubble = view.find("[data-spoken-bubble]");
		assert.match(bubble.textContent ?? "", /看看.*报告\.md/);
		assert.ok(!(bubble.textContent ?? "").includes("第一章"), "附件正文不摊在气泡里");
		assert.ok(!(bubble.textContent ?? "").includes("Attached file"));
		// 夹在两段话中间的那次 `ls`：从前这里只认思考和文字，它就这么不见了。
		assert.match(view.text(), /先看看目录.*再读入口文件/);
		// 两行工具调用：夹在中间的 `ls` 一行、排在最后的 `read` 一行。从前只有后面那一行。
		assert.equal(view.all("[data-ly-run]").length, 2, `中间那次调用画出来了：${view.text()}`);
	} finally {
		await view.unmount();
	}
});

test("侧边聊天正在答的时候按回车是排队：答完自己发出去，被停下就不发", async () => {
	const asked: UserContent[][] = [];
	useSide.setState({ chats: {} });
	const original = useSide.getState().ask;
	useSide.setState({ ask: async (_sessionId, content) => void asked.push(content) });
	try {
		const store = useSide.getState();
		useSide.setState({ chats: { s: { ...sideChatOf(useSide.getState(), "s"), running: true } } });
		store.enqueue("s", { content: [{ type: "text", text: "还有一件" }], draft: { text: "还有一件", attachments: [], sessionRefs: [] }, preview: "还有一件" });
		store.enqueue("s", { content: [{ type: "text", text: "再一件" }], draft: { text: "再一件", attachments: [], sessionRefs: [] }, preview: "再一件" });
		await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
		assert.equal(asked.length, 0, "还在答，不插进去");
		assert.deepEqual(sideChatOf(useSide.getState(), "s").queued.map((one) => one.preview), ["还有一件", "再一件"]);

		// 换个顺序，条上改得了先后。
		const [first, second] = sideChatOf(useSide.getState(), "s").queued;
		assert.ok(store.moveQueued("s", second!.id, first!.id, "before"));
		assert.deepEqual(sideChatOf(useSide.getState(), "s").queued.map((one) => one.preview), ["再一件", "还有一件"]);

		store.applyEvent("s", { type: "agent_end", reason: "aborted" } as never);
		await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
		assert.equal(asked.length, 0, "按了停止，排着的不接着灌进去");

		useSide.setState({ chats: { s: { ...sideChatOf(useSide.getState(), "s"), running: true } } });
		store.applyEvent("s", { type: "agent_end", reason: "done" } as never);
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(asked.length, 1, "答完了，队首接上");
		assert.deepEqual(asked[0], [{ type: "text", text: "再一件" }]);
		assert.deepEqual(sideChatOf(useSide.getState(), "s").queued.map((one) => one.preview), ["还有一件"]);
	} finally {
		useSide.setState({ ask: original });
	}
});

test("重新开始一段侧边聊天，排着的那几句不跟过去", async () => {
	const store = useSide.getState();
	useSide.setState({ chats: { s: { ...sideChatOf(useSide.getState(), "s"), running: true } } });
	store.enqueue("s", { content: [{ type: "text", text: "问上一段的" }], draft: { text: "问上一段的", attachments: [], sessionRefs: [] }, preview: "问上一段的" });
	assert.equal(sideChatOf(useSide.getState(), "s").queued.length, 1);
	useSide.setState({ chats: { s: { ...sideChatOf(useSide.getState(), "s"), running: false } } });
	await store.reset("s");
	assert.equal(sideChatOf(useSide.getState(), "s").queued.length, 0);
});

test("侧边聊天的队伍是同一条条：没有「插进这一轮」，编辑直接是一个按钮", async () => {
	const taken: string[] = [];
	const items = [{ id: "q1", content: [{ type: "text" as const, text: "排着的" }], draft: { text: "排着的", attachments: [], sessionRefs: [] }, preview: "排着的", queuedAt: 1 }];
	const view = await mount(h(QueueList, { source: { items, drop: (id: string) => items.find((one) => one.id === id) ?? null, move: () => {} }, running: true, onEdit: (entry) => taken.push(entry.draft.text) }));
	try {
		assert.equal(view.all("[data-queue-row]").length, 1);
		assert.equal(view.all("[data-queue-steer]").length, 0, "侧边聊天没有「插进这一轮」");
		assert.equal(view.all("[data-queue-more]").length, 0, "只剩编辑一样，就不藏进菜单");
		await click(view.find("[data-queue-edit]"));
		assert.deepEqual(taken, ["排着的"]);
	} finally {
		await view.unmount();
	}
});

test("侧边聊天里编辑一句带文件的问题：文件和给人看的那一份都跟着过去", async () => {
	const resent: { content: UserContent[]; meta: unknown }[] = [];
	const original = useSide.getState().editAndResend;
	useSide.setState({ editAndResend: async (_sessionId, _index, content, meta) => void resent.push({ content, meta }) });
	const message: Message = {
		role: "user",
		content: [{ type: "text", text: "总结【报告.md】" }, { type: "text", text: "\n\n### Attached file: 报告.md\n```\n正文\n```" }],
		displayText: "总结【报告.md】",
		attachments: [{ name: "报告.md", kind: "text" }],
		timestamp: 1,
	};
	const view = await mount(h(MessageRow, { message, index: 0 }));
	try {
		await click(view.find("button[aria-label='编辑并重新提问']"));
		const field = view.find<HTMLTextAreaElement>("textarea");
		await type(field, "只总结第一章【报告.md】");
		await press(field, "Enter", { metaKey: true });
		if (resent.length === 0) await press(field, "Enter");
		assert.equal(resent.length, 1);
		const texts = resent[0]!.content.map((block) => (block.type === "text" ? block.text : ""));
		assert.ok(texts.some((text) => text.includes("### Attached file: 报告.md")), `文件正文跟着过去：${JSON.stringify(texts)}`);
		assert.deepEqual(resent[0]!.meta, { displayText: "只总结第一章【报告.md】", attachments: [{ name: "报告.md", kind: "text" }] });
	} finally {
		useSide.setState({ editAndResend: original });
		await view.unmount();
	}
});

test("侧边聊天的工具调用收成一行，和主会话一样", async () => {
	const message = reply([
		{ type: "toolCall", id: "r1", name: "read", arguments: { path: "a.ts" } },
		{ type: "toolCall", id: "r2", name: "read", arguments: { path: "b.ts" } },
		{ type: "toolCall", id: "r3", name: "read", arguments: { path: "c.ts" } },
	], "toolUse");
	const view = await mount(h(MessageRow, { message, index: 1 }));
	try {
		assert.equal(view.all("[data-ly-run]").length, 1, `三次读取收成一行：${view.text()}`);
		assert.match(view.find("[data-ly-run]").textContent ?? "", /3/, "那一行说的是「3 个」");
	} finally {
		await view.unmount();
	}
});
