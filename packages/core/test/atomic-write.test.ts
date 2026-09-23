/**
 * Replacing a file whole: the settings, the vault, the symbol index.
 *
 * Each of these was written through `${path}.${pid}.tmp` and a single `rename`. The session index
 * had already been fixed for both of the ways that goes wrong (`session-index-race.test.ts`); these
 * are the same two failures, for the files that had not been:
 *
 * - one temporary name per process, for writes that run concurrently *inside* a process — two saves
 *   shared it, and the first rename took the file out from under the second (ENOENT);
 * - on Windows a rename onto a file that antivirus or the indexer has open fails for a moment with
 *   EPERM or EBUSY, and that moment was reported as a failed save.
 */

import assert from "node:assert/strict";
import fsPromises, { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, beforeEach, test, type TestContext } from "node:test";

import { DEFAULT_SETTINGS, saveSettings, settingsPath, type Settings } from "../src/config/settings.ts";
import { resetVault, seal, unseal } from "../src/config/vault.ts";
import { loadIndex, saveIndex, type SymbolIndex } from "../src/index/symbols.ts";

let home: string;
const made: string[] = [];
const previous = { home: process.env.LYRA_HOME, userProfile: process.env.USERPROFILE };

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-atomic-"));
	made.push(home);
	// Both, because `os.homedir()` reads `USERPROFILE` on Windows; `LYRA_HOME` outranks either.
	process.env.LYRA_HOME = home;
	process.env.USERPROFILE = home;
	resetVault();
});

after(async () => {
	if (previous.home === undefined) delete process.env.LYRA_HOME;
	else process.env.LYRA_HOME = previous.home;
	if (previous.userProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = previous.userProfile;
	await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
});

const leftovers = async (dir: string) => (await readdir(dir)).filter((name) => name.endsWith(".tmp"));

/** Run the rest of the test as if on Windows, restoring the real platform however it ends. */
function asWindows(t: TestContext): void {
	const platform = Object.getOwnPropertyDescriptor(process, "platform");
	assert.ok(platform);
	Object.defineProperty(process, "platform", { ...platform, value: "win32" });
	t.after(() => Object.defineProperty(process, "platform", platform));
}

/** Answer every `rename` onto a file named `target` with `code`, `times` times, then really rename. */
function refuseRenames(t: TestContext, target: string, code: string, times = Infinity): { refused: () => number } {
	const real = fsPromises.rename;
	let refused = 0;
	const mocked = t.mock.method(fsPromises, "rename", async (from: string, to: string) => {
		if (basename(to) === target && refused < times) {
			refused += 1;
			throw Object.assign(new Error(`${code}: operation not permitted, rename '${from}' -> '${to}'`), { code });
		}
		return real(from, to);
	});
	syncBuiltinESMExports();
	t.after(() => {
		mocked.mock.restore();
		syncBuiltinESMExports();
	});
	return { refused: () => refused };
}

test("settings saved a click apart all land, and the last one asked for is the one on disk", async () => {
	/*
	 * The desktop app saves on every change and does not wait for one save before starting the next:
	 * flip two switches quickly and there are two saves in flight. Each has to succeed, and they have
	 * to land in the order they were made — a save that finishes first is not the newer one.
	 */
	const saves = Array.from({ length: 6 }, (_, i): Settings => ({ ...DEFAULT_SETTINGS, alwaysAllow: [`save-${i}`] }));
	const results = await Promise.allSettled(saves.map((settings) => saveSettings(settings)));
	assert.deepEqual(results.filter((result) => result.status === "rejected").map((result) => String((result as PromiseRejectedResult).reason)), []);
	const onDisk = JSON.parse(await readFile(settingsPath(), "utf8")) as Settings;
	assert.deepEqual(onDisk.alwaysAllow, ["save-5"]);
	assert.deepEqual(await leftovers(home), []);
});

test("on Windows a rename refused for a moment is retried, not reported as a failed save", async (t) => {
	asWindows(t);
	const { refused } = refuseRenames(t, "settings.json", "EPERM", 2);
	await saveSettings({ ...DEFAULT_SETTINGS, alwaysAllow: ["kept"] });
	assert.equal(refused(), 2, "the premise: the first two renames were refused");
	assert.deepEqual((JSON.parse(await readFile(settingsPath(), "utf8")) as Settings).alwaysAllow, ["kept"]);
});

test("a write that fails does not leave its temporary file behind", async (t) => {
	// Not a code that means "held open": this one is reported straight away, and must clean up.
	refuseRenames(t, "settings.json", "EXDEV");
	await assert.rejects(saveSettings({ ...DEFAULT_SETTINGS }), /EXDEV/);
	assert.deepEqual(await leftovers(home), []);
});

test("secrets sealed at the same moment on a fresh profile can all be opened again", async () => {
	/*
	 * The vault makes its key on first use. Two first uses at once each made one and each wrote it
	 * through the same temporary file: one of them failed, or — worse — both succeeded and the key
	 * on disk was not the one half the secrets were sealed with, which is found out on next launch.
	 */
	const values = ["alpha", "beta", "gamma", "delta"];
	const sealed = await Promise.all(values.map((value) => seal(value)));
	resetVault();
	assert.deepEqual(await Promise.all(sealed.map((value) => unseal(value))), values);
});

test("one project's symbol index saved twice at once is saved, not lost to ENOENT", async () => {
	const cwd = join(home, "project");
	const index = (n: number): SymbolIndex => ({ cwd, builtAt: n, fileCount: 1, symbols: [], skipped: 0 });
	const results = await Promise.allSettled([1, 2, 3, 4].map((n) => saveIndex(index(n))));
	assert.deepEqual(results.filter((result) => result.status === "rejected").map((result) => String((result as PromiseRejectedResult).reason)), []);
	assert.ok(await loadIndex(cwd), "the index is readable afterwards");
	assert.deepEqual(await leftovers(join(home, "index")), []);
});
