/**
 * The rules behind every file operation the panel offers.
 *
 * The boundary check is the one that matters most: the renderer names the path, and rename, copy
 * and delete now go through the same doorway that used to only read. A test that walks `..` out of
 * a project is the difference between a guard and the appearance of one.
 */

import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
	containingRoot,
	isDescendant,
	resolveInside,
	splitExtension,
	uniqueName,
	validateName,
} from "../electron/file-ops.ts";

/*
 * Built with `resolve`, not written out.
 *
 * `resolveInside` returns a resolved path, and on Windows resolving "/work/app" produces
 * "D:\\work\\app" — so a literal expectation compared a Unix spelling against a Windows one and
 * failed on a function that was working perfectly. The path this points at does not exist on any
 * platform, which is the point: these are rules about strings, not about a filesystem.
 */
const ROOT = resolve("/work/app");
const ROOTS = [ROOT];

test("a path inside a project comes back normalised", () => {
	assert.equal(resolveInside(join(ROOT, "src", "main.ts"), ROOTS), join(ROOT, "src", "main.ts"));
	assert.equal(resolveInside(ROOT, ROOTS), ROOT, "the root itself is inside itself");
	assert.equal(resolveInside(join(ROOT, ".", "src", "..", "src", "a.ts"), ROOTS), join(ROOT, "src", "a.ts"));
});

test("traversal cannot survive the check", () => {
	// The bug this replaces: `/work/app/../../etc/passwd`.startsWith("/work/app/") is true.
	for (const hostile of [
		"/work/app/../../etc/passwd",
		"/work/app/../app-secrets/key.pem",
		"/work/app/src/../../../root/.ssh/id_rsa",
	]) {
		assert.equal(resolveInside(hostile, ROOTS), null, `${hostile} got through`);
	}
});

test("a sibling with the project's name as a prefix is outside it", () => {
	assert.equal(resolveInside("/work/app-secrets/key.pem", ROOTS), null);
	assert.equal(resolveInside("/work/application/a.ts", ROOTS), null);
});

test("only absolute paths, and never one carrying a NUL", () => {
	assert.equal(resolveInside("src/main.ts", ROOTS), null, "relative would resolve against our cwd");
	assert.equal(resolveInside("", ROOTS), null);
	assert.equal(resolveInside("/work/app/a\0/../../etc", ROOTS), null);
});

test("with no projects open nothing is inside one", () => {
	assert.equal(resolveInside("/work/app/src/main.ts", []), null);
});

test("the containing root follows the platform's path rules", () => {
	assert.equal(containingRoot(join(ROOT, "src", "main.ts"), ROOTS), ROOT);
	assert.equal(containingRoot(ROOT, ROOTS), ROOT, "the project root belongs to itself");
	assert.equal(containingRoot(resolve("/work/app-secrets/key.pem"), ROOTS), null);
});

test("the deepest containing root wins when projects are nested", () => {
	const inner = join(ROOT, "packages", "desktop");
	const file = join(inner, "src", "main.ts");
	assert.equal(containingRoot(file, [ROOT, inner]), inner);
});

test("a path is not its own descendant, and a sibling prefix is not one either", () => {
	assert.ok(isDescendant("/a", "/a/b"));
	assert.ok(isDescendant("/a", "/a/b/c/d"));
	assert.ok(!isDescendant("/a", "/a"), "moving a directory onto itself is not moving it into itself");
	assert.ok(!isDescendant("/a/b", "/a/bc"), "the separator is what makes these different directories");
	assert.ok(!isDescendant("/a/b", "/a"));
});

test("a name is split at the last dot, and a leading dot is not one", () => {
	assert.deepEqual(splitExtension("report.md"), ["report", ".md"]);
	assert.deepEqual(splitExtension("archive.tar.gz"), ["archive.tar", ".gz"]);
	assert.deepEqual(splitExtension(".env"), [".env", ""], "a dotfile is all name");
	assert.deepEqual(splitExtension("Makefile"), ["Makefile", ""]);
});

test("a free name is returned unchanged", () => {
	assert.equal(uniqueName(["a.txt"], "b.txt"), "b.txt");
});

test("copies are numbered the way the Finder numbers them", () => {
	const taken = ["report.md"];
	assert.equal(uniqueName(taken, "report.md"), "report copy.md");
	assert.equal(uniqueName([...taken, "report copy.md"], "report.md"), "report copy 2.md");
	assert.equal(uniqueName([...taken, "report copy.md", "report copy 2.md"], "report.md"), "report copy 3.md");
});

test("the extension survives, and a dotfile keeps its dot", () => {
	// The last dot, so `.tar` stays part of the name — same split `splitExtension` is tested on.
	assert.equal(uniqueName(["archive.tar.gz"], "archive.tar.gz"), "archive.tar copy.gz");
	assert.equal(uniqueName([".env"], ".env"), ".env copy");
	assert.equal(uniqueName(["src"], "src"), "src copy", "a directory has no extension to preserve");
});

test("every name a filesystem would refuse is refused here first", () => {
	for (const [name, why] of [
		["", "empty"],
		[" leading", "leading space"],
		["trailing ", "trailing space"],
		[".", "self"],
		["..", "parent"],
		["a/b", "separator"],
		["a\\b", "windows separator"],
		["a\0b", "NUL"],
		["x".repeat(256), "too long"],
	] as const) {
		assert.notEqual(validateName(name, "darwin"), null, `${why} was accepted`);
	}
});

test("an ordinary name passes, on either platform", () => {
	for (const name of ["main.ts", ".env", "我的文件.md", "a b c.txt", "archive.tar.gz"]) {
		assert.equal(validateName(name, "darwin"), null, `${name} was refused`);
		assert.equal(validateName(name, "win32"), null, `${name} was refused on win32`);
	}
});

test("the Windows-only rules apply on Windows only", () => {
	assert.equal(validateName("a:b.txt", "darwin"), null, "a colon is a legal name on a Mac");
	assert.notEqual(validateName("a:b.txt", "win32"), null);
	assert.notEqual(validateName("con.txt", "win32"), null, "reserved whatever the extension");
	assert.notEqual(validateName("NUL", "win32"), null, "and case does not save it");
	assert.notEqual(validateName("name.", "win32"), null);
	assert.equal(validateName("con.txt", "darwin"), null);
});

test("byte length is what is counted, not character count", () => {
	// 85 three-byte characters is 255 bytes; one more is over, while `length` would say 86.
	assert.equal(validateName("字".repeat(85), "darwin"), null);
	assert.notEqual(validateName("字".repeat(86), "darwin"), null);
});
