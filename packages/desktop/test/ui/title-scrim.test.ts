/**
 * The system's buttons in the title strip dim with a dialog's scrim.
 *
 * Measured on Windows 11 with a confirmation open: the page under the scrim was #bfbfbf and the
 * minimise/maximise/close patch in its corner stayed #f3f3f3 — the brightest thing on screen, because
 * the system draws it outside the page in the colour the theme last named.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import { sendWindowColors, tintedWindowColors } from "../../src/features/settings/window-tint.ts";
import { Overlay, SCRIM_ALPHA } from "../../src/ui/overlay/Overlay.tsx";
import { heldScrims, holdScrim } from "../../src/ui/overlay/scrims.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

let view: Mounted | undefined;
afterEach(async () => {
	await view?.unmount();
	view = undefined;
	Reflect.deleteProperty(window, "lyra");
});

const LIGHT = { color: "#f5f5f5", headerColor: "#f3f3f3", symbolColor: "#9a9a9a" };

test("under the dialog scrim the strip and its glyphs come out as dark as the page around them", () => {
	const tinted = tintedWindowColors(LIGHT, [{ color: "#000000", alpha: SCRIM_ALPHA }]);
	assert.equal(tinted.headerColor, "#bebebe", "243 × 0.78");
	assert.equal(tinted.symbolColor, "#787878");
	assert.equal(tinted.color, LIGHT.color, "the window's backing is not the strip, and stays");
	assert.deepEqual(tintedWindowColors(LIGHT, []), LIGHT);
});

test("holding a scrim sends the dimmed colours, and letting it go sends the theme's back", () => {
	const sent: unknown[] = [];
	Object.defineProperty(window, "lyra", { configurable: true, value: { setWindowTheme: (colors: unknown) => sent.push(colors) } });
	sendWindowColors(LIGHT);
	const release = holdScrim("#000000", SCRIM_ALPHA);
	release();
	assert.deepEqual(sent, [LIGHT, tintedWindowColors(LIGHT, [{ color: "#000000", alpha: SCRIM_ALPHA }]), LIGHT]);
});

test("a dialog holds its scrim while open and lets it go as it starts to leave", async () => {
	view = await mount(h(Overlay, { onClose() {}, children: h("button", null, "取消") }));
	assert.equal(heldScrims().length, 1);
	await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
	assert.equal(heldScrims().length, 0, "the page starts to brighten now, so the strip does too");
});

test("the alpha the strip is dimmed by is the one the scrim is drawn with", () => {
	const css = readFileSync(join(import.meta.dirname, "../../src/styles/overlay.css"), "utf8");
	const drawn = [...css.matchAll(/\.ly-scrim-(?:in|out)\s*\{[^}]*background:\s*rgb\(0 0 0 \/ ([\d.]+)\)/g)].map((m) => Number(m[1]));
	assert.deepEqual(drawn, [SCRIM_ALPHA, SCRIM_ALPHA]);
});

test("under a heavy backdrop the strip goes dark and its glyphs stay readable, as on a dark theme", () => {
	// The image viewer's 72%: dimmed along with it the glyphs would be #2b2b2b on #444444.
	const viewer = tintedWindowColors(LIGHT, [{ color: "#000000", alpha: 0.72 }]);
	assert.equal(viewer.headerColor, "#444444");
	assert.equal(viewer.symbolColor, "#b4b4b4");
	// A video filling the window.
	const video = tintedWindowColors(LIGHT, [{ color: "#000000", alpha: 1 }]);
	assert.deepEqual([video.headerColor, video.symbolColor], ["#000000", "#999999"]);
});

test("the scrim is no drag region, so a press on it over the window's top strip still reaches it", async () => {
	// On Windows 11 a click on the scrim inside the top 32px did not dismiss the dialog: the strip is a
	// drag region and the system took the press as one on the title bar.
	view = await mount(h(Overlay, { onClose() {}, children: h("button", null, "取消") }));
	const scrim = document.querySelector("[data-ly-overlay]")!;
	assert.ok(scrim.classList.contains("no-drag"), scrim.className);
});
