/**
 * Where an external formatter is looked for, on the platform that got it wrong.
 *
 * On Windows every tool read as 「未安装」: the search asked for `rustfmt` where the file is
 * `rustfmt.exe`, and it looked under `process.env.HOME`, which Windows does not set — so
 * `~/.cargo/bin` became the relative path `.cargo/bin`, resolved against wherever the app happened
 * to be running.
 */

import assert from "node:assert/strict";
import { posix, win32 } from "node:path";
import { test } from "node:test";

import { formatterExtraDirs, locateFormatter } from "../electron/format-external.ts";

test("a rustup install on Windows is found: PATHEXT, and the home directory from the OS", () => {
	const onDisk = new Set(["C:\\Users\\me\\.cargo\\bin\\rustfmt.exe"]);
	const found = locateFormatter("rustfmt", {
		platform: "win32",
		// No HOME at all, which is the ordinary state of a Windows process.
		env: { Path: "C:\\Windows\\system32", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
		home: "C:\\Users\\me",
		isExecutable: (path) => onDisk.has(path),
	});
	assert.equal(found, "C:\\Users\\me\\.cargo\\bin\\rustfmt.exe");
});

test("the per-user directories hang off the home directory it is given", () => {
	const windows = formatterExtraDirs("win32", "C:\\Users\\me");
	assert.ok(windows.includes("C:\\Users\\me\\.cargo\\bin"));
	assert.ok(windows.includes("C:\\Users\\me\\go\\bin"));
	// Homebrew's directories mean nothing there, and on Windows they would resolve against a drive.
	assert.ok(!windows.some((dir) => dir.startsWith("/")), windows.join(", "));

	const unix = formatterExtraDirs("linux", "/home/me");
	assert.ok(unix.includes("/home/me/.cargo/bin"));
	assert.ok(unix.includes("/home/me/.local/bin"));
	assert.ok(unix.includes("/usr/local/bin"));
});

test("a missing home directory contributes nothing rather than a relative path", () => {
	for (const dir of formatterExtraDirs("win32", "")) assert.ok(win32.isAbsolute(dir), dir);
	for (const dir of formatterExtraDirs("linux", "")) assert.ok(posix.isAbsolute(dir), dir);
});
