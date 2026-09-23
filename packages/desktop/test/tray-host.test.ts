/**
 * Whether the status bar icon can actually be seen, which decides whether closing the window may
 * only hide it.
 *
 * `new Tray()` succeeds on stock GNOME and draws nothing. Electron asks the session bus for a
 * StatusNotifierWatcher and, finding none, falls back to an XEmbed GtkStatusIcon — which GNOME
 * Shell stopped showing in 3.26 and which no Wayland session can show at all. The app counted the
 * tray as present, so closing the window hid it with nothing left on screen to bring it back.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNameHasOwner, probeStatusNotifierHost, trayVisible } from "../electron/tray-host.ts";

test("dbus-send's reply and gdbus's are both understood", () => {
	const dbusSend = "method return time=1726996722.1 sender=org.freedesktop.DBus -> destination=:1.99 serial=3 reply_serial=2\n   boolean true\n";
	assert.equal(parseNameHasOwner(dbusSend), true);
	assert.equal(parseNameHasOwner(dbusSend.replace("true", "false")), false);
	assert.equal(parseNameHasOwner("(true,)\n"), true);
	assert.equal(parseNameHasOwner("(false,)\n"), false);
	assert.equal(parseNameHasOwner("Error org.freedesktop.DBus.Error.NoReply"), null);
});

test("the first tool that answers decides; a missing tool is not an answer", async () => {
	const asked: string[] = [];
	const answer = await probeStatusNotifierHost(async (file) => {
		asked.push(file);
		return file === "dbus-send" ? null : { stdout: "(false,)" };
	});
	assert.equal(answer, false);
	assert.deepEqual(asked, ["dbus-send", "gdbus"]);
	assert.equal(await probeStatusNotifierHost(async () => null), null);
});

test("stock GNOME without the AppIndicator extension has no visible tray", () => {
	const x11 = { XDG_CURRENT_DESKTOP: "GNOME", XDG_SESSION_TYPE: "x11" };
	assert.equal(trayVisible({ platform: "linux", created: true, env: x11, watcher: false }), false);
	assert.equal(trayVisible({ platform: "linux", created: true, env: { XDG_CURRENT_DESKTOP: "ubuntu:GNOME", XDG_SESSION_TYPE: "wayland" }, watcher: false }), false);
});

test("Ubuntu's GNOME, whose extension provides the watcher, keeps closing to the tray", () => {
	assert.equal(trayVisible({ platform: "linux", created: true, env: { XDG_CURRENT_DESKTOP: "ubuntu:GNOME" }, watcher: true }), true);
	assert.equal(trayVisible({ platform: "linux", created: true, env: { XDG_CURRENT_DESKTOP: "KDE", XDG_SESSION_TYPE: "wayland" }, watcher: true }), true);
});

test("an X11 desktop that is not GNOME may still have an XEmbed tray, so nothing changes there", () => {
	assert.equal(trayVisible({ platform: "linux", created: true, env: { XDG_CURRENT_DESKTOP: "i3", XDG_SESSION_TYPE: "x11" }, watcher: false }), true);
});

test("any Wayland session without a watcher has nowhere to show the icon", () => {
	assert.equal(trayVisible({ platform: "linux", created: true, env: { XDG_CURRENT_DESKTOP: "sway", WAYLAND_DISPLAY: "wayland-1" }, watcher: false }), false);
});

test("when the bus could not be asked, the old assumption stands", () => {
	assert.equal(trayVisible({ platform: "linux", created: true, env: { XDG_CURRENT_DESKTOP: "GNOME" }, watcher: null }), true);
});

test("macOS and Windows are unaffected, and no icon at all is never visible", () => {
	assert.equal(trayVisible({ platform: "darwin", created: true, env: {}, watcher: false }), true);
	assert.equal(trayVisible({ platform: "win32", created: true, env: {}, watcher: null }), true);
	assert.equal(trayVisible({ platform: "linux", created: false, env: { XDG_CURRENT_DESKTOP: "KDE" }, watcher: true }), false);
});
