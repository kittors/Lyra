/**
 * Where a drag lands.
 *
 * This is the part of the dock the hand argues with, so it is worth pinning at the boundaries
 * rather than in the middle of each region: a band that is off by a few percent still looks right
 * in every screenshot and feels wrong every single time you use it.
 *
 * The corner behaviour is the one to read. Four rectangular regions would make the answer flip as
 * the pointer crosses a corner; taking the nearest edge puts the boundary on the diagonal, so the
 * answer changes along a straight line and a drag along the top edge never dips into "left".
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { EDGE_BAND, ROOT_BAND } from "../src/features/dock/geometry.ts";
import { dropAt, edgeOf, rootEdge, sameDrop, type Rect } from "../src/features/dock/drop.ts";

/** 1000 × 500 at the origin, so a share of the box is a round number of pixels. */
const box: Rect = { left: 0, top: 0, width: 1000, height: 500 };

test("each edge band claims the side it is on", () => {
	assert.equal(edgeOf(box, 10, 250), "left");
	assert.equal(edgeOf(box, 990, 250), "right");
	assert.equal(edgeOf(box, 500, 10), "top");
	assert.equal(edgeOf(box, 500, 490), "bottom");
});

test("the middle claims nothing, so passing over a pane does not split it", () => {
	assert.equal(edgeOf(box, 500, 250), null, "dead centre");
	// Just inside the band on one axis is still the centre while the other axis is clear of it.
	assert.equal(edgeOf(box, 500, 200), null);
	assert.equal(edgeOf(box, 400, 250), null);
});

test("the band is exactly EDGE_BAND deep, measured in the pane's own width", () => {
	const inside = box.width * EDGE_BAND;
	assert.equal(edgeOf(box, inside - 1, 250), "left", "one pixel inside the band");
	assert.equal(edgeOf(box, inside + 1, 250), null, "one pixel past it");
	// And in its height, which is a different number of pixels for the same share.
	const above = box.height * EDGE_BAND;
	assert.equal(edgeOf(box, 500, above - 1), "top");
	assert.equal(edgeOf(box, 500, above + 1), null);
});

test("corners are divided by the diagonal, not by rectangles", () => {
	// The top-left corner of a 1000×500 box: the diagonal through it has slope 0.5, so a point
	// at (100, 40) is proportionally nearer the top and one at (100, 60) nearer the left.
	assert.equal(edgeOf(box, 100, 40), "top", "40/500 is nearer than 100/1000");
	assert.equal(edgeOf(box, 100, 60), "left", "60/500 is further than 100/1000");
	// The same rule, three more corners.
	assert.equal(edgeOf(box, 900, 40), "top");
	assert.equal(edgeOf(box, 900, 60), "right");
	assert.equal(edgeOf(box, 100, 460), "bottom");
	assert.equal(edgeOf(box, 100, 440), "left");
});

test("a point outside the pane is not in any of its bands", () => {
	assert.equal(edgeOf(box, -1, 250), null);
	assert.equal(edgeOf(box, 1001, 250), null);
	assert.equal(edgeOf(box, 500, -1), null);
	assert.equal(edgeOf(box, 500, 501), null);
});

test("a pane with no area answers nothing rather than dividing by zero", () => {
	assert.equal(edgeOf({ left: 0, top: 0, width: 0, height: 500 }, 0, 250), null);
	assert.equal(edgeOf({ left: 0, top: 0, width: 1000, height: 0 }, 500, 0), null);
});

test("the dock's outer band is a fixed number of pixels, not a share", () => {
	assert.equal(rootEdge(box, ROOT_BAND - 1, 250), "left");
	assert.equal(rootEdge(box, ROOT_BAND + 1, 250), null);
	// Same depth on the short axis, which a share-based band would have made shallower.
	assert.equal(rootEdge(box, 500, ROOT_BAND - 1), "top");
	assert.equal(rootEdge(box, 500, ROOT_BAND + 1), null);
	assert.equal(rootEdge(box, 1000 - ROOT_BAND + 1, 250), "right");
	assert.equal(rootEdge(box, 500, 500 - ROOT_BAND + 1), "bottom");
});

test("the dock's edge wins where it overlaps a pane's, because that is what it means", () => {
	const panes = [{ kind: "chat" as const, box }];
	// Five pixels in: inside the pane's left band and inside the dock's, and "against the window"
	// is the outer reading of the two.
	assert.deepEqual(dropAt(box, panes, 5, 250), { side: "left", kind: null });
	// Past the dock's band but still in the pane's, the pane is what gets split.
	assert.deepEqual(dropAt(box, panes, ROOT_BAND + 5, 250), { side: "left", kind: "chat" });
});

test("a drop finds whichever pane contains the pointer", () => {
	const left: Rect = { left: 0, top: 0, width: 500, height: 500 };
	const right: Rect = { left: 500, top: 0, width: 500, height: 500 };
	const panes = [
		{ kind: "chat" as const, box: left },
		{ kind: "terminal" as const, box: right },
	];
	// 50px into the right-hand pane is 10% of its width — inside its left band.
	assert.deepEqual(dropAt(box, panes, 550, 250), { side: "left", kind: "terminal" });
	assert.deepEqual(dropAt(box, panes, 450, 250), { side: "right", kind: "chat" });
	// Both middles: nowhere to land. Note these are *not* the middle of the dock — a pane's
	// bands are measured against the pane, which is the whole point of splitting the space up.
	assert.equal(dropAt(box, panes, 250, 250), null);
	assert.equal(dropAt(box, panes, 750, 250), null);
});

test("a drop nowhere in particular is null, and null is a stable answer", () => {
	assert.equal(dropAt(box, [{ kind: "chat", box }], 500, 250), null);
	assert.equal(sameDrop(null, null), true);
	assert.equal(sameDrop(null, { side: "left", kind: "chat" }), false);
	assert.equal(sameDrop({ side: "left", kind: "chat" }, null), false);
});

test("two landing places are the same only when both parts agree", () => {
	assert.equal(sameDrop({ side: "left", kind: "chat" }, { side: "left", kind: "chat" }), true);
	assert.equal(sameDrop({ side: "left", kind: "chat" }, { side: "right", kind: "chat" }), false);
	assert.equal(sameDrop({ side: "left", kind: "chat" }, { side: "left", kind: "terminal" }), false);
	// The dock's edge and a pane's edge on the same side are different places.
	assert.equal(sameDrop({ side: "left", kind: null }, { side: "left", kind: "chat" }), false);
});
