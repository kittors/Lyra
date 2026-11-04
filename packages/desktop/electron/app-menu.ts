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
 * The one item that is not a role is Ctrl+W on Windows and Linux, and it has no label either: the
 * menu bar is hidden there, so it is only ever an accelerator.
 * A development run returns null and keeps Electron's default, reload and DevTools included.
 */

import type { MenuItemConstructorOptions } from "electron";

export function applicationMenuTemplate(options: {
	platform: string;
	packaged: boolean;
	/**
	 * Ctrl+W on Windows and Linux, with the window it was pressed in. Main decides what to close:
	 * a conversation or panel window, never the main one — see the template below.
	 */
	closeAuxiliary?: (win: unknown) => void;
}): MenuItemConstructorOptions[] | null {
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
		/*
		 * No `minimize`. The menu bar is hidden here, so a role is nothing but its accelerator, and
		 * minimise's is Ctrl+M — macOS's ⌘M carried over to a keyboard where no Windows program uses
		 * it. Pressed while typing, the window vanished to the taskbar. The title bar's own button
		 * and Win+↓ are how a window is minimised on Windows.
		 *
		 * No `close` either, for the same reason with a worse outcome. Its Ctrl+W closed whichever
		 * window had focus, and the main window closes into the tray, which Windows 11 tucks into the
		 * "^" overflow: pressed in the composer — where Windows users close a tab or a pane with it —
		 * the app seemed to have quit. The main window's Ctrl+W is the renderer's now (`closeInFront` in `app/shortcuts.ts`:
		 * the pane in front, then the screen). This item is what is left of `close`: a menu
		 * accelerator only fires for a key the page did not handle, so the terminal's Ctrl+W still
		 * reaches the shell, and the conversation and panel windows still close on it.
		 */
		{
			role: "windowMenu",
			submenu: [{ role: "togglefullscreen" }, { accelerator: "Ctrl+W", click: (_item, win) => options.closeAuxiliary?.(win) }],
		},
	];
}
