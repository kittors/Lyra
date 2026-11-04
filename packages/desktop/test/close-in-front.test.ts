/**
 * Ctrl+W in the main window on Windows and Linux peels one layer at a time: the panel in front on
 * the screen being worked in, then that screen, and never the window. It used to be the menu's
 * `close`, which hid the whole window into a tray icon Windows 11 keeps out of sight.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { frontToClose } from "../src/features/split/close-in-front.ts";

const base = { open: [] as string[], active: null, focused: null, screens: 1, sessionId: "a" };

test("the panel holding keyboard focus goes first", () => {
	assert.deepEqual(frontToClose({ ...base, open: ["terminal", "review"], active: "terminal", focused: "review" }), { pane: "terminal" });
});

test("with focus in the conversation, the panel last brought forward goes", () => {
	assert.deepEqual(frontToClose({ ...base, open: ["terminal", "review"], active: "conversation", focused: "terminal" }), { pane: "terminal" });
});

test("with nothing to go by, the last panel in the layout goes", () => {
	assert.deepEqual(frontToClose({ ...base, open: ["terminal", "chat"], focused: "conversation" }), { pane: "chat" });
	// A focus record for a panel that has since closed is no answer either.
	assert.deepEqual(frontToClose({ ...base, open: ["review"], focused: "terminal" }), { pane: "review" });
});

test("a screen with no panels left closes itself when there are others", () => {
	assert.deepEqual(frontToClose({ ...base, screens: 2 }), { screen: "a" });
});

test("a blank screen is not closed by the key — it has no close button either", () => {
	assert.equal(frontToClose({ ...base, screens: 2, sessionId: null }), null);
});

test("one screen with only its conversation: nothing closes, the window stays", () => {
	assert.equal(frontToClose(base), null);
});
