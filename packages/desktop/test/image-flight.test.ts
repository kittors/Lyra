/**
 * The two ends of a picture's flight between a thumbnail and the viewer.
 *
 * The viewer measured the wrong box once and started 编辑 at 2.8× the thumbnail; these pin what the
 * start has to be for the box that is measured — the thumbnail exactly: its size, its crop, its corners.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { atRest, atThumbnail, paintedBox } from "../src/features/image/flight.ts";

const number = (value: string, pattern: RegExp) => Number(pattern.exec(value)?.[1]);

test("the flight starts the size of the thumbnail, not bigger, centred on it", () => {
	// A 420px square thumbnail of a picture that rests at 729px in the middle of the window.
	const start = atThumbnail({ box: { x: 385, y: 129.4, width: 420, height: 420 }, radius: 16 }, { x: 275.5, y: 59.5, width: 729, height: 729 });
	const scale = number(start.transform, /scale\(([\d.]+)\)/);
	assert.ok(Math.abs(scale * 729 - 420) < 0.01, `starts ${scale * 729}px wide`);
	assert.match(start.transform, /^translate\(-45px, -84.6px\)/, "centre on centre: 339.4 − 424 and 595 − 640");
	assert.ok(Math.abs(number(start.clipPath, /round ([\d.]+)px/) * scale - 16) < 0.01, "the corners are the thumbnail's once scaled");
	assert.match(start.clipPath, /^inset\(0px 0px 0px 0px round/, "a thumbnail the shape of the picture crops nothing");
});

test("a square crop of a wide picture starts as that square, the rest clipped away", () => {
	// A 64px square showing a `cover` crop of a 16:9 picture.
	const start = atThumbnail({ box: { x: 0, y: 0, width: 64, height: 64 }, radius: 10 }, { x: 100, y: 100, width: 1600, height: 900 });
	const scale = number(start.transform, /scale\(([\d.]+)\)/);
	assert.ok(Math.abs(scale * 900 - 64) < 0.01, "covers the square by height, like the crop");
	const [top, side] = /inset\(([\d.]+)px ([\d.]+)px/.exec(start.clipPath)!.slice(1).map(Number);
	assert.equal(top, 0);
	assert.ok(Math.abs((1600 - 2 * side) * scale - 64) < 0.05, "what is left of the width is the square");
});

test("at rest the clip is an inset of the same kind, so the two ends interpolate", () => {
	assert.deepEqual(atRest(12), { transform: "none", clipPath: "inset(0px 0px 0px 0px round 12px)" });
});

test("a letterboxed picture flies from where it is painted, not from its element", () => {
	assert.deepEqual(paintedBox({ x: 0, y: 0, width: 200, height: 200 }, { width: 400, height: 100 }, "contain"), { x: 0, y: 75, width: 200, height: 50 });
	assert.deepEqual(paintedBox({ x: 0, y: 0, width: 200, height: 200 }, { width: 40, height: 10 }, "scale-down"), { x: 80, y: 95, width: 40, height: 10 });
	assert.deepEqual(paintedBox({ x: 5, y: 5, width: 200, height: 100 }, { width: 400, height: 100 }, "cover"), { x: 5, y: 5, width: 200, height: 100 });
});
