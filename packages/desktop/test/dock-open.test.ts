/**
 * Where a panel lands when it is opened from the menu rather than dragged.
 *
 * Dragging says where it goes; opening has to decide, and the decision is the whole of what the
 * layout looks like for anyone who never drags anything. Two panels share a column beside the
 * conversation, and the third starts a column of its own — stacking without limit left four panes
 * a couple of rows tall each, and opening a column every time squeezed the conversation to
 * nothing.
 *
 * `defaultDrop` paired with the `insert` it feeds, which together are what the menu does — the
 * store around them only adds persistence, and that has tests of its own. Asserted on the shape of
 * the tree, never on pixels: this is about arrangement, and the geometry is tested elsewhere.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultDrop } from "../src/features/dock/store.ts";
import { defaultTree, has, insert, kinds, remove, type DockNode, type DockSplit, type PaneKind } from "../src/features/dock/tree.ts";

/** What the panel menu does: open it where the layout says it goes, or leave it where it is. */
function open(tree: DockNode, kind: PaneKind): DockNode {
	return has(tree, kind) ? tree : insert(tree, kind, defaultDrop(tree));
}

/** Open several in the order someone would click them. */
function opened(...wanted: PaneKind[]): DockNode {
	return wanted.reduce(open, defaultTree());
}

/** The columns of the root row, as the kinds in each — which is the layout at a glance. */
function columns(tree: DockNode): PaneKind[][] {
	if (tree.type === "leaf") return [[tree.kind]];
	if (tree.dir !== "row") return [kinds(tree)];
	return tree.children.map((child) => kinds(child));
}

test("the first panel opens as a column beside the conversation", () => {
	assert.deepEqual(columns(opened("terminal")), [["conversation"], ["terminal"]]);
});

test("the second shares that column rather than taking width from the conversation", () => {
	const tree = opened("terminal", "browser");
	assert.deepEqual(columns(tree), [["conversation"], ["terminal", "browser"]]);
	const panels = (tree as DockSplit).children[1];
	assert.equal(panels.type === "split" && panels.dir, "col", "stacked, not side by side");
});

test("the third starts a column of its own", () => {
	assert.deepEqual(columns(opened("terminal", "browser", "review")), [
		["conversation"],
		["terminal", "browser"],
		["review"],
	]);
});

test("and the fourth pairs up with it, so panels arrive two to a column", () => {
	assert.deepEqual(columns(opened("terminal", "browser", "review", "tasks")), [
		["conversation"],
		["terminal", "browser"],
		["review", "tasks"],
	]);
});

test("six panels are three columns of two, not one column of six", () => {
	const wanted: PaneKind[] = ["terminal", "browser", "review", "tasks", "files", "trajectory"];
	const tree = opened(...wanted);

	const laid = columns(tree);
	assert.equal(laid.length, 4, "the conversation and three columns of panels");
	assert.deepEqual(
		laid.slice(1).map((column) => column.length),
		[2, 2, 2],
	);
	assert.deepEqual(kinds(tree).slice(1).sort(), [...wanted].sort(), "and all of them are here");
});

test("closing one leaves room in its column for the next to open into", () => {
	const tree = open(remove(opened("terminal", "browser", "review"), "review"), "tasks");

	/*
	 * `tasks` joins the column that lost `review` — which is now the last one and has room.
	 *
	 * The rule reads the column the *last* panel is in, so it follows the layout as it actually is
	 * rather than counting how many times anything has been opened.
	 */
	assert.deepEqual(columns(tree), [["conversation"], ["terminal", "browser"], ["tasks"]]);
});

test("opening one that is already there does not add a second", () => {
	assert.deepEqual(columns(opened("terminal", "browser", "terminal")), [["conversation"], ["terminal", "browser"]]);
});

test("a panel with a declared partner still lands beside it, whatever the columns are doing", () => {
	// The file goes under the tree because `files` declares it, not into the next free column.
	const tree = insert(opened("terminal", "browser", "files"), "file", { side: "bottom", kind: "files" });

	assert.deepEqual(columns(tree), [["conversation"], ["terminal", "browser"], ["files", "file"]]);
});

/**
 * Whether a pane offers a handle to drag itself by.
 *
 * `useDockDrag` already refuses to lift the only pane in the dock — there would be no layout left
 * to drop it into — but the handle was drawn regardless, so a conversation on its own carried a
 * control that did nothing when pressed and appeared whenever the pointer entered the pane.
 */
const hasGrip = (paneCount: number, compact: boolean) => !compact && paneCount > 1;

test("a lone pane has no grip: there is nowhere for it to go", () => {
	assert.equal(hasGrip(kinds(defaultTree()).length, false), false, "the default layout is one pane");
	assert.equal(hasGrip(1, false), false);
});

test("a second pane makes both of them draggable", () => {
	assert.equal(hasGrip(kinds(opened("terminal")).length, false), true);
	assert.equal(hasGrip(2, false), true);
	assert.equal(hasGrip(6, false), true);
});

test("the narrow layout has no grips at all, however many panes there are", () => {
	// One pane is shown at a time there, so a drop target is not a thing that exists.
	assert.equal(hasGrip(4, true), false);
});
