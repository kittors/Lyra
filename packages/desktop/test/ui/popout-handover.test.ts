/**
 * A panel moving to its own window stays where it was until that window is on screen.
 *
 * It used to be closed first and the window asked for second. On the Windows test machine the window
 * then took 2.8s to appear, and for all of that the panel was nowhere — gone from the main window,
 * not yet in its own, the click apparently lost. Now it stays, inert under a note, and leaves when
 * the main process reports the window shown; a window that fails to open leaves nothing to undo.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { popOutPanel, provideScope, usePanelWindows } from "../../src/features/dock/popout.ts";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { has } from "../../src/features/dock/tree.ts";
import "../../src/features/dock/panels/builtin.tsx";

function reset(): void {
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null });
	usePanelWindows.setState({ panels: [], opening: [], leaving: [] });
	provideScope(() => "tile");
	usePaneDock.getState().rememberSize("tile", { width: 1400, height: 800 });
	usePaneDock.getState().open("tile", "terminal");
}

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const here = () => has(usePaneDock.getState().tree("tile"), "terminal");
const leaving = () => usePanelWindows.getState().leaving.map((panel) => panel.kind);

test("the panel stays, inert, until its window is on screen — then it leaves", async () => {
	reset();
	let answer!: (result: { ok: boolean }) => void;
	Reflect.set(window, "lyra", { windows: { openPanel: () => new Promise((resolve) => (answer = resolve)) } });
	const done = popOutPanel({ scope: "tile", kind: "terminal", sessionId: null });
	await tick();
	assert.equal(here(), true, "still here while the window is being asked for");
	assert.deepEqual(leaving(), ["terminal"]);
	answer({ ok: true });
	await tick();
	usePanelWindows.setState({ panels: [{ kind: "terminal", scope: "tile", shown: false }] });
	await tick();
	assert.equal(here(), true, "still here while the window is built but not yet shown");
	usePanelWindows.setState({ panels: [{ kind: "terminal", scope: "tile", shown: true }] });
	assert.equal(await done, true);
	assert.equal(here(), false, "gone the moment the window is on screen");
	assert.deepEqual(leaving(), []);
});

test("a window that fails to open leaves the panel exactly where it was", async () => {
	reset();
	Reflect.set(window, "lyra", { windows: { openPanel: async () => ({ ok: false }) } });
	assert.equal(await popOutPanel({ scope: "tile", kind: "terminal", sessionId: null }), false);
	assert.equal(here(), true);
	assert.deepEqual(leaving(), []);
	assert.deepEqual(usePanelWindows.getState().opening, []);
});
