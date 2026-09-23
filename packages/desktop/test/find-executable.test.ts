/**
 * Finding a program on PATH the way the platform itself would.
 *
 * Every case here is one that went wrong: Windows looked for `gofmt` and there is only
 * `gofmt.exe`, a Git Bash launch spelled the variable `Path`, and an App Execution Alias like
 * `wt.exe` cannot be `stat`ed at all. The platform is a parameter, so the Windows rules are checked
 * on whatever machine runs the tests.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { candidateNames, envValue, findExecutable, searchDirs } from "../electron/find-executable.ts";

test("Windows tries every PATHEXT extension, because `gofmt` on disk is `gofmt.exe`", () => {
	const onDisk = new Set(["C:\\Go\\bin\\gofmt.exe"]);
	const found = findExecutable("gofmt", {
		platform: "win32",
		env: { PATH: "C:\\Windows;C:\\Go\\bin", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
		isExecutable: (path) => onDisk.has(path),
	});
	assert.equal(found, "C:\\Go\\bin\\gofmt.exe");
});

test("a name that already has its extension is looked up as written", () => {
	assert.deepEqual(candidateNames("code.cmd", "win32", { PATHEXT: ".EXE;.CMD" }), ["code.cmd"]);
	assert.deepEqual(candidateNames("wt.exe", "win32", {}), ["wt.exe"]);
	// And an extensionless one is never taken bare: Windows will not run it.
	assert.deepEqual(candidateNames("black", "win32", { PATHEXT: ".EXE;.CMD" }), ["black.exe", "black.cmd"]);
});

test("PATHEXT falls back to the system default when the variable is missing", () => {
	assert.deepEqual(candidateNames("ruff", "win32", {}), ["ruff.com", "ruff.exe", "ruff.bat", "ruff.cmd"]);
});

test("Windows reads `Path` as readily as `PATH` — the variable is case-insensitive there", () => {
	assert.equal(envValue({ Path: "C:\\bin" }, "PATH", "win32"), "C:\\bin");
	// Elsewhere the case is part of the name.
	assert.equal(envValue({ Path: "/bin" }, "PATH", "linux"), undefined);
	const onDisk = new Set(["C:\\Tools\\shfmt.exe"]);
	assert.equal(
		findExecutable("shfmt", { platform: "win32", env: { Path: "C:\\Tools" }, isExecutable: (path) => onDisk.has(path) }),
		"C:\\Tools\\shfmt.exe",
	);
});

test("quoted PATH entries on Windows are unquoted before they are searched", () => {
	assert.deepEqual(searchDirs("win32", { PATH: "\"C:\\Program Files\\Go\\bin\";;C:\\x" }), ["C:\\Program Files\\Go\\bin", "C:\\x"]);
});

test("the extra directories come after PATH, and nothing is searched twice", () => {
	assert.deepEqual(searchDirs("linux", { PATH: "/usr/bin:/bin" }, ["/home/me/.cargo/bin", "/usr/bin"]), [
		"/usr/bin",
		"/bin",
		"/home/me/.cargo/bin",
	]);
});

test("a path is checked where it is rather than searched for", () => {
	const onDisk = new Set(["C:\\Apps\\tool.exe"]);
	assert.equal(findExecutable("C:\\Apps\\tool", { platform: "win32", env: {}, isExecutable: (path) => onDisk.has(path) }), "C:\\Apps\\tool.exe");
	assert.equal(findExecutable("/opt/x/tool", { platform: "linux", env: { PATH: "/usr/bin" }, isExecutable: () => false }), null);
});

test("on a real disk, a file without the execute bit is not a program", { skip: process.platform === "win32" }, () => {
	const dir = mkdtempSync(join(tmpdir(), "lyra-which-"));
	try {
		writeFileSync(join(dir, "plain"), "#!/bin/sh\n");
		writeFileSync(join(dir, "runnable"), "#!/bin/sh\n");
		chmodSync(join(dir, "runnable"), 0o755);
		const env = { PATH: dir };
		assert.equal(findExecutable("plain", { platform: process.platform, env }), null);
		assert.equal(findExecutable("runnable", { platform: process.platform, env }), join(dir, "runnable"));
		// A directory with the right name is not a program either.
		assert.equal(findExecutable(".", { platform: process.platform, env }), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
