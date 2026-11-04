/**
 * When a screen is too small for its panels as arranged, the dock draws them as tabs (`crowded`).
 *
 * A window snapped to half of a 1920px screen at 125% on Windows drew a conversation and three panels
 * as four 150px strips — `fitTree` had turned the two columns into one to clear the floors — with the
 * side chat's send button below its bottom edge. Its floor is now tall enough for its composer.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { paneFloor } from "../src/features/dock/geometry.ts";
import { crowded, fitTree } from "../src/features/dock/layout.ts";
import { leafOf, type DockNode } from "../src/features/dock/tree.ts";

const row = (children: DockNode[]): DockNode => ({ type: "split", dir: "row", children, sizes: children.map(() => 1 / children.length) });
const col = (children: DockNode[]): DockNode => ({ type: "split", dir: "col", children, sizes: children.map(() => 1 / children.length) });
const check = (tree: DockNode, span: { width: number; height: number }) => crowded(tree, fitTree(tree, span, paneFloor), span, paneFloor);

const fourPanes = row([col([leafOf("conversation"), leafOf("terminal")]), col([leafOf("review"), leafOf("chat")])]);

test("the half-screen case: two columns turned into a stack of four is crowded", () => {
	assert.equal(check(fourPanes, { width: 712, height: 784 }), true);
});

test("the same four panes in a full window are not", () => {
	assert.equal(check(fourPanes, { width: 1400, height: 840 }), false);
});

test("a conversation and a terminal turned into a column is not crowded — two stack fine", () => {
	assert.equal(check(row([leafOf("conversation"), leafOf("terminal")]), { width: 600, height: 784 }), false);
});

test("three in a column that the user arranged is theirs, not crowded", () => {
	const theirs = row([leafOf("conversation"), col([leafOf("terminal"), leafOf("review"), leafOf("tasks")])]);
	assert.equal(check(theirs, { width: 1200, height: 800 }), false);
});

test("a tree that cannot clear its floors either way is crowded", () => {
	assert.equal(check(row([leafOf("conversation"), leafOf("chat")]), { width: 700, height: 400 }), true);
});

test("the side chat's floor is tall enough for its header and an empty composer", () => {
	assert.ok(paneFloor("chat").height >= 220);
	assert.equal(paneFloor("terminal").height, 150, "other panels keep theirs");
});
