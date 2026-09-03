import assert from "node:assert/strict";
import { test } from "node:test";
import { keyboardOverlap, type ScreenFrame } from "../src/keyboard.ts";

const FULL_SCREEN: ScreenFrame = { x: 0, y: 0, width: 430, height: 932 };
const KEYBOARD: ScreenFrame = { x: 0, y: 570, width: 430, height: 362 };

test("an overlaid keyboard reserves the covered part of the view", () => {
	assert.equal(keyboardOverlap(FULL_SCREEN, KEYBOARD), 362);
});

test("adjustResize does not get a second keyboard reservation", () => {
	const resizedView = { ...FULL_SCREEN, height: KEYBOARD.y };
	assert.equal(keyboardOverlap(resizedView, KEYBOARD), 0);
});

test("screen offsets are included in the overlap", () => {
	const insetView = { x: 0, y: 48, width: 430, height: 884 };
	assert.equal(keyboardOverlap(insetView, KEYBOARD), 362);
});

test("a keyboard outside the view does not change its layout", () => {
	assert.equal(keyboardOverlap(FULL_SCREEN, { ...KEYBOARD, x: 500 }), 0);
	assert.equal(keyboardOverlap(FULL_SCREEN, { ...KEYBOARD, y: 940 }), 0);
});

test("a malformed frame cannot reserve more than the whole view", () => {
	assert.equal(keyboardOverlap(FULL_SCREEN, { x: 0, y: -20, width: 430, height: 952 }), FULL_SCREEN.height);
});

test("fractional native coordinates produce whole layout pixels", () => {
	assert.equal(keyboardOverlap(FULL_SCREEN, { ...KEYBOARD, y: 570.4 }), 362);
});
