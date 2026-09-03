/**
 * Which end of the window row the system took, and how much of it.
 *
 * The window's own controls are drawn over the page rather than in it, so nothing in the document
 * can measure them and every one of these numbers has to be decided rather than observed. Getting
 * it wrong is not subtle: on Windows the panel buttons ended up underneath the close button, drawn
 * and unpressable, and the sidebar toggle sat 78px in — clear of traffic lights that only macOS
 * has, and out of line with every mark below it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	OVERLAY_FALLBACK,
	overlayReserved,
	titlebarInsets,
	TOOLBAR_EDGE,
	TRAFFIC_LIGHTS_WIDTH,
} from "../src/titlebar.ts";

test("macOS holds the corner open for its traffic lights, and nothing at the other end", () => {
	assert.deepEqual(titlebarInsets("darwin", false, 0), { start: TRAFFIC_LIGHTS_WIDTH, end: 0 });
});

test("native full screen takes the lights away, so the inset goes with them", () => {
	assert.deepEqual(titlebarInsets("darwin", true, 0), { start: TOOLBAR_EDGE, end: 0 });
});

test("Windows starts at the window's own margin and clears its buttons at the far end", () => {
	assert.deepEqual(titlebarInsets("win32", false, 138), { start: TOOLBAR_EDGE, end: 138 });
});

test("Linux is Windows: an overlay at the trailing end, nothing at the leading one", () => {
	assert.deepEqual(titlebarInsets("linux", false, 92), { start: TOOLBAR_EDGE, end: 92 });
});

test("an overlay reported wider than usual is cleared to whatever it says", () => {
	// Display scaling changes this; it is not three fixed buttons.
	assert.deepEqual(titlebarInsets("win32", false, 207), { start: TOOLBAR_EDGE, end: 207 });
});

test("a hidden overlay reserves nothing — full screen on Windows draws no buttons", () => {
	assert.equal(overlayReserved({ visible: false, getTitlebarAreaRect: () => ({ right: 0, width: 0 }) }, 1200), 0);
	assert.equal(overlayReserved(undefined, 1200), 0);
});

test("what the system took is whatever lies past the page's own strip", () => {
	const overlay = { visible: true, getTitlebarAreaRect: () => ({ right: 1062, width: 1062 }) };
	assert.equal(overlayReserved(overlay, 1200), 138);
});

test("an overlay that is on but not yet measured falls back rather than reserving nothing", () => {
	// A rect of zeroes is what Chromium answers with before the first geometry arrives. Treating
	// it as "nothing reserved" puts the panel controls back under the close button until it does.
	const overlay = { visible: true, getTitlebarAreaRect: () => ({ right: 0, width: 0 }) };
	assert.equal(overlayReserved(overlay, 1200), OVERLAY_FALLBACK);
});

test("a rect wider than the window never reserves a negative amount", () => {
	const overlay = { visible: true, getTitlebarAreaRect: () => ({ right: 1400, width: 1400 }) };
	assert.equal(overlayReserved(overlay, 1200), 0);
});

test("a phone has no window controls, so nothing is held open for them", () => {
	/*
	 * The phone reports `darwin` — it is describing the machine the session runs on, which is what
	 * the renderer uses `platform` for. Left at that, it also inherited macOS's geometry: 78px at
	 * the top left for traffic lights that are not there, which left the sidebar toggle marooned in
	 * the middle of the row instead of at the edge where every mark below it lines up.
	 */
	assert.deepEqual(titlebarInsets("darwin", false, 0, false), { start: TOOLBAR_EDGE, end: TOOLBAR_EDGE });
	assert.deepEqual(titlebarInsets("win32", false, 138, false), { start: TOOLBAR_EDGE, end: TOOLBAR_EDGE });
});

test("a desktop window keeps its controls, whatever the platform", () => {
	// The default is `windowed`, so nothing outside the phone had to be changed to read this.
	assert.equal(titlebarInsets("darwin", false, 0).start, TRAFFIC_LIGHTS_WIDTH);
	assert.equal(titlebarInsets("win32", false, 138).end, 138);
});
