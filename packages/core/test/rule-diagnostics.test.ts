/**
 * What the rules page is told about the files it could not use, next to what the session is told.
 *
 * `collectRules` answers the settings page and `loadRules` the session, from the same registry. The
 * page's copy dropped each line's severity, so a description cut short arrived looking like a file
 * whose YAML does not parse, and the page, with nothing to tell them apart, called both unreadable.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, before, test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import { collectRules, loadRules } from "../src/runtime/session-setup.ts";

let home: string;
let project: string;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-rule-diagnostics-home-"));
	project = await mkdtemp(join(tmpdir(), "ly-rule-diagnostics-proj-"));
	process.env.LYRA_HOME = join(home, ".lyra");

	const rules = join(project, ".lyra", "rules");
	await mkdir(rules, { recursive: true });
	// Loads, with two warnings: a description past the limit, and a condition that is not a regex.
	await writeFile(join(rules, "noisy.md"), `---\ndescription: ${"x".repeat(450)}\ncondition: "(unclosed"\n---\nKeep it short.\n`);
	// Does not load: its YAML does not parse.
	await writeFile(join(rules, "broken.md"), "---\ndescription: [unclosed\n---\nBody.\n");
});

after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

/** os.homedir() reads USERPROFILE on Windows and HOME on POSIX. */
async function withHome<T>(run: () => Promise<T>): Promise<T> {
	const keys = ["HOME", "USERPROFILE"];
	const saved = keys.map((key) => process.env[key]);
	for (const key of keys) process.env[key] = home;
	try {
		return await run();
	} finally {
		for (const [index, key] of keys.entries()) {
			if (saved[index] === undefined) delete process.env[key];
			else process.env[key] = saved[index];
		}
	}
}

/** One line per diagnostic, sorted: the registry collects its sources' lines as each one finishes. */
const lines = (diagnostics: { path: string; message: string; severity?: string }[]) =>
	diagnostics.map((d) => `${basename(d.path)} ${d.severity}: ${d.message}`).sort();

test("the rules page is told which lines are errors and which are warnings", async () => {
	const { diagnostics } = await withHome(() => collectRules(project, DEFAULT_SETTINGS, []));
	assert.deepEqual(
		diagnostics.map((d) => `${basename(d.path)} ${d.severity}`).sort(),
		["broken.md error", "noisy.md warning", "noisy.md warning"],
		lines(diagnostics).join("\n"),
	);
});

test("and it is told what the session is told", async () => {
	const page = await withHome(() => collectRules(project, DEFAULT_SETTINGS, []));
	const session = await withHome(() => loadRules(project, DEFAULT_SETTINGS, []));
	assert.deepEqual(lines(page.diagnostics), lines(session.diagnostics));
});
