import assert from "node:assert/strict";
import { test } from "node:test";

import { paneFloor } from "../src/features/dock/geometry.ts";
import { homeOf, placePanel, viableDrops } from "../src/features/dock/place.ts";
import { defaultTree, insert, type DockNode } from "../src/features/dock/tree.ts";

/** A 2×2 tile on a 1280×860 window after the sidebar. */
const TILE = { width: 504, height: 424 };
const WIDE = { width: 1200, height: 800 };

test("a roomy dock still opens the first panel as a column", () => {
	const at = placePanel(defaultTree(), WIDE, paneFloor, "browser");
	assert.deepEqual(at, { side: "right", kind: null });
});

test("a 2×2 tile stacks the first panel under the conversation", () => {
	const at = placePanel(defaultTree(), TILE, paneFloor, "browser");
	assert.deepEqual(at, { side: "bottom", kind: "conversation" });
	const tree = insert(defaultTree(), "browser", at!);
	assert.equal(tree.type, "split");
	if (tree.type === "split") assert.equal(tree.dir, "col");
});

test("a 2×2 tile that already holds a panel has no second landing", () => {
	const first = placePanel(defaultTree(), TILE, paneFloor, "browser");
	assert.ok(first);
	const tree = insert(defaultTree(), "browser", first);
	assert.equal(placePanel(tree, TILE, paneFloor, "terminal"), null);
	assert.deepEqual(viableDrops(tree, TILE, paneFloor, "terminal"), []);
});

test("homeOf remembers the neighbour a stacked panel sits against", () => {
	const tree: DockNode = insert(defaultTree(), "browser", { side: "bottom", kind: "conversation" });
	assert.deepEqual(homeOf(tree, "browser"), { side: "bottom", kind: "conversation" });
});
