/**
 * The status bar item: reaching the app without going through its window.
 *
 * What it is for is starting something. An agent runs for minutes at a time, so the window spends
 * most of its life closed or behind something else, and "I want to ask it one thing" should not
 * begin with finding a window. What the menu offers is in `tray-menu.ts`, which is the same list
 * on every platform; this file is how it is raised, which is not.
 *
 * **How the menu opens.** macOS attaches it to the right button only: `setContextMenu` there takes
 * the click event entirely, so the item would stop toggling the window and only ever open a menu.
 * Windows and Linux hand the menu to the system with `setContextMenu` and keep raising `click` for
 * the left button — which is both the platform convention and the only thing that reliably works,
 * since a `right-click` handler competes with the system's own handling of that button. That was
 * the bug: the menu existed and could not be opened.
 *
 * Icon handling differs by platform in a way that is not cosmetic either:
 *
 *   - macOS gets a template image, which the system fills with the menu bar's own foreground
 *     colour. That is the only correct answer there, because the menu bar inverts under a dark
 *     wallpaper, under a pulled-down menu and under an active-app highlight — a fixed bitmap is
 *     wrong in at least one of those, whichever one it is drawn for.
 *   - Windows and Linux have no equivalent, and their notification areas are full of colour
 *     already, so they get the artwork as drawn — one bitmap per display scaling, no theme
 *     switching, since a drawing with its own outline reads on a light taskbar and a dark one.
 *
 * Both come out of `scripts/make-tray-icons.mjs`, from two source drawings.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";
import { trayMenu, type TrayAction, type TrayCommand, type TrayItem } from "./tray-menu.ts";
import { resolveNativeLocale } from "./i18n.ts";
import { settings } from "./app-settings.ts";
import { autostartArgv, autostartFile, readAutostart, writeAutostart } from "./linux-autostart.ts";

export type { TrayCommand } from "./tray-menu.ts";

export interface TrayActions {
	/** Bring the window up, creating it if it is gone, and run `then` once it can receive events. */
	reveal: (then?: () => void) => void;
	/** The live window, or null when there is none. */
	window: () => Electron.BrowserWindow | null;
	send: (command: TrayCommand) => void;
	/** Open one conversation, by id — the only menu item with a subject. */
	openSession: (id: string) => void;
	/**
	 * The most recent conversations, newest first.
	 *
	 * Read when the menu is built rather than held, because it changes while the app runs and a
	 * status bar menu is looked at precisely when nothing else is on screen to be trusted.
	 */
	recent: () => { id: string; title: string }[];
}

let tray: Tray | null = null;
let actions: TrayActions | null = null;

/**
 * Where the icons are, packaged or not — the same two-place search the app icon does.
 *
 * Returns undefined rather than a wrong path: Electron falls back to an empty image on a missing
 * file without complaining, and an invisible status bar item is a much worse thing to debug than
 * a missing one.
 */
function iconPath(name: string): string | undefined {
	const base = app.getAppPath();
	return [
		join(base, "build", "tray", name),
		join(base, "..", "build", "tray", name),
		join(process.resourcesPath ?? "", "build", "tray", name),
	].find((path) => existsSync(path));
}

function currentIcon(): Electron.NativeImage {
	if (process.platform === "darwin") {
		const path = iconPath("trayTemplate.png");
		const image = path ? nativeImage.createFromPath(path) : nativeImage.createEmpty();
		// Belt and braces: the `Template` suffix already means this, but only when the file is
		// loaded from disk under that name — and being wrong here costs a black square on a black
		// menu bar.
		image.setTemplateImage(true);
		return image;
	}

	/*
	 * Windows and Linux get the artwork in colour, which is also why there is only one of it now.
	 *
	 * There used to be two — a light fill and a dark one, swapped on `nativeTheme` — because the
	 * icon was a flat silhouette and a flat silhouette is invisible against a taskbar of its own
	 * shade. A drawing with its own palette and its own outline has no such problem: it reads the
	 * same on a white taskbar, a black one, and the accent-coloured one Windows uses when a window
	 * is maximised. The theme listener went with it.
	 *
	 * `@1.25x`, `@1.5x` and `@2x` sit beside this file and Electron picks whichever matches the
	 * display — see the sizes in `scripts/make-tray-icons.mjs` for why they are made rather than
	 * resampled.
	 */
	const path = iconPath("tray.png");
	return path ? nativeImage.createFromPath(path) : nativeImage.createEmpty();
}

