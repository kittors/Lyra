/**
 * Where a tooltip lands.
 *
 * The claim: it goes on the side it was asked for, flips when that side would run off the window,
 * and stays within both horizontal edges.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { tipPlacement } from "../src/ui/overlay/tooltip.ts";

const VIEW = { width: 1200, height: 800 };
const TIP = { width: 100, height: 24 };
const target = (top: number, left = 500, width = 40, height = 28) => ({
	top,
	bottom: top + height,
	left,
	width,
	height,
});

test("a tip asked for above goes above", () => {
	const at = tipPlacement(target(400), TIP, "top", VIEW);
	assert.ok(at.top < 400, `expected above 400, got ${at.top}`);
	assert.equal(at.top, 400 - TIP.height - 6);
});

test("a tip asked for below goes below", () => {
	const at = tipPlacement(target(400), TIP, "bottom", VIEW);
	assert.equal(at.top, 428 + 6);
});

test("a bar at the bottom of the window gets its tips above it", () => {
	// The annotation toolbar: 24px clear of the bottom edge, where a bubble below would be cut off.
	const bar = target(VIEW.height - 24 - 28);
	const at = tipPlacement(bar, TIP, "top", VIEW);
	assert.ok(at.top + TIP.height < bar.top, `tip at ${at.top} overlaps the bar at ${bar.top}`);
	assert.ok(at.top > 0, "and is still on screen");
});

test("the preferred side is abandoned when it does not fit", () => {
	// Hard against the top: "above" has nowhere to go, so it flips below.
	const at = tipPlacement(target(2), TIP, "top", VIEW);
	assert.ok(at.top > 2, `expected a flip below, got ${at.top}`);

	// Hard against the bottom: "below" has nowhere to go, so it flips above.
	const low = target(VIEW.height - 30);
	const flipped = tipPlacement(low, TIP, "bottom", VIEW);
	assert.ok(flipped.top < low.top, `expected a flip above, got ${flipped.top}`);
});

test("the tip is centred on its target", () => {
	const at = tipPlacement(target(400, 500, 40), TIP, "bottom", VIEW);
	assert.equal(at.left + TIP.width / 2, 500 + 20, "centres match");
});

test("but never past either edge of the window", () => {
	assert.ok(tipPlacement(target(400, 0, 20), TIP, "bottom", VIEW).left >= 6, "left edge");
	const right = tipPlacement(target(400, VIEW.width - 20, 20), TIP, "bottom", VIEW);
	assert.ok(right.left + TIP.width <= VIEW.width - 6, `right edge, got ${right.left}`);
});

test("a multiline tip that fits neither side stays inside the viewport", () => {
	const view = { width: 300, height: 220 };
	const tip = { width: 288, height: 200 };
	for (const side of ["top", "bottom"] as const) {
		const at = tipPlacement(target(90, 280), tip, side, view);
		assert.ok(at.top >= 6);
		assert.ok(at.top + tip.height <= view.height - 6);
		assert.ok(at.left >= 6);
	}
});

test("beside a button in a column, centred on it, and to its left when the right has no room", () => {
	// The icon rail: a 32px button 8px in from the window's left edge.
	const rail = target(100, 8, 32, 32);
	const at = tipPlacement(rail, TIP, "right", VIEW);
	assert.ok(at.left >= 8 + 32, `starts right of the button, got ${at.left}`);
	assert.equal(at.top + TIP.height / 2, 100 + 16, "vertically centred on it");
	const edge = tipPlacement(target(100, VIEW.width - 40, 32), TIP, "right", VIEW);
	assert.ok(edge.left + TIP.width <= VIEW.width - 40, `falls back to the left, got ${edge.left}`);
});
