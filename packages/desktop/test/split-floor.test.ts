import assert from "node:assert/strict";
import { test } from "node:test";
import {
	SCREEN_MIN_HEIGHT_PX,
	SCREEN_MIN_WIDTH_PX,
	canSplitSide,
	fitSplitTree,
	pickSplitTarget,
	preferredSide,
	resizeFloors,
	subtreeMinPx,
	viableSides,
} from "../src/features/split/geometry.ts";
import { leafOf, resize, splitLeaf } from "../src/features/split/tree.ts";
import { paneAtShare, panePixels } from "../src/features/split/hit.ts";
import { layoutPanes } from "../src/features/split/layout.ts";
import { holdSplitPersist, saveSplit, flushSplit, storageKey } from "../src/features/split/persist.ts";

test("a pane shorter than two floors cannot split on that axis", () => {
	assert.deepEqual(viableSides(900, 800).sort(), ["bottom", "left", "right", "top"]);
	assert.deepEqual(viableSides(500, 800).sort(), ["bottom", "top"]);
	assert.deepEqual(viableSides(900, 350).sort(), ["left", "right"]);
	assert.deepEqual(viableSides(400, 350), []);
	assert.equal(canSplitSide(500, 800, "left"), false);
	assert.equal(canSplitSide(500, 800, "bottom"), true);
});

test("menu split prefers the focused pane, then the largest that still fits", () => {
	const panes = [
		{ sessionId: "small", width: 400, height: 350 },
		{ sessionId: "tall", width: 500, height: 800 },
		{ sessionId: "wide", width: 900, height: 400 },
	];
	assert.deepEqual(pickSplitTarget(panes, "small"), { target: "tall", side: "bottom" });
	assert.deepEqual(pickSplitTarget(panes, "wide"), { target: "wide", side: "right" });
	assert.equal(pickSplitTarget([{ sessionId: "x", width: 400, height: 350 }], "x"), null);
	assert.equal(preferredSide(900, 400), "right");
	assert.equal(preferredSide(400, 900), null);
});

test("a 2×2 grid needs two floors on each axis", () => {
	let tree = splitLeaf(leafOf("a"), "a", "b", "right")!;
	tree = splitLeaf(tree, "a", "c", "bottom")!;
	tree = splitLeaf(tree, "b", "d", "bottom")!;
	assert.equal(subtreeMinPx(tree, "row"), SCREEN_MIN_WIDTH_PX * 2);
	assert.equal(subtreeMinPx(tree, "col"), SCREEN_MIN_HEIGHT_PX * 2);
	assert.deepEqual(
		{ width: subtreeMinPx(tree, "row"), height: subtreeMinPx(tree, "col") },
		{ width: 840, height: 520 },
	);
});

test("splitter shares cannot cross a pixel floor", () => {
	const tree = splitLeaf(leafOf("a"), "a", "b", "right")!;
	assert.equal(tree.type, "split");
	const floors = resizeFloors(tree, 0, 1000);
	assert.equal(floors.near, 0.42);
	const crushed = resize(tree, [], 0, 0.05, floors);
	assert.equal(crushed.type, "split");
	if (crushed.type === "split") {
		assert.ok(crushed.sizes[0]! >= floors.near - 1e-9);
		assert.ok(crushed.sizes[1]! >= floors.far - 1e-9);
	}
	const once = resize(tree, [], 0, 0.5, floors);
	assert.equal(resize(once, [], 0, 0.5, floors), once);
});

test("restored ratios are fitted without overwriting the user's proportions", () => {
	const tree = { type: "split" as const, dir: "row" as const, children: [leafOf("a"), leafOf("b")], sizes: [0.08, 0.92] };
	const fitted = fitSplitTree(tree, { width: 1000, height: 700 });
	assert.deepEqual(layoutPanes(fitted).map((box) => Math.round(box.width * 1000)), [420, 580]);
	assert.deepEqual(tree.sizes, [0.08, 0.92]);
});

test("a column of two chats needs twice the height of a leaf when the handle moves", () => {
	const stacked = splitLeaf(leafOf("a"), "a", "c", "bottom")!;
	const row = {
		type: "split" as const,
		dir: "row" as const,
		children: [stacked, leafOf("b")],
		sizes: [0.5, 0.5],
	};
	const floors = resizeFloors(row, 0, 1000);
	assert.equal(floors.near, floors.far);
	assert.ok(floors.near >= SCREEN_MIN_WIDTH_PX / 1000);
});

test("a pointer over a share-space tile does not need a measured pane", () => {
	const tree = splitLeaf(leafOf("a"), "a", "b", "right")!;
	const panes = layoutPanes(tree);
	const root = { left: 100, top: 50, width: 800, height: 400 };
	assert.equal(paneAtShare(panes, root, 120, 80)?.sessionId, "a");
	assert.equal(paneAtShare(panes, root, 700, 80)?.sessionId, "b");
	assert.equal(paneAtShare(panes, root, 10, 80), null);
	const pixels = panePixels(panes[0]!, root);
	assert.equal(pixels.width, 400);
	assert.equal(pixels.left, 100);
});

test("a live resize keeps the last tree until the handle is released", () => {
	const memory = new Map<string, string>();
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => memory.get(key) ?? null,
			setItem: (key: string, value: string) => {
				memory.set(key, value);
			},
			removeItem: (key: string) => {
				memory.delete(key);
			},
			key: (index: number) => [...memory.keys()][index] ?? null,
			get length() {
				return memory.size;
			},
		},
	});
	const key = storageKey("perf");
	const release = holdSplitPersist();
	saveSplit("perf", leafOf("a"), "a");
	assert.equal(memory.get(key), undefined);
	release();
	assert.ok(memory.get(key));
	flushSplit();
});
