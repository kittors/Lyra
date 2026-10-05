/**
 * A tool call in a screen's transcript reads that screen's record of it.
 *
 * The cards asked the live slot's `toolRuns` — the focused conversation's — by call id. A call in the
 * conversation beside it is never in there, so under a screen without focus every card drew without
 * its record: a finished call fell back to 「出错」 once its turn had ended, a preview was drawn as a
 * plain tool card (the page itself never appeared), a folded run counted no changed lines, and a
 * browser card could not tell two visits to one tab apart. Measured in a real window: a preview in
 * the screen without focus drew no page at all (`e2e/split-scope-more-probe.ts cards`).
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";
import type { AssistantMessage, Message, SessionMeta } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { BrowserCards } from "../../src/features/conversation/BrowserCard.tsx";
import { LiveToolCard, ToolRun } from "../../src/features/conversation/runs.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import type { ToolRun as ToolRunState } from "../../src/store/tool-run.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function meta(id: string): SessionMeta {
	return { id, title: id, cwd: `/work/${id}`, projectId: id, projectName: id, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 3, seq: 4, usage };
}
type ToolCallBlock = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;
const call = (id: string, name: string, args: Record<string, unknown>): ToolCallBlock => ({ type: "toolCall", id, name, arguments: args });
const record = (block: ToolCallBlock, result: ToolRunState["result"]): ToolRunState => ({
	toolCallId: block.id, toolName: block.name, args: block.arguments, summary: `${block.name} 的摘要`, status: "done", result, startedAt: 1, finishedAt: 2,
});

// 乙's finished calls, each with its record in 乙's parked copy — where the events of a conversation off the live slot land.
const ls = call("b-ls", "bash", { command: "ls" });
const edit = call("b-edit", "edit", { path: "/work/b/lib.ts" });
const shown = call("b-preview", "preview", { entry: "index.html" });
const visit = call("b-open", "browser_open", { url: "http://127.0.0.1:5173/" });
const RUNS: Record<string, ToolRunState> = {
	[ls.id]: record(ls, { content: [{ type: "text", text: "README.md" }], details: undefined }),
	[edit.id]: record(edit, { content: [{ type: "text", text: "已修改" }], details: { added: 5, removed: 2 } }),
	[shown.id]: record(shown, { content: [{ type: "text", text: "预览已生成" }], details: { preview: { id: "p1", sessionId: "b", title: "乙的页面", entry: "index.html" } } }),
	[visit.id]: record(visit, { content: [], details: { kind: "browser", tabId: "t1", url: "http://127.0.0.1:5173/", title: "乙打开的页面", thumbnail: "b.jpg", opened: true } }),
};

function beside(): Cache[string] {
	const said: Message[] = [
		{ role: "user", content: [{ type: "text", text: "乙的问题" }], timestamp: 1 },
		{ role: "assistant", content: [ls, edit, shown], api: "anthropic-messages", provider: "qa", model: "model", usage, stopReason: "toolUse", timestamp: 2 },
	];
	return { meta: meta("b"), messages: said, toolRuns: RUNS, state: { running: false, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null } };
}

let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	// 甲 holds the live slot with no tool runs of its own; 乙, beside it, has finished its turn.
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: meta("a"), messages: [], toolRuns: {}, running: false,
		sessions: [meta("a"), meta("b")], sessionCache: { b: beside() }, activity: {},
	});
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous, true);
	Reflect.deleteProperty(window, "lyra");
});

function under(id: string, body: ReturnType<typeof h>): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: id }, body) }));
}

test("a finished call under a screen without focus shows its own record, not a failure", async () => {
	view = await under("b", h(LiveToolCard, { block: ls, stopReason: "toolUse" }));
	assert.equal(view.all("svg.lucide-circle-x").length, 0, "the finished call was drawn as a failure");
	assert.equal(view.find("[data-ly-tool]").getAttribute("data-ly-tool"), "done", "the finished call was not drawn as done");
	assert.match(view.text(), /bash 的摘要/, "the card lost its own summary");
});

test("a preview made under a screen without focus draws the page there", async () => {
	view = await under("b", h(LiveToolCard, { block: shown, stopReason: "toolUse" }));
	// The page itself, named by the preview's title — a plain tool card has no frame at all.
	assert.equal(view.all('iframe[title="乙的页面"]').length, 1, `the preview was drawn as a plain tool card: ${view.text().slice(0, 120)}`);
});

test("a folded run under a screen without focus counts that screen's changed lines", async () => {
	view = await under("b", h(ToolRun, { calls: [{ block: ls, stopReason: "toolUse" }, { block: edit, stopReason: "toolUse" }], live: false }));
	assert.match(view.text(), /\+5/, `the run lost its added lines: ${view.text().slice(0, 160)}`);
	assert.match(view.text(), /-2|−2/, "the run lost its removed lines");
});

test("a page visited under a screen without focus has its card there", async () => {
	view = await under("b", h(BrowserCards, { calls: [visit.id] }));
	assert.equal(view.all("[data-browser-card-row]").length, 1, "the visit left no card under its own screen");
	assert.match(view.text(), /乙打开的页面/);
});
