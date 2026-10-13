/** How a player writes a position: what a person reads under every video. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatClock } from "../src/lib/clock.ts";

test("minutes unpadded, seconds padded, hours only when there are any", () => {
	assert.equal(formatClock(0), "0:00");
	assert.equal(formatClock(5.9), "0:05", "a position is the second it is in, not the nearest");
	assert.equal(formatClock(65), "1:05");
	assert.equal(formatClock(754), "12:34");
	assert.equal(formatClock(3723), "1:02:03");
});

test("a duration not known yet reads as nothing elapsed, never NaN:NaN", () => {
	for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -3]) assert.equal(formatClock(value), "0:00");
});
