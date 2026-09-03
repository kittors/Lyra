/**
 * The conversation's measure, as a value and as a choice.
 *
 * Both halves have a way of being silently wrong: a stored number that nothing bounds turns the
 * transcript into a column of single words, and a preset lookup that rounds to the nearest button
 * tells you the app is at 800 while it renders at 870.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CONTENT_DEFAULT,
	CONTENT_FILL,
	CONTENT_MAX,
	CONTENT_MIN,
	contentMeasure,
	contentPreset,
} from "../src/lib/content-width.ts";

describe("contentMeasure", () => {
	it("a settings file written before this existed keeps the width it always had", () => {
		assert.equal(contentMeasure(undefined), `${CONTENT_DEFAULT}px`);
	});

	it("the fill sentinel is a percentage, not a pixel count", () => {
		assert.equal(contentMeasure(CONTENT_FILL), "100%");
	});

	it("ordinary widths pass through", () => {
		assert.equal(contentMeasure(640), "640px");
		assert.equal(contentMeasure(960), "960px");
	});

	it("a hand-edited file cannot produce a column nobody can read", () => {
		assert.equal(contentMeasure(40), `${CONTENT_MIN}px`);
		assert.equal(contentMeasure(99_999), `${CONTENT_MAX}px`);
		// Negative is not the fill sentinel; it is nonsense, and clamps like any other nonsense.
		assert.equal(contentMeasure(-320), `${CONTENT_MIN}px`);
	});

	it("nonsense falls back rather than emitting `NaNpx`", () => {
		assert.equal(contentMeasure(Number.NaN), `${CONTENT_DEFAULT}px`);
		assert.equal(contentMeasure(Number.POSITIVE_INFINITY), `${CONTENT_DEFAULT}px`);
	});

	it("fractions round, so the value is always a whole pixel", () => {
		assert.equal(contentMeasure(800.4), "800px");
		assert.equal(contentMeasure(800.6), "801px");
	});
});

describe("contentPreset", () => {
	it("lights the button that matches", () => {
		assert.equal(contentPreset(CONTENT_DEFAULT), String(CONTENT_DEFAULT));
		assert.equal(contentPreset(800), "800");
		assert.equal(contentPreset(960), "960");
		assert.equal(contentPreset(CONTENT_FILL), String(CONTENT_FILL));
	});

	it("an unset width reads as the default preset", () => {
		assert.equal(contentPreset(undefined), String(CONTENT_DEFAULT));
	});

	it("a typed-in width lights nothing", () => {
		assert.equal(contentPreset(870), "");
		assert.equal(contentPreset(641), "");
	});
});
