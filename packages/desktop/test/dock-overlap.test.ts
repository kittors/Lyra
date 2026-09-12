/**
 * What a row does when it genuinely cannot hold its panes' floors.
 *
 * The reported fault: a third panel in a dock about eight hundred points wide, and the whole
 * arrangement replaced by a column of full-width strips that could not be dragged back — because
 * the flattening was re-derived on every render.
 *
 * The old code had two answers and both lost the layout. Turn the row on its side, which is the
 * column of strips. Or, when neither axis fits, divide what there is in proportion to the floors —
 * which puts *every* pane below its own minimum: a 420pt conversation drawn at 320 breaks its words
 * one per line, and the terminal beside it wraps its own prompt.
 *
 * The answer here is the one the reference does. Every pane keeps its floor except the first, whose
 * box absorbs the shortfall; a `min-width` then draws that pane at its floor anyway, so it extends
 * past its box and the pane beside it covers the overhang. The conversation stays laid out at the
 * width it says it is and has its right-hand side covered, rather than reflowing.
 *
 * These tests are about the *boxes*. That the first pane is then drawn wider than its box is CSS,
 * and is verified in a real window — see `e2e/dock-overlap-probe.ts`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { CONVERSATION_MIN_WIDTH_PX, PANEL_MIN_WIDTH_PX, paneFloor } from "../src/features/dock/geometry.ts";
import { fitTree, layoutPanes } from "../src/features/dock/layout.ts";
import { leafOf, type DockNode } from "../src/features/dock/tree.ts";

const leaf = (kind: string): DockNode => leafOf(kind as never);

const split = (dir: "row" | "col", children: DockNode[], sizes?: number[]): DockNode => ({
	type: "split",
	dir,
	children,
	sizes: sizes ?? children.map(() => 1 / children.length),
});

/** The layout `defaultDrop` builds from n panels opened one after another beside a conversation. */
const opened = (...panels: string[]): DockNode => {
	const columns: DockNode[] = [];
	for (let i = 0; i < panels.length; i += 2) {
		const pair = panels.slice(i, i + 2).map(leaf);
		columns.push(pair.length === 1 ? pair[0] : split("col", pair));
	}
	return split("row", [leaf("conversation"), ...columns]);
};

/** Boxes in pixels, keyed by kind, of a tree fitted into a span. */
function drawn(tree: DockNode, span: { width: number; height: number }) {
	const fitted = fitTree(tree, span, paneFloor);
	const boxes = layoutPanes(fitted).map((pane) => ({
		kind: pane.kind,
		left: pane.left * span.width,
		width: pane.width * span.width,
		top: pane.top * span.height,
		height: pane.height * span.height,
	}));
	return { fitted, boxes, of: (kind: string) => boxes.find((box) => box.kind === kind)! };
}

/*
 * The reported case.
 *
 * A dock 792 wide — a 2000px window on a retina panel, less the sidebar — with three panels opened
 * from the menu. `defaultDrop` puts the first two in a column and starts a second column with the
 * third, so the row needs 420 + 300 + 300 = 1020 across and has 792.
 */
const REPORTED = { width: 792, height: 900 };

test("the row keeps its shape: no rotation, and the panels keep their floors", () => {
	const { fitted, of } = drawn(opened("browser", "terminal", "git"), REPORTED);

	assert.equal(fitted.type === "split" && fitted.dir, "row", "still side by side, not a column of strips");

	// The panels are at their floors, exactly — the row cannot give them more and will not give less.
	assert.ok(Math.abs(of("browser").width - PANEL_MIN_WIDTH_PX) < 0.5, `browser ${of("browser").width}`);
	assert.ok(Math.abs(of("git").width - PANEL_MIN_WIDTH_PX) < 0.5, `git ${of("git").width}`);
	// And full height, rather than one row of a stack.
	assert.ok(Math.abs(of("git").height - REPORTED.height) < 0.5, "a panel column runs the dock's height");
});

test("the conversation's box absorbs the shortfall, and it is the only one that does", () => {
	const { of } = drawn(opened("browser", "terminal", "git"), REPORTED);
	const conversation = of("conversation");

	// 792 − 300 − 300: what is left once everyone else has their floor.
	assert.ok(Math.abs(conversation.width - 192) < 0.5, `conversation box ${conversation.width}`);
	assert.ok(
		conversation.width < CONVERSATION_MIN_WIDTH_PX,
		"its box is below its floor — the min-width is what draws it wider",
	);
	assert.equal(conversation.left, 0, "and it starts at the left edge, where it is covered from");
});

