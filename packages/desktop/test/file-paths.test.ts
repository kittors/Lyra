/**
 * The renderer's own path arithmetic.
 *
 * It cannot use `node:path` — a Node builtin in the browser bundle is what leaves the window
 * blank — so it does the splitting itself, and "does it correctly" is exactly the sort of claim
 * that is easy to make and easy to be wrong about at the edges: a trailing slash, a dotfile, a
 * sibling whose name starts with the folder's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	baseName,
	dirName,
	isDescendantPath,
	joinPath,
	relativeTo,
	splitExtension,
} from "../src/lib/paths.ts";

test("the name is the last segment, with or without a trailing slash", () => {
	assert.equal(baseName("/work/app/src/main.ts"), "main.ts");
	assert.equal(baseName("/work/app/src"), "src");
	assert.equal(baseName("/work/app/src/"), "src");
	assert.equal(baseName("main.ts"), "main.ts");
	assert.equal(baseName("C:\\work\\app\\main.ts"), "main.ts", "Windows paths arrive with backslashes");
});

test("the parent is everything before it, and the root's parent is the root", () => {
	assert.equal(dirName("/work/app/src/main.ts"), "/work/app/src");
	assert.equal(dirName("/work/app/src/"), "/work/app");
	assert.equal(dirName("/main.ts"), "/", "not the empty string, which would name nothing");
});

test("joining reuses the separator the parent already has", () => {
	assert.equal(joinPath("/work/app", "src"), "/work/app/src");
	assert.equal(joinPath("/work/app/", "src"), "/work/app/src", "no double slash");
	assert.equal(joinPath("C:\\work\\app", "src"), "C:\\work\\app\\src");
});

test("a relative path is written from the project root", () => {
	assert.equal(relativeTo("/work/app", "/work/app/src/main.ts"), "src/main.ts");
	assert.equal(relativeTo("/work/app/", "/work/app/src/main.ts"), "src/main.ts");
	assert.equal(relativeTo("/work/app", "/work/app"), "app", "the root names itself rather than nothing");
	assert.equal(relativeTo("/work/app", "/elsewhere/x.ts"), "/elsewhere/x.ts", "outside, so it stays absolute");
});

test("a sibling with a shared prefix is not inside", () => {
	assert.ok(isDescendantPath("/a/b", "/a/b/c"));
	assert.ok(isDescendantPath("/a/b", "/a/b/c/d/e"));
	assert.ok(!isDescendantPath("/a/b", "/a/bc"), "the separator is what makes these different folders");
	assert.ok(!isDescendantPath("/a/b", "/a/b"), "dragging something onto itself is not dragging it inside");
	assert.ok(!isDescendantPath("/a/b/c", "/a/b"));
});

test("the extension starts at the last dot, and a dotfile has none", () => {
	assert.deepEqual(splitExtension("report.md"), ["report", ".md"]);
	assert.deepEqual(splitExtension("archive.tar.gz"), ["archive.tar", ".gz"]);
	assert.deepEqual(splitExtension(".env"), [".env", ""]);
	assert.deepEqual(splitExtension("Makefile"), ["Makefile", ""]);
});
