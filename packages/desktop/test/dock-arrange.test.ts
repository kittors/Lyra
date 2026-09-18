/**
 * Conversation tiling only grows the conversation leaf's floor. The dock does not
 * rewrite itself; `fitTree` draws the stored tree against that floor.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { paneFloor } from "../src/features/dock/geometry.ts";
import { fitTree, layoutPanes } from "../src/features/dock/layout.ts";
import { leafOf, type DockNode, type PaneKind } from "../src/features/dock/tree.ts";

const row: DockNode = {
	type: "split",
	dir: "row",
	children: [leafOf("conversation"), leafOf("terminal")],
	sizes: [0.7, 0.3],
};

const floorFor = (kind: PaneKind) =>
	kind === "conversation" ? { width: 840, height: 520 } : paneFloor(kind);

test("a single chat beside a terminal is left as a row when both floors fit", () => {
	const fitted = fitTree(row, { width: 1200, height: 800 }, paneFloor);
	assert.equal(fitted.type === "split" && fitted.dir, "row");
	assert.deepEqual(row.dir, "row");
});

test("a 2×2 beside a terminal stacks when a third column would steal a floor", () => {
	const saved = structuredClone(row);
	const span = { width: 1000, height: 800 };
	const fitted = fitTree(row, span, floorFor);
	assert.equal(fitted.type === "split" && fitted.dir, "col");
	const conversation = layoutPanes(fitted).find((box) => box.kind === "conversation");
	assert.ok(conversation);
	assert.ok(conversation.width * span.width >= 840 - 0.5);
	assert.ok(conversation.height * span.height >= 520 - 0.5);
	assert.deepEqual(row, saved, "fitTree draws; it does not rewrite the stored tree");
});

test("a wide dock can keep the terminal as a column next to a 2×2", () => {
	const fitted = fitTree(row, { width: 1600, height: 800 }, floorFor);
	assert.equal(fitted.type === "split" && fitted.dir, "row");
	const conversation = layoutPanes(fitted).find((box) => box.kind === "conversation");
	assert.ok(conversation);
	assert.ok(conversation.width * 1600 >= 840 - 0.5);
});

test("a dock with no extra panes is never rewritten", () => {
	const only = leafOf("conversation");
	assert.equal(fitTree(only, { width: 800, height: 600 }, floorFor), only);
});
