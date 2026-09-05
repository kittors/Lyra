/**
 * The roster as a tree, and as a bill.
 *
 * Every summary names its parent; the tree is a fold over the list. What can go wrong in a fold
 * is quiet: a child filed under a parent that has been retired vanishes with it, a branch total
 * that forgets a grandchild is off by exactly the amount nobody checks, and a roster with no
 * nesting drawn as a tree is a tab strip with worse ergonomics.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { SubAgentSummary } from "@lyra/core";
import { rosterNested, rosterRows, rosterTotal, rosterTree } from "../src/store/subAgents.ts";

function summary(over: Partial<SubAgentSummary> & { id: string; tokens?: number; cost?: number }): SubAgentSummary {
	const { tokens = 0, cost = 0, ...rest } = over;
	return {
		agent: "general",
		description: rest.id,
		status: "done",
		startedAt: 1000,
		toolCalls: 0,
		depth: 1,
		usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens, cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } },
		...rest,
	};
}

test("children sit under the parent they name, in roster order", () => {
	const roots = rosterTree([
		summary({ id: "a", startedAt: 1 }),
		summary({ id: "a2", parentId: "a", depth: 2, startedAt: 3 }),
		summary({ id: "a1", parentId: "a", depth: 2, startedAt: 2, status: "running" }),
		summary({ id: "b", startedAt: 5 }),
	]);
	assert.deepEqual(
		roots.map((root) => [root.agent.id, root.children.map((child) => child.agent.id)]),
		[
			["a", ["a1", "a2"]],
			["b", []],
		],
		"running first among siblings, then by start — the same order the strip has always used",
	);
	assert.deepEqual(
		rosterRows(roots.flatMap((root) => [root.agent, ...root.children.map((child) => child.agent)])).map((row) => [row.agent.id, row.level]),
		[
			["a", 1],
			["a1", 2],
			["a2", 2],
			["b", 1],
		],
	);
});

test("an orphan becomes a root, at level 1, whatever its depth was", () => {
	// Its parent was retired from the roster; the work still happened and still cost something.
	const rows = rosterRows([summary({ id: "grandchild", parentId: "gone", depth: 3, tokens: 40 })]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].level, 1);
	assert.equal(rosterTotal([rows[0].agent]).tokens, 40);
});

test("a branch total includes grandchildren; the root's own share stays separate", () => {
	const [root] = rosterTree([
		summary({ id: "a", tokens: 1000, cost: 0.1 }),
		summary({ id: "a1", parentId: "a", depth: 2, tokens: 300, cost: 0.03 }),
		summary({ id: "a1x", parentId: "a1", depth: 3, tokens: 50, cost: 0.005 }),
	]);
	assert.deepEqual(root.own, { tokens: 1000, cost: 0.1 });
	assert.equal(root.branch.tokens, 1350);
	assert.ok(Math.abs(root.branch.cost - 0.135) < 1e-9);
	assert.equal(root.children[0].branch.tokens, 350, "the middle node's branch is itself plus its child");
});

test("the orchestration total is everything on the roster, related or not", () => {
	const total = rosterTotal([
		summary({ id: "a", tokens: 1000, cost: 0.1 }),
		summary({ id: "a1", parentId: "a", depth: 2, tokens: 300, cost: 0.03 }),
		summary({ id: "b", tokens: 200 }),
	]);
	assert.equal(total.tokens, 1500);
	assert.ok(Math.abs(total.cost - 0.13) < 1e-9);
});

test("nested means someone below the main conversation dispatched", () => {
	assert.equal(rosterNested([summary({ id: "a" }), summary({ id: "b" })]), false, "peers are a strip, not a tree");
	assert.equal(rosterNested([summary({ id: "a" }), summary({ id: "a1", parentId: "a", depth: 2 })]), true);
});
