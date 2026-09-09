/**
 * The `PATH` a command is given, when the app was launched from an icon rather than a terminal.
 *
 * The bug this pins down: a GUI-launched Electron app inherits launchd's four system directories,
 * `$SHELL -c` never reads `~/.zshrc`, and so every `pnpm`, `node` and `npx` the agent runs is a
 * `command not found` — in one real session history, fifty of them.
 *
 * The two properties that matter are opposites, and both are cheap to get wrong: a starved `PATH`
 * has to be repaired, and a healthy one has to be left completely alone. The second is what keeps
 * the CLI, the tests and every terminal launch from paying for a shell they do not need.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { commandPath, FALLBACK_DIRS, forgetCommandPath, nvmNodeBins, primeCommandPath } from "../src/sandbox/login-path.ts";

/** Exactly what launchd hands a double-clicked app on macOS. */
const GUI = "/usr/bin:/bin:/usr/sbin:/sbin";
const posix = process.platform === "win32" ? "this behaviour is POSIX-only" : false;

const dirs = (path: string | undefined) => (path ?? "").split(delimiter).filter(Boolean);

/**
 * Run `body` as if this process had been launched from an icon.
 *
 * `primeCommandPath` decides whether to ask the shell by looking at `process.env.PATH` — under
 * `node --test` that is a terminal's PATH, so it correctly declines to ask, and any test of the
 * shell path silently measures the fallback instead. Two of these tests passed that way before this
 * existed: green, and testing nothing.
 */
async function asGuiLaunch(body: () => Promise<void> | void): Promise<void> {
	const real = process.env.PATH;
	process.env.PATH = GUI;
	forgetCommandPath();
	try {
		await body();
	} finally {
		process.env.PATH = real;
		forgetCommandPath();
	}
}

test("a PATH a shell has contributed to is returned untouched", () => {
	forgetCommandPath();
	const real = `/opt/homebrew/bin${delimiter}${GUI}`;
	// Identity, not equality: nothing was rebuilt, so no shell was started to rebuild it.
	assert.equal(commandPath(real), real);
});

test("the system-only PATH of a GUI launch is repaired", { skip: posix }, () => {
	forgetCommandPath();
	const repaired = dirs(commandPath(GUI));
	assert.ok(repaired.length > dirs(GUI).length, `expected more than ${GUI}, got ${repaired.join(":")}`);
});

test("repair only ever adds: the system directories survive it", { skip: posix }, () => {
	forgetCommandPath();
	const repaired = dirs(commandPath(GUI));
	/*
	 * `git` and `python3` live in these. A shell that answered with a PATH missing one of them —
	 * or a fallback list that replaced rather than extended — would fix `pnpm` by breaking `git`,
	 * which is a worse bug than the one being fixed and would look nothing like it.
	 */
	for (const dir of dirs(GUI)) assert.ok(repaired.includes(dir), `${dir} was dropped`);
});

test("the repaired PATH has no duplicates", { skip: posix }, () => {
	forgetCommandPath();
	const repaired = dirs(commandPath(GUI));
	assert.equal(new Set(repaired).size, repaired.length, repaired.join(":"));
});

test("no call ever blocks on the shell", { skip: posix }, () => {
	forgetCommandPath();
	/*
	 * The property that keeps this out of the UI thread. `execFileSync` on a login+interactive zsh
	 * was measured at 1.2–2.1s on a busy machine, and in Electron that is a window that does not
	 * repaint — a broken command traded for a hung app. Every call here must return at list speed,
	 * including the very first, which is the one that starts the ask.
	 */
	for (let i = 0; i < 3; i++) {
		const started = Date.now();
		commandPath(GUI);
		assert.ok(Date.now() - started < 50, `call ${i + 1} blocked for ${Date.now() - started}ms`);
	}
});

/*
 * Everything that needs a real shell, in one test and therefore in one shell.
 *
 * Split across three tests this was three login+interactive zsh launches, and on a machine already
 * running the rest of the suite that was enough CPU to push a *different* file's idle-timer test
 * over its deadline. A unit test that makes another one flaky has a cost beyond its own runtime.
 */
