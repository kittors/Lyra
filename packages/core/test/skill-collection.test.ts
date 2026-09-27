/**
 * A skill collection installed the old way, once it is on disk.
 *
 * Collections are installed as bundles of their own now (`plugins/<id>/skills/…`, see
 * `installEntry`). Before that they were flattened in among the loose skills as `<id>-<name>`, and
 * those installs are still on people's machines: uninstalling or updating one has to find the
 * scattered directories — and only those. These tests are about that older layout.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { bundleRoot, uninstallEntry } from "../src/plugins/registry.ts";

/** A home of our own, so the tests never look at the machine's real `~/.lyra`. */
async function withHome(body: (home: string) => Promise<void>): Promise<void> {
	const home = await mkdtemp(join(tmpdir(), "lyra-collection-"));
	const previous = process.env.LYRA_HOME;
	process.env.LYRA_HOME = home;
	try {
		await body(home);
	} finally {
		if (previous === undefined) delete process.env.LYRA_HOME;
		else process.env.LYRA_HOME = previous;
		await rm(home, { recursive: true, force: true });
	}
}

/** One skill directory, named as `moveInto` would have named it. */
async function skill(name: string): Promise<void> {
	const dir = join(bundleRoot("skill"), name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: 测试用。\n---\n`);
}

test("uninstalling a collection takes its scattered skills with it", async () => {
	await withHome(async () => {
		await skill("waza-check");
		await skill("waza-hunt");
		await skill("superpowers-brainstorm");

		await uninstallEntry("waza");

		const left = (await readdir(bundleRoot("skill"))).sort();
		assert.deepEqual(left, ["superpowers-brainstorm"]);
	});
});

test("a loose skill whose name merely starts the same way is not touched", async () => {
	await withHome(async () => {
		/*
		 * `waza` and `wazabi` are not Waza's, and the prefix alone does not distinguish them.
		 *
		 * Both would be caught by a `startsWith("waza")`, and both are directories the user could
		 * have written themselves — deleting either is destroying work on the strength of a naming
		 * coincidence. The separator is what makes the prefix a prefix.
		 */
		await skill("waza");
		await skill("wazabi");
		await skill("waza-check");

		await uninstallEntry("waza");

		const left = (await readdir(bundleRoot("skill"))).sort();
		assert.deepEqual(left, ["waza", "wazabi"]);
	});
});

test("uninstalling something that was never installed is not an error", async () => {
	await withHome(async () => {
		await mkdir(bundleRoot("skill"), { recursive: true });
		await uninstallEntry("never-installed");
	});
});

test("an id that could escape the skills directory is refused", async () => {
	await withHome(async () => {
		await assert.rejects(() => uninstallEntry("../../etc"), /非法/);
		await assert.rejects(() => uninstallEntry(""), /非法/);
	});
});
