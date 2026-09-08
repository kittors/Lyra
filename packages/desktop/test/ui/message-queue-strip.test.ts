/**
 * 条上的那几行：删、发、编辑、换位置，以及它们各自是怎么离场的。
 *
 * 队列的规则在 `message-queue.test.ts` 里量过了，这里量的是手放上去之后发生的事——尤其是「走掉的那
 * 一行要走完退场再消失」：那是一段时间上的行为，删掉之后立刻查 DOM 会看到它还在，而这正是要的。
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { act, createElement as h } from "react";

import { QueuedMessages } from "../../src/features/composer/QueuedMessages.tsx";
import { useApp } from "../../src/store/index.ts";
import type { QueuedMessage } from "../../src/store/queue-slice.ts";
import { DURATION } from "../../src/ui/motion/tokens.ts";
import { click, mount, press } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
const meta = { id: "a", title: "a", cwd: "/test", projectId: "test", projectName: "test", createdAt: 1, updatedAt: 2, modelId: "", messageCount: 1, seq: 2, usage };

let prompted: { deliver?: string; text: string }[];

function entry(text: string, extra: Partial<QueuedMessage> = {}): Omit<QueuedMessage, "id" | "queuedAt"> {
	return {
		content: [{ type: "text", text }],
		draft: { text, attachments: [], sessionRefs: [] },
		preview: text,
		...extra,
	};
}

/** 行的位置，因为这个 DOM 不排版：拖动要靠一行到下一行的距离，量到 0 就等于没有第二行。 */
function layout(rows: Element[], stride = 40): void {
	rows.forEach((row, index) => {
		row.getBoundingClientRect = () => ({ top: index * stride, bottom: index * stride + 36, height: 36, left: 0, right: 300, width: 300, x: 0, y: index * stride, toJSON: () => ({}) }) as DOMRect;
	});
}

const pointer = (type: string, y: number) => new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 });

async function settle(ms: number): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});
}

beforeEach(() => {
	prompted = [];
	useApp.setState({
		queued: {}, activeSessionId: "a", meta, messages: [], sessions: [meta], sessionCache: {},
		running: true, activity: { a: "running" }, turns: {}, carried: {}, notices: [], pendingUserMessage: null, drafts: {}, workspace: null, scratchCwd: "/test",
	});
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		agent: { prompt: async (_id: string, content: { type: string; text?: string }[], options?: { deliver?: string }) => {
			prompted.push({ text: content.map((block) => block.text ?? "").join(""), ...(options?.deliver ? { deliver: options.deliver } : {}) });
			return meta;
		} },
		sessions: { capabilities: async () => null, list: async () => [meta] },
	} });
});

function strip(onEdit: (entry: QueuedMessage) => void = () => {}) {
	return h(QueuedMessages, { sessionId: "a", running: true, onEdit });
}

test("排着的每一条一行，带图的那条把图也摆出来", async () => {
	useApp.getState().enqueue("a", entry("第一句"));
	useApp.getState().enqueue("a", entry("看这张图", { thumbnail: { mimeType: "image/png", data: "AAAA" } }));
	const view = await mount(strip());

	assert.deepEqual(view.all("[data-queue-row]").map((row) => row.textContent), ["第一句", "看这张图"]);
	const images = view.all("img");
	assert.equal(images.length, 1, "只有带图的那一条有缩略图");
	assert.equal(images[0]!.getAttribute("src"), "data:image/png;base64,AAAA");
	await view.unmount();
});

test("删掉的那一行先收起来，收完才真的没有", async () => {
	const id = useApp.getState().enqueue("a", entry("不想说了"));
	const view = await mount(strip());

	await click(view.find("[data-queue-remove]"));
	await act(async () => {});
	assert.equal(useApp.getState().queued.a, undefined, "队列里立刻就没有它了");
	const leaving = view.find("[data-queue-row]");
	assert.equal(leaving.getAttribute("data-leaving"), "true", "但行还在，正在收");
	assert.equal(useApp.getState().dropQueued("a", id), null);

	await settle(DURATION.base + 40);
	assert.equal(view.all("[data-queue-row]").length, 0, "收完之后才真的没有");
	await view.unmount();
});

test("自动出队的那一行，也要走完同一段退场", async () => {
	useApp.getState().enqueue("a", entry("轮到我了"));
	const view = await mount(strip());

	// 这一轮干净收尾——队首被送走，条上没有人点过任何东西。
	await act(async () => {
		useApp.setState({ activity: {} });
		useApp.getState().applyEvent("a", { type: "agent_end", reason: "done" });
	});
	await act(async () => {});
	assert.equal(view.find("[data-queue-row]").getAttribute("data-leaving"), "true", "被送走的行也要收，而不是凭空消失");
	assert.deepEqual(prompted.map((one) => one.text), ["轮到我了"]);

	await settle(DURATION.base + 40);
	assert.equal(view.all("[data-queue-row]").length, 0);
	await view.unmount();
});

