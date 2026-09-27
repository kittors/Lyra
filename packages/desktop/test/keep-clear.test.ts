/**
 * Where a long-press menu goes, so that it never covers the row it is about.
 *
 * The phone lifts the pressed row and asks the popover to keep clear of it (`ui/overlay/keep-clear.ts`).
 * The rule is iOS's own: below if it fits, above if that fits, and when neither does the row moves up
 * to make room — a row near the bottom of the screen with a tall menu is the common case, not an
 * edge one, because the list scrolls under the thumb.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { CLEAR_GAP, placeBeside, type Rect } from "../src/ui/overlay/keep-clear.ts";

/** A 390 × 844 phone, less a 59pt status bar and a 34pt home indicator, each with 8pt of air. */
const SCREEN: Rect = { top: 67, bottom: 844 - 42, left: 12, right: 390 - 12 };
const MENU = { width: 247, height: 300 };

const row = (top: number, height = 56): Rect => ({ top, bottom: top + height, left: 12, right: 336 });

test("a row with room under it gets its menu underneath, lined up with its left edge", () => {
	const spot = placeBeside(row(200), MENU, SCREEN);
	assert.equal(spot.side, "below");
	assert.equal(spot.top, 256 + CLEAR_GAP);
	assert.equal(spot.left, 12);
	assert.equal(spot.shift, 0, "放得下就不动那一行");
});

test("a row low on the screen gets its menu above it", () => {
	const spot = placeBeside(row(600), MENU, SCREEN);
	assert.equal(spot.side, "above");
	assert.equal(spot.top + MENU.height + CLEAR_GAP, 600, "菜单的下沿停在行的上沿之上");
	assert.equal(spot.shift, 0);
});

test("with no room on either side, the row moves up and the menu takes the bottom", () => {
	const tall = { width: 247, height: 520 };
	const spot = placeBeside(row(330), tall, SCREEN);
	assert.equal(spot.side, "below");
	assert.equal(spot.top + tall.height, SCREEN.bottom, "菜单贴着底部安全区");
	// The row lands directly above the menu, by the same gap.
	assert.equal(330 + spot.shift + 56 + CLEAR_GAP, spot.top);
	assert.ok(spot.shift < 0, "行往上挪");
});

test("something taller than the screen can spare is overlapped, not pushed off it", () => {
	const reply: Rect = { top: 80, bottom: 780, left: 16, right: 374 };
	const spot = placeBeside(reply, MENU, SCREEN);
	assert.equal(spot.side, "over");
	assert.equal(spot.shift, 0);
	assert.ok(spot.top >= SCREEN.top && spot.top + MENU.height <= SCREEN.bottom, "菜单完整地在屏内");
});

test("a sent message's menu lines up with its right edge, where the bubble is", () => {
	const bubble: Rect = { top: 200, bottom: 260, left: 150, right: 374 };
	const spot = placeBeside(bubble, MENU, SCREEN);
	assert.equal(spot.left + MENU.width, 374);
});

test("a menu wider than the space left of the edge it aligns to is clamped inside the screen", () => {
	const spot = placeBeside({ top: 200, bottom: 256, left: 300, right: 330 }, MENU, SCREEN);
	assert.ok(spot.left >= SCREEN.left);
	assert.ok(spot.left + MENU.width <= SCREEN.right);
});

test("a menu taller than the whole screen is capped to it rather than overflowing", () => {
	const spot = placeBeside(row(300), { width: 247, height: 2000 }, SCREEN);
	assert.ok(spot.maxHeight <= SCREEN.bottom - SCREEN.top);
});
