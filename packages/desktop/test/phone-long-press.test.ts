/**
 * Telling a long press apart from a tap and from a scroll — the phone's replacement for hover.
 *
 * A finger that lands on a row is all three for its first few hundred milliseconds. Each wrong
 * verdict is felt: a scroll that pops a menu, a tap that waits, a hold that opens the conversation
 * instead of its menu. The recogniser is pure, so the timing cases can be stated rather than waited
 * for.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { drift, hold, HOLD_MS, ripe, SLOP } from "../src/mobile/long-press.ts";

test("a finger held still past the threshold is a long press", () => {
	const press = hold({ x: 100, y: 200, t: 0 });
	assert.equal(ripe(press, HOLD_MS - 1), false, "差一毫秒还不算");
	assert.equal(ripe(press, HOLD_MS), true);
});

test("the wobble of a resting thumb does not cancel it", () => {
	let press = hold({ x: 100, y: 200, t: 0 });
	press = drift(press, { x: 104, y: 205, t: 80 });
	press = drift(press, { x: 97, y: 196, t: 160 });
	assert.equal(press.cancelled, false);
	assert.equal(ripe(press, HOLD_MS), true);
});

test("moving past the slop is a scroll or a drag, and the press never comes back", () => {
	let press = hold({ x: 100, y: 200, t: 0 });
	press = drift(press, { x: 100, y: 200 + SLOP + 1, t: 60 });
	assert.equal(press.cancelled, true, "竖着滑出阈值就是在滚动");
	// Drifting back to where it started does not revive it: the gesture was decided.
	press = drift(press, { x: 100, y: 200, t: 120 });
	assert.equal(press.cancelled, true);
	assert.equal(ripe(press, HOLD_MS * 2), false);
});

test("the slop is a distance, not a per-axis allowance", () => {
	// Seven across and seven down is under ten on each axis and just under ten overall.
	const inside = drift(hold({ x: 0, y: 0, t: 0 }), { x: 7, y: 7, t: 10 });
	assert.equal(inside.cancelled, false);
	// Eight and eight is over ten along the diagonal, though under it on either axis alone.
	const outside = drift(hold({ x: 0, y: 0, t: 0 }), { x: 8, y: 8, t: 10 });
	assert.equal(outside.cancelled, true);
});

test("once it has fired it does not fire again, and movement no longer cancels it", () => {
	const fired = { ...hold({ x: 0, y: 0, t: 0 }), fired: true };
	assert.equal(ripe(fired, HOLD_MS * 3), false, "只触发一次");
	// The menu is up under the finger; the finger wandering is reading the menu, not cancelling.
	assert.equal(drift(fired, { x: 80, y: 80, t: 900 }).cancelled, false);
});

test("the threshold sits between a tap and the system's own long press", () => {
	// Taps land and lift in about a tenth of a second; iOS opens its own menus at about half.
	assert.ok(HOLD_MS > 250 && HOLD_MS < 500, `HOLD_MS=${HOLD_MS}`);
});
