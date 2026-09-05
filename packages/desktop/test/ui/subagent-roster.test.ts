/**
 * The roster above a sub-agent's transcript: a strip while the rows are peers, a tree once one of
 * them dispatched another — and the bill on both (16 §6.2).
 *
 * Mounted rather than reasoned about, because the acceptance is about what is drawn: the depth
 * that switches the shape, the indent that says who asked, the figure on a root that has to be
 * the branch's and not its own, and the total that is the whole point.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import type { SubAgentSummary } from "@lyra/core";
import { SubAgentRoster } from "../../src/features/subagents/SubAgentRoster.tsx";
import { click, mount } from "../helpers/mount.ts";

function summary(over: Partial<SubAgentSummary> & { id: string; tokens?: number; cost?: number }): SubAgentSummary {
	const { tokens = 0, cost = 0, ...rest } = over;
	return {
		agent: "general",
		description: rest.id,
		status: "done",
		startedAt: 1000,
		endedAt: 2000,
		toolCalls: 0,
		depth: 1,
		usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens, cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } },
		...rest,
	};
}

test("peers are a tab strip, with the total at its end", async () => {
	const view = await mount(
		h(SubAgentRoster, {
			agents: [summary({ id: "找入口", tokens: 1200, cost: 0.02 }), summary({ id: "查用法", tokens: 800, cost: 0.01 })],
			current: "找入口",
			onFocus: () => {},
		}),
	);
	assert.ok(view.find("[role=tablist]"), "two peers: a strip");
	assert.equal(view.all("[role=tree]").length, 0, "no nesting, no tree");
	assert.equal(view.all("[role=tab]").length, 2);
	assert.equal(view.find("[role=tab][aria-selected=true]").textContent, "找入口");
	assert.match(view.find("[data-sub-total]").textContent ?? "", /合计 2\.0k · \$0\.03/);
	await view.unmount();
});

test("one sub-agent needs no chooser", async () => {
	const view = await mount(h(SubAgentRoster, { agents: [summary({ id: "只有一个", tokens: 500 })], current: null, onFocus: () => {} }));
	assert.equal(view.text(), "", "the header above the transcript already says everything the strip would");
	await view.unmount();
});

test("a dispatch below the main conversation turns the strip into an indented tree", async () => {
	const focused: string[] = [];
	const view = await mount(
		h(SubAgentRoster, {
			agents: [
				summary({ id: "boss", agent: "orchestrator", tokens: 1000, cost: 0.1 }),
				summary({ id: "leaf", agent: "explore", parentId: "boss", depth: 2, tokens: 500, cost: 0.05, startedAt: 1500 }),
				summary({ id: "other", tokens: 200, cost: 0.02, startedAt: 1800 }),
			],
			current: "leaf",
			onFocus: (id) => focused.push(id),
		}),
	);
	assert.ok(view.find("[role=tree]"));
	assert.equal(view.all("[role=tablist]").length, 0);

	const rows = view.all<HTMLElement>("[role=treeitem]");
	assert.deepEqual(
		rows.map((row) => [row.dataset.subTab, row.getAttribute("aria-level")]),
		[
			["boss", "1"],
			["leaf", "2"],
			["other", "1"],
		],
		"parents before children, and the level says who asked",
	);
	const indent = (row: HTMLElement) => Number.parseFloat(row.style.paddingLeft);
	assert.ok(indent(rows[1]) > indent(rows[0]), `the child is drawn further in: ${indent(rows[1])} vs ${indent(rows[0])}`);
	assert.equal(indent(rows[2]), indent(rows[0]), "a second root sits level with the first");

	// The root's figure is the branch's — what dispatching it cost — not its own share.
	assert.match(rows[0].querySelector("[data-sub-figures]")?.textContent ?? "", /1\.5k · \$0\.15/);
	assert.match(rows[1].querySelector("[data-sub-figures]")?.textContent ?? "", /^500 · \$0\.05$/);
	assert.match(view.find("[data-sub-total]").textContent ?? "", /本次编排 · 3 个子 Agent · 1\.7k · \$0\.17/);
	assert.equal(rows[1].getAttribute("aria-selected"), "true");

	await click(rows[2].querySelector("button") as HTMLElement);
	assert.deepEqual(focused, ["other"]);
	await view.unmount();
});

test("a fraction of a cent is 「<$0.01」, not 「$0.00」 — cheap is not free either", async () => {
	const view = await mount(
		h(SubAgentRoster, {
			agents: [summary({ id: "a", tokens: 3000, cost: 0.02 }), summary({ id: "a1", parentId: "a", depth: 2, tokens: 520, cost: 0.0018 })],
			current: null,
			onFocus: () => {},
		}),
	);
	const rows = view.all<HTMLElement>("[role=treeitem]");
	assert.match(rows[1].querySelector("[data-sub-figures]")?.textContent ?? "", /^520 · <\$0\.01$/);
	await view.unmount();
});

test("an unpriced model shows tokens and no price — unknown is not free", async () => {
	const view = await mount(
		h(SubAgentRoster, {
			agents: [summary({ id: "a", tokens: 3000 }), summary({ id: "a1", parentId: "a", depth: 2, tokens: 1000 })],
			current: null,
			onFocus: () => {},
		}),
	);
	const total = view.find("[data-sub-total]").textContent ?? "";
	assert.match(total, /4\.0k/);
	assert.ok(!total.includes("$"), `no rate, no dollar figure: ${total}`);
	await view.unmount();
});