/** Whether the app is set to start with the system, as the system itself reports it. */
function launchAtLogin(): boolean {
	// Electron's login items are macOS and Windows only; Linux reads its XDG autostart entry.
	if (process.platform === "linux") return readAutostart(autostartFile(process.env, homedir()));
	try {
		return app.getLoginItemSettings().openAtLogin;
	} catch {
		return false;
	}
}

function setLaunchAtLogin(enabled: boolean): void {
	if (process.platform === "linux") {
		const argv = autostartArgv({ appImage: process.env.APPIMAGE, packaged: app.isPackaged, execPath: process.execPath, appPath: app.getAppPath() });
		writeAutostart(autostartFile(process.env, homedir()), enabled, argv);
		return;
	}
	app.setLoginItemSettings({ openAtLogin: enabled });
}

function perform(action: TrayAction): void {
	switch (action.kind) {
		case "toggle-window": {
			const window = actions?.window();
			if (window?.isVisible() && !window.isMinimized()) window.hide();
			else actions?.reveal();
			break;
		}
		case "command":
			actions?.send(action.command);
			break;
		case "open-session":
			actions?.openSession(action.id);
			break;
		case "toggle-login":
			try {
				setLaunchAtLogin(!launchAtLogin());
			} catch {
				// Nothing to report to: this is a menu item, and the tick simply stays where it was.
			}
			refreshMenu();
			break;
		case "quit":
			/*
			 * The one way out on Windows and Linux, where closing the window only hides it.
			 * `app.quit()` rather than `exit`, so `before-quit` still gets to shut down the
			 * sessions, the shells and the sync server.
			 */
			app.quit();
			break;
	}
}

function toTemplate(items: TrayItem[]): Electron.MenuItemConstructorOptions[] {
	return items.map((item) => {
		if (item.type === "separator") return { type: "separator" };
		if (item.type === "submenu") return { label: item.label, submenu: toTemplate(item.items) };
		return {
			label: item.label,
			...(item.checked === undefined ? {} : { type: "checkbox" as const, checked: item.checked }),
			...(item.enabled === false ? { enabled: false } : {}),
			click: () => perform(item.action),
		};
	});
}

function buildMenu(): Electron.Menu {
	return Menu.buildFromTemplate(
		toTemplate(
			trayMenu({
				windowVisible: actions?.window()?.isVisible() ?? false,
				recent: actions?.recent() ?? [],
				launchAtLogin: launchAtLogin(),
				locale: resolveNativeLocale(settings().uiLocale, app.getLocale()),
			}),
		),
	);
}

/**
 * Put the current menu in place.
 *
 * Rebuilt rather than kept, because three things in it change while the app runs: whether there is
 * a window, which conversations are recent, and whether the app starts with the system.
 *
 * On macOS this is the menu the *next* right-click will pop up — it is passed to `popUpContextMenu`
 * at that moment, so it is always current. On Windows and Linux the system owns the raising, so
 * the menu has to be handed over in advance and refreshed whenever one of those three changes.
 */
export function refreshMenu(): void {
	if (!tray || process.platform === "darwin") return;
	tray.setContextMenu(buildMenu());
}

export function createTray(next: TrayActions): void {
	if (tray) return;
	actions = next;

	/*
	 * An empty image would still make a status bar item, just an invisible one — indistinguishable
	 * from the tray having failed outright, and impossible to click your way back from. Say so
	 * instead: the icons are generated and committed, so a miss here means either the generator
	 * has not been run or the packaging did not carry `build/tray`.
	 */
	const image = currentIcon();
	if (image.isEmpty()) {
		console.warn(`[lyra] 状态栏图标找不到（appPath=${app.getAppPath()}），跳过。跑 pnpm tray:icons 生成。`);
		return;
	}

	tray = new Tray(image);
	tray.setToolTip("Lyra");

	tray.on("click", () => {
		perform({ kind: "toggle-window" });
		refreshMenu();
	});

	if (process.platform === "darwin") {
		// The menu is built at the moment it is raised, so it never needs refreshing.
		tray.on("right-click", () => tray?.popUpContextMenu(buildMenu()));
	} else {
		refreshMenu();
	}
}

export function destroyTray(): void {
	tray?.destroy();
	tray = null;
	actions = null;
}

/** Whether a status bar item exists, which is what decides if closing a window may hide it. */
export function hasTray(): boolean {
	return tray !== null;
}
