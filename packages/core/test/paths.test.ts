import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { scratchHome } from "../src/runtime/previews.ts";
import { readTool } from "../src/tools/read.ts";
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
});

/**
 * 这里只剩「写」这一侧。
 *
 * 附件许可和技能文件例外都搬去了 `read-access.ts`——它们回答的是「能不能看」，而这个函数如今
 * 只回答「能不能改」，两者故意不再是同一个答案（见该文件与 `read-access.test.ts`）。留在这里的
 * 是那条不能松的：写不进工作区之外，技能文件也不行。
 */
test("nothing outside the workspace is writable, skill files included", () => {
	const skill = join(HOME, "plugins", "waza", "skills", "check", "references", "mode-audit.md");
	for (const bad of [
		resolve("/tmp/some-external-doc.txt"),
		skill,
		join(HOME, "skills", "ui", "SKILL.md"),
		join(HOME, "plugins", "waza", "manifest.json"),
		join(HOME, "settings.json"),
	]) {
		assert.throws(() => resolveWorkspacePath(CWD, bad), /escapes the workspace root/, bad);
	}
});

test("read opens an installed plugin skill file that used to escape the workspace", async () => {
	const skill = join(HOME, "plugins", "waza", "skills", "check", "references", "mode-audit.md");
	await mkdir(dirname(skill), { recursive: true });
	await writeFile(skill, "# mode-audit\nread me\n");
	const res = await readTool.execute({ path: skill }, { cwd: CWD, sessionId: "s", state: new Map() });
	assert.equal(res.isError, undefined);
	assert.match(res.content[0].text, /mode-audit/);
});