test("what the shell answers, and what it costs", { skip: posix }, async (t) => {
	await asGuiLaunch(async () => {
		const fallback = dirs(commandPath(GUI));

		// Concurrent callers share one ask rather than each starting their own shell.
		for (let i = 0; i < 5; i++) commandPath(GUI);
		const first = primeCommandPath();
		assert.equal(primeCommandPath(), first, "a second ask was started");
		await first;

		const asked = Date.now();
		await primeCommandPath();
		assert.ok(Date.now() - asked < 50, "asked again after the answer was already in");

		/*
		 * The fallback is a list of guesses and the shell's answer is the truth; the point of asking
		 * is that the second is better than the first. On a machine using a version manager they
		 * differ by its shim directory, which is exactly what a list cannot know.
		 */
		const answer = dirs(commandPath(GUI));
		/*
		 * What the shell knows that the list could not have guessed — not how many entries it has.
		 *
		 * Counting was the obvious form and it is wrong in both directions. The guesses include
		 * every location that happens to exist on this machine, so on one where several package
		 * managers are installed the list is the *longer* of the two and a correct answer fails the
		 * comparison; and a shell that merely reordered the same set would pass it. What is being
		 * claimed is that asking beats guessing, and that claim is about membership.
		 *
		 * Empty is a fact about the host rather than about the code: a container's non-login `sh`
		 * with no startup files exports the system PATH and stops. Said out loud, because a check
		 * that passes because its subject is absent should say so.
		 */
		const unguessable = answer.filter((dir) => !fallback.includes(dir));
		if (unguessable.length === 0) {
			t.diagnostic(`this host's shell adds nothing the list had not already guessed: ${answer.join(":")}`);
		} else {
			assert.ok(unguessable.length > 0, `the shell added nothing: ${answer.join(":")}`);
		}
		for (const dir of dirs(GUI)) assert.ok(answer.includes(dir), `${dir} was dropped`);
		assert.equal(new Set(answer).size, answer.length, "duplicates in the shell's answer");
	});
});

test("an empty PATH is treated as starved rather than as a shell's answer", { skip: posix }, () => {
	forgetCommandPath();
	assert.ok(dirs(commandPath("")).length > 0);
	forgetCommandPath();
	assert.ok(dirs(commandPath(undefined)).length > 0);
});

test("the repair finds a package manager, which is the entire point", { skip: posix }, async (t) => {
	const { execFileSync } = await import("node:child_process");
	const found = (path: string | undefined, tool: string) => {
		try {
			execFileSync("/bin/sh", ["-c", `command -v ${tool}`], { env: { PATH: path ?? "" }, stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	};
	/** Not whether it is reachable but *where from*, which is what the skip below turns on. */
	const where = (tool: string): string => {
		try {
			return execFileSync("/bin/sh", ["-c", `command -v ${tool}`], { env: { PATH: process.env.PATH ?? "" }, encoding: "utf8" }).trim();
		} catch {
			return "";
		}
	};

	// The premise. If this host cannot find node from a real shell either, there is nothing to prove.
	if (!found(process.env.PATH, "node")) return t.skip("no node on this host's own PATH");
	assert.equal(found(GUI, "node"), false, "premise broken: node was already reachable from the GUI PATH");

	/*
	 * Deliberately the fallback list alone, with no shell asked — both because it keeps this test
	 * off the CPU, and because the first command of a session runs on exactly this and has to work.
	 * What the shell adds on top is covered above.
	 */
	forgetCommandPath();
	const repaired = commandPath(GUI);
	assert.ok(found(repaired, "node"), "the fallback list cannot find node");

	/*
	 * And pnpm, where this host keeps pnpm somewhere the list has any reason to know about.
	 *
	 * The question is whether the guesses cover the places a person installs a package manager, so
	 * it can only be asked of a host where one is installed in such a place. CI is not: the runner
	 * unpacks pnpm into a scratch directory it made up for the job, and a list of where people keep
	 * their tools that knew `/home/runner/setup-pnpm/node_modules/.bin` would be a list overfitted
	 * to one machine. Skipped by naming the location rather than by catching the failure — the two
	 * look the same on a green run and mean opposite things on a red one.
	 */
	const at = where("pnpm");
	if (!at) {
		t.diagnostic("no pnpm on this host's own PATH");
	} else if (!FALLBACK_DIRS.includes(dirname(at))) {
		t.diagnostic(`pnpm lives in ${dirname(at)}, which is nobody's install location`);
	} else {
		assert.ok(found(repaired, "pnpm"), "the fallback list cannot find pnpm");
	}
	forgetCommandPath();
});

/**
 * nvm's layout, read rather than guessed.
 *
 * The entry that stood here before was `~/.nvm/current/bin`, which nvm never creates — that is
 * fnm's shape. So on any machine whose node comes from nvm the fallback pointed at a path that did
 * not exist, and the one test that would have caught it could not: it can only ask about the
 * directory this host happens to have.
 *
 * A directory made here instead, holding versions that sort differently as text than as numbers.
 */
test("nvm 的 node 目录按版本号从新到旧读出来，不是按字符串", async (t: TestContext) => {
	const root = await mkdtemp(join(tmpdir(), "lyra-nvm-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	// v9 sorts after v24 as text. A lexicographic list hands back the oldest node on the machine.
	for (const name of ["v9.11.2", "v24.18.0", "v22.9.0", "v24.2.1", "node_modules", ".DS_Store"]) {
		await mkdir(join(root, name), { recursive: true });
	}
	await writeFile(join(root, "stray-file"), "");

	assert.deepEqual(nvmNodeBins(root), [
		join(root, "v24.18.0", "bin"),
		join(root, "v24.2.1", "bin"),
		join(root, "v22.9.0", "bin"),
		join(root, "v9.11.2", "bin"),
	]);
});

test("没有 nvm 的机器上不报错，只是没有可加的目录", () => {
	assert.deepEqual(nvmNodeBins(join(tmpdir(), "lyra-nvm-absent-4711", "versions", "node")), []);
});
