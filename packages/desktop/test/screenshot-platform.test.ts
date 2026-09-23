/**
 * What the screenshot overlay may do on each platform, decided before any window is touched.
 *
 * Two Linux failures started here. Three seconds after every launch the capture pipeline was
 * warmed with `desktopCapturer.getSources` — which on Wayland goes through the screen-cast portal,
 * so every launch put up a 「屏幕共享」 dialog nobody had asked for (VS Code #318759 is the same
 * bug). And the overlay leans on `setOpacity` to be invisible, which Electron does not implement on
 * Linux: the "invisible" warm-up was a full-screen window for 220ms, black on an X11 desktop with
 * no compositor, and a second capture taken over the first photographed the first one's selection.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { hidesOverlayForSnapshot, warmupPlan } from "../electron/screenshot-platform.ts";

test("Linux never warms the capture pipeline — on Wayland that is the portal dialog at launch", () => {
	assert.equal(warmupPlan("linux", true).capture, false);
});

test("Linux skips the invisible first presentation, because it is not invisible there", () => {
	const plan = warmupPlan("linux", true);
	assert.equal(plan.present, false);
	// The window itself is still built ahead of time: hidden, it costs nothing to look at.
	assert.equal(plan.overlay, true);
});

test("macOS and Windows warm up exactly as before", () => {
	for (const platform of ["darwin", "win32"]) {
		assert.deepEqual(warmupPlan(platform, true), { overlay: true, present: true, capture: true });
	}
});

test("with screenshots switched off, nothing is built or captured on any platform", () => {
	for (const platform of ["darwin", "win32", "linux"]) {
		assert.deepEqual(warmupPlan(platform, false), { overlay: false, present: false, capture: false });
	}
});

test("a capture over a capture hides the old overlay on Linux, where opacity does nothing", () => {
	assert.equal(hidesOverlayForSnapshot("linux"), true);
	assert.equal(hidesOverlayForSnapshot("darwin"), false);
	assert.equal(hidesOverlayForSnapshot("win32"), false);
});
