import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { scratchHome } from "../src/runtime/previews.ts";
import { resolveWorkspacePath } from "../src/tools/paths.ts";

const HOME = join(tmpdir(), "ly-paths-home");
process.env.LYRA_HOME = HOME;

const CWD = join(tmpdir(), "ly-paths-project");

test("paths inside the workspace resolve, relative or absolute", () => {
	assert.equal(resolveWorkspacePath(CWD, "src/index.ts"), join(CWD, "src/index.ts"));
	assert.equal(resolveWorkspacePath(CWD, join(CWD, "a/b.txt")), join(CWD, "a/b.txt"));
	assert.equal(resolveWorkspacePath(CWD, "."), resolve(CWD));
});

test("paths outside the workspace are refused", () => {
	for (const bad of ["../../.ssh/id_rsa", "/etc/passwd", join(CWD, "../sibling/file.ts")]) {
		assert.throws(() => resolveWorkspacePath(CWD, bad), /escapes the workspace root/, bad);
	}
});

test("the scratch directory is writable, because the model is told to use it", () => {
	const scratch = scratchHome(HOME);
	const file = join(scratch, "session-1", "notes.md");
	assert.equal(resolveWorkspacePath(CWD, file), file);
});

/**
 * The exception is the scratch subtree and nothing above it — settings, credentials and every
 * transcript live in the same parent directory.
 */
test("the rest of the app's home stays closed", () => {
	for (const bad of [join(HOME, "settings.json"), join(HOME, "sessions/x.jsonl"), join(HOME, "scratch/../settings.json")]) {
		assert.throws(() => resolveWorkspacePath(CWD, bad), /escapes the workspace root/, bad);
	}
});

test("a missing path is an error rather than the workspace root", () => {
	assert.throws(() => resolveWorkspacePath(CWD, ""), /A path is required/);

test("explicitly allowed paths outside workspace resolve cleanly", () => {
	const externalFile = resolve("/tmp/some-external-doc.txt");
	const allowed = new Set([externalFile]);

	assert.equal(resolveWorkspacePath(CWD, externalFile, allowed), externalFile);
	assert.throws(
		() => resolveWorkspacePath(CWD, "/tmp/unallowed-file.txt", allowed),
		/escapes the workspace root/,
	);
});
});
