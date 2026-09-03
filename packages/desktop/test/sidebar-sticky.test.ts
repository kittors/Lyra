/**
 * How deep the sidebar's pinned rows reach.
 *
 * The rows are held by `position: sticky` and need no arithmetic — the browser does that on the
 * compositor, which is the only way they keep up with a wheel. All that is left for JavaScript is
 * where the *bottom* of the pinned band is, so the scroller's fade starts under the rows rather
 * than through them, and these are the cases that number gets wrong.
 *
 * Numbers are viewport-relative pixels, the way `getBoundingClientRect` reports them once the
 * viewport's own top is subtracted: negative means scrolled past.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { heldBand, isPinned, pinnedDepth, type StickyRow } from "../src/features/sidebar/sticky.ts";

const GAP = 6;
const STRIP = 32;
/** Where headings rest: a gap, the strip, and a gap again. */
const RAIL = GAP + STRIP + GAP;
const HEAD = 31;

const strip = (top: number): StickyRow => ({ top, bottom: top + STRIP, rail: GAP });
const head = (top: number): StickyRow => ({ top, bottom: top + HEAD, rail: RAIL });

test("nothing is covered before the list has scrolled", () => {
	// The strip is still down the pane where the list puts it, and the first heading below that.
	assert.equal(pinnedDepth([strip(120), head(160), head(400)]), 0);
});

test("a strip that has reached its rail covers down to its own underside", () => {
	assert.equal(pinnedDepth([strip(GAP), head(300)]), GAP + STRIP);
});

test("a heading held under the strip is what the depth follows", () => {
	const depth = pinnedDepth([strip(GAP), head(RAIL), head(600)]);
	/*
	 * The assertion the fade depends on. A pinned row is opaque, so the list behind it is hidden
	 * either way — but the rows *below* it must not start softening until they are clear of it, or
	 * the first conversation under a project name is half drawn.
	 */
	assert.equal(depth, RAIL + HEAD);
});

test("a heading on its way out still covers what it is standing on", () => {
	// Pushed above its rail by the next one, but still on screen and still opaque.
	const depth = pinnedDepth([strip(GAP), head(RAIL - 12), head(RAIL + HEAD - 12)]);
	assert.equal(depth, RAIL + HEAD - 12, "the depth follows it up rather than staying where it was");
});

test("a heading still arriving covers nothing", () => {
	// One pixel short of its rail: the list is still carrying it, so it is part of the list.
	const depth = pinnedDepth([strip(GAP), head(RAIL + 1)]);
	assert.equal(depth, GAP + STRIP, "the strip's depth, with nothing added for a row still in transit");
});

test("a heading resting exactly on its rail counts", () => {
	// `<=` rather than `<`, and the reason is subpixel scroll positions: these are two floats that
	// agree in every way that matters until the ninth decimal.
	assert.ok(Math.abs(pinnedDepth([strip(GAP), head(RAIL + 0.0000001)]) - (RAIL + HEAD)) < 0.001);
});

test("the lowest held row wins, whatever order they arrive in", () => {
	const rows = [head(RAIL - 20), strip(GAP), head(RAIL)];
	assert.equal(pinnedDepth(rows), RAIL + HEAD, "an outgoing heading above the rail does not shorten the band");
});

test("a list with no headings is just the strip", () => {
	assert.equal(pinnedDepth([strip(GAP)]), GAP + STRIP);
	assert.equal(pinnedDepth([]), 0);
});

/*
 * The same question, asked per row rather than of the set.
 *
 * It decides two separate things and the second one is visible even when the first is not: the
 * depth above, and whether the row may draw a fill at all. A row that fills while it is still
 * travelling with the list is painting over nothing, which is invisible right up until the pane's
 * colour and the fill's stop agreeing — and then it is a grey slab on every project name.
 */
test("a row is held once it reaches its rail, and not one pixel before", () => {
	assert.equal(isPinned(head(RAIL)), true, "resting exactly on the rail");
	assert.equal(isPinned(head(RAIL + 1)), false, "one pixel short, still being carried by the list");
	assert.equal(isPinned(head(RAIL - 12)), true, "pushed up past the rail on its way out, still covering");
	assert.equal(isPinned(strip(120)), false, "at rest, where the list happens to put it");
	assert.equal(isPinned(strip(GAP)), true, "the strip against its own rail");
});

/*
 * The band the mask must not soften through, which starts before the row has landed.
 *
 * The fade eats the top `FADE` pixels of the viewport, and a row travels through exactly that on
 * its way to the rail — so the strip dissolved as it approached the top and snapped back the
 * instant it arrived. These are the cases that decides.
 */
const FADE = 36;

test("a row still well clear of the rail is nothing but list", () => {
	assert.deepEqual(heldBand([strip(120), head(400)], FADE), { top: 0, bottom: 0 });
});

test("a row within a fade of its rail is held whole, and the list above it still fades", () => {
	const band = heldBand([strip(GAP + 20), head(400)], FADE);
	assert.equal(band.top, GAP + 20, "the band starts at the row rather than at the top edge");
	assert.equal(band.bottom, GAP + 20 + STRIP, "and ends at its underside, where the list starts again");
});

test("landing takes the band up to the edge it rests against", () => {
	const band = heldBand([strip(GAP), head(400)], FADE);
	assert.equal(band.top, GAP, "which is the rail, and zero for the strip in the pane itself");
	assert.equal(band.bottom, GAP + STRIP);
});

test("a heading arriving under a held strip joins the same band", () => {
	/*
	 * The one that makes this recursive rather than per-row. With the strip held, the fade would
	 * restart at its underside — and a project name arriving there is inside it, so it has to
	 * extend the band rather than be softened by it.
	 */
	const band = heldBand([strip(GAP), head(GAP + STRIP + 10)], FADE);
	assert.equal(band.top, GAP);
	assert.equal(band.bottom, GAP + STRIP + 10 + HEAD, "the band reaches the heading's underside");
});

test("a row pushed above the viewport starts the band at the edge, not off it", () => {
	// Negative tops would put the mask's first stop above zero, which is not a place.
	const band = heldBand([strip(-8)], FADE);
	assert.equal(band.top, 0);
	assert.equal(band.bottom, -8 + STRIP);
});

test("with no fade to allow for, the band is exactly what has landed", () => {
	// What every other scroller in the app gets, and what `pinnedDepth` is.
	assert.deepEqual(heldBand([strip(20), head(400)], 0), { top: 0, bottom: 0 }, "20 is not landed");
	assert.equal(heldBand([strip(GAP), head(400)], 0).bottom, pinnedDepth([strip(GAP), head(400)]));
});
