/**
 * What the composer's toolbar gives up, and when.
 *
 * The row along the bottom of the field used to decide this from its own width: `@max-[480px]`
 * dropped the context meter, `@max-[420px]` dropped the words beside the access mark. Two numbers
 * standing in for "does this fit", which they cannot be — what fits depends on the model's name,
 * and those run from `gpt-5` to `anthropic-claude-opus-4-6-20250514-extended-thinking-preview`.
 *
 * Measured on a real window: the meter was going at 479px while the two halves of the row still had
 * 54px of clear air between them, and dropping it freed another 24px that nothing then claimed,
 * because a breakpoint cannot see what its own decision made room for.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { FIT_LEVELS, MAX_FIT_LEVEL, MIN_NAME_WIDTH, nextLevel, settle, tight } from "../src/features/composer/fit.ts";

// ---------------------------------------------------------------------------
// Reading the row
// ---------------------------------------------------------------------------

test("a name with room to spare is not tight", () => {
	assert.equal(tight({ scrollWidth: 171, clientWidth: 171 }), false);
});

test("a name trimmed by a few pixels is not an emergency", () => {
	/*
	 * The specific trade that made the old behaviour wrong. On a 424px field the name was cut by
	 * 4px; giving up 「完全访问」 to avoid that handed 58px of blank space back to a row that had
	 * asked for 4. Truncation ends in an ellipsis and the chip carries the full name in its tooltip,
	 * so it costs close to nothing — and the label costs a whole label.
	 */
	assert.equal(tight({ scrollWidth: 171, clientWidth: 164 }), false);
});

test("a name cut past being readable is", () => {
	assert.equal(tight({ scrollWidth: 436, clientWidth: 71 }), true);
});

test("a short name is never tight, however narrow the row", () => {
	/*
	 * `gpt-5` is 40px wide because that is all it needs, and a rule that read "narrower than 88px"
	 * alone would report it as cramped in a field with room to spare — and take the meter away for
	 * a name that was never truncated at all.
	 */
	assert.equal(tight({ scrollWidth: 40, clientWidth: 40 }), false);
	assert.equal(tight({ scrollWidth: 40, clientWidth: 300 }), false);
});

test("a pixel of slack, so sub-pixel layout does not set the row flickering", () => {
	// A name that fits exactly can measure 171.3 against 171 and must not read as truncated.
	assert.equal(tight({ scrollWidth: 172, clientWidth: 171 }), false);
	assert.equal(tight({ scrollWidth: 173, clientWidth: 40 }), true);
});

test("nothing to measure is not tight", () => {
	// The side chat's composer has no model chip; it must simply keep everything it has.
	assert.equal(tight(null), false);
	assert.equal(tight(undefined), false);
});

// ---------------------------------------------------------------------------
// Walking down the levels
// ---------------------------------------------------------------------------

test("a row that fits gives up nothing", () => {
	assert.equal(nextLevel(FIT_LEVELS.all, false), null);
});

test("a tight row gives up the next thing, in order", () => {
	assert.equal(nextLevel(FIT_LEVELS.all, true), FIT_LEVELS.noAccessLabel);
	assert.equal(nextLevel(FIT_LEVELS.noAccessLabel, true), FIT_LEVELS.noMeter);
});

test("the words beside the access mark go before the meter does", () => {
	/*
	 * Asserted on the order rather than left to the two names, because the order *is* the decision.
	 *
	 * The meter and the model name answer questions about the reply being asked for — how much room
	 * is left, and who will answer. 「完全访问」 is a mode set once and left set, its mark is red, and
	 * its tooltip still says the word. Reading them the other way round is what made a narrow
	 * composer drop the meter while spending its width on four characters that had not changed in
	 * days.
	 */
	assert.ok(FIT_LEVELS.noAccessLabel < FIT_LEVELS.noMeter, "the label yields first");
});

test("and stops once there is nothing left to give up", () => {
	// A name too long for even the barest row is still too long; the walk must not count for ever.
	assert.equal(nextLevel(MAX_FIT_LEVEL, true), null);
});

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

/** A row whose measurements are decided in advance: `tightAt` lists the levels that do not fit. */
const rowWhere = (...tightAt: number[]) => {
	const asked: number[] = [];
	const measure = (level: number) => {
		asked.push(level);
		return tightAt.includes(level);
	};
	return { measure, asked };
};

test("a roomy row settles on showing everything", () => {
	const row = rowWhere();
	assert.equal(settle(row.measure), FIT_LEVELS.all);
	assert.deepEqual(row.asked, [FIT_LEVELS.all], "and asked once, rather than trying levels it did not need");
});

test("a row that needs the label's width stops as soon as it has it", () => {
	const row = rowWhere(FIT_LEVELS.all);
	assert.equal(settle(row.measure), FIT_LEVELS.noAccessLabel);
	assert.deepEqual(row.asked, [FIT_LEVELS.all, FIT_LEVELS.noAccessLabel]);
});

test("a row that needs more than that goes on to the meter", () => {
	const row = rowWhere(FIT_LEVELS.all, FIT_LEVELS.noAccessLabel);
	assert.equal(settle(row.measure), FIT_LEVELS.noMeter);
});

test("a row too narrow for anything settles at the barest level rather than looping", () => {
	const row = rowWhere(FIT_LEVELS.all, FIT_LEVELS.noAccessLabel, FIT_LEVELS.noMeter);
	assert.equal(settle(row.measure), MAX_FIT_LEVEL);
	assert.equal(row.asked.length, MAX_FIT_LEVEL + 1, "each level asked exactly once");
});

test("it always starts from whole, so widening gives back what narrowing took", () => {
	/*
	 * The property the fixed breakpoints could not have. A level is a decision made under a width;
	 * when the width changes the decision is void, and the only way to know what the row can hold
	 * now is to offer it everything and measure again. Dropping the meter frees space that only a
	 * fresh walk can offer back.
	 */
	const row = rowWhere();
	assert.equal(settle(row.measure), FIT_LEVELS.all);
	assert.equal(row.asked[0], FIT_LEVELS.all);
});

test("the readable floor is a width a name can still be recognised at", () => {
	// Guards the constant itself: a dozen characters of `claude-opus-4…` is the point of it.
	assert.ok(MIN_NAME_WIDTH >= 64 && MIN_NAME_WIDTH <= 140, `${MIN_NAME_WIDTH}px`);
});
