/**
 * What the Linux (and Windows) packages need from `package.json` and `electron-builder.yml`.
 *
 * None of these can be seen from a macOS build, and each of them was wrong:
 *
 *   - No `desktopName`, so Electron derived one from the package name — `@lyra/desktop.desktop` —
 *     and the Wayland app_id matched no installed `.desktop` file: a generic icon in the dock,
 *     windows not grouped under their launcher, and the GlobalShortcuts portal refusing every
 *     binding without a word.
 *   - The legacy FUSE2 AppImage runtime, which Ubuntu 22.04 and later do not ship: double-clicking
 *     the AppImage did nothing.
 *   - `build/icon.png` was never packaged, so `appIconPath()` was undefined in every release and
 *     Linux windows and notifications had no icon.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { appIconCandidates } from "../electron/app-icon-path.ts";

const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")) as { desktopName?: string };
const builder = parse(readFileSync(join(desktop, "electron-builder.yml"), "utf8")) as {
	executableName: string;
	toolsets?: { appimage?: string };
	linux: { syncDesktopName?: boolean; extraResources?: { from: string; to: string }[] };
	win: { extraResources?: { from: string; to: string }[] };
};

test("desktopName is set, and names the .desktop file the packages already install", () => {
	assert.equal(pkg.desktopName, "Lyra.desktop");
	// electron-builder names the file after `executableName` without it; keeping the two equal means
	// an existing install's launcher, pinned favourite and autostart entry all keep their file.
	assert.equal(pkg.desktopName?.replace(/\.desktop$/, ""), builder.executableName);
	assert.equal(builder.linux.syncDesktopName, true, "the file name must follow desktopName, not drift from it");
});

test("the AppImage uses the static runtime, which needs no libfuse2", () => {
	// "0.0.0" (the default) is the legacy FUSE2 runtime; 1.0.3 is runtime 20251108 with #9598 fixed.
	assert.equal(builder.toolsets?.appimage, "1.0.3");
});

for (const platform of ["linux", "win32"] as const) {
	test(`the ${platform} package carries the app icon where appIconPath looks for it`, () => {
		const section = platform === "linux" ? builder.linux : builder.win;
		const entry = section.extraResources?.find((item) => item.from === "build/icon.png");
		assert.ok(entry, `build/icon.png is not packaged for ${platform}`);
		const [packaged] = appIconCandidates({ platform, packaged: true, appPath: "/A/app.asar", resourcesPath: "/R", moduleDir: "/A/out/main" });
		assert.equal(packaged, join("/R", ...entry.to.split("/")));
	});
}

test("a packaged macOS build keeps using the bundle's own icon", () => {
	// The .icns is what the dock and notifications use there; a PNG would replace it.
	assert.deepEqual(appIconCandidates({ platform: "darwin", packaged: true, appPath: "/A/app.asar", resourcesPath: "/R", moduleDir: "/A/out/main" }), []);
});

test("a development run still finds the icon in the source tree", () => {
	const candidates = appIconCandidates({ platform: "linux", packaged: false, appPath: "/repo/packages/desktop", resourcesPath: "/electron/resources", moduleDir: "/repo/packages/desktop/out/main" });
	assert.ok(candidates.includes(join("/repo/packages/desktop", "build", "icon.png")));
});
