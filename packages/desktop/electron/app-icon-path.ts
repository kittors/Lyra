/**
 * Where the application icon file can be, packaged or not.
 *
 * Split out of `window.ts` so the packaged answer can be checked against `electron-builder.yml`
 * without Electron. It used to be a list of six guesses that were all wrong in a release:
 * `build/icon.png` was not in `files` or `extraResources`, so nothing put it anywhere, and
 * `appIconPath()` was undefined in every package ever built. Windows and Linux windows had no
 * icon of their own, and neither did their notifications.
 */

import { join } from "node:path";

export interface IconLocation {
	platform: string;
	packaged: boolean;
	/** `app.getAppPath()`: the source package in development, `…/resources/app.asar` packaged. */
	appPath: string;
	/** `process.resourcesPath`. */
	resourcesPath: string;
	/** The directory of the running main bundle, `out/main`. */
	moduleDir: string;
}

export function appIconCandidates(where: IconLocation): string[] {
	if (where.packaged) {
		/*
		 * macOS: none. The bundle's `.icns` is the icon the dock, the app switcher and notifications
		 * already use, and a PNG handed to `app.dock.setIcon` or a notification would replace it.
		 *
		 * Elsewhere: exactly where the `extraResources` entry for `build/icon.png` puts it.
		 */
		return where.platform === "darwin" ? [] : [join(where.resourcesPath, "build", "icon.png")];
	}
	return [
		join(where.appPath, "build", "icon.png"),
		join(where.appPath, "..", "build", "icon.png"),
		join(where.appPath, "packages", "desktop", "build", "icon.png"),
		join(where.moduleDir, "..", "..", "build", "icon.png"),
	];
}
