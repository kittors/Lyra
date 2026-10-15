/**
 * The top row stays clear of Windows' own buttons through a maximise and a restore.
 *
 * Chromium hands the page the overlay's new rectangle about 150ms before the window's new width:
 * `geometrychange` first, `resize` after. Measured in between, maximising a 1202px window reserved
 * nothing — the close button sat on the terminal, browser and git buttons — and restoring reserved
 * 472px for buttons 137px wide, pushing them to the middle of the row. Both stayed that way, since
 * nothing listened for the `resize` that would have put them right.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import { LayoutProvider, useLayout } from "../../src/app/layout.tsx";
import { OVERLAY_SETTLE_MS } from "../../src/app/window/titlebar.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

/** The part of `navigator.windowControlsOverlay` the layout reads, with events fired by hand. */
class FakeOverlay {
	visible = true;
	rect = { x: 0, right: 1064, width: 1064 };
	private listeners = new Set<() => void>();
	getTitlebarAreaRect() {
		return this.rect;
	}
	addEventListener(_type: "geometrychange", listener: () => void) {
		this.listeners.add(listener);
	}
	removeEventListener(_type: "geometrychange", listener: () => void) {
		this.listeners.delete(listener);
	}
	geometrychange() {
		for (const listener of this.listeners) listener();
	}
}

function Probe() {
	const { titlebar } = useLayout();
	return h("output", { "data-end": String(titlebar.end) });
}

let view: Mounted | undefined;
let overlay: FakeOverlay;
const end = () => Number(view!.find("output").getAttribute("data-end"));
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

beforeEach(() => {
	overlay = new FakeOverlay();
	Object.defineProperty(navigator, "windowControlsOverlay", { configurable: true, value: overlay });
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform: "win32" } });
	setWidth(1202);
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	Reflect.deleteProperty(navigator, "windowControlsOverlay");
	Reflect.deleteProperty(window, "lyra");
});

test("maximising and restoring keep the buttons' 138px reserved while the width catches up", async () => {
	view = await mount(h(LayoutProvider, { children: h(Probe) }));
	assert.equal(end(), 138);

	// Maximise: the new rect arrives while the page still believes it is 1202 wide.
	overlay.rect = { x: 0, right: 1399, width: 1399 };
	await act(async () => overlay.geometrychange());
	assert.equal(end(), 138, "1202 − 1399 is not the buttons' width; nothing new is known yet");
	setWidth(1536);
	await act(async () => window.dispatchEvent(new Event("resize")));
	assert.equal(end(), 137);

	// Restore: the rect shrinks while the page still believes it is 1536 wide.
	overlay.rect = { x: 0, right: 1064, width: 1064 };
	await act(async () => overlay.geometrychange());
	assert.equal(end(), 137, "1536 − 1064 would push the buttons to the middle of the row");
	setWidth(1202);
	await act(async () => window.dispatchEvent(new Event("resize")));
	assert.equal(end(), 138);
});

test("a geometry change that no resize follows is still read, once it has settled", async () => {
	view = await mount(h(LayoutProvider, { children: h(Probe) }));
	// The system's own title bar metrics changing: the buttons widen, the window does not.
	overlay.rect = { x: 0, right: 1040, width: 1040 };
	await act(async () => overlay.geometrychange());
	await act(() => new Promise((resolve) => setTimeout(resolve, OVERLAY_SETTLE_MS + 50)));
	assert.equal(end(), 162);
});
