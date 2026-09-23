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

type Item = { role?: string; type?: string; label?: string; submenu?: Item[] };

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
		// ⌘W / Ctrl+W closed the window through the default menu; the renderer does not handle it.
		assert.ok(present.includes("close"), `closing the window by keyboard went missing on ${platform}`);
	});

	test(`every item on ${platform} is a role, so no label is written here in one language`, () => {
		const template = applicationMenuTemplate({ platform, packaged: true }) as Item[];
		const walk = (items: Item[]): void => {
			for (const item of items) {
				assert.ok(item.role || item.type === "separator", `an item without a role: ${JSON.stringify(item)}`);
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

test("a development run keeps Electron's default menu, reload and DevTools included", () => {
	assert.equal(applicationMenuTemplate({ platform: "darwin", packaged: false }), null);
	assert.equal(applicationMenuTemplate({ platform: "win32", packaged: false }), null);
});
