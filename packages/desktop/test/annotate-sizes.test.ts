/**
 * A mark is drawn at the size it was made at, not at the size the toolbar currently shows.
 *
 * The toolbar is about what happens *next*. Painted from the current setting instead, every mark
 * already on the picture changes the moment the size is adjusted: redact three things with a coarse
 * mosaic, pick a finer grain for the fourth, and the first three turn fine as well — work that was
 * finished, silently rewritten. Captions always kept their own `size`; every other tool did not.
 *
 * `paintAll` is where the two meet, so that is what these drive, with a stand-in context that
 * records what it was asked to do.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { paintAll } from "../src/features/image/paint.ts";
import type { Shape } from "../src/features/image/annotate.ts";

/** A canvas context that remembers the line widths it was given and the blits it was asked for. */
function recorder() {
	const widths: number[] = [];
	const blits: { block: number }[] = [];
	const ctx = {
		save() {},
		restore() {},
		beginPath() {},
		moveTo() {},
		lineTo() {},
		stroke() {},
		fill() {},
		arc() {},
		rect() {},
		ellipse() {},
		closePath() {},
		fillText() {},
		measureText: () => ({ width: 10 }),
		drawImage(_source: unknown, ..._rest: number[]) {
			// The mosaic blits one averaged pixel per cell at block size: the last two arguments.
			blits.push({ block: _rest[_rest.length - 1] ?? 0 });
		},
		setLineDash() {},
		translate() {},
		set lineWidth(value: number) {
			widths.push(value);
		},
		get lineWidth() {
			return widths[widths.length - 1] ?? 0;
		},
		lineCap: "round",
		lineJoin: "round",
		strokeStyle: "",
		fillStyle: "",
		font: "",
		textBaseline: "alphabetic",
		globalAlpha: 1,
		imageSmoothingEnabled: true,
	};
	return { ctx: ctx as unknown as CanvasRenderingContext2D, widths, blits };
}

const source = { width: 100, height: 100 } as unknown as HTMLCanvasElement;
const options = (stroke: number, block: number, brush: number) => ({
	stroke,
	block,
	brush,
	mosaicSourceFor: () => source,
});

const line = (stroke?: number): Shape => ({
	tool: "line",
	colour: "#ef4444",
	points: [
		{ x: 0, y: 0 },
		{ x: 50, y: 50 },
	],
	...(stroke === undefined ? {} : { stroke }),
});

const mosaic = (block?: number, brush?: number): Shape => ({
	tool: "mosaic",
	colour: "#000",
	points: [{ x: 40, y: 40 }],
	...(block === undefined ? {} : { block }),
	...(brush === undefined ? {} : { brush }),
});

test("a mark drawn thin stays thin when the setting is turned up", () => {
	const { ctx, widths } = recorder();

	paintAll(ctx, [line(2)], options(20, 8, 30));

	assert.ok(widths.includes(2), `expected the mark's own 2, got ${JSON.stringify(widths)}`);
	assert.ok(!widths.includes(20), "the current setting must not reach back into finished work");
});

test("two marks of different sizes keep their own", () => {
	// The whole point: a picture can hold a thin annotation and a thick one at the same time.
	const { ctx, widths } = recorder();

	paintAll(ctx, [line(2), line(12)], options(20, 8, 30));

	assert.ok(widths.includes(2) && widths.includes(12), JSON.stringify(widths));
});

test("a mark with no size of its own falls back to the current one", () => {
	/*
	 * Two cases land here and both want this: the shape being dragged out right now, which is not
	 * committed yet, and anything drawn by a build from before marks carried their sizes.
	 */
	const { ctx, widths } = recorder();

	paintAll(ctx, [line()], options(7, 8, 30));

	assert.ok(widths.includes(7), JSON.stringify(widths));
});

test("a mosaic keeps the grain it was painted with", () => {
	const { ctx, blits } = recorder();

	paintAll(ctx, [mosaic(6, 20)], options(4, 40, 90));

	assert.ok(blits.length > 0, "nothing was blitted");
	assert.ok(
		blits.every((b) => b.block === 6),
		`every cell should be the mark's own 6, got ${JSON.stringify(blits.map((b) => b.block))}`,
	);
});

test("coarse and fine redactions coexist on one picture", () => {
	// Redacting a whole window and redacting one line of text want visibly different squares.
	const { ctx, blits } = recorder();

	paintAll(ctx, [mosaic(6, 20), mosaic(24, 60)], options(4, 40, 90));

	const sizes = new Set(blits.map((b) => b.block));
	assert.deepEqual([...sizes].sort((a, b) => a - b), [6, 24]);
});

test("a mosaic samples the source built for its own grain", () => {
	/*
	 * The source's resolution *is* the grid — it holds `naturalWidth / block` pixels — so asking for
	 * the wrong one samples the wrong pixel for every cell. This is what stops a single cached
	 * canvas from being reused across grain sizes.
	 */
	const asked: number[] = [];
	const { ctx } = recorder();

	paintAll(ctx, [mosaic(6, 20), mosaic(24, 60)], {
		stroke: 4,
		block: 40,
		brush: 90,
		mosaicSourceFor: (grid) => {
			asked.push(grid);
			return source;
		},
	});

	assert.deepEqual(asked.sort((a, b) => a - b), [6, 24]);
});
