/**
 * Registering the screenshot shortcut, and saying so when it did not work.
 *
 * `globalShortcut.register` returns false when another application holds the combination — the
 * default Alt+A is WeChat's screenshot key on Windows — and throws on one it cannot parse. Both
 * were written to the console and nowhere else, so the setting showed a shortcut that did nothing.
 * And settings synced from a Mac may say `Cmd+…`, which on Windows means the Windows key rather
 * than Ctrl, and so never registers there.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeShortcut, registerShortcut, shortcutFailureKey } from "../electron/accelerator.ts";

test("Cmd and Command become CommandOrControl, and Option becomes Alt", () => {
	assert.equal(normalizeShortcut("Cmd+Shift+S"), "CommandOrControl+Shift+S");
	assert.equal(normalizeShortcut("command+option+a"), "CommandOrControl+Alt+a");
	// Already portable, or not a modifier at all: left alone.
	assert.equal(normalizeShortcut("CommandOrControl+Shift+S"), "CommandOrControl+Shift+S");
	assert.equal(normalizeShortcut(" Alt+A "), "Alt+A");
	assert.equal(normalizeShortcut("Ctrl+Plus"), "Ctrl+Plus");
});

test("what is registered is the normalised accelerator", () => {
	const asked: string[] = [];
	const outcome = registerShortcut({ raw: "Cmd+Shift+2", enabled: true, register: (accelerator) => (asked.push(accelerator), true) });
	assert.deepEqual(asked, ["CommandOrControl+Shift+2"]);
	assert.deepEqual(outcome, { state: "registered", shortcut: "CommandOrControl+Shift+2" });
});

test("a combination another app holds is reported as taken, not swallowed", () => {
	assert.deepEqual(registerShortcut({ raw: "Alt+A", enabled: true, register: () => false }), { state: "taken", shortcut: "Alt+A" });
});

test("one Electron cannot parse is reported as invalid", () => {
	const outcome = registerShortcut({
		raw: "Hyper+Q",
		enabled: true,
		register: () => {
			throw new Error("Error processing argument at index 0, conversion failure from Hyper+Q");
		},
	});
	assert.equal(outcome.state, "invalid");
	assert.equal(outcome.state === "invalid" && outcome.shortcut, "Hyper+Q");
});

test("switched off or left empty, nothing is registered and nothing is wrong", () => {
	let called = false;
	const register = () => ((called = true), true);
	assert.deepEqual(registerShortcut({ raw: "Alt+A", enabled: false, register }), { state: "off" });
	assert.deepEqual(registerShortcut({ raw: "  ", enabled: true, register }), { state: "off" });
	assert.deepEqual(registerShortcut({ raw: undefined, enabled: true, register }), { state: "off" });
	assert.equal(called, false);
});

test("the same failure is announced once, however many times settings are saved", () => {
	const taken = { state: "taken", shortcut: "Alt+A" } as const;
	assert.equal(shortcutFailureKey(taken), "taken:Alt+A");
	assert.equal(shortcutFailureKey({ state: "registered", shortcut: "Alt+A" }), null);
	assert.equal(shortcutFailureKey({ state: "off" }), null);
	// A different combination failing is a different thing to say.
	assert.notEqual(shortcutFailureKey(taken), shortcutFailureKey({ state: "taken", shortcut: "Alt+S" }));
});
