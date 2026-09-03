/**
 * Annotation arithmetic.
 *
 * The claims: undo and redo reach every state and no others, step badges describe the order they
 * are in rather than the order they were made in, a mosaic stroke covers the same cells however
 * many times it is drawn, and zooming holds whatever is under the pointer.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	canRedo,
	canUndo,
	clampZoom,
	commit,
	current,
	emptyHistory,
	handlesOf,
	hitShape,
	hitShapes,
	HISTORY_LIMIT,
	mosaicBlock,
	mosaicBrush,
	mosaicCells,
	moveShape,
	pickTolerance,
	redo,
	resizeShape,
	shapeBounds,
	stepNumber,
	wrapText,
	undo,
	ZOOM_MAX,
	ZOOM_MIN,
	WIDTH_HANDLE,
	zoomAt,
	type Point,
	type Shape,
} from "../src/features/image/annotate.ts";

const pen = (...points: [number, number][]): Shape => ({
	tool: "pen",
	colour: "#ef4444",
	points: points.map(([x, y]) => ({ x, y })),
});

const step = (x: number, y: number): Shape => ({ tool: "step", colour: "#ef4444", points: [{ x, y }] });

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

test("a fresh history has nothing to undo and nothing to redo", () => {
	const history = emptyHistory();
	assert.deepEqual(current(history), []);
	assert.equal(canUndo(history), false);
	assert.equal(canRedo(history), false);
	// And asking anyway is a no-op rather than a crash.
	assert.equal(current(undo(history)).length, 0);
	assert.equal(current(redo(history)).length, 0);
});

test("undo walks back through every state and redo walks forward to the same ones", () => {
	let history = emptyHistory();
	const a = pen([0, 0]);
	const b = pen([1, 1]);
	history = commit(history, [a]);
	history = commit(history, [a, b]);

	assert.equal(current(history).length, 2);
	history = undo(history);
	assert.equal(current(history).length, 1);
	history = undo(history);
	assert.equal(current(history).length, 0);
	assert.equal(canUndo(history), false, "back at the start");

	assert.equal(canRedo(history), true);
	history = redo(history);
	assert.equal(current(history).length, 1);
	history = redo(history);
	assert.deepEqual(current(history), [a, b], "and the redone state is the one that was undone");
	assert.equal(canRedo(history), false);
});

test("drawing after an undo abandons what was undone", () => {
	let history = emptyHistory();
	history = commit(history, [pen([0, 0])]);
	history = commit(history, [pen([0, 0]), pen([1, 1])]);
	history = undo(history);
	assert.equal(canRedo(history), true);

	history = commit(history, [pen([0, 0]), pen([2, 2])]);
	assert.equal(canRedo(history), false, "the abandoned branch is gone, not waiting");
	assert.equal(current(history)[1]?.points[0]?.x, 2);
	// Undo still reaches everything on the surviving branch.
	assert.equal(current(undo(history)).length, 1);
});

test("history is bounded, and the bound drops the oldest rather than the newest", () => {
	let history = emptyHistory();
	for (let i = 1; i <= HISTORY_LIMIT + 20; i++) history = commit(history, [pen([i, i])]);

	assert.ok(history.steps.length <= HISTORY_LIMIT, `kept ${history.steps.length}`);
	assert.equal(current(history)[0]?.points[0]?.x, HISTORY_LIMIT + 20, "the newest state is the live one");
	assert.equal(canRedo(history), false);
	assert.equal(canUndo(history), true, "and there is still a history to walk back through");
});

// ---------------------------------------------------------------------------
// Step badges
// ---------------------------------------------------------------------------

test("step badges are numbered by their position among the steps, ignoring other marks", () => {
	const shapes = [step(0, 0), pen([5, 5]), step(10, 10), pen([1, 1]), step(20, 20)];
	assert.equal(stepNumber(shapes, 0), 1);
	assert.equal(stepNumber(shapes, 2), 2, "the pen between them is not a step");
	assert.equal(stepNumber(shapes, 4), 3);
});

test("removing a step renumbers the ones after it", () => {
	const shapes = [step(0, 0), step(10, 10), step(20, 20)];
	assert.equal(stepNumber(shapes, 2), 3);
	// Undo takes out the middle one — the third badge must become the second, not stay 3.
	const fewer = [shapes[0]!, shapes[2]!];
	assert.equal(stepNumber(fewer, 1), 2, "counted at paint time rather than stored");
});

// ---------------------------------------------------------------------------
// Mosaic
// ---------------------------------------------------------------------------

test("a mosaic stroke covers the cells around it and snaps them to the grid", () => {
	const cells = mosaicCells([{ x: 50, y: 50 }], 20, 10);
	assert.ok(cells.length > 0);
	for (const cell of cells) {
		const [x, y] = cell.split(",").map(Number) as [number, number];
		assert.equal(x % 10, 0, `cell ${cell} is off the grid`);
		assert.equal(y % 10, 0, `cell ${cell} is off the grid`);
		// And within a brush's reach of where it was painted.
		assert.ok(Math.hypot(x + 5 - 50, y + 5 - 50) <= 20, `cell ${cell} is beyond the brush`);
	}
});

test("going over the same place twice covers the same cells", () => {
	const once = mosaicCells([{ x: 100, y: 100 }], 30, 12);
	const twice = mosaicCells([{ x: 100, y: 100 }, { x: 100, y: 100 }], 30, 12);
	assert.deepEqual(new Set(twice), new Set(once), "idempotent, so a nervous scribble is not darker");
});

test("a longer stroke covers more, and its cells are the union of its points", () => {
	const a = mosaicCells([{ x: 40, y: 40 }], 20, 10);
	const long = mosaicCells([{ x: 40, y: 40 }, { x: 200, y: 40 }], 20, 10);
	assert.ok(long.length > a.length);
	for (const cell of a) assert.ok(long.includes(cell), `${cell} was dropped by the longer stroke`);
});

test("block and brush scale with the image, and never collapse on a small one", () => {
	assert.ok(mosaicBlock(3000) > mosaicBlock(600), "a big screenshot gets bigger blocks");
	assert.ok(mosaicBlock(100) >= 4, "and a tiny one still gets blocks you can see");
	assert.ok(mosaicBrush(3000) > mosaicBrush(600));
	assert.ok(mosaicBrush(50) >= 12);
});

test("the grain follows the size control, so a mosaic can be coarse or fine", () => {
	/*
	 * Redacting a line of text and redacting a whole window want visibly different squares, and the
	 * grain used to be fixed — the size control moved the brush and left the blocks alone.
	 */
	assert.ok(mosaicBlock(2000, 2) > mosaicBlock(2000, 1), "a larger setting gives coarser blocks");
	assert.ok(mosaicBlock(2000, 0.5) < mosaicBlock(2000, 1), "and a smaller one finer");
	assert.ok(mosaicBlock(2000, 0.01) >= 4, "never so fine that it stops hiding anything");
	assert.equal(mosaicBlock(2000), mosaicBlock(2000, 1), "left off, it is the middle setting");
});

