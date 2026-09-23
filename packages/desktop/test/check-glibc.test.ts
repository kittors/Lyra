/**
 * The glibc gate that runs after the Linux packages are built, and the floor it holds them to.
 *
 * `pty.node` is compiled on the release runner, and on Ubuntu 24.04 it comes out needing glibc
 * 2.34 — `forkpty` and `openpty` moved from libutil into libc in that version, so linking against
 * it pins the new symbol versions. Nothing looked: the .deb declared no libc6 at all, apt installed
 * it anywhere, and on Ubuntu 20.04 or Debian 11 the app died on startup. The package now states its
 * floor, and `check-glibc.mjs` fails the build when anything in it needs more than that.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { compareVersions, declaredGlibcFloor, glibcNeeds, overFloor } from "../scripts/check-glibc.mjs";

const OBJDUMP = `
/opt/Lyra/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node:     file format elf64-x86-64

DYNAMIC SYMBOL TABLE:
0000000000000000      DF *UND*	0000000000000000 (GLIBC_2.34) forkpty
0000000000000000      DF *UND*	0000000000000000 (GLIBC_2.34) openpty
0000000000000000      DF *UND*	0000000000000000 (GLIBC_2.32) pthread_sigmask
0000000000000000      DF *UND*	0000000000000000  GLIBC_2.2.5 memcpy
0000000000000000      DF *UND*	0000000000000000 (GLIBC_PRIVATE) __libc_something
0000000000000000      DF *UND*	0000000000000000 (GLIBCXX_3.4.32) _ZNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEE10_M_replaceEmmPKcm
0000000000000000  w   D  *UND*	0000000000000000  Base        __gmon_start__
`;

test("the glibc versions a binary needs are read off objdump -T, with the symbols that need them", () => {
	const needs = glibcNeeds(OBJDUMP);
	assert.deepEqual(needs.get("2.34"), ["forkpty", "openpty"]);
	assert.deepEqual(needs.get("2.32"), ["pthread_sigmask"]);
	assert.deepEqual(needs.get("2.2.5"), ["memcpy"]);
	// GLIBC_PRIVATE is not a version, and GLIBCXX is libstdc++, not glibc.
	assert.equal([...needs.keys()].some((version) => !/^\d+(\.\d+)+$/.test(version)), false);
});

test("versions compare numerically, not as strings", () => {
	assert.equal(compareVersions("2.34", "2.4") > 0, true);
	assert.equal(compareVersions("2.2.5", "2.3") < 0, true);
	assert.equal(compareVersions("2.34", "2.34.0"), 0);
});

test("anything above the floor is named, symbol by symbol", () => {
	assert.deepEqual(overFloor(glibcNeeds(OBJDUMP), "2.31"), [{ version: "2.34", symbols: ["forkpty", "openpty"] }, { version: "2.32", symbols: ["pthread_sigmask"] }]);
	assert.deepEqual(overFloor(glibcNeeds(OBJDUMP), "2.34"), []);
});

test("the .deb states a libc6 floor, and keeps every dependency electron-builder would have added", () => {
	const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
	const config = parse(readFileSync(join(desktop, "electron-builder.yml"), "utf8")) as { deb?: { depends?: string[] } };
	const floor = declaredGlibcFloor(config);
	assert.ok(floor, "no `libc6 (>= …)` in deb.depends");
	assert.ok(compareVersions(floor, "2.34") >= 0, `pty.node built on ubuntu-24.04 needs 2.34; the package says ${floor}`);
	// `depends` replaces electron-builder's defaults rather than adding to them (FpmTarget in
	// app-builder-lib 26.15.3), so each of these has to be listed by hand or it silently goes.
	for (const dependency of ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0"]) {
		assert.ok(config.deb?.depends?.includes(dependency), `${dependency} fell out of the .deb's dependencies`);
	}
});
