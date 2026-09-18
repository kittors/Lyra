/**
 * What a number field does with what you type into it.
 *
 * The box keeps a draft while focused. Characters that can never become a value in
 * range do not enter. Blur and the steppers commit a clamped number. The step still
 * decides the resolution: a font size truncates, 行高 and 字距 keep their fraction.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	commitDraft,
	isLegalDraft,
	roundTo,
	stepNumber,
	type NumberBounds,
} from "../src/lib/number-draft.ts";

const TRACKING: NumberBounds = { min: -0.1, max: 0.2, step: 0.01 };
const LINE_HEIGHT: NumberBounds = { min: 1, max: 3, step: 0.05 };
const FONT_SIZE: NumberBounds = { min: 11, max: 20, step: 1 };
const CODE_SIZE: NumberBounds = { min: 10, max: 20, step: 1 };
const CONTENT: NumberBounds = { min: 560, max: 1600, step: 1 };
const WEIGHT: NumberBounds = { min: 100, max: 900, step: 50 };
const PRINT: NumberBounds = { min: 40, max: 400, step: 10 };
const CONCURRENCY: NumberBounds = { min: 1, max: 8, step: 1 };
const PORT: NumberBounds = { min: 1, max: 65535, step: 1 };

test("a fractional step keeps the fraction on commit", () => {
	assert.equal(commitDraft("0.08", TRACKING), 0.08);
	assert.equal(commitDraft("1.8", LINE_HEIGHT), 1.8);
	assert.equal(commitDraft("-0.05", TRACKING), -0.05);
});

test("an integer step still truncates, which is what a font size wants", () => {
	assert.equal(commitDraft("13.7", { min: 9, max: 24, step: 1 }), 13);
});

test("the value is rounded to the step's own resolution", () => {
	assert.equal(commitDraft("0.123", TRACKING), 0.12);
	assert.equal(commitDraft("1.87", LINE_HEIGHT), 1.87);
});

test("blur clamps a finished number, and leaves an unfinished draft alone", () => {
	assert.equal(commitDraft("99", TRACKING), 0.2);
	assert.equal(commitDraft("-99", TRACKING), -0.1);
	assert.equal(commitDraft("0", LINE_HEIGHT), 1);
	assert.equal(commitDraft("1.", LINE_HEIGHT), 1);
	assert.equal(commitDraft("", FONT_SIZE), null);
	assert.equal(commitDraft("-", TRACKING), null);
});

test("digits that can grow into the range stay; the ones that cannot do not enter", () => {
	assert.equal(isLegalDraft("1", FONT_SIZE), true);
	assert.equal(isLegalDraft("16", FONT_SIZE), true);
	assert.equal(isLegalDraft("9", FONT_SIZE), false);
	assert.equal(isLegalDraft("21", FONT_SIZE), false);
	assert.equal(isLegalDraft("1", CODE_SIZE), true);
	assert.equal(isLegalDraft("0", CODE_SIZE), false);
	assert.equal(isLegalDraft("5", CONTENT), true);
	assert.equal(isLegalDraft("56", CONTENT), true);
	assert.equal(isLegalDraft("55", CONTENT), false);
	assert.equal(isLegalDraft("2", CONTENT), false);
	assert.equal(isLegalDraft("4", WEIGHT), true);
	assert.equal(isLegalDraft("0", WEIGHT), false);
	assert.equal(isLegalDraft("1", PRINT), true);
	assert.equal(isLegalDraft("5", PRINT), true);
	assert.equal(isLegalDraft("500", PRINT), false);
	assert.equal(isLegalDraft("8", CONCURRENCY), true);
	assert.equal(isLegalDraft("9", CONCURRENCY), false);
	assert.equal(isLegalDraft("0", CONCURRENCY), false);
	assert.equal(isLegalDraft("4", PORT), true);
	assert.equal(isLegalDraft("70000", PORT), false);
});

test("a minus does not enter when the floor is zero or above", () => {
	assert.equal(isLegalDraft("-", FONT_SIZE), false);
	assert.equal(isLegalDraft("-1", FONT_SIZE), false);
	assert.equal(isLegalDraft("-12", CONCURRENCY), false);
	assert.equal(isLegalDraft("-", TRACKING), true);
	assert.equal(isLegalDraft("-0", TRACKING), true);
	assert.equal(isLegalDraft("-0.1", TRACKING), true);
	assert.equal(isLegalDraft("-1", TRACKING), false);
	assert.equal(isLegalDraft("0.3", TRACKING), false);
});

test("letters, extra dots and extra fraction digits do not enter", () => {
	assert.equal(isLegalDraft("1e5", FONT_SIZE), false);
	assert.equal(isLegalDraft("12a", FONT_SIZE), false);
	assert.equal(isLegalDraft("1.2.3", LINE_HEIGHT), false);
	assert.equal(isLegalDraft("1.", FONT_SIZE), false);
	assert.equal(isLegalDraft("1.", LINE_HEIGHT), true);
	assert.equal(isLegalDraft("1.605", LINE_HEIGHT), false);
	assert.equal(isLegalDraft("", FONT_SIZE), true);
});

test("stepping with the arrow keys does not accumulate float noise", () => {
	assert.equal(stepNumber(1.6, 0.05, LINE_HEIGHT), 1.65);
	assert.equal(String(stepNumber(1.6, 0.05, LINE_HEIGHT)), "1.65");
	assert.equal(stepNumber(20, 1, FONT_SIZE), 20);
	assert.equal(stepNumber(11, -1, FONT_SIZE), 11);
	assert.equal(stepNumber(0.2, 0.01, TRACKING), 0.2);
	assert.equal(stepNumber(-0.1, -0.01, TRACKING), -0.1);
	assert.equal(roundTo(1.6 + 0.1, 1), 1.7);
});
