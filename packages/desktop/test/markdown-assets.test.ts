/**
 * Turning `src="assets/logo.png"` into a path on this disk.
 *
 * Worth its own file because it is string work about paths written without `node:path` — which the
 * renderer does not have — and AGENTS.md names exactly this as the shape that passes on macOS and
 * is silently wrong on Windows. Both separators are exercised here rather than whichever one the
 * machine running the suite happens to use.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { directoryOf, isAbsolutePath, resolveAsset } from "../src/lib/markdown/assets.ts";

test("a relative path lands beside the file", () => {
	assert.equal(resolveAsset("/home/me/repo", "assets/logo.png"), "/home/me/repo/assets/logo.png");
	assert.equal(resolveAsset("/home/me/repo", "./assets/logo.png"), "/home/me/repo/assets/logo.png");
});

test("`..` walks up, and the result has no `..` left in it", () => {
	// Not the boundary — the media protocol re-checks — but a path that reads one way here and
	// another there is how a check gets walked around.
	assert.equal(resolveAsset("/home/me/repo/docs", "../assets/logo.png"), "/home/me/repo/assets/logo.png");
	assert.equal(resolveAsset("/home/me/repo/docs", "../../x.png"), "/home/me/x.png");
});

test("an absolute src is taken as it is", () => {
	assert.equal(resolveAsset("/home/me/repo", "/etc/hosts.png"), "/etc/hosts.png");
});

test("Windows paths keep their separators", () => {
	assert.equal(resolveAsset("C:\\Users\\me\\repo", "assets/logo.png"), "C:\\Users\\me\\repo\\assets\\logo.png");
	assert.equal(resolveAsset("C:\\Users\\me\\repo\\docs", "../logo.png"), "C:\\Users\\me\\repo\\logo.png");
	assert.equal(resolveAsset("C:\\Users\\me", "C:\\other\\a.png"), "C:\\other\\a.png");
});

test("a UNC share keeps both of its leading separators", () => {
	assert.equal(resolveAsset("\\\\server\\share", "a.png"), "\\\\server\\share\\a.png");
});

test("what GitHub reads is stripped, since the disk does not read it", () => {
	// `?raw=true` and `#gh-dark-mode-only` are addressed to a website. Left on, they become part of
	// a filename that then does not exist.
	assert.equal(resolveAsset("/repo", "assets/logo.png?raw=true"), "/repo/assets/logo.png");
	assert.equal(resolveAsset("/repo", "assets/logo.png#gh-dark-mode-only"), "/repo/assets/logo.png");
	assert.equal(resolveAsset("/repo", "assets/my%20logo.png"), "/repo/assets/my logo.png");
});

test("anything that is not a path into the filesystem is refused", () => {
	for (const src of ["https://example.com/a.png", "http://x/a.png", "data:image/png;base64,AA", "//cdn/x.png", "#anchor", ""]) {
		assert.equal(resolveAsset("/repo", src), null, src);
	}
});

test("with no directory there is nothing to resolve against", () => {
	// A pull request body and a model's reply have no folder; a relative path in either refers to a
	// checkout that may not be on this machine.
	assert.equal(resolveAsset(undefined, "assets/logo.png"), null);
});

test("what counts as absolute", () => {
	for (const path of ["/a", "C:\\a", "c:/a", "\\\\server\\share"]) assert.ok(isAbsolutePath(path), path);
	for (const path of ["a/b", "./a", "../a", "C:a"]) assert.ok(!isAbsolutePath(path), path);
});

test("a file's own folder, on either platform", () => {
	assert.equal(directoryOf("/home/me/repo/README.md"), "/home/me/repo");
	assert.equal(directoryOf("C:\\Users\\me\\README.md"), "C:\\Users\\me");
	// The root is `/`, not the empty string — a file there still has a folder.
	assert.equal(directoryOf("/README.md"), "/");
	assert.equal(directoryOf("README.md"), "");
});
