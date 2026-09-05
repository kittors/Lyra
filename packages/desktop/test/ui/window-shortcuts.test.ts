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
	const toggle = mock.method(useDock.getState(), "toggle", () => {});
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
			assert.equal(toggle.mock.calls.at(-1)?.arguments[0], kind);
		}
	} finally {
		toggle.mock.restore();
		await view.unmount();
	}
});
