/**
 * Which conversations go with a project when it is removed.
 *
 * The report was that a project deleted from disk could not be removed from Lyra. Archiving only
 * the chats whose `cwd` matched exactly was half of why: the sidebar builds a group per distinct
 * `cwd`, so anything started one directory down came back as its own group the moment the entry
 * was dropped.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionUnderProject } from "../src/lib/project-scope.ts";

test("a project owns the chats started inside it, at any depth", () => {
	assert.ok(sessionUnderProject("/Users/x/proj", "/Users/x/proj"));
	assert.ok(sessionUnderProject("/Users/x/proj", "/Users/x/proj/packages/core"));
	assert.ok(sessionUnderProject("/Users/x/proj", "/Users/x/proj/a/b/c/d"));
});

test("a sibling whose name merely starts the same is not inside it", () => {
	// The separator is the whole guard: without it `proj-old` reads as living in `proj`.
	assert.ok(!sessionUnderProject("/Users/x/proj", "/Users/x/proj-old"));
	assert.ok(!sessionUnderProject("/Users/x/proj", "/Users/x/project"));
	assert.ok(!sessionUnderProject("/Users/x/proj", "/Users/x"));
	assert.ok(!sessionUnderProject("/Users/x/proj", "/elsewhere"));
});

test("a trailing slash on the configured path does not lose the project's own chats", () => {
	// A configured project path and a session's `cwd` arrive from different places, and only one
	// of them tends to carry a trailing separator.
	assert.ok(sessionUnderProject("/Users/x/proj/", "/Users/x/proj"));
	assert.ok(sessionUnderProject("/Users/x/proj/", "/Users/x/proj/packages/core"));
	assert.ok(!sessionUnderProject("/Users/x/proj/", "/Users/x/proj-old"));
});

test("Windows paths are matched on their own separator", () => {
	assert.ok(sessionUnderProject("C:\\Users\\x\\proj", "C:\\Users\\x\\proj\\packages"));
	assert.ok(sessionUnderProject("C:\\Users\\x\\proj\\", "C:\\Users\\x\\proj"));
	assert.ok(!sessionUnderProject("C:\\Users\\x\\proj", "C:\\Users\\x\\proj-old"));
});

test("a root path is not eaten by the trailing-slash trim", () => {
	// `"/".replace(/[/\\]+$/, "")` is the empty string, which would match everything.
	assert.ok(sessionUnderProject("/", "/Users/x/proj"));
	assert.ok(sessionUnderProject("/", "/"));
});
