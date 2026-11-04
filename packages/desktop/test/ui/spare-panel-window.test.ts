/**
 * A panel window built ahead of time learns which panel it is when it is taken.
 *
 * On the Windows test machine a pop-out window took 3.0s to paint and 5.2s to draw its terminal —
 * a whole renderer starting up. After the first pop-out the main process now keeps one hidden
 * panel window ready; it boots without a panel, so `bridge.bootWindow` (frozen from argv) can never
 * say which one it holds. The live answer is `useBootWindow`, fed by `windows:assign-panel`.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import { bootWindow, useBootWindow, watchPanelAssignment } from "../../src/services/boot-window.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

type Assignment = { panelKind: string; panelScope: string; sessionId: string | null };

let view: Mounted | undefined;
afterEach(async () => {
	await view?.unmount();
	view = undefined;
	Reflect.deleteProperty(window, "lyra");
});

function Probe() {
	const boot = useBootWindow();
	return h("output", { "data-panel": boot?.panelKind ?? "", "data-scope": boot?.panelScope ?? "", "data-session": boot?.sessionId ?? "" });
}

test("a spare boots with no panel and draws the one it is given", async () => {
	let assign: ((state: Assignment) => void) | null = null;
	const frozen = { id: "w-1", kind: "panel", sessionId: null, panelKind: null, panelScope: null };
	Object.defineProperty(window, "lyra", {
		configurable: true,
		writable: true,
		value: { bootWindow: frozen, windows: { onAssignPanel: (fn: (state: Assignment) => void) => { assign = fn; return () => { assign = null; }; } } },
	});
	view = await mount(h(Probe));
	const stop = watchPanelAssignment();
	const out = () => document.querySelector("output") as HTMLOutputElement;
	assert.equal(out().dataset.panel, "", "a spare holds no panel until it is taken");
	assert.equal(bootWindow(), frozen, "and reads straight through to the preload's answer");

	assert.ok(assign, "the window listens for its assignment");
	await act(async () => assign?.({ panelKind: "tasks", panelScope: "qa-short", sessionId: "qa-short" }));
	assert.deepEqual({ ...out().dataset }, { panel: "tasks", scope: "qa-short", session: "qa-short" });
	assert.equal(bootWindow()?.kind, "panel", "still a panel window");
	assert.equal(bootWindow()?.id, "w-1");
	assert.equal(bootWindow(), bootWindow(), "one snapshot per assignment, or React re-renders forever");
	stop();
});

test("without a preload there is no window to describe, and nothing throws", () => {
	assert.equal(bootWindow(), undefined);
	assert.doesNotThrow(() => watchPanelAssignment()());
});
