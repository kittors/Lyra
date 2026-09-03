/**
 * The dock's five invariants, and the operations that have to keep them.
 *
 * These are worth stating as tests rather than as comments because every one of them is invisible
 * until it is violated, and then it is catastrophic in a way that looks like a rendering bug: a
 * split with one child draws a handle with nothing behind it, sizes that do not sum to 1 leave a
 * gap or an overlap at the far edge, and a duplicated kind mounts a terminal twice and kills one
 * of the shells.
 *
 * `invariants()` runs after every mutation in this file, so a rule broken anywhere is caught
 * everywhere rather than only by the test that happened to be looking.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_FRACTION } from "../src/features/dock/geometry.ts";
import {
	defaultTree,
	has,
	insert,
	kinds,
	leafOf,
	areAdjacent,
	move,
	nodeAt,
	normalize,
	pathTo,
	pruneTo,
	remove,
	resize,
	type Axis,
	type DockNode,
	type DockSplit,
	type PaneKind,
} from "../src/features/dock/tree.ts";

function invariants(node: DockNode, what = "tree"): DockNode {
	const seen = new Set<PaneKind>();

	const walk = (n: DockNode, parentDir?: Axis) => {
		if (n.type === "leaf") {
			assert.ok(!seen.has(n.kind), `${what}: ${n.kind} appears twice`);
			seen.add(n.kind);
			return;
		}
		assert.ok(n.children.length >= 2, `${what}: a split with ${n.children.length} child(ren)`);
		assert.equal(n.sizes.length, n.children.length, `${what}: sizes and children disagree`);
		assert.notEqual(n.dir, parentDir, `${what}: a ${n.dir} nested directly in a ${n.dir}`);
		const sum = n.sizes.reduce((a, b) => a + b, 0);
		assert.ok(Math.abs(sum - 1) < 1e-6, `${what}: sizes sum to ${sum}`);
		/*
		 * The floor, or an even share when the floor cannot be met.
		 *
		 * Past 1/MIN_FRACTION children there is no distribution that both sums to 1 and clears
		 * the floor for everyone, so the floor is the weaker claim and gives way. Stating it as a
		 * flat `>= MIN_FRACTION` would make the invariant unsatisfiable rather than the tree wrong.
		 */
		const floor = Math.min(MIN_FRACTION, 1 / n.children.length);
		for (const share of n.sizes) {
			assert.ok(share >= floor - 1e-6, `${what}: a share of ${share} is below ${floor}`);
		}
		for (const child of n.children) walk(child, n.dir);
	};

	walk(node);
	assert.ok(seen.has("conversation"), `${what}: the conversation left the tree`);
	return node;
}

/** The share of the split at `path` that the child at `index` holds. */
function shareAt(tree: DockNode, path: number[], index: number): number {
	let node: DockNode = tree;
	for (const step of path) {
		assert.equal(node.type, "split");
		node = (node as DockSplit).children[step];
	}
	assert.equal(node.type, "split");
	return (node as DockSplit).sizes[index];
}

test("the default layout is the conversation, alone", () => {
	const tree = invariants(defaultTree());
	assert.deepEqual(tree, leafOf("conversation"));
	assert.deepEqual(kinds(tree), ["conversation"]);
});

test("dropping on a pane's edge splits that pane in half, on the axis the side implies", () => {
	const sides = [
		{ side: "right" as const, dir: "row", order: ["conversation", "terminal"] },
		{ side: "left" as const, dir: "row", order: ["terminal", "conversation"] },
		{ side: "bottom" as const, dir: "col", order: ["conversation", "terminal"] },
		{ side: "top" as const, dir: "col", order: ["terminal", "conversation"] },
	];
	for (const { side, dir, order } of sides) {
		const tree = invariants(insert(defaultTree(), "terminal", { side, kind: "conversation" }), side);
		assert.equal(tree.type, "split");
		assert.equal((tree as DockSplit).dir, dir, `${side} splits along ${dir}`);
		assert.deepEqual(kinds(tree), order, `${side} puts the new pane on the ${side}`);
		assert.deepEqual((tree as DockSplit).sizes, [0.5, 0.5], "a split is halves");
	}
});

