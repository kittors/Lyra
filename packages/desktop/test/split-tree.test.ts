import assert from "node:assert/strict";
import { test } from "node:test";
import {
	MAX_PANES,
	adopt,
	canSplit,
	contains,
	defaultTree,
	evenSplit,
	firstSession,
	leafCount,
	leafOf,
	longestAxis,
	normalize,
	removeLeaf,
	replaceLeaf,
	resize,
	sessionIds,
	sift,
	splitLeaf,
} from "../src/features/split/tree.ts";
import { regionForSide, sideOf } from "../src/features/split/drop.ts";
import { isOriginPane, isTopEndPane, layoutPanes, layoutSplitters, shareFromPointer } from "../src/features/split/layout.ts";

function ids(node: ReturnType<typeof defaultTree>): string[] {
	return sessionIds(node);
}

test("longer axis: wide becomes a row, tall becomes a column", () => {
	assert.equal(longestAxis(800, 400), "row");
	assert.equal(longestAxis(400, 800), "col");
	assert.equal(longestAxis(400, 400), "row");
});

test("split puts the new pane on the aimed edge", () => {
	const right = splitLeaf(leafOf("a"), "a", "b", "right");
	assert.ok(right);
	assert.deepEqual(ids(right), ["a", "b"]);
	assert.equal(right.type, "split");
	if (right.type === "split") assert.equal(right.dir, "row");
	const left = splitLeaf(leafOf("a"), "a", "b", "left");
	assert.deepEqual(ids(left!), ["b", "a"]);
	const top = splitLeaf(leafOf("a"), "a", "b", "top");
	assert.equal(top?.type, "split");
	if (top?.type === "split") {
		assert.equal(top.dir, "col");
		assert.deepEqual(ids(top), ["b", "a"]);
	}
});

test("pointer on a pane always picks the nearest of four edges", () => {
	const box = { left: 0, top: 0, width: 400, height: 200 };
	assert.equal(sideOf(box, 20, 100), "left");
	assert.equal(sideOf(box, 380, 100), "right");
	assert.equal(sideOf(box, 200, 10), "top");
	assert.equal(sideOf(box, 200, 190), "bottom");
	assert.equal(sideOf(box, 200, 100), "left");
	assert.equal(sideOf(box, -1, 100), null);
	assert.deepEqual(regionForSide("right"), { left: 0.5, top: 0, width: 0.5, height: 1 });
});

test("refuses a fifth pane and a duplicate", () => {
	let tree = leafOf("a");
	for (const id of ["b", "c", "d"]) {
		const next = splitLeaf(tree, "a", id, "right") ?? splitLeaf(tree, ids(tree)[0] ?? "a", id, "bottom");
		assert.ok(next, `should accept ${id}`);
		tree = next;
	}
	assert.equal(leafCount(tree), MAX_PANES);
	assert.equal(canSplit(tree), false);
	assert.equal(splitLeaf(tree, "a", "e", "right"), null);
	assert.equal(splitLeaf(leafOf("a"), "a", "a", "right"), null);
});

test("at four panes, replace swaps the target and keeps the count", () => {
	let tree = leafOf("a");
	tree = splitLeaf(tree, "a", "b", "right")!;
	tree = splitLeaf(tree, "a", "c", "bottom")!;
	tree = splitLeaf(tree, "b", "d", "bottom")!;
	assert.equal(leafCount(tree), 4);
	const next = replaceLeaf(tree, "c", "e");
	assert.equal(leafCount(next), 4);
	assert.ok(contains(next, "e"));
	assert.equal(contains(next, "c"), false);
	assert.deepEqual(replaceLeaf(next, "e", "a"), next);
});

test("close prunes and flattens until one pane remains", () => {
	let tree = leafOf("a");
	tree = splitLeaf(tree, "a", "b", "right")!;
	tree = splitLeaf(tree, "b", "c", "bottom")!;
	tree = removeLeaf(tree, "b");
	assert.equal(leafCount(tree), 2);
	assert.equal(contains(tree, "b"), false);
	tree = removeLeaf(tree, "c");
	assert.equal(tree, removeLeaf(tree, "a"));
	assert.deepEqual(tree, leafOf("a"));
});

test("normalize collapses a one-child split and same-axis nesting", () => {
	const nested = normalize({
		type: "split",
		dir: "row",
		children: [
			{
				type: "split",
				dir: "row",
				children: [leafOf("a"), leafOf("b")],
				sizes: [0.5, 0.5],
			},
			leafOf("c"),
		],
		sizes: [0.5, 0.5],
	});
	assert.equal(nested.type, "split");
	if (nested.type === "split") {
		assert.equal(nested.dir, "row");
		assert.equal(nested.children.length, 3);
		assert.ok(Math.abs(nested.sizes.reduce((sum, n) => sum + n, 0) - 1) < 1e-6);
	}
	assert.deepEqual(normalize({ type: "split", dir: "col", children: [leafOf("x")], sizes: [1] }), leafOf("x"));
});