// ---------------------------------------------------------------------------
// Selecting and moving
// ---------------------------------------------------------------------------

test("the mark under the point is found, and a miss is reported as a miss", () => {
	const line: Shape = { tool: "line", colour: "#000", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
	assert.equal(hitShape([line], { x: 50, y: 2 }, 5), 0);
	assert.equal(hitShape([line], { x: 50, y: 40 }, 5), -1, "far from the line");
	assert.equal(hitShape([line], { x: 140, y: 0 }, 5), -1, "a segment is not its infinite extension");
	assert.equal(hitShape([], { x: 0, y: 0 }, 5), -1, "nothing to hit");
});

test("an outline is hit on its outline, so what it frames stays clickable", () => {
	const rect: Shape = { tool: "rect", colour: "#000", points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
	assert.equal(hitShape([rect], { x: 50, y: 1 }, 5), 0, "top edge");
	assert.equal(hitShape([rect], { x: 100, y: 50 }, 5), 0, "right edge");
	assert.equal(hitShape([rect], { x: 50, y: 50 }, 5), -1, "the middle belongs to whatever it frames");

	const ellipse: Shape = { tool: "ellipse", colour: "#000", points: [{ x: 0, y: 0 }, { x: 200, y: 100 }] };
	assert.equal(hitShape([ellipse], { x: 100, y: 0 }, 6), 0, "on the curve");
	assert.equal(hitShape([ellipse], { x: 100, y: 50 }, 6), -1, "inside is not on it");
});

test("text and step badges are solid, and are hit anywhere in their box", () => {
	const label: Shape = {
		tool: "text",
		colour: "#000",
		points: [{ x: 10, y: 10 }],
		text: "hello",
		size: 20,
		width: 200,
		height: 60,
	};
	assert.equal(hitShape([label], { x: 100, y: 40 }, 2), 0, "middle of the box");
	assert.equal(hitShape([label], { x: 205, y: 65 }, 2), 0, "bottom right corner");
	assert.equal(hitShape([label], { x: 300, y: 40 }, 2), -1, "past the column");
	assert.equal(hitShape([label], { x: 100, y: 200 }, 2), -1, "below it");

	const badge: Shape = { tool: "step", colour: "#000", points: [{ x: 100, y: 100 }] };
	assert.equal(hitShape([badge], { x: 100, y: 100 }, 3), 0, "the badge is a disc, not a ring");
});

test("a wide mosaic stroke is easier to hit than a thin pen stroke", () => {
	// Beyond a pen's reach, inside a mosaic brush's.
	const at: Point = { x: 50, y: 16 };
	const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
	assert.equal(hitShape([{ tool: "pen", colour: "#000", points: path }], at, 5), -1);
	assert.equal(hitShape([{ tool: "mosaic", colour: "#000", points: path }], at, 5), 0);
});

test("everything under the point can be listed, topmost first, so a stack is navigable", () => {
	const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
	const under: Shape = { tool: "line", colour: "#a", points: path };
	const middle: Shape = { tool: "line", colour: "#b", points: path };
	const over: Shape = { tool: "line", colour: "#c", points: path };

	const stack = hitShapes([under, middle, over], { x: 50, y: 0 }, 5);
	assert.deepEqual(stack, [2, 1, 0], "newest first");
	assert.equal(stack[0], hitShape([under, middle, over], { x: 50, y: 0 }, 5), "and it agrees with the single answer");

	// Stepping through it wraps, which is what makes the bottom one reachable and then the top again.
	const next = (i: number) => stack[(stack.indexOf(i) + 1) % stack.length];
	assert.equal(next(2), 1);
	assert.equal(next(1), 0);
	assert.equal(next(0), 2, "wraps back to the top");

	assert.deepEqual(hitShapes([under], { x: 50, y: 400 }, 5), [], "nothing under the point");
});

test("the topmost mark wins, because that is the one being pointed at", () => {
	const a: Shape = { tool: "pen", colour: "#000", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
	const b: Shape = { tool: "pen", colour: "#111", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
	assert.equal(hitShape([a, b], { x: 50, y: 0 }, 5), 1, "the later one is on top");
});

test("moving shifts every point and changes nothing else", () => {
	const shape: Shape = { tool: "text", colour: "#ef4444", points: [{ x: 10, y: 20 }], text: "hi", width: 100 };
	const moved = moveShape(shape, 5, -8);
	assert.deepEqual(moved.points, [{ x: 15, y: 12 }]);
	assert.equal(moved.text, "hi");
	assert.equal(moved.width, 100, "the column it wraps at travels with it");
	assert.equal(moved.colour, "#ef4444");
	assert.deepEqual(shape.points, [{ x: 10, y: 20 }], "and the original is untouched");
});

test("a moved mark can be picked up again where it now is, and not where it was", () => {
	const before: Shape = { tool: "line", colour: "#000", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
	const after = moveShape(before, 0, 200);
	assert.equal(hitShape([after], { x: 50, y: 200 }, 5), 0);
	assert.equal(hitShape([after], { x: 50, y: 0 }, 5), -1);
});

test("the selection box surrounds the mark it is drawn around", () => {
	const line: Shape = { tool: "line", colour: "#000", points: [{ x: 20, y: 30 }, { x: 120, y: 80 }] };
	const box = shapeBounds(line, 4);
	assert.ok(box.x <= 20 && box.y <= 30, "starts at or before the mark");
	assert.ok(box.x + box.w >= 120 && box.y + box.h >= 80, "ends at or after it");

	// A step badge is centred on its point, not started from it.
	const badge = shapeBounds({ tool: "step", colour: "#000", points: [{ x: 100, y: 100 }] }, 4);
	assert.ok(badge.x < 100 && badge.y < 100 && badge.x + badge.w > 100, JSON.stringify(badge));

	// A single-point pen dab still gets a box with area, or it cannot be shown as selected.
	const dab = shapeBounds({ tool: "pen", colour: "#000", points: [{ x: 5, y: 5 }] }, 3);
	assert.ok(dab.w > 0 && dab.h > 0, JSON.stringify(dab));
});

test("picking is forgiving by a constant number of screen pixels, however far in you are", () => {
	assert.ok(pickTolerance(3, 0.25) > pickTolerance(3, 1), "zoomed out, one screen pixel is more image pixels");
	assert.ok(pickTolerance(3, 4) < pickTolerance(3, 1));
	assert.ok(pickTolerance(12, 8) >= 12, "never tighter than the mark's own width");
});

test("a mark drawn as a drag gets a grip at each end, and dragging one moves only that end", () => {
	const rect: Shape = { tool: "rect", colour: "#000", points: [{ x: 10, y: 10 }, { x: 110, y: 60 }] };
	const grips = handlesOf(rect);
	assert.equal(grips.length, 2);
	assert.deepEqual(grips.map((g) => g.at), [{ x: 10, y: 10 }, { x: 110, y: 60 }]);

	const pulled = resizeShape(rect, 1, { x: 200, y: 200 });
	assert.deepEqual(pulled.points[0], { x: 10, y: 10 }, "the other end stays put");
	assert.deepEqual(pulled.points[1], { x: 200, y: 200 });

	const other = resizeShape(rect, 0, { x: 0, y: 0 });
	assert.deepEqual(other.points, [{ x: 0, y: 0 }, { x: 110, y: 60 }]);
});

test("lines and arrows resize the same way; ellipses too", () => {
	for (const tool of ["line", "arrow", "ellipse"] as const) {
		const shape: Shape = { tool, colour: "#000", points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] };
		assert.equal(handlesOf(shape).length, 2, tool);
		assert.deepEqual(resizeShape(shape, 1, { x: 80, y: 20 }).points[1], { x: 80, y: 20 }, tool);
	}
});

test("marks with no two points that stand for them offer no grips", () => {
	// A pen stroke and a mosaic are paths; a badge is a fixed size. All three move rather than resize,
	// and a grip that does nothing is worse than no grip.
	assert.deepEqual(handlesOf(pen([0, 0], [5, 5], [9, 2])), []);
	assert.deepEqual(handlesOf({ tool: "mosaic", colour: "#000", points: [{ x: 0, y: 0 }] }), []);
	assert.deepEqual(handlesOf(step(4, 4)), []);
});

test("a caption's grip is its column edge, and dragging it sets the width", () => {
	const label: Shape = {
		tool: "text", colour: "#000", points: [{ x: 20, y: 40 }],
		text: "hi", size: 20, width: 160, height: 60,
	};
	const grips = handlesOf(label);
	assert.equal(grips.length, 1);
	assert.equal(grips[0]?.index, WIDTH_HANDLE);
	assert.deepEqual(grips[0]?.at, { x: 180, y: 70 }, "right edge, vertically centred");

	assert.equal(resizeShape(label, WIDTH_HANDLE, { x: 300, y: 0 }).width, 280, "measured from its left edge");
	// And never so narrow that nothing can be laid out in it.
	assert.ok((resizeShape(label, WIDTH_HANDLE, { x: 21, y: 0 }).width ?? 0) >= 40);
});

test("resizing leaves the original alone", () => {
	const shape: Shape = { tool: "rect", colour: "#000", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] };
	resizeShape(shape, 1, { x: 99, y: 99 });
	assert.deepEqual(shape.points[1], { x: 10, y: 10 });
});

// ---------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------

/** Every character one unit wide, which makes the expected breaks countable by hand. */
const evenly = (s: string) => s.length;

test("text wraps at the column instead of running off the picture", () => {
	const lines = wrapText(evenly, "一二三四五六七八九十", 4);
	assert.ok(lines.length > 1, "it broke somewhere");
	for (const line of lines) assert.ok(line.length <= 4, `line "${line}" is ${line.length} wide`);
	assert.equal(lines.join(""), "一二三四五六七八九十", "and nothing was lost");
});

test("newlines already in the text are kept", () => {
	assert.deepEqual(wrapText(evenly, "上\n下", 100), ["上", "下"]);
	// Including empty ones — a blank line is a thing someone typed on purpose.
	assert.deepEqual(wrapText(evenly, "上\n\n下", 100), ["上", "", "下"]);
});

test("latin breaks at spaces rather than mid-word", () => {
	const lines = wrapText(evenly, "hello wonderful world", 12);
	assert.ok(lines.length > 1);
	for (const line of lines) assert.ok(!/^\S/.test(line) || !line.startsWith(" "), "no leading space");
	assert.ok(
		lines.every((l) => !l.includes("wonder ") && l.trim() !== "wonderf"),
		`broke a word: ${JSON.stringify(lines)}`,
	);
	assert.equal(lines.join(" ").replace(/\s+/g, " ").trim(), "hello wonderful world");
});

test("a run longer than the column still gets its own line rather than looping forever", () => {
	const lines = wrapText(evenly, "supercalifragilistic", 5);
	assert.ok(lines.length >= 1);
	assert.equal(lines.join(""), "supercalifragilistic");
});

test("text that fits is left alone", () => {
	assert.deepEqual(wrapText(evenly, "短", 100), ["短"]);
	assert.deepEqual(wrapText(evenly, "", 100), [""]);
});

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

test("zoom is clamped at both ends", () => {
	assert.equal(clampZoom(1000), ZOOM_MAX);
	assert.equal(clampZoom(0), ZOOM_MIN);
	assert.equal(clampZoom(-3), ZOOM_MIN);
	assert.equal(clampZoom(2), 2);
});

test("zooming holds whatever is under the pointer", () => {
	const centre = { x: 500, y: 400 };
	const anchor = { x: 700, y: 300 };
	const offset = { x: 0, y: 0 };

	const next = zoomAt(1, 2, offset, anchor, centre);
	assert.equal(next.zoom, 2);

	// Where the anchored content point lands after the change. Content offset from the centre is
	// (v - offset) / zoom; on screen it is centre + offset + content * zoom.
	const before = { x: (anchor.x - centre.x - offset.x) / 1, y: (anchor.y - centre.y - offset.y) / 1 };
	const after = {
		x: centre.x + next.offset.x + before.x * next.zoom,
		y: centre.y + next.offset.y + before.y * next.zoom,
	};
	assert.ok(Math.abs(after.x - anchor.x) < 1e-9, `x drifted to ${after.x}`);
	assert.ok(Math.abs(after.y - anchor.y) < 1e-9, `y drifted to ${after.y}`);
});

test("zooming about the centre does not move anything, and a round trip returns to where it started", () => {
	const centre = { x: 500, y: 400 };
	assert.deepEqual(zoomAt(1, 2, { x: 0, y: 0 }, centre, centre).offset, { x: 0, y: 0 });
	// So a wheel that overshoots and comes back does not leave the picture displaced.
	const first = zoomAt(1, 2, { x: 30, y: -10 }, { x: 700, y: 300 }, centre);
	const back = zoomAt(first.zoom, 1, first.offset, { x: 700, y: 300 }, centre);
	assert.ok(Math.abs(back.offset.x - 30) < 1e-9, `x came back to ${back.offset.x}`);
	assert.ok(Math.abs(back.offset.y + 10) < 1e-9, `y came back to ${back.offset.y}`);
});

test("a clamped zoom still holds its anchor, rather than holding a zoom it did not reach", () => {
	const centre = { x: 500, y: 400 };
	const anchor = { x: 800, y: 500 };
	const next = zoomAt(1, 1000, { x: 0, y: 0 }, anchor, centre);
	assert.equal(next.zoom, ZOOM_MAX);
	const before = { x: anchor.x - centre.x, y: anchor.y - centre.y };
	const after = {
		x: centre.x + next.offset.x + before.x * next.zoom,
		y: centre.y + next.offset.y + before.y * next.zoom,
	};
	assert.ok(Math.abs(after.x - anchor.x) < 1e-9, `x drifted to ${after.x}`);
	assert.ok(Math.abs(after.y - anchor.y) < 1e-9);
});