test("dropping on the dock's own edge makes an outermost column rather than splitting a pane", () => {
	const two = insert(defaultTree(), "terminal", { side: "bottom", kind: "conversation" });
	const tree = invariants(insert(two, "review", { side: "right", kind: null }));

	// The column runs the whole height beside both of the others, so the root is a row of two:
	// the original column, then the new pane.
	assert.equal(tree.type, "split");
	const root = tree as DockSplit;
	assert.equal(root.dir, "row");
	assert.equal(root.children.length, 2);
	assert.deepEqual(kinds(tree), ["conversation", "terminal", "review"]);
	// Alongside rather than halving: the pane it joins keeps the bulk of the dock.
	assert.ok(root.sizes[0] > root.sizes[1], "the existing layout keeps the larger share");
});

test("a second drop on the dock's edge joins that outer split instead of nesting another", () => {
	let tree = insert(defaultTree(), "terminal", { side: "right", kind: null });
	tree = invariants(insert(tree, "review", { side: "right", kind: null }));

	const root = tree as DockSplit;
	assert.equal(root.children.length, 3, "three columns, not a column holding a column");
	assert.deepEqual(kinds(tree), ["conversation", "terminal", "review"]);
});

test("a pane dropped beside one in a matching split becomes a sibling, sharing that pane's space", () => {
	// chat | terminal, then review onto the right of terminal.
	let tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	tree = invariants(insert(tree, "review", { side: "right", kind: "terminal" }));

	const root = tree as DockSplit;
	assert.equal(root.children.length, 3, "one row of three, not a row holding a row");
	assert.deepEqual(kinds(tree), ["conversation", "terminal", "review"]);
	// The conversation is untouched; the two that split its neighbour share what it had.
	assert.equal(root.sizes[0], 0.5, "the pane that was not aimed at keeps its share exactly");
	assert.equal(root.sizes[1], 0.25);
	assert.equal(root.sizes[2], 0.25);
});

test("opening a kind that is already open changes nothing — one pane per kind", () => {
	const tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	const again = insert(tree, "terminal", { side: "bottom", kind: "conversation" });
	assert.equal(again, tree, "the same tree, by reference: nothing was rebuilt");
	invariants(again);
});

test("dropping against a pane that is not in the tree is refused", () => {
	const tree = defaultTree();
	assert.equal(insert(tree, "terminal", { side: "right", kind: "review" }), tree);
});

test("closing a pane gives its room to its neighbours, in proportion", () => {
	// A row of three at 50/25/25, then the middle one closes.
	let tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	tree = insert(tree, "review", { side: "right", kind: "terminal" });
	tree = invariants(remove(tree, "terminal"));

	const root = tree as DockSplit;
	assert.deepEqual(kinds(tree), ["conversation", "review"]);
	// 0.5 and 0.25 re-shared is 2:1, not 50/50 — the pane that was already larger stays larger.
	assert.ok(Math.abs(root.sizes[0] - 2 / 3) < 1e-6, `expected 2/3, got ${root.sizes[0]}`);
	assert.ok(Math.abs(root.sizes[1] - 1 / 3) < 1e-6);
});

test("closing the last pane in a split lifts its sibling up rather than leaving a split of one", () => {
	let tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	tree = invariants(remove(tree, "terminal"));
	assert.deepEqual(tree, leafOf("conversation"), "back to a bare leaf");
});

test("the conversation cannot be closed", () => {
	const tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	assert.equal(remove(tree, "conversation"), tree, "the same tree, by reference: nothing was rebuilt");
	assert.ok(has(remove(tree, "conversation"), "conversation"));
	// And it survives being the only thing there, which is the case that would empty the window.
	assert.deepEqual(remove(defaultTree(), "conversation"), leafOf("conversation"));
});

test("closing something that is not open is a no-op", () => {
	const tree = defaultTree();
	assert.equal(remove(tree, "terminal"), tree);
});

