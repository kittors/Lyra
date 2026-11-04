/**
 * The application menu a packaged build carries.
 *
 * Nothing ever set one, so every release shipped Electron's default: a View menu whose Ctrl+R and
 * Ctrl+Shift+R reload the whole interface — a half-typed message, an open dialog, the scroll
 * position, gone — and whose Ctrl+Shift+I opens DevTools. With the settings page open the renderer
 * stops listening for its own shortcuts, so ⌘⇧R there fell straight through to a forced reload.
 *
 * What must stay is the Edit menu: on macOS a text field's ⌘C, ⌘V, ⌘Z and ⌘A are routed through
 * the Edit menu's roles, and without it they do nothing at all.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applicationMenuTemplate } from "../electron/app-menu.ts";

type Item = { role?: string; type?: string; label?: string; accelerator?: string; click?: (item: unknown, win: unknown) => void; submenu?: Item[] };

function items(list: Item[]): Item[] {
	return list.flatMap((item) => [item, ...items(Array.isArray(item.submenu) ? item.submenu : [])]);
}

function roles(items: Item[]): string[] {
	return items.flatMap((item) => [...(item.role ? [item.role] : []), ...roles(Array.isArray(item.submenu) ? item.submenu : [])]);
}

const GONE = ["reload", "forceReload", "toggleDevTools", "viewMenu"];

for (const platform of ["darwin", "win32", "linux"]) {
	test(`a packaged build on ${platform} has no reload and no DevTools anywhere in its menu`, () => {
		const template = applicationMenuTemplate({ platform, packaged: true }) as Item[] | null;
		assert.ok(template, "a packaged build must set its own menu, or Electron's default stays");
		const present = roles(template);
		for (const role of GONE) assert.ok(!present.includes(role), `${role} is still in the ${platform} menu`);
		assert.ok(present.includes("editMenu"), "the Edit menu is what copy and paste in text fields depend on");
		assert.ok(present.includes("windowMenu"));
	});

	test(`every item on ${platform} is a role, so no label is written here in one language`, () => {
		const template = applicationMenuTemplate({ platform, packaged: true }) as Item[];
		const walk = (items: Item[]): void => {
			for (const item of items) {
				// The one exception is Ctrl+W on Windows and Linux: keyboard-only, never drawn, no label.
				assert.ok(item.role || item.type === "separator" || (item.accelerator && item.click), `an item without a role: ${JSON.stringify(item)}`);
				assert.equal(item.label, undefined);
				if (Array.isArray(item.submenu)) walk(item.submenu);
			}
		};
		walk(template);
	});
}

test("macOS keeps its application menu — Quit, Hide and About live there", () => {
	const present = roles(applicationMenuTemplate({ platform: "darwin", packaged: true }) as Item[]);
	assert.ok(present.includes("appMenu"));
	// Full screen was reachable from the View menu that is gone; ⌃⌘F moves to Window.
	assert.ok(present.includes("togglefullscreen"));
});

for (const platform of ["win32", "linux"]) {
	test(`Ctrl+M does not minimise the window on ${platform}`, () => {
		// The role's accelerator is CmdOrCtrl+M: ⌘M on a Mac, a key that hid the window mid-sentence here.
		const present = roles(applicationMenuTemplate({ platform, packaged: true }) as Item[]);
		assert.ok(!present.includes("minimize"), `minimize (Ctrl+M) is still in the ${platform} menu`);
	});
}

test("⌘W still closes the window on macOS, where it is the system's own shortcut", () => {
	assert.ok(roles(applicationMenuTemplate({ platform: "darwin", packaged: true }) as Item[]).includes("close"));
});

for (const platform of ["win32", "linux"]) {
	/*
	 * Ctrl+W closed the main window through the `close` role, which on Windows hid it to a tray
	 * icon that Windows 11 tucks into the "^" overflow: pressed in the composer — where Windows
	 * users close a tab or a pane with it — the whole app seemed to quit. The main window's Ctrl+W
	 * is the renderer's now (pane, then screen); the menu only closes the small windows, as before.
	 */
	test(`Ctrl+W never closes the main window on ${platform}`, () => {
		const template = applicationMenuTemplate({ platform, packaged: true, closeAuxiliary: () => {} }) as Item[];
		assert.ok(!roles(template).includes("close"), "the close role would close whichever window has focus, the main one included");
		const closing = items(template).filter((item) => item.accelerator === "Ctrl+W");
		assert.equal(closing.length, 1);
		const asked: unknown[] = [];
		const hand = applicationMenuTemplate({ platform, packaged: true, closeAuxiliary: (win) => asked.push(win) }) as Item[];
		items(hand).find((item) => item.accelerator === "Ctrl+W")?.click?.({}, "focused-window");
		assert.deepEqual(asked, ["focused-window"], "the window it was pressed in is handed over to decide on");
	});
}

for (const platform of ["darwin", "win32", "linux"]) {
	/*
	 * Zoom went with the View menu. The roles' own zoom-in key is CmdOrCtrl+Plus — Ctrl+Shift+= on a
	 * US or Chinese keyboard, so in a development run Ctrl+- zoomed out and Ctrl+= did nothing.
	 */
	test(`a packaged build on ${platform} zooms with Ctrl/⌘ and = - 0`, () => {
		const all = items(applicationMenuTemplate({ platform, packaged: true }) as Item[]);
		const key = (role: string) => all.find((item) => item.role === role)?.accelerator;
		assert.equal(key("zoomIn"), "CommandOrControl+=");
		assert.equal(key("zoomOut"), "CommandOrControl+-");
		assert.equal(key("resetZoom"), "CommandOrControl+0");
	});
}

test("⌘M still minimises on macOS, where it is the system's own shortcut", () => {
	assert.ok(roles(applicationMenuTemplate({ platform: "darwin", packaged: true }) as Item[]).includes("minimize"));
});

test("a development run keeps Electron's default menu, reload and DevTools included", () => {
	assert.equal(applicationMenuTemplate({ platform: "darwin", packaged: false }), null);
	assert.equal(applicationMenuTemplate({ platform: "win32", packaged: false }), null);
});
