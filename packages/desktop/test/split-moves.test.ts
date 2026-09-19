import assert from "node:assert/strict";
import { test } from "node:test";
import { appendColumn, moveSplit, splitMoves, type MoveName } from "../src/features/split/moves.ts";
import { leafCount, leafOf, sessionIds, type SplitNode } from "../src/features/split/tree.ts";
import { layoutPanes } from "../src/features/split/layout.ts";
import { assignPaneKeys } from "../src/features/split/pane-key.ts";

function move(tree: SplitNode, id: string, name: MoveName): SplitNode {
	const option = splitMoves(tree, id).find((item) => item.name === name);
	assert.ok(option, `${id} has no ${name} destination`);
	const result = moveSplit(tree, id, option);
	assert.deepEqual(sessionIds(result).sort(), sessionIds(tree).sort());
	assert.equal(leafCount(result), leafCount(tree));
	return result;
}

test("menu splits append equal columns and respect the four-session limit", () => {
	let tree: SplitNode = leafOf("a");
	for (const id of ["b", "c", "d"]) {
		const next = appendColumn(tree, id);
		assert.ok(next);
		tree = next;
	}
	assert.deepEqual(layoutPanes(tree).map(({ left, width, height }) => ({ left, width, height })), [0, 0.25, 0.5, 0.75].map((left) => ({ left, width: 0.25, height: 1 })));
	assert.equal(appendColumn(tree, "e"), null);
	assert.equal(appendColumn(leafOf("a"), "a"), null);
});

test("a conversation can stack beside, exchange rows, cross columns, and detach into a new column", () => {
	const two = appendColumn(leafOf("a"), "b");
	assert.ok(two);
	let tree = appendColumn(two, "c");
	assert.ok(tree);
	tree = move(tree, "c", "bottomLeft");
	let boxes = layoutPanes(tree);
	assert.equal(boxes.find((box) => box.sessionId === "c")?.top, 0.5);
	tree = move(tree, "c", "up");
	assert.equal(layoutPanes(tree).find((box) => box.sessionId === "c")?.top, 0);
	tree = move(tree, "c", "left");
	boxes = layoutPanes(tree);
	assert.equal(boxes.find((box) => box.sessionId === "c")?.left, 0);
	assert.equal(boxes.find((box) => box.sessionId === "c")?.top, 0);
	tree = move(tree, "c", "newColumn");
	assert.equal(layoutPanes(tree).find((box) => box.sessionId === "c")?.left, 2 / 3);
	tree = move(tree, "c", "left");
	assert.deepEqual(sessionIds(tree), ["a", "c", "b"]);
});

test("pane keys follow moved sessions while replacements reuse their cached slot", () => {
	const original = assignPaneKeys([], ["a"]);
	const added = assignPaneKeys(original, ["a", "b", "c"]);
	const moved = assignPaneKeys(added, ["c", "a", "b"]);
	for (const slot of moved) assert.equal(slot.key, added.find((item) => item.sessionId === slot.sessionId)?.key);
	const replaced = assignPaneKeys(moved, ["d", "a", "b"]);
	assert.equal(replaced[0].key, moved[0].key);
	assert.equal(new Set(replaced.map((slot) => slot.key)).size, 3);
});

test("move menus follow edge columns and a stacked right move can create a column", () => {
	const two = appendColumn(leafOf("a"), "b");
	assert.ok(two);
	assert.deepEqual(splitMoves(two, "a").map((move) => move.name), ["right", "down"]);
	assert.deepEqual(splitMoves(two, "b").map((move) => move.name), ["left", "topLeft", "bottomLeft"]);
	const stacked = move(two, "a", "down");
	assert.equal(layoutPanes(stacked).find((pane) => pane.sessionId === "a")?.top, 0.5);
	assert.deepEqual(splitMoves(stacked, "a").map((move) => move.name), ["up", "right"]);
	assert.deepEqual(sessionIds(move(stacked, "b", "right")), ["a", "b"]);
	const three = appendColumn(two, "c");
	assert.ok(three);
	assert.deepEqual(splitMoves(three, "b").map((move) => move.name), ["left", "right", "down"]);
});
