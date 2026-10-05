/**
 * Settings › Appearance › Tool calls: whether each layout says what belongs to it.
 *
 * Collapsed (the default): a turn has its line from the start, folded by default; each call takes a
 * row of its own, with no tool-group layer. Expanded: the earlier look — no line while running, folding
 * by itself when done, calls gathered into tool groups of bordered cards.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement as h } from "react";
import type { AssistantContent, Settings } from "@lyra/core";
import { ToolRun } from "../../src/features/conversation/runs.tsx";
import { TurnProcess } from "../../src/features/conversation/TurnProcess.tsx";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

type Call = Extract<AssistantContent, { type: "toolCall" }>;
const read = (id: string, path: string): Call => ({ type: "toolCall", id, name: "read", arguments: { path } });
const calls = [read("r1", "src/a.ts"), read("r2", "src/b.ts")];
const inside = h("div", { "data-probe": "inside" }, "过程");

const previous = useApp.getState();
afterEach(() => useApp.setState(previous, true));

function layout(callChain: "expanded" | "collapsed") {
	useApp.setState({
		activeSessionId: "chain",
		capabilities: null,
		settings: { appearance: { callChain } } as Settings,
		toolRuns: Object.fromEntries(calls.map((call) => [call.id, { toolCallId: call.id, toolName: "read", summary: `Read ${String(call.arguments.path)}`, args: call.arguments, status: "done" as const, startedAt: Date.now() - 1000 }])),
	});
}

const drawRun = () => mount(h(ToolRun, { calls: calls.map((block) => ({ block, stopReason: "toolUse" as const })), flat: true }));

test("collapsed: the main transcript's calls are rows of their own, said in the turn line's words", async () => {
	layout("collapsed");
	const view = await drawRun();
	try {
		assert.equal(view.all("[data-ly-run] > button").length, 0, "no group line over them");
		const rows = view.all<HTMLElement>("[data-ly-tool]");
		assert.equal(rows.length, 2, "one row per call");
		assert.match(rows[0].textContent ?? "", /读取文件 a\.ts/, "core's English summary is not what the row says");
	} finally { await view.unmount(); }
});

test("expanded: the same calls fold into one group line of bordered cards", async () => {
	layout("expanded");
	const view = await drawRun();
	try {
		const head = view.find<HTMLButtonElement>("[data-ly-run] > button");
		assert.match(head.textContent ?? "", /读取文件 2 个/);
		assert.equal(head.getAttribute("aria-expanded"), "false", "the group starts folded, as it used to");
	} finally { await view.unmount(); }
});

test("expanded: a running turn has no line and folds itself away when it ends", async () => {
	layout("expanded");
	const view = await mount(h(TurnProcess, { counts: { tools: 2, thinking: 0 }, running: true, children: inside }));
	try {
		assert.equal(view.all("button[aria-expanded]").length, 0, "no line while it runs");
		assert.equal(view.all("[data-probe]").length, 1, "but everything in it is shown");
		await view.rerender(h(TurnProcess, { counts: { tools: 2, thinking: 0 }, running: false, children: inside }));
		assert.equal(view.find("button[aria-expanded]").getAttribute("aria-expanded"), "false", "folded once the turn ends");
		assert.match(view.text(), /调用工具 2 个/);
	} finally { await view.unmount(); }
});

test("collapsed: the same running turn has its line from the start, folded", async () => {
	layout("collapsed");
	const view = await mount(h(TurnProcess, { counts: { tools: 2, thinking: 0 }, running: true, children: inside }));
	try {
		assert.equal(view.find("button[aria-expanded]").getAttribute("aria-expanded"), "false");
		await view.rerender(h(TurnProcess, { counts: { tools: 2, thinking: 0 }, running: false, children: inside }));
		assert.equal(view.find("button[aria-expanded]").getAttribute("aria-expanded"), "false");
	} finally { await view.unmount(); }
});