test("the row still adds up to the row, which is what keeps everything downstream honest", () => {
	const { boxes } = drawn(opened("browser", "terminal", "git"), REPORTED);
	// The top-level children, not the leaves: `browser` and `terminal` share a column.
	const columns = [boxes.find((b) => b.kind === "conversation")!, boxes.find((b) => b.kind === "browser")!, boxes.find((b) => b.kind === "git")!];
	const total = columns.reduce((sum, box) => sum + box.width, 0);
	assert.ok(Math.abs(total - REPORTED.width) < 0.5, `adds up to ${total}, dock is ${REPORTED.width}`);

	// No gaps and no double-counting: each column starts where the last one ended.
	assert.ok(Math.abs(columns[1].left - columns[0].width) < 0.5, "the first panel column starts where the conversation's box ends");
	assert.ok(Math.abs(columns[2].left + columns[2].width - REPORTED.width) < 0.5, "and the last one reaches the right edge");
});

test("how much of the conversation is covered is exactly how much the row overflowed", () => {
	const { of } = drawn(opened("browser", "terminal", "git"), REPORTED);
	const box = of("conversation").width;
	// Drawn at its floor by `min-width`; the difference is the overhang the next pane covers.
	const covered = CONVERSATION_MIN_WIDTH_PX - box;
	const overflow = CONVERSATION_MIN_WIDTH_PX + PANEL_MIN_WIDTH_PX * 2 - REPORTED.width;
	assert.ok(Math.abs(covered - overflow) < 0.5, `covered ${covered}, overflowed ${overflow}`);
});

test("a dock with room for the arrangement is not touched at all", () => {
	const tree = opened("browser", "terminal", "git");
	const wide = { width: 1600, height: 900 };
	const { of } = drawn(tree, wide);
	// Every pane at or above its floor, and the shares left exactly as stored — the ordinary case,
	// which must not change because the cramped one did. (This tree is built with even shares, so
	// "the conversation is widest" is not a property of it; `dock-open.test.ts` covers what
	// `defaultDrop` actually hands out.)
	assert.ok(of("conversation").width >= CONVERSATION_MIN_WIDTH_PX);
	assert.ok(of("browser").width >= PANEL_MIN_WIDTH_PX);
	assert.ok(of("git").width >= PANEL_MIN_WIDTH_PX);
	const columns = ["conversation", "browser", "git"].map((kind) => of(kind).width);
	assert.ok(Math.abs(columns.reduce((a, b) => a + b, 0) - wide.width) < 0.5, "and the row adds up");
});

test("a column never overlaps: that would cover a composer or a title bar", () => {
	/*
	 * Four panes stacked in a dock too short for their floors — 260 + 150×3 = 710 against 500.
	 *
	 * Overlapping here would hide either the conversation's composer or the next pane's title bar,
	 * and those are the controls you would need in order to undo it. So a column falls back to
	 * dividing what there is, which is the old behaviour and the right one on this axis.
	 */
	const column = split("col", [leaf("conversation"), leaf("browser"), leaf("terminal"), leaf("git")]);
	const span = { width: 1200, height: 500 };
	const { boxes } = drawn(column, span);

	const total = boxes.reduce((sum, box) => sum + box.height, 0);
	assert.ok(Math.abs(total - span.height) < 0.5, `the column adds up, got ${total}`);
	for (const box of boxes) assert.ok(box.height > 0, `${box.kind} is still on screen`);
	// Stacked in order with no overlap: each one starts where the last ended.
	const sorted = [...boxes].sort((a, b) => a.top - b.top);
	for (let i = 1; i < sorted.length; i++) {
		assert.ok(
			sorted[i].top >= sorted[i - 1].top + sorted[i - 1].height - 0.5,
			`${sorted[i].kind} overlaps ${sorted[i - 1].kind}`,
		);
	}
});

test("when even the panes after the first will not fit, the row divides rather than overflowing", () => {
	/*
	 * Three panels beside the conversation in a dock of 700: the panels alone need 900.
	 *
	 * There is no overhang that helps here — the first pane's box would have to be negative, and the
	 * panes after it would be pushed off the right-hand end, which is worse than being narrow. So
	 * this is the one case that still divides what there is.
	 */
	const span = { width: 700, height: 900 };
	const { boxes } = drawn(opened("browser", "terminal", "git", "editor", "files"), span);
	const columns = ["conversation", "browser", "git", "files"].map((kind) => boxes.find((b) => b.kind === kind)!);
	const total = columns.reduce((sum, box) => sum + box.width, 0);
	assert.ok(Math.abs(total - span.width) < 0.5, `still adds up, got ${total}`);
	for (const box of columns) assert.ok(box.width > 0, `${box.kind} is still on screen`);
	assert.ok(
		columns[0].width > columns[1].width,
		"and the conversation still gets the largest piece, its floor being the largest",
	);
});

test("the overlap is re-derived from the size, so widening gives the layout straight back", () => {
	const tree = opened("browser", "terminal", "git");
	const saved = structuredClone(tree);

	drawn(tree, REPORTED);
	assert.deepEqual(tree, saved, "the stored tree is never rewritten by what the window can hold");

	const { of } = drawn(tree, { width: 1600, height: 900 });
	assert.ok(of("conversation").width >= CONVERSATION_MIN_WIDTH_PX, "and the room comes back on its own");
});
