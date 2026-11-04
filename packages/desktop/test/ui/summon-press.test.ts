/**
 * Opening a pane with its shortcut moves the keyboard into it — unless the pointer goes down
 * somewhere else first.
 *
 * Red on the Windows CI runner: the side chat was opened, a click put the caret in the conversation,
 * and the side chat's composer — mounting late on a slow machine — took the summons and pulled the
 * keyboard back out of the field just clicked. A press after the `open` now drops the summons.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import "../../src/features/dock/panels/builtin.tsx";

beforeEach(() => {
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null, summoned: null });
	usePaneDock.getState().rememberSize("tile", { width: 1400, height: 800 });
});

// The listener goes by the event's type; the DOM shim has no PointerEvent constructor.
const press = () => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));

test("an open with nothing pressed after it still hands the pane the keyboard", () => {
	usePaneDock.getState().open("tile", "chat");
	assert.equal(usePaneDock.getState().takeSummon("tile", "chat"), true);
});

test("a press after the open drops the summons, so a pane that draws late takes nothing", () => {
	usePaneDock.getState().open("tile", "chat");
	press();
	assert.equal(usePaneDock.getState().takeSummon("tile", "chat"), false);
});

test("the press that opened it came first and drops nothing", () => {
	press();
	usePaneDock.getState().open("tile", "chat");
	assert.equal(usePaneDock.getState().takeSummon("tile", "chat"), true);
});
