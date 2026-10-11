/**
 * The percentage on a drawing card, which no endpoint reports and is therefore an estimate.
 *
 * What it must never do is the thing people read as broken: reach 100 with nothing arrived, stand
 * still while the drawing runs long, or go backwards.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ESTIMATE_CEILING, expectedMs, progressAt, stageAt } from "../src/lib/image-progress.ts";

test("the estimate climbs, keeps moving past the expected time, and never reaches the end on its own", () => {
	const expected = expectedMs("gemini-3.1-flash-image");
	let last = -1;
	for (let ms = 0; ms <= expected * 6; ms += 250) {
		const value = progressAt(ms, expected);
		assert.ok(value >= last, `went backwards at ${ms}ms`);
		assert.ok(value < ESTIMATE_CEILING, `reached the ceiling at ${ms}ms`);
		last = value;
	}
	assert.ok(progressAt(expected, expected) > 0.8 && progressAt(expected, expected) < 0.9, "about 85% at the expected time");
	assert.ok(progressAt(expected * 2, expected) - progressAt(expected * 1.5, expected) > 0.005, "still moving when it runs long");
});

test("slower kinds of drawing are expected to take longer", () => {
	assert.ok(expectedMs("gpt-image-1") > expectedMs("gemini-3.1-flash-image"));
	assert.ok(expectedMs("gemini-3.1-flash-image", "max") > expectedMs("gemini-3.1-flash-image", "high"));
	assert.ok(expectedMs("gemini-3.1-flash-image", undefined, 3) > expectedMs("gemini-3.1-flash-image"));
	assert.ok(expectedMs("gemini-3.1-flash-image", undefined, 1, true) > expectedMs("gemini-3.1-flash-image"));
});

test("the stage follows the estimate, ending on the last one", () => {
	assert.equal(stageAt(0), "imageGen.stage.brief");
	assert.equal(stageAt(0.5), "imageGen.stage.scene");
	assert.equal(stageAt(ESTIMATE_CEILING), "imageGen.stage.finish");
});
