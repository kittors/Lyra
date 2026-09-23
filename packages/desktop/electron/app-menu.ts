/**
 * The application menu of a packaged build.
 *
 * Nothing set one before, so every release carried Electron's default — including its View menu:
 * Ctrl+R / Ctrl+Shift+R reload the entire interface (a half-written message, an open dialog, the
 * scroll position of every pane), and Ctrl+Shift+I opens DevTools. The renderer's own shortcut
 * handlers are unmounted while the settings page is open, so ⌘⇧R pressed there went straight to a
 * forced reload.
 *
 * What stays is what something depends on:
 *
 *   - Edit. On macOS a text field's ⌘C, ⌘V, ⌘X, ⌘Z and ⌘A are dispatched through the Edit menu's
 *     roles; with no Edit menu they do nothing in any input in the app.
 *   - Window, with full screen moved into it now that View is gone (⌃⌘F on macOS, F11 elsewhere),
 *     and Close — ⌘W / Ctrl+W came from the default menu, and the renderer does not handle it.
 *   - On macOS the application menu, which is where Quit, Hide and About live.
 *
 * Roles only, no labels: Electron supplies the names, so nothing here is written in one language.
 * A development run returns null and keeps Electron's default, reload and DevTools included.
 */

import type { MenuItemConstructorOptions } from "electron";

export function applicationMenuTemplate(options: { platform: string; packaged: boolean }): MenuItemConstructorOptions[] | null {
	if (!options.packaged) return null;
	if (options.platform === "darwin") {
		return [
			{ role: "appMenu" },
			{ role: "editMenu" },
			{
				role: "windowMenu",
				submenu: [
					{ role: "minimize" },
					{ role: "zoom" },
					{ role: "togglefullscreen" },
					{ type: "separator" },
					// ⌘W, which lived in the default File menu.
					{ role: "close" },
					{ role: "front" },
				],
			},
		];
	}
	return [
		{ role: "editMenu" },
		// `close` is Ctrl+W, which the default menu already bound; keeping it is not a new shortcut.
		{ role: "windowMenu", submenu: [{ role: "minimize" }, { role: "togglefullscreen" }, { role: "close" }] },
	];
}
