/**
 * How a squeeze is shared out.
 *
 * The behaviour this pins down took several attempts to get right, and every wrong version looked
 * plausible in code: the conversation growing past its box and hiding under a panel, a merely-narrow
 * panel doing the same to the conversation, a boundary that simply stopped responding once a floor
 * was reached. What should happen is none of those — the squeeze moves *onward* to whoever still
 * has room, and the row always adds up to the row.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { CONVERSATION_MIN_WIDTH_PX, PANEL_MIN_WIDTH_PX, paneFloor } from "../src/features/dock/geometry.ts";
import { fitTree, layoutPanes } from "../src/features/dock/layout.ts";
import { leafOf, type DockNode } from "../src/features/dock/tree.ts";

/** A row of leaves at the given shares. */
const row = (kinds: string[], sizes: number[]): DockNode => ({
	type: "split",
	dir: "row",
	children: kinds.map((kind) => leafOf(kind as never)),
	sizes,
});

/** Widths in pixels, keyed by kind, of a tree fitted into a box. */
function widths(tree: DockNode, width: number, height = 900): Record<string, number> {
	const fitted = fitTree(tree, { width, height }, paneFloor);
	const out: Record<string, number> = {};
	for (const pane of layoutPanes(fitted)) out[pane.kind] = pane.width * width;
	return out;
}

test("a layout that already fits is left exactly as it is", () => {
	const tree = row(["browser", "conversation", "terminal"], [0.25, 0.5, 0.25]);
	const got = widths(tree, 1600);
	assert.ok(Math.abs(got.browser - 400) < 0.01);
	assert.ok(Math.abs(got.conversation - 800) < 0.01);
	assert.ok(Math.abs(got.terminal - 400) < 0.01);
});

test("squeezing the conversation past its floor takes the room from the other panel instead", () => {
	// The conversation has been dragged down to 5% — far below what it can be read at.
	const tree = row(["browser", "conversation", "terminal"], [0.6, 0.05, 0.35]);
	const got = widths(tree, 1600);

	assert.ok(
		got.conversation >= CONVERSATION_MIN_WIDTH_PX - 0.5,
		`the conversation kept its floor, got ${Math.round(got.conversation)}`,
	);
	// And the total is still the total: nothing overflowed, the room moved.
	const total = got.browser + got.conversation + got.terminal;
	assert.ok(Math.abs(total - 1600) < 0.5, `widths still add up, got ${Math.round(total)}`);
	// The panels gave way in proportion to what they had spare, rather than one of them alone.
	assert.ok(got.browser > got.terminal, "the panel that had more to spare gave up more");
});

test("panels have a floor too, so a squeeze cannot erase one", () => {
	const tree = row(["browser", "conversation"], [0.02, 0.98]);
	const got = widths(tree, 1600);
	assert.ok(got.browser >= PANEL_MIN_WIDTH_PX - 0.5, `the panel kept its floor, got ${Math.round(got.browser)}`);
	assert.ok(Math.abs(got.browser + got.conversation - 1600) < 0.5);
});

test("the conversation outranks the panels: they reach their floors first", () => {
	/*
	 * A window with room for every floor and nothing to spare beyond it, and shares that would
	 * have starved the conversation. Sized from the constants rather than a literal, so raising a
	 * floor changes the window this is measured in rather than quietly invalidating the premise.
	 */
	const span = CONVERSATION_MIN_WIDTH_PX + PANEL_MIN_WIDTH_PX * 2 + 80;
	const tree = row(["browser", "conversation", "terminal"], [0.45, 0.1, 0.45]);
	const got = widths(tree, span);
	assert.ok(got.conversation >= CONVERSATION_MIN_WIDTH_PX - 0.5, "the conversation is whole");
	assert.ok(got.browser >= PANEL_MIN_WIDTH_PX - 0.5, "and both panels are still usable");
	assert.ok(got.terminal >= PANEL_MIN_WIDTH_PX - 0.5);
	assert.ok(Math.abs(got.browser + got.conversation + got.terminal - span) < 0.5);
});

test("a window too small for every floor divides what there is rather than overflowing", () => {
	// Deliberately below the sum of the floors, so the fallback is what is under test.
	const span = (CONVERSATION_MIN_WIDTH_PX + PANEL_MIN_WIDTH_PX * 2) * 0.7;
	const tree = row(["browser", "conversation", "terminal"], [0.33, 0.34, 0.33]);
	const got = widths(tree, span);
	const total = got.browser + got.conversation + got.terminal;
	assert.ok(Math.abs(total - span) < 0.5, `still adds up, got ${Math.round(total)}`);
	for (const [kind, width] of Object.entries(got)) assert.ok(width > 0, `${kind} is still on screen`);
	// Shared out in proportion to the floors, so the conversation still gets the largest piece.
	assert.ok(got.conversation > got.browser && got.conversation > got.terminal);
});

test("nested splits are fitted inside the room their parent actually got", () => {
	const tree: DockNode = {
		type: "split",
		dir: "row",
		children: [
			leafOf("conversation"),
			{ type: "split", dir: "col", children: [leafOf("browser"), leafOf("terminal")], sizes: [0.5, 0.5] },
		],
		sizes: [0.05, 0.95],
	};
	const fitted = fitTree(tree, { width: 1600, height: 900 }, paneFloor);
	const boxes = layoutPanes(fitted);
	const conversation = boxes.find((box) => box.kind === "conversation")!;
	const browser = boxes.find((box) => box.kind === "browser")!;

	assert.ok(conversation.width * 1600 >= CONVERSATION_MIN_WIDTH_PX - 0.5, "the conversation kept its floor");
	// The column beside it kept the rest, and its own children still split that rest evenly.
	assert.ok(Math.abs((conversation.width + browser.width) * 1600 - 1600) < 0.5, "and the row still adds up");
});

test("a box with no area is left alone rather than divided by zero", () => {
	const tree = row(["conversation", "browser"], [0.5, 0.5]);
	assert.deepEqual(fitTree(tree, { width: 0, height: 0 }, paneFloor), tree);
});