test("moving a pane keeps it, and puts it where it was aimed", () => {
	// chat | terminal, then terminal is dragged under the conversation.
	let tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	tree = invariants(move(tree, "terminal", { side: "bottom", kind: "conversation" }));

	assert.equal((tree as DockSplit).dir, "col", "it is a column now");
	assert.deepEqual(kinds(tree), ["conversation", "terminal"]);
});

test("moving a pane out of a split collapses what it leaves behind", () => {
	// chat | (terminal over review) — then review is dragged to the far left.
	let tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	tree = insert(tree, "review", { side: "bottom", kind: "terminal" });
	tree = invariants(move(tree, "review", { side: "left", kind: "conversation" }));

	// The column that held terminal and review is gone: terminal is a plain sibling again.
	assert.deepEqual(kinds(tree), ["review", "conversation", "terminal"]);
	const root = tree as DockSplit;
	assert.equal(root.dir, "row");
	assert.equal(root.children.length, 3);
	for (const child of root.children) assert.equal(child.type, "leaf");
});

test("a pane dropped on itself stays where it is", () => {
	const tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	assert.equal(move(tree, "terminal", { side: "left", kind: "terminal" }), tree);
});

test("the only pane in the dock cannot be moved out of it", () => {
	const tree = defaultTree();
	assert.equal(move(tree, "conversation", { side: "right", kind: null }), tree);
});

test("normalize flattens a same-axis nesting and keeps the proportions it implied", () => {
	// A row holding a row: chat at 0.5, and inside the other half, terminal and review at 3:1.
	const nested: DockNode = {
		type: "split",
		dir: "row",
		children: [
			leafOf("conversation"),
			{ type: "split", dir: "row", children: [leafOf("terminal"), leafOf("review")], sizes: [0.75, 0.25] },
		],
		sizes: [0.5, 0.5],
	};
	const tree = invariants(normalize(nested)!);
	const root = tree as DockSplit;
	assert.equal(root.children.length, 3, "one row of three");
	// 0.5 × 0.75 and 0.5 × 0.25: the inner ratio survives being lifted out.
	assert.deepEqual(root.sizes, [0.5, 0.375, 0.125]);
});

test("normalize repairs sizes that do not add up, and pins slivers to the floor", () => {
	const wrong: DockNode = {
		type: "split",
		dir: "row",
		children: [leafOf("conversation"), leafOf("terminal"), leafOf("review")],
		sizes: [900, 0.0001, 100],
	};
	const tree = invariants(normalize(wrong)!);
	const root = tree as DockSplit;
	assert.equal(root.sizes[1], MIN_FRACTION, "the sliver is pinned, not left invisible");
	// The other two still stand 9:1 to each other inside what is left.
	assert.ok(Math.abs(root.sizes[0] / root.sizes[2] - 9) < 1e-6);
});

test("normalize survives a split with more children than can clear the floor", () => {
	const many: DockNode = {
		type: "split",
		dir: "row",
		children: Array.from({ length: 20 }, (_, i) => leafOf((i === 0 ? "conversation" : `k${i}`) as PaneKind)),
		sizes: Array.from({ length: 20 }, () => 1),
	};
	const tree = invariants(normalize(many)!);
	const root = tree as DockSplit;
	// 20 × 8% is more than a whole, so an even split is the only distribution left.
	for (const share of root.sizes) assert.ok(Math.abs(share - 0.05) < 1e-6);
});

test("pathTo finds a pane, and misses cleanly", () => {
	let tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	tree = insert(tree, "review", { side: "bottom", kind: "terminal" });
	assert.deepEqual(pathTo(tree, "conversation"), [0]);
	assert.deepEqual(pathTo(tree, "review"), [1, 1]);
	assert.equal(pathTo(tree, "files"), null);
});

test("resizing moves one boundary and leaves every other pane alone", () => {
	// A row of three at 50/25/25.
	let tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	tree = insert(tree, "review", { side: "right", kind: "terminal" });

	const after = invariants(resize(tree, [], 0, 0.6));
	assert.equal(shareAt(after, [], 0), 0.6, "the pane being dragged got what was asked");
	// The pair traded between themselves: 0.75 − 0.6.
	assert.ok(Math.abs(shareAt(after, [], 1) - 0.15) < 1e-6);
	assert.equal(shareAt(after, [], 2), 0.25, "the pane past the handle did not move at all");
});

