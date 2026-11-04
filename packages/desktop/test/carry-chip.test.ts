/**
 * The chip that follows a conversation carried from the sidebar flips to the pointer's other side
 * near the right and bottom edges. Fixed at the pointer's lower right, it was drawn entirely past
 * the window exactly where a side-by-side split is made — the right edge.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CHIP_GAP, carryChipAt } from "../src/features/split/carry-chip.ts";

const chip = { width: 141, height: 33 };
const viewport = { width: 1364, height: 784 };

test("in the open the chip sits below and to the right of the pointer", () => {
	assert.deepEqual(carryChipAt({ x: 600, y: 300 }, chip, viewport), { left: 600 + CHIP_GAP, top: 300 + CHIP_GAP });
});

test("at the right edge it moves to the pointer's left, inside the window", () => {
	// The measured case: the pointer 18px from the right edge of a 1364px window.
	const at = carryChipAt({ x: 1345.6, y: 406 }, chip, viewport);
	assert.equal(at.left, 1345.6 - CHIP_GAP - chip.width);
	assert.ok(at.left + chip.width <= viewport.width, "the whole chip is on screen");
	assert.equal(at.top, 406 + CHIP_GAP);
});

test("at the bottom edge it moves above the pointer", () => {
	const at = carryChipAt({ x: 600, y: 770 }, chip, viewport);
	assert.equal(at.top, 770 - CHIP_GAP - chip.height);
	assert.equal(at.left, 600 + CHIP_GAP);
});

test("in the bottom-right corner it moves both ways", () => {
	const at = carryChipAt({ x: 1360, y: 780 }, chip, viewport);
	assert.ok(at.left + chip.width < 1360 && at.top + chip.height < 780);
});
