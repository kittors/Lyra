/**
 * The environment git is run in.
 *
 * Both halves of this are inherited state that the app never asked for and cannot see. A `GIT_DIR`
 * left in the environment silently redirects every call in the process to another repository; a
 * PATH with no git on it makes every call fail in a way that reads like an ordinary directory. Both
 * end at the same wrong sentence on screen — 「不是 Git 仓库」 about a project that plainly is one —
 * and neither is reproducible by opening the app normally, so both are pinned here instead.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { gitEnvironment, remoteGitEnvironment } from "../electron/git-exec.ts";

const exec = promisify(execFile);

test("every variable that redirects git is dropped", () => {
	const env = gitEnvironment({
		GIT_DIR: "/somewhere/else/.git",
		GIT_WORK_TREE: "/somewhere/else",
		GIT_COMMON_DIR: "/somewhere/else/.git",
		GIT_INDEX_FILE: "/tmp/index",
		GIT_OBJECT_DIRECTORY: "/tmp/objects",
		GIT_ALTERNATE_OBJECT_DIRECTORIES: "/tmp/alt",
		GIT_NAMESPACE: "refs/namespaces/x",
		GIT_CEILING_DIRECTORIES: "/",
		GIT_PREFIX: "sub/",
		PATH: "/usr/bin",
	});

	for (const name of Object.keys(env)) {
		assert.ok(!name.startsWith("GIT_"), `${name} should not have survived`);
	}
});

test("but the rest of the environment is left alone", () => {
	const env = gitEnvironment({ HOME: "/Users/someone", LANG: "en_US.UTF-8", PATH: "/usr/bin" });
	assert.equal(env.HOME, "/Users/someone");
	assert.equal(env.LANG, "en_US.UTF-8");
});

test("remote git disables both terminal and credential manager prompts", () => {
	const env = remoteGitEnvironment({ GIT_TERMINAL_PROMPT: "1", GCM_INTERACTIVE: "1", PATH: process.env.PATH });
	assert.equal(env.GIT_TERMINAL_PROMPT, "0", "git itself must not wait for a terminal");
	assert.equal(env.GCM_INTERACTIVE, "0", "GCM must not open a window of its own");
});

test("the usual install locations are added when they are missing", { skip: process.platform === "win32" }, () => {
	const env = gitEnvironment({ PATH: "/usr/bin:/bin" });
	const dirs = (env.PATH ?? "").split(delimiter);
	assert.ok(dirs.includes("/opt/homebrew/bin"), env.PATH);
	assert.ok(dirs.includes("/usr/local/bin"), env.PATH);
});

test("and appended, so a directory the user chose still wins", () => {
	const env = gitEnvironment({ PATH: "/my/own/bin" });
	const dirs = (env.PATH ?? "").split(delimiter);
	assert.equal(dirs[0], "/my/own/bin");
});

test("a directory already on the path is not added twice", { skip: process.platform === "win32" }, () => {
	const env = gitEnvironment({ PATH: "/opt/homebrew/bin:/usr/bin" });
	const dirs = (env.PATH ?? "").split(delimiter);
	assert.equal(dirs.filter((d) => d === "/opt/homebrew/bin").length, 1, env.PATH);
});

test("an empty path still ends up with somewhere to look", { skip: process.platform === "win32" }, () => {
	const env = gitEnvironment({});
	const dirs = new Set((env.PATH ?? "").split(delimiter).filter(Boolean));
	assert.ok(dirs.has("/usr/bin"), env.PATH);
	assert.ok(!dirs.has(""), "no empty segments");
});

test("Path key case-insensitivity on Windows is preserved", { skip: process.platform !== "win32" }, () => {
	const env = gitEnvironment({ Path: "C:\\Program Files\\Git\\cmd" });
	assert.equal(env.Path, "C:\\Program Files\\Git\\cmd");
});

/**
 * The whole point, against a real git.
 *
 * Two repositories, and `GIT_DIR` pointing at the wrong one. Inherited, git answers about the
 * decoy; scrubbed, it answers about the directory it was run in — which is the only thing any
 * caller in the app ever meant to ask.
 */
test("GIT_DIR in the environment no longer decides which repository git answers about", async () => {
	const home = await mkdtemp(join(tmpdir(), "lyra-git-env-"));
	const project = join(home, "project");
	const decoy = join(home, "decoy");

	for (const dir of [project, decoy]) {
		await exec("git", ["init", "-q", "-b", "main", dir]);
		await writeFile(join(dir, "file.txt"), `${dir}\n`);
		await exec("git", ["-C", dir, "add", "."]);
		await exec("git", ["-C", dir, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "init"]);
	}

	const poisoned = { ...process.env, GIT_DIR: join(decoy, ".git") };

	const inherited = await exec("git", ["rev-parse", "--absolute-git-dir"], { cwd: project, env: poisoned });
	assert.match(inherited.stdout.trim(), /decoy/, "the decoy is what the leak does — if not, this test proves nothing");

	const scrubbed = await exec("git", ["rev-parse", "--absolute-git-dir"], {
		cwd: project,
		env: gitEnvironment(poisoned),
	});
	assert.match(scrubbed.stdout.trim(), /project/, "scrubbed, git must answer about the directory it was run in");
});
