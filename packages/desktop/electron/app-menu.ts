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
 * Roles only: Electron supplies the names, so nothing anyone reads is written here in one language.
 * The one item that is not a role is Ctrl+W on Windows and Linux. Its label is never drawn — the
 * menu bar is hidden there — but it cannot be left out: see the item.
 * A development run returns null and keeps Electron's default, reload and DevTools included.
 */

import type { MenuItemConstructorOptions } from "electron";

/*
 * Zoom, which left with the View menu: Ctrl/⌘ with = - 0, as in every browser and in Codex and VS Code.
 *
 * The roles' own accelerator for zooming in is CmdOrCtrl+Plus, which on a US or Chinese keyboard
 * is Ctrl+Shift+= — the default menu of a development run showed it: Ctrl+- zoomed out and Ctrl+=
 * did nothing. So the keys are spelled out. A focused terminal keeps them: a menu accelerator only
 * fires for a key the page did not handle, and xterm takes Ctrl+- as readline's undo.
 */
const ZOOM: MenuItemConstructorOptions[] = [
	{ role: "zoomIn", accelerator: "CommandOrControl+=" },
	{ role: "zoomOut", accelerator: "CommandOrControl+-" },
	{ role: "resetZoom", accelerator: "CommandOrControl+0" },
];

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
					...ZOOM,
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
			submenu: [
				{ role: "togglefullscreen" },
				...ZOOM,
				/*
				 * The label is never drawn, which is why it is not translated, but Electron refuses an
				 * item with none of label, role or type — and `type: "normal"` alone is refused as well
				 * (measured on 43.4.1). 0.9.33 shipped this item bare: `Menu.buildFromTemplate` threw
				 * before the app had a window, and every Windows launch ended on the boot screen.
				 */
				{ label: "Close Window", accelerator: "Ctrl+W", click: (_item, win) => options.closeAuxiliary?.(win) },
			],
		},
	];
}

/**
 * Set the menu, and never let a bad one stop the app.
 *
 * This runs first in `whenReady`, before the IPC handlers and the window. When it threw in 0.9.33,
 * everything after it was skipped: no window on the first launch, and the one a second launch
 * opened sat on the boot screen for good, every call to the main process answering "No handler
 * registered". A missing menu costs a few shortcuts; that cost the whole app. The template is held
 * to Electron's rule in `app-menu.test.ts` — this is for whatever that does not catch.
 */
export function applyApplicationMenu<M>(
	template: MenuItemConstructorOptions[] | null,
	menu: { buildFromTemplate(template: MenuItemConstructorOptions[]): M; setApplicationMenu(built: M): void },
	report: (error: unknown) => void = (error) => console.error("[menu] application menu not set:", error),
): void {
	if (!template) return;
	try {
		menu.setApplicationMenu(menu.buildFromTemplate(template));
	} catch (error) {
		report(error);
	}
}