test("sift repairs hostile storage and adopt drops missing sessions", () => {
	assert.equal(sift(null), null);
	assert.equal(sift({ type: "leaf", sessionId: 1 }), null);
	const tree = sift({
		type: "split",
		dir: "row",
		children: [{ type: "leaf", sessionId: "keep" }, { type: "leaf", sessionId: "gone" }, { type: "nope" }],
		sizes: [0.4, 0.6],
	});
	assert.ok(tree);
	const adopted = adopt(tree, new Set(["keep"]));
	assert.deepEqual(adopted, leafOf("keep"));
	assert.deepEqual(adopt(defaultTree(), new Set()), defaultTree());
});

test("resize trades a pair of shares without touching the rest", () => {
	const tree = {
		type: "split" as const,
		dir: "row" as const,
		children: [leafOf("a"), leafOf("b"), leafOf("c")],
		sizes: [0.3, 0.3, 0.4],
	};
	const moved = resize(tree, [], 0, 0.5);
	assert.equal(moved.type, "split");
	if (moved.type === "split") {
		assert.ok(Math.abs(moved.sizes[0]! + moved.sizes[1]! - 0.6) < 1e-6);
		assert.equal(moved.sizes[2], 0.4);
	}
	const even = evenSplit(tree, [], 0);
	if (even.type === "split") {
		assert.equal(even.sizes[0], 0.3);
		assert.equal(even.sizes[1], 0.3);
	}
});

test("independent screens keep their own origin and trailing-top corners", () => {
	const row = splitLeaf(leafOf("a"), "a", "b", "right")!;
	const two = layoutPanes(row);
	assert.equal(isOriginPane(two[0]!), true);
	assert.equal(isTopEndPane(two[0]!), false);
	assert.equal(isOriginPane(two[1]!), false);
	assert.equal(isTopEndPane(two[1]!), true);
	const stacked = splitLeaf(leafOf("a"), "a", "b", "bottom")!;
	const col = layoutPanes(stacked);
	assert.equal(isOriginPane(col[0]!), true);
	assert.equal(isTopEndPane(col[0]!), true);
	assert.equal(isOriginPane(col[1]!), false);
	assert.equal(isTopEndPane(col[1]!), false);
});

test("layout tiles to 1 and splitters sit on the seams", () => {
	const tree = splitLeaf(leafOf("a"), "a", "b", "right")!;
	const panes = layoutPanes(tree);
	assert.equal(panes.length, 2);
	assert.ok(Math.abs(panes[0]!.width + panes[1]!.width - 1) < 1e-6);
	const handles = layoutSplitters(tree);
	assert.equal(handles.length, 1);
	assert.equal(handles[0]!.dir, "row");
	const share = shareFromPointer(handles[0]!, 500, { left: 0, top: 0, width: 1000, height: 800 });
	assert.ok(share > 0.4 && share < 0.6);
});

test("four tiled panes fill the unit square without overlapping", () => {
	let tree = splitLeaf(leafOf("a"), "a", "b", "right")!;
	tree = splitLeaf(tree, "a", "c", "bottom")!;
	tree = splitLeaf(tree, "b", "d", "bottom")!;
	const panes = layoutPanes(tree);
	assert.equal(panes.length, 4);
	const area = panes.reduce((sum, pane) => sum + pane.width * pane.height, 0);
	assert.ok(Math.abs(area - 1) < 1e-6, `area ${area}`);
	for (let i = 0; i < panes.length; i++) {
		for (let j = i + 1; j < panes.length; j++) {
			const a = panes[i]!;
			const b = panes[j]!;
			const overlap =
				a.left + a.width - 1e-9 > b.left &&
				b.left + b.width - 1e-9 > a.left &&
				a.top + a.height - 1e-9 > b.top &&
				b.top + b.height - 1e-9 > a.top;
			assert.equal(overlap, false, `${a.sessionId} overlaps ${b.sessionId}`);
		}
	}
});

test("a thousand split/close cycles stay at most four panes and keep a valid tree", () => {
	const started = Date.now();
	let tree = leafOf("s0");
	for (let i = 1; i <= 1000; i++) {
		const incoming = `s${i}`;
		const target = firstSession(tree);
		const next = splitLeaf(tree, target, incoming, i % 2 === 0 ? "right" : "bottom");
		tree = next ?? replaceLeaf(tree, target, incoming);
		assert.ok(leafCount(tree) <= MAX_PANES);
		if (i % 7 === 0 && leafCount(tree) > 1) {
			const victim = sessionIds(tree)[0]!;
			tree = removeLeaf(tree, victim);
		}
	}
	assert.ok(leafCount(tree) >= 1 && leafCount(tree) <= MAX_PANES);
	assert.ok(Date.now() - started < 1000, `1000 cycles took ${Date.now() - started}ms`);
});
