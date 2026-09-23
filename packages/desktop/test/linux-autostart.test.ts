/**
 * 「开机时启动」 on Linux, where Electron has no implementation of it.
 *
 * `app.setLoginItemSettings` works on macOS and Windows only; on Linux it does nothing and
 * `getLoginItemSettings` answers false, so the tray's tick never stuck and nothing ever started at
 * login. Linux desktops read `~/.config/autostart/*.desktop` (the XDG autostart spec), and that
 * file is what the item now writes and reads.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	DESKTOP_FILE,
	autostartArgv,
	autostartEnabled,
	autostartEntry,
	autostartFile,
	readAutostart,
	writeAutostart,
} from "../electron/linux-autostart.ts";

test("the file lives under XDG_CONFIG_HOME when it is absolute, ~/.config otherwise", () => {
	assert.equal(autostartFile({ XDG_CONFIG_HOME: "/cfg" }, "/home/me"), join("/cfg", "autostart", DESKTOP_FILE));
	// The spec says a relative value is invalid and must be ignored.
	assert.equal(autostartFile({ XDG_CONFIG_HOME: "cfg" }, "/home/me"), join("/home/me", ".config", "autostart", DESKTOP_FILE));
	assert.equal(autostartFile({}, "/home/me"), join("/home/me", ".config", "autostart", DESKTOP_FILE));
});

test("the entry is named like the installed launcher", () => {
	const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
	const pkg = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")) as { desktopName: string };
	assert.equal(DESKTOP_FILE, pkg.desktopName);
});

test("what starts at login is the AppImage itself, not the copy mounted for this run", () => {
	assert.deepEqual(autostartArgv({ appImage: "/home/me/Apps/Lyra.AppImage", packaged: true, execPath: "/tmp/.mount_Lyra/lyra", appPath: "/x" }), [
		"/home/me/Apps/Lyra.AppImage",
	]);
	assert.deepEqual(autostartArgv({ packaged: true, execPath: "/opt/Lyra/Lyra", appPath: "/opt/Lyra/resources/app.asar" }), ["/opt/Lyra/Lyra"]);
	// A development run is Electron plus the source directory.
	assert.deepEqual(autostartArgv({ packaged: false, execPath: "/repo/node_modules/electron/dist/electron", appPath: "/repo/packages/desktop" }), [
		"/repo/node_modules/electron/dist/electron",
		"/repo/packages/desktop",
	]);
});

test("Exec is quoted by the Desktop Entry rules — spaces, $, backslashes and % included", () => {
	const entry = autostartEntry(["/home/me/My Apps/Lyra $1\\x 100%.AppImage"]);
	const exec = entry.split("\n").find((line) => line.startsWith("Exec="));
	// Quoted for the space; `$` and `\` escaped inside the quotes and then again as a string value;
	// a literal % written as %% so it is not read as a field code.
	assert.equal(exec, 'Exec="/home/me/My Apps/Lyra \\\\$1\\\\\\\\x 100%%.AppImage"');
	assert.equal(autostartEntry(["/opt/Lyra/Lyra"]).split("\n").find((line) => line.startsWith("Exec=")), "Exec=/opt/Lyra/Lyra");
	assert.ok(entry.startsWith("[Desktop Entry]\n"));
	assert.ok(entry.includes("\nType=Application\n"));
});

test("an entry the desktop was told to skip does not count as on", () => {
	assert.equal(autostartEnabled("[Desktop Entry]\nType=Application\nExec=/opt/Lyra/Lyra\n"), true);
	assert.equal(autostartEnabled("[Desktop Entry]\nExec=/opt/Lyra/Lyra\nHidden=true\n"), false);
	assert.equal(autostartEnabled("[Desktop Entry]\nExec=/opt/Lyra/Lyra\nX-GNOME-Autostart-enabled=false\n"), false);
	// Only the main group decides; an action group saying Hidden=true is about something else.
	assert.equal(autostartEnabled("[Desktop Entry]\nExec=a\n\n[Desktop Action x]\nHidden=true\n"), true);
});

test("turning it on writes the file, turning it off removes it, and reading agrees both times", () => {
	const root = mkdtempSync(join(tmpdir(), "lyra-autostart-"));
	try {
		const file = autostartFile({ XDG_CONFIG_HOME: root }, "/nowhere");
		assert.equal(readAutostart(file), false);
		writeAutostart(file, true, ["/opt/Lyra/Lyra"]);
		assert.ok(existsSync(file));
		assert.equal(readAutostart(file), true);
		writeAutostart(file, false, ["/opt/Lyra/Lyra"]);
		assert.equal(existsSync(file), false);
		assert.equal(readAutostart(file), false);
		// Off when it is already off is not an error.
		writeAutostart(file, false, ["/opt/Lyra/Lyra"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a hand-disabled entry reads as off, and turning it on replaces it", () => {
	const root = mkdtempSync(join(tmpdir(), "lyra-autostart-"));
	try {
		const file = autostartFile({ XDG_CONFIG_HOME: root }, "/nowhere");
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, "[Desktop Entry]\nExec=/old/Lyra\nHidden=true\n");
		assert.equal(readAutostart(file), false);
		writeAutostart(file, true, ["/opt/Lyra/Lyra"]);
		assert.equal(readAutostart(file), true);
		assert.ok(readFileSync(file, "utf8").includes("Exec=/opt/Lyra/Lyra"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