test("resizing stops at the floor rather than pushing a pane out of existence", () => {
	const tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	const wide = invariants(resize(tree, [], 0, 5));
	assert.ok(Math.abs(shareAt(wide, [], 0) - (1 - MIN_FRACTION)) < 1e-6);
	assert.ok(Math.abs(shareAt(wide, [], 1) - MIN_FRACTION) < 1e-6);

	const narrow = invariants(resize(tree, [], 0, -3));
	assert.ok(Math.abs(shareAt(narrow, [], 0) - MIN_FRACTION) < 1e-6);
});

test("resizing through a path that leads nowhere changes nothing", () => {
	const tree = insert(defaultTree(), "terminal", { side: "right", kind: "conversation" });
	assert.equal(resize(tree, [4, 1], 0, 0.6), tree);
	assert.equal(resize(tree, [], 7, 0.6), tree, "and neither does a handle that does not exist");
});

test("panes side by side are adjacent, even as two of three in one row", () => {
	// conversation | files | file — the shape opening a file actually produces.
	let tree = insert(defaultTree(), "files", { side: "right", kind: "conversation" });
	tree = insert(tree, "file", { side: "right", kind: "files" });
	assert.deepEqual(kinds(tree), ["conversation", "files", "file"]);
	assert.equal(areAdjacent(tree, "files", "file"), true);
	assert.equal(areAdjacent(tree, "conversation", "files"), true);
	assert.equal(areAdjacent(tree, "conversation", "file"), false, "with something in between");
});

test("panes with something between them are not adjacent", () => {
	/*
	 * Dragged apart, a declared pair is two ordinary panes. Treating them as a pair anyway would
	 * mean full screen occasionally swallowing whatever sat between them.
	 */
	let tree = insert(defaultTree(), "files", { side: "left", kind: "conversation" });
	tree = insert(tree, "file", { side: "right", kind: "conversation" });
	assert.deepEqual(kinds(tree), ["files", "conversation", "file"]);
	assert.equal(areAdjacent(tree, "files", "file"), false);
});

test("a pane is not adjacent to one that is not there", () => {
	const tree = insert(defaultTree(), "files", { side: "right", kind: "conversation" });
	assert.equal(areAdjacent(tree, "files", "file"), false);
});

test("pruning to a pair keeps their order and their proportions", () => {
	let tree = insert(defaultTree(), "files", { side: "right", kind: "conversation" });
	tree = insert(tree, "file", { side: "right", kind: "files" });
	// The file's share of the row is doubled, so the pair is 1:2 between themselves.
	tree = resize(tree, [], 1, 0.1);

	const pair = pruneTo(tree, new Set<PaneKind>(["files", "file"]));
	assert.ok(pair);
	assert.deepEqual(kinds(pair!), ["files", "file"], "the tree is still left of the file");
	const split = pair as DockSplit;
	// Re-shared to fill the dock, keeping the ratio they had between them.
	assert.ok(Math.abs(split.sizes[0] + split.sizes[1] - 1) < 1e-6);
	assert.ok(split.sizes[1] > split.sizes[0], "and the file is still the larger of the two");
});

test("pruning to one pane gives that pane, and to none gives nothing", () => {
	let tree = insert(defaultTree(), "files", { side: "right", kind: "conversation" });
	tree = insert(tree, "file", { side: "right", kind: "files" });
	assert.deepEqual(pruneTo(tree, new Set<PaneKind>(["file"])), leafOf("file"));
	assert.equal(pruneTo(tree, new Set<PaneKind>(["terminal"])), null);
});

test("nodeAt walks a path, and refuses one that leads nowhere", () => {
	const tree = insert(defaultTree(), "files", { side: "right", kind: "conversation" });
	assert.deepEqual(nodeAt(tree, [0]), leafOf("conversation"));
	assert.deepEqual(nodeAt(tree, []), tree);
	assert.equal(nodeAt(tree, [5]), null);
	assert.equal(nodeAt(tree, [0, 0]), null, "a leaf has no children to walk into");
});
