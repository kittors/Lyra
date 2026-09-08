/**
 * 会话正忙的时候按下回车，那句话去了哪里。
 *
 * 从前它直接插进正在跑的那一轮（`send` 的默认投递就是 steer），现在它排到条上等下一轮。这条测试量
 * 的正是这个改动本身，以及它必须留出的那几个例外：
 *
 *   - 空闲时照旧直接发，排队条不该在这时候冒出来；
 *   - 命令自己声明了 `steer` 的仍旧插进去——那是写命令的人说清楚了的事；
 *   - 前面还排着东西时，即使这会儿空闲也要接着排，否则新说的这句会越过前面几句先到。
 *
 * 展开也在这里量一次：条上留着的是人写的那行原文，而真正发出去的是命令展开后的正文——两者是同一次
 * 提交的两面，对不上就等于条上写着一件事、发出去的是另一件。
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { act, createElement as h } from "react";

import { Composer } from "../../src/features/composer/Composer.tsx";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
const meta = { id: "a", title: "a", cwd: "/test", projectId: "test", projectName: "test", createdAt: 1, updatedAt: 2, modelId: "", messageCount: 1, seq: 2, usage };

let sent: { text: string; deliver?: string }[];
let previous: ReturnType<typeof useApp.getState>;

/** 一条命令，按磁盘上读出来的样子。 */
function command(name: string, content: string, deliver?: "steer" | "followUp") {
	return { name, description: name, content, path: `/test/${name}.md`, scope: "workspace" as const, origin: "lyra" as const, ...(deliver ? { deliver } : {}) };
}

function setup(over: { running?: boolean; commands?: ReturnType<typeof command>[]; draft?: string } = {}) {
	useApp.setState({
		activeSessionId: "a", meta, sessions: [meta], workspace: null, scratchCwd: "/test", settings: null, messages: [],
		running: over.running ?? true, activity: over.running === false ? {} : { a: "running" }, queued: {}, notices: [],
		drafts: { a: { text: over.draft ?? "等这一轮完了再看这个", attachments: [], sessionRefs: [] } },
		send: async (content, options) => {
			sent.push({ text: content.map((block) => (block.type === "text" ? block.text : "[图]")).join(""), ...(options?.deliver ? { deliver: options.deliver } : {}) });
			return true;
		},
	});
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		commands: { list: async () => ({ commands: over.commands ?? [], skills: [], agents: [] }) },
	} });
}

const composer = () => h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(Composer) }) });

beforeEach(() => {
	sent = [];
	previous = useApp.getState();
});

test("正忙的时候按下去，话排到条上，不插进这一轮", async () => {
	setup();
	const view = await mount(composer());
	try {
		// 正忙时那颗额外的发送键，就是这条路的入口——见 `Composer` 里 `running && 有内容` 那一处。
		await click(view.find('[data-composer-send="send"]'));
		await act(async () => {});
		assert.deepEqual(sent, [], "一句都不该直接发出去");
		assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["等这一轮完了再看这个"]);
		assert.equal(view.find<HTMLTextAreaElement>("textarea").value, "", "输入框要清空，话已经在条上了");
		assert.equal(view.all("[data-queue-row]").length, 1);
	} finally { await view.unmount(); useApp.setState(previous, true); }
});

test("空闲的时候照旧直接发，条不冒出来", async () => {
	setup({ running: false });
	const view = await mount(composer());
	try {
		await click(view.find('[aria-label="发送"]'));
		await act(async () => {});
		assert.deepEqual(sent.map((one) => one.text), ["等这一轮完了再看这个"]);
		assert.equal(useApp.getState().queued.a, undefined);
		assert.equal(view.all("[data-queue-row]").length, 0);
	} finally { await view.unmount(); useApp.setState(previous, true); }
});

test("命令自己声明了 steer，正忙时仍旧插进去", async () => {
	setup({ draft: "/focus 只看 src/", commands: [command("focus", "把注意力收回到：$ARGUMENTS", "steer")] });
	const view = await mount(composer());
	try {
		await click(view.find('[data-composer-send="send"]'));
		await act(async () => {});
		assert.deepEqual(sent, [{ text: "把注意力收回到：只看 src/", deliver: "steer" }], "写命令的人说了要插进去，队列不该替他改主意");
		assert.equal(useApp.getState().queued.a, undefined);
	} finally { await view.unmount(); useApp.setState(previous, true); }
});

test("条上留原文，发出去的是展开后的正文", async () => {
	setup({ draft: "/review 这次的改动", commands: [command("review", "审一遍：$ARGUMENTS，按严重程度排序。")] });
	const view = await mount(composer());
	try {
		await click(view.find('[data-composer-send="send"]'));
		await act(async () => {});
		const queued = useApp.getState().queued.a?.[0];
		assert.equal(queued?.preview, "/review 这次的改动", "条上要认得出是自己写的那一行");
		assert.equal(queued?.draft.text, "/review 这次的改动", "编辑退回去的也是那一行，而不是展开后的几百字");
		assert.ok(queued?.content.some((block) => block.type === "text" && block.text.includes("按严重程度排序")), "真正发出去的是展开后的正文");
	} finally { await view.unmount(); useApp.setState(previous, true); }
});

test("前面还排着的时候，空闲也要接着排，并把队伍推起来", async () => {
	setup({ running: false });
	useApp.getState().enqueue("a", {
		content: [{ type: "text", text: "先说的那句" }],
		draft: { text: "先说的那句", attachments: [], sessionRefs: [] },
		preview: "先说的那句",
	});
	const view = await mount(composer());
	try {
		await click(view.find('[aria-label="发送"]'));
		await act(async () => {});
		// 排进去的是新说的这句；被推出去的是先说的那句——顺序就是这么一件事。
		assert.deepEqual(sent.map((one) => one.text), ["先说的那句"]);
		assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["等这一轮完了再看这个"]);
	} finally { await view.unmount(); useApp.setState(previous, true); }
});

test("编辑：那一条整份回到输入框，草稿也跟着回来", async () => {
	setup();
	const view = await mount(composer());
	try {
		await click(view.find('[data-composer-send="send"]'));
		await act(async () => {});
		await click(view.find("[data-queue-more]"));
		await click([...document.querySelectorAll("[role=menu] button")][0]!);
		await act(async () => {});
		assert.equal(view.find<HTMLTextAreaElement>("textarea").value, "等这一轮完了再看这个");
		assert.equal(useApp.getState().queued.a, undefined);
		assert.equal(useApp.getState().drafts.a?.text, "等这一轮完了再看这个", "存下来的草稿也要跟着回到这一份上");
	} finally { await view.unmount(); useApp.setState(previous, true); }
});
