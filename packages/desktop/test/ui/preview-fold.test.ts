/**
 * A page made with `preview` never folds away with the work that made it.
 *
 * Reported 2026-10-12: a turn folded its process into 「思考 1 次 · 生成预览」 and the page went with
 * it — the only way to see what had been made was to open the reasoning. The page used to replace
 * its own tool card wherever the card was drawn, including inside a fold. Now inside a fold it is a
 * row saying what was made, and whoever owns the fold draws the page after it: the transcript for a
 * turn's process line (pinned in `turn-blocks.test.ts`), the run itself for its own group line —
 * which starts folded, and is how the sub-agent panel draws every run.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement as h, type ReactNode } from "react";
import type { AssistantMessage } from "@lyra/core";
import { InFold, LiveToolCard, PreviewCards, ToolRun } from "../../src/features/conversation/runs.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import type { ToolRun as ToolRunState } from "../../src/store/tool-run.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

type ToolCallBlock = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

const TITLE = "柴柴小布丁";
const call = (id: string, name: string, args: Record<string, unknown> = {}): ToolCallBlock => ({ type: "toolCall", id, name, arguments: args });
const record = (block: ToolCallBlock, extra: Partial<ToolRunState>): ToolRunState => ({
	toolCallId: block.id, toolName: block.name, args: block.arguments, summary: block.name, status: "done", startedAt: 1, finishedAt: 2, ...extra,
});

const ls = call("c-ls", "bash", { command: "ls" });
const shown = call("c-pup", "preview", { title: TITLE, html: "<p>汪</p>" });
// Failed before writing anything: the row says what was attempted, and there is no page to draw.
const refused = call("c-refused", "preview", { title: "空页面" });
const RUNS: Record<string, ToolRunState> = {
	[ls.id]: record(ls, { result: { content: [{ type: "text", text: "README.md" }], details: undefined } }),
	// The summary a reopened conversation rebuilds for this tool is its bare name.
	[shown.id]: record(shown, { summary: "preview", result: { content: [{ type: "text", text: "预览已生成" }], details: { preview: { id: "p1", sessionId: "s", title: TITLE, entry: "index.html" } } } }),
	[refused.id]: record(refused, { status: "error", result: { content: [{ type: "text", text: "需要 `html` 或 `files` 其中之一。" }], details: undefined, isError: true } }),
};

let view: Mounted | undefined;

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState({ toolRuns: {}, activeSessionId: null });
});

const render = (body: ReactNode) => mount(h(I18nProvider, { locale: "zh-CN", children: body }));
const folded = (body: ReactNode) => h(InFold.Provider, { value: true }, body);
const pages = () => view?.all(`iframe[title="${TITLE}"]`) ?? [];

test("inside a fold a preview is a row saying what it made, not the page", async () => {
	view = await render(folded(h(LiveToolCard, { block: shown, stopReason: "toolUse", runs: RUNS })));
	assert.equal(pages().length, 0, "the page was drawn inside the fold again");
	const row = view.find("[data-ly-tool]");
	// The words the turn line uses, with the page's name — not the bare title, not the tool's name.
	assert.equal(row.textContent?.replace(/\s+/g, " ").trim(), `生成预览 ${TITLE}`);
	assert.ok(row.querySelector("svg.lucide-app-window"), "a preview row has its own mark, not the terminal's");
});

test("outside a fold the page still stands in for the call", async () => {
	view = await render(h(LiveToolCard, { block: shown, stopReason: "toolUse", runs: RUNS }));
	assert.equal(pages().length, 1, `no page outside a fold: ${view.text().slice(0, 120)}`);
	assert.equal(view.all("[data-ly-tool]").length, 0, "the page and a row for it, both");
});

test("a run's group line starts folded, and its page is drawn after the line", async () => {
	// The grouped form, as the sub-agent panel draws every run.
	view = await render(h(ToolRun, { calls: [{ block: ls, stopReason: "toolUse" }, { block: shown, stopReason: "toolUse" }], live: false, runs: RUNS }));
	const toggle = view.find("[data-ly-run] button[aria-expanded]");
	assert.equal(toggle.getAttribute("aria-expanded"), "false", "the line is meant to start folded");
	const [page] = pages();
	assert.ok(page, "folded, the page was nowhere");
	assert.ok(!page.closest("[data-ly-run]"), "the page is inside the line that folds");
	const group = view.find("[data-ly-run]");
	assert.ok(group.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING, "the page comes after the line, not before it");
	assert.equal(pages().length, 1, "one page, not one inside and one outside");
});

test("inside an outer fold the run leaves its page to the fold's owner", async () => {
	// Under the expanded layout a turn's runs are group lines inside the turn's own fold: drawn here too, the page would be twice.
	view = await render(folded(h(ToolRun, { calls: [{ block: shown, stopReason: "toolUse" }], live: false, runs: RUNS })));
	assert.equal(pages().length, 0, "the run drew the page that the outer fold's owner draws");
});

test("a preview that made no page leaves only its row, and nothing after the fold", async () => {
	view = await render(h("div", null, folded(h(LiveToolCard, { block: refused, stopReason: "toolUse", runs: RUNS })), h(PreviewCards, { calls: [refused], runs: RUNS })));
	assert.equal(view.all("iframe").length, 0, "a page was drawn for a call that made none");
	assert.match(view.find("[data-ly-tool]").textContent ?? "", /生成预览 空页面/, "the failed row lost what it was trying to make");
	assert.ok(view.find("[data-ly-tool]").querySelector("svg.lucide-circle-x"), "the failure lost its mark");
});

test("after the fold, the page is read from this screen's records", async () => {
	// The main transcript hands no records in: the page comes from the store, the way the turn's other cards read theirs.
	useApp.setState({ toolRuns: { [shown.id]: RUNS[shown.id] } });
	view = await render(h(PreviewCards, { calls: [shown] }));
	assert.equal(pages().length, 1, "the page did not come from the store's record");
	await view.unmount();
	useApp.setState({ toolRuns: { [shown.id]: { ...RUNS[shown.id], status: "running", result: undefined } } });
	view = await render(h(PreviewCards, { calls: [shown] }));
	assert.equal(pages().length, 0, "a call still running has no page to draw");
});
