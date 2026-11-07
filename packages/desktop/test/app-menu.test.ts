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

import { applicationMenuTemplate, applyApplicationMenu } from "../electron/app-menu.ts";

type Item = { role?: string; type?: string; label?: string; accelerator?: string; click?: (item: unknown, win: unknown) => void; submenu?: Item[] };

function items(list: Item[]): Item[] {
	return list.flatMap((item) => [item, ...items(Array.isArray(item.submenu) ? item.submenu : [])]);
}

function roles(items: Item[]): string[] {
	return items.flatMap((item) => [...(item.role ? [item.role] : []), ...roles(Array.isArray(item.submenu) ? item.submenu : [])]);
}

/*
 * Electron's own check, copied from `areValidTemplateItems` in lib/browser/api/menu.ts (43.4.1),
 * which `Menu.buildFromTemplate` applies at every depth: an own `label` (even ""), an own `role`,
 * or a separator. Its message says "label, role or type", but no other type passes — measured, a
 * `type: "normal"` item without a label is refused too. 0.9.33 shipped an item with only an
 * accelerator and a click: the throw came first in `whenReady`, before the IPC handlers and the
 * window, and every Windows launch ended on the boot screen. A development run builds no menu, so
 * only a packaged build on Windows or Linux ever reached it — which is why it is checked here.
 */
function electronBuilds(item: Item): boolean {
	return item != null && typeof item === "object" && (Object.hasOwn(item, "label") || Object.hasOwn(item, "role") || item.type === "separator");
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

	test(`every item on ${platform} is one Electron will build`, () => {
		for (const item of items(applicationMenuTemplate({ platform, packaged: true, closeAuxiliary: () => {} }) as Item[])) {
			assert.ok(electronBuilds(item), `Electron refuses an item with no label, no role and no separator type: ${JSON.stringify(item)}`);
		}
	});

	test(`nothing on ${platform} is labelled in one language but the never-drawn Ctrl+W`, () => {
		// Roles carry Electron's own translated names. The one label sits on an item no one sees.
		const labelled = items(applicationMenuTemplate({ platform, packaged: true }) as Item[]).filter((item) => item.label !== undefined);
		assert.deepEqual(
			labelled.map((item) => item.accelerator),
			platform === "darwin" ? [] : ["Ctrl+W"],
		);
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

/*
 * Setting the menu is the first thing startup does, ahead of the IPC handlers and the window. In
 * 0.9.33 its throw skipped all of that, and the window a second launch opened sat on the boot
 * screen for good. Whatever the rule above misses, a refused menu must cost the menu and no more.
 */
test("a menu Electron refuses is reported and skipped, never thrown into startup", () => {
	const reported: unknown[] = [];
	let set = 0;
	const refusing = {
		buildFromTemplate: (): never => {
			throw new TypeError("Invalid template for MenuItem: must have at least one of label, role or type");
		},
		setApplicationMenu: () => {
			set++;
		},
	};
	assert.doesNotThrow(() => applyApplicationMenu([{ accelerator: "Ctrl+W" }], refusing, (error) => reported.push(error)));
	assert.equal(set, 0);
	assert.equal(reported.length, 1);
	assert.match(String(reported[0]), /Invalid template for MenuItem/);
});

test("a menu Electron builds is the one that is set", () => {
	const template = applicationMenuTemplate({ platform: "win32", packaged: true });
	const built = { from: template };
	const set: unknown[] = [];
	const reported: unknown[] = [];
	applyApplicationMenu(
		template,
		{ buildFromTemplate: (given) => (given === template ? built : null), setApplicationMenu: (menu) => set.push(menu) },
		(error) => reported.push(error),
	);
	assert.deepEqual(reported, []);
	assert.equal(set.length, 1);
	assert.equal(set[0], built);
});

test("a development run builds and sets nothing", () => {
	let calls = 0;
	applyApplicationMenu(null, { buildFromTemplate: () => calls++, setApplicationMenu: () => calls++ }, () => calls++);
	assert.equal(calls, 0);
});
