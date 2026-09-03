/**
 * Picking a mark up: what counts as pointing at it.
 *
 * Two opposite complaints, both real, and they pull in different directions — which is why the
 * rule ends up depending on whether the mark is already selected:
 *
 *   - a step badge was picked up by presses that visibly missed it, because its grab area was
 *     inflated twice over;
 *   - a rectangle you had just drawn, with its frame still on it, could only be moved by aiming
 *     at the 2px stroke — pressing inside started a second rectangle.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { hitShape, insideBounds, shapeBounds, type Shape } from "../src/features/image/annotate.ts";

const STROKE = 4;
const TOLERANCE = 6;

const rect = (): Shape => ({
	tool: "rect",
	colour: "#f00",
	stroke: STROKE,
	points: [
		{ x: 100, y: 100 },
		{ x: 300, y: 200 },
	],
});

const badge = (): Shape => ({ tool: "step", colour: "#f00", stroke: STROKE, points: [{ x: 200, y: 200 }] });

test("a step badge is not grabbed from well outside the circle it draws", () => {
	/*
	 * The badge's radius is `max(12, stroke * 4.5)` — 18 here. With the tolerance added once, a
	 * press is forgiven up to 24 from the centre. It used to be forgiven far past that: the
	 * tolerance was passed in *as the stroke*, inflating the radius itself, and then added again.
	 */
	const box = shapeBounds(badge(), STROKE);
	const radius = box.w / 2;
	assert.equal(radius, 18, "前提：这个描边下徽章半径是 18");

	// Just outside the circle plus one tolerance — must miss.
	const outside = { x: 200 + radius + TOLERANCE + 4, y: 200 };
	assert.equal(hitShape([badge()], outside, TOLERANCE), -1, "在圆外一个容差还多的地方仍然选中了");

	// On the badge itself — must hit.
	assert.equal(hitShape([badge()], { x: 200, y: 200 }, TOLERANCE), 0);
	// Just inside the forgiveness — must hit, so the fix did not overshoot into being fussy.
	assert.equal(hitShape([badge()], { x: 200 + radius, y: 200 }, TOLERANCE), 0);
});

test("an unselected outline is still only hit on its stroke", () => {
	// The other half of the rule: a rectangle drawn *around* something must leave the inside
	// clickable, or there is no way to annotate within one.
	const middle = { x: 200, y: 150 };
	assert.equal(hitShape([rect()], middle, TOLERANCE), -1, "未选中的矩形内部不该吃掉按下");
	assert.equal(hitShape([rect()], { x: 100, y: 150 }, TOLERANCE), 0, "边上应该命中");
});

test("the selected mark is grabbable anywhere inside its frame", () => {
	// What `Annotator` adds on top of `hitShape` for the one mark that is selected.
	assert.ok(insideBounds(rect(), { x: 200, y: 150 }, STROKE, TOLERANCE), "框内应该能抓住");
	assert.ok(insideBounds(rect(), { x: 100, y: 100 }, STROKE, TOLERANCE), "角上应该能抓住");
	assert.ok(!insideBounds(rect(), { x: 400, y: 150 }, STROKE, TOLERANCE), "框外不该");
	assert.ok(!insideBounds(rect(), { x: 200, y: 400 }, STROKE, TOLERANCE), "框下方不该");
});

test("the frame allows for the stroke and the tolerance, and no more", () => {
	// A press one tolerance past the corner is still forgiven; two is not.
	const near = { x: 100 - STROKE - TOLERANCE + 1, y: 150 };
	const far = { x: 100 - STROKE - TOLERANCE * 2 - 4, y: 150 };
	assert.ok(insideBounds(rect(), near, STROKE, TOLERANCE));
	assert.ok(!insideBounds(rect(), far, STROKE, TOLERANCE));
});

test("a caption with no measured width is estimated from its text, not from a constant", () => {
	/*
	 * `fitWidth` measures against the canvas and stores the result, so this fallback is only for
	 * captions saved before that existed. It used to be a flat `size * 6` — far too wide for two
	 * words, far too narrow for a sentence.
	 */
	const short: Shape = { tool: "text", colour: "#000", points: [{ x: 0, y: 0 }], size: 20, text: "短" };
	const long: Shape = { ...short, text: "这是一句长得多的说明文字" };
	const shortWidth = shapeBounds(short, STROKE).w;
	const longWidth = shapeBounds(long, STROKE).w;
	assert.ok(longWidth > shortWidth * 3, `长文应该明显更宽：${shortWidth} vs ${longWidth}`);
	assert.ok(shortWidth >= 20 * 1.6, "再短也要放得下一个字和光标");
});

test("a measured width is used as-is, whatever the text", () => {
	// The stored width is the one the field actually laid out; nothing here may second-guess it.
	const caption: Shape = { tool: "text", colour: "#000", points: [{ x: 0, y: 0 }], size: 20, text: "短", width: 137 };
	assert.equal(shapeBounds(caption, STROKE).w, 137);
});