test("「现在就发」把这一条插进正在跑的这一轮", async () => {
	useApp.getState().enqueue("a", entry("先看这个"));
	useApp.getState().enqueue("a", entry("再看那个"));
	const view = await mount(strip());

	await click(view.all("[data-queue-steer]")[1]!);
	await act(async () => {});
	assert.deepEqual(prompted, [{ text: "再看那个", deliver: "steer" }], "点哪一条发哪一条，而且不打断这一轮");
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["先看这个"]);
	await view.unmount();
});

test("编辑：行先收掉，草稿整份交回给输入框", async () => {
	const taken: QueuedMessage[] = [];
	useApp.getState().enqueue("a", entry("要改的那句", {
		draft: { text: "要改的那句", attachments: [{ id: "f1", name: "图.png", mimeType: "image/png", data: "AAAA", isText: false }], sessionRefs: [{ id: "s1", title: "另一个对话" }] },
	}));
	const view = await mount(strip((one) => taken.push(one)));

	await click(view.find("[data-queue-more]"));
	const edit = [...document.querySelectorAll("[role=menu] button")][0]!;
	await click(edit);

	assert.equal(taken.length, 1, "退回来的那一条要交到输入框手上");
	assert.equal(taken[0]!.draft.text, "要改的那句");
	assert.deepEqual(taken[0]!.draft.attachments.map((file) => file.name), ["图.png"], "附件要跟着回去，否则等于没退回来");
	assert.deepEqual(taken[0]!.draft.sessionRefs.map((ref) => ref.id), ["s1"]);
	assert.equal(useApp.getState().queued.a, undefined);
	await act(async () => {});
	assert.equal(view.find("[data-queue-row]").getAttribute("data-leaving"), "true");
});

test("拖动换位置：让位的那几行先滑开，松手才落定", async () => {
	useApp.getState().enqueue("a", entry("第一句"));
	useApp.getState().enqueue("a", entry("第二句"));
	useApp.getState().enqueue("a", entry("第三句"));
	const view = await mount(strip());
	layout(view.all("[data-queue-row]"));

	const grip = view.all("[data-queue-grip]")[0]!;
	await act(async () => { grip.dispatchEvent(pointer("pointerdown", 0)); });
	await act(async () => { grip.dispatchEvent(pointer("pointermove", 80)); });

	const rows = view.all("[data-queue-row]");
	assert.equal(rows[0]!.getAttribute("data-dragging"), "true");
	assert.equal((rows[0] as HTMLElement).style.transform, "translateY(80px)", "被拖的那条跟着手指");
	assert.equal((rows[1] as HTMLElement).style.transform, "translateY(-40px)", "被越过的让开一格");
	assert.equal((rows[2] as HTMLElement).style.transform, "translateY(-40px)");
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["第一句", "第二句", "第三句"], "松手之前顺序不变");

	await act(async () => { grip.dispatchEvent(pointer("pointerup", 80)); });
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["第二句", "第三句", "第一句"]);
	assert.equal(view.all("[data-queue-row]")[0]!.getAttribute("data-dragging"), null);
	await view.unmount();
});

test("放回原处不算改动", async () => {
	useApp.getState().enqueue("a", entry("第一句"));
	useApp.getState().enqueue("a", entry("第二句"));
	const view = await mount(strip());
	layout(view.all("[data-queue-row]"));

	const grip = view.all("[data-queue-grip]")[0]!;
	await act(async () => { grip.dispatchEvent(pointer("pointerdown", 0)); });
	await act(async () => { grip.dispatchEvent(pointer("pointermove", 12)); });
	await act(async () => { grip.dispatchEvent(pointer("pointerup", 12)); });
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["第一句", "第二句"], "还没到半格，落回原位");
	await view.unmount();
});

test("↑↓ 也能改顺序，因为拖动只是它的一种说法", async () => {
	useApp.getState().enqueue("a", entry("第一句"));
	useApp.getState().enqueue("a", entry("第二句"));
	const view = await mount(strip());

	await press(view.all("[data-queue-grip]")[1]!, "ArrowUp");
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["第二句", "第一句"]);

	await press(view.all("[data-queue-grip]")[0]!, "ArrowDown");
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["第一句", "第二句"]);
	await view.unmount();
});

test("只有一条的时候没有顺序可排，手柄按不动", async () => {
	useApp.getState().enqueue("a", entry("唯一的一句"));
	const view = await mount(strip());
	assert.equal(view.find("[data-queue-grip]").hasAttribute("disabled"), true);
	await view.unmount();
});

test("一条都不排的时候，条本身不占位置", async () => {
	const view = await mount(strip());
	assert.equal(view.all("[data-composer-queue]").length, 0);
	await view.unmount();
});
