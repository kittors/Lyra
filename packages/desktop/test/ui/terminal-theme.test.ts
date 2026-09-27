/**
 * The built-in terminal takes a new theme in the same moment as everything around it.
 *
 * xterm paints to its own surface, so its colours are pushed in by hand rather than picked up from
 * CSS. They used to be pushed from the terminal's own effect, which React runs before the effect in
 * `App` that writes the theme onto the document — so the terminal read the `dark` class and the code
 * background of the theme being left, and showed them until something re-ran it. Measured in a real
 * window: one to two painted frames late after a switch in settings, and never at all when the system
 * appearance changed under 「跟随系统」, since nothing in React changes then.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h, useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { DEFAULT_APPEARANCE, type AppearanceSettings, type Settings } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { applyAppearance } from "../../src/features/settings/theme.ts";
import { TerminalPane } from "../../src/features/terminal/TerminalPane.tsx";
import { useTerminals } from "../../src/store/terminals.ts";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

/** How light a colour is, 0 to 1; the terminal's background is either clearly one or clearly the other. */
function lightness(colour: string | undefined): number {
	const hex = /^#?([0-9a-f]{6})$/i.exec(colour?.trim() ?? "")?.[1];
	if (!hex) throw new Error(`not a colour: ${colour}`);
	const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The app's own order: the theme is written by the parent's effect, after every child's effect has run. */
function Themed() {
	const appearance = useApp((s) => s.settings?.appearance);
	useEffect(() => {
		if (appearance) applyAppearance(appearance);
	}, [appearance]);
	return h(TerminalPane);
}

function settingsWith(appearance: AppearanceSettings): Settings {
	return { appearance } as Settings;
}

async function mountTerminal(t: import("node:test").TestContext, appearance: AppearanceSettings) {
	const css = Object.getOwnPropertyDescriptor(globalThis, "CSS");
	Object.defineProperty(globalThis, "CSS", { value: window.CSS, configurable: true });
	const built: Terminal[] = [];
	const additions: Record<string, unknown> = {
		focus() {},
		reset() {},
		onData: () => ({ dispose() {} }),
		cols: 80,
		rows: 24,
		// Every terminal the pane builds, so the test can read the options it was left with.
		open(this: Terminal) {
			built.push(this);
		},
	};
	for (const [name, value] of Object.entries(additions)) {
		const original = Object.getOwnPropertyDescriptor(Terminal.prototype, name);
		Object.defineProperty(Terminal.prototype, name, { value, configurable: true });
		t.after(() => {
			if (original) Object.defineProperty(Terminal.prototype, name, original);
			else Reflect.deleteProperty(Terminal.prototype, name);
		});
	}
	t.after(() => {
		if (css) Object.defineProperty(globalThis, "CSS", css);
		else Reflect.deleteProperty(globalThis, "CSS");
	});
	const tabs = [{ id: "shell", title: "zsh" }];
	Reflect.set(window, "lyra", {
		terminal: {
			listAll: async () => tabs,
			list: async () => tabs,
			attach: async (id: string) => ({ id, epoch: 1, replay: "" }),
			detach: () => {},
			onData: () => () => {},
			onExit: () => () => {},
		},
	});
	window.localStorage.clear();
	useTerminals.setState({ tabs, active: "", activeByScope: { scope: "shell" } });
	useApp.setState({ settings: settingsWith(appearance), workspace: null, meta: null, activeSessionId: "scope" });
	// The app themed itself long before anyone opened a terminal; start each case from its own theme.
	applyAppearance(appearance);
	const view = await mount(h(SessionScope.Provider, { value: "scope" }, h(Themed)));
	// Unmounted while the bridge is still there: the pane detaches its shell on the way out.
	t.after(async () => {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	});
	const terminal = built.at(-1);
	if (!terminal) throw new Error("the pane built no terminal");
	return terminal;
}

test("switching the theme in settings recolours the terminal in the same commit", async (t) => {
	const light = { ...DEFAULT_APPEARANCE, theme: "light" as const };
	const terminal = await mountTerminal(t, light);
	assert.ok(lightness(terminal.options.theme?.background) > 0.75, `starts light: ${terminal.options.theme?.background}`);

	await act(async () => useApp.setState({ settings: settingsWith({ ...light, theme: "dark" }) }));
	assert.ok(document.documentElement.classList.contains("dark"), "the document took the dark theme");
	assert.ok(
		lightness(terminal.options.theme?.background) < 0.35,
		`the terminal is still on the theme being left: ${terminal.options.theme?.background}`,
	);

	await act(async () => useApp.setState({ settings: settingsWith(light) }));
	assert.ok(lightness(terminal.options.theme?.background) > 0.75, `and back: ${terminal.options.theme?.background}`);
});

test("the system turning dark under 跟随系统 recolours the terminal too", async (t) => {
	const system = { ...DEFAULT_APPEARANCE, theme: "system" as const };
	const match = window.matchMedia;
	let dark = false;
	window.matchMedia = ((query: string) => ({ ...match.call(window, query), matches: query.includes("dark") && dark })) as typeof window.matchMedia;
	t.after(() => {
		window.matchMedia = match;
	});
	const terminal = await mountTerminal(t, system);
	assert.ok(lightness(terminal.options.theme?.background) > 0.75, `starts light: ${terminal.options.theme?.background}`);

	// What `watchSystemTheme` does when the system's appearance changes: nothing in React changes.
	dark = true;
	await act(async () => applyAppearance(system));
	assert.ok(document.documentElement.classList.contains("dark"));
	assert.ok(lightness(terminal.options.theme?.background) < 0.35, `the terminal never followed: ${terminal.options.theme?.background}`);
});
