/**
 * Android's back button, which is the one part of the phone build this machine cannot run.
 *
 * There is no Android emulator here, so these are the checks standing in for it. They are written
 * against the two failures that matter: an app that quits when you meant to close a drawer, and an
 * app you cannot quit at all.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ARM_MS, backPress, layerDepth, type BackState } from "../src/back.ts";

test("with a drawer open, back closes it and nothing else", () => {
	assert.deepEqual(backPress({ depth: 1 }, 1000), { do: "close" });
});

test("closing never exits, however many times it takes", () => {
	// A drawer over a dialog is two presses to get out of, and neither of them should be the last.
	let state: BackState = { depth: 2 };
	assert.deepEqual(backPress(state, 1000), { do: "close" });
	state = { depth: 1 };
	assert.deepEqual(backPress(state, 1100), { do: "close" });
});

test("with nothing open, the first press warns rather than quitting", () => {
	/*
	 * Quitting on a single press is how you lose a half-typed message to a thumb that brushed the
	 * navigation bar — and on this app that means losing it on the desktop too.
	 */
	const action = backPress({ depth: 0 }, 5000);
	assert.equal(action.do, "warn");
	assert.equal(action.do === "warn" && action.state.armedAt, 5000);
});

test("a second press straight after does quit", () => {
	const warned = backPress({ depth: 0 }, 5000);
	assert.ok(warned.do === "warn");
	assert.deepEqual(backPress(warned.state, 5300), { do: "exit" });
});

test("but a press after the warning has expired starts over", () => {
	// Otherwise a press now and another one a minute later reads as a double press.
	const warned = backPress({ depth: 0 }, 5000);
	assert.ok(warned.do === "warn");
	assert.equal(backPress(warned.state, 5000 + ARM_MS + 1).do, "warn");
});

test("right on the boundary is still the same intention", () => {
	const warned = backPress({ depth: 0 }, 0);
	assert.ok(warned.do === "warn");
	assert.deepEqual(backPress(warned.state, ARM_MS - 1), { do: "exit" });
});

test("opening something between two presses cancels the exit", () => {
	/*
	 * Press back on an empty screen, open a drawer, press back again: the second press means close
	 * the drawer, not quit — the armed state is still there but the depth outranks it.
	 */
	const warned = backPress({ depth: 0 }, 1000);
	assert.ok(warned.do === "warn");
	assert.deepEqual(backPress({ ...warned.state, depth: 1 }, 1200), { do: "close" });
});

/** A stand-in for the pieces of the document this reads. */
function doc(elements: { attrs: string[] }[]) {
	return {
		querySelectorAll(selector: string) {
			const wanted = selector === '[data-pane="drawer"]' ? "data-pane" : "aria-modal";
			return elements
				.filter((el) => el.attrs.includes(wanted))
				.map((el) => ({ hasAttribute: (name: string) => el.attrs.includes(name) }));
		},
	};
}

test("a closed drawer is not a layer", () => {
	// It is in the document at all times; `inert` is what says it is not on screen.
	assert.equal(layerDepth(doc([{ attrs: ["data-pane", "aria-modal", "inert"] }])), 0);
});

test("an open drawer is one layer, counted once", () => {
	/*
	 * The drawer is itself `aria-modal` while it is one, so a naive count finds it twice — and a
	 * depth of 2 means the back button appears to do nothing on the press that should have closed
	 * it.
	 */
	assert.equal(layerDepth(doc([{ attrs: ["data-pane", "aria-modal"] }])), 1);
});

test("a dialog over an open drawer is two", () => {
	assert.equal(layerDepth(doc([{ attrs: ["data-pane", "aria-modal"] }, { attrs: ["aria-modal"] }])), 2);
});

test("a dialog on its own is one", () => {
	assert.equal(layerDepth(doc([{ attrs: ["data-pane", "aria-modal", "inert"] }, { attrs: ["aria-modal"] }])), 1);
});

test("an empty screen is nothing", () => {
	assert.equal(layerDepth(doc([])), 0);
});
