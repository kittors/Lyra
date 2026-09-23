import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { useShortcuts } from "../../src/app/shortcuts.ts";
import { useDock } from "../../src/features/dock/index.ts";
import { mount, press, fire } from "../helpers/mount.ts";

function Harness({ toggleNav }: { toggleNav(): void }) {
	useShortcuts({ enabled: true, compact: false, navOpen: true, activeSessionId: "test",
		workspace: null, toggleNav, dismissNav() {} });
	return h("textarea");
}

test("global toggles leave consumed, composing and repeating keys alone", async () => {
	let toggles = 0;
	const view = await mount(h(Harness, { toggleNav: () => toggles++ }));
	try {
		const input = view.find("textarea");
		input.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
		await press(input, "b", { code: "KeyB", ctrlKey: true });
		assert.equal(toggles, 0, "a control already consumed Ctrl+B");
		await press(input, "b", { code: "KeyB", ctrlKey: true, isComposing: true });
		await press(input, "b", { code: "KeyB", ctrlKey: true, repeat: true });
		await press(input, "B", { code: "KeyB", ctrlKey: true, shiftKey: true });
		assert.equal(toggles, 0);
		await press(input, "b", { code: "KeyB", ctrlKey: true });
		assert.equal(toggles, 1);
	} finally {
		await view.unmount();
	}
});

test("every advertised panel shortcut opens its panel, including a home terminal", async () => {
	const open = mock.method(useDock.getState(), "open", () => {});
	const view = await mount(h(Harness, { toggleNav() {} }));
	try {
		for (const [key, code, extra, kind] of [
			["t", "KeyT", {}, "browser"],
			["j", "KeyJ", {}, "tasks"],
			["a", "KeyA", { altKey: true }, "subagents"],
			["`", "Backquote", {}, "terminal"],
		] as const) {
			const event = new KeyboardEvent("keydown", { key, code, ctrlKey: true, bubbles: true, ...extra });
			// happy-dom aliases AltGraph to Alt; Chromium distinguishes these modifiers.
			Object.defineProperty(event, "getModifierState", { value: () => false });
			await fire(view.find("textarea"), event);
			assert.equal(open.mock.calls.at(-1)?.arguments[0], kind);
		}
	} finally {
		open.mock.restore();
		await view.unmount();
	}
});

/** A keydown as Chromium sends it: no AltGraph, which happy-dom would otherwise infer from Alt. */
function keydown(key: string, code: string, init: KeyboardEventInit = {}) {
	const event = new KeyboardEvent("keydown", { key, code, ctrlKey: true, bubbles: true, cancelable: true, ...init });
	Object.defineProperty(event, "getModifierState", { value: () => false });
	return event;
}

test("a letter shortcut is the key labelled with that letter, on any Latin layout", async () => {
	let toggles = 0;
	const original = useDock.getState().open;
	const opened: string[] = [];
	useDock.setState({ open: (kind: string) => void opened.push(kind) } as never);
	const view = await mount(h(Harness, { toggleNav: () => toggles++ }));
	try {
		const input = view.find("textarea");
		// Dvorak: the key labelled B sits where QWERTY has N.
		await fire(input, keydown("b", "KeyN"));
		assert.equal(toggles, 1, "Ctrl+B on Dvorak is the key labelled B");
		await fire(input, keydown("x", "KeyB"));
		assert.equal(toggles, 1, "the key in QWERTY's B position is X on Dvorak, and is not Ctrl+B");

		// AZERTY: A and Q trade places. Ctrl+Alt+A is the key labelled A, not the one labelled Q.
		await fire(input, keydown("a", "KeyQ", { altKey: true }));
		assert.deepEqual(opened, ["subagents"]);
		await fire(input, keydown("q", "KeyA", { altKey: true }));
		assert.deepEqual(opened, ["subagents"], "the key labelled Q must not open the sub-agent pane");
	} finally {
		useDock.setState({ open: original } as never);
		await view.unmount();
	}
});

test("layouts with no Latin letters, and macOS Option, fall back to the key's position", async () => {
	let toggles = 0;
	const original = useDock.getState().open;
	const opened: string[] = [];
	useDock.setState({ open: (kind: string) => void opened.push(kind) } as never);
	const view = await mount(h(Harness, { toggleNav: () => toggles++ }));
	try {
		const input = view.find("textarea");
		// Russian ЙЦУКЕН: the key in B's position types "и"; there is no Latin B to press instead.
		await fire(input, keydown("и", "KeyB"));
		assert.equal(toggles, 1);
		// macOS Option is a dead-key modifier: ⌥⌘S arrives as "ß" (the reason this used `code`).
		await fire(input, keydown("ß", "KeyS", { ctrlKey: false, metaKey: true, altKey: true }));
		assert.deepEqual(opened, ["chat"]);
	} finally {
		useDock.setState({ open: original } as never);
		await view.unmount();
	}
});
