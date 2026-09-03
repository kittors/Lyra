/**
 * Every manifest carries the same version.
 *
 * They are written by `pnpm release`, so this is not about catching a typo in a hand edit. It is
 * about catching a *new* manifest: a package added without being added to the list would sit at
 * whatever version its author happened to type, and nothing else in the build would notice.
 *
 * `packages/mobile/app.json` is why this test exists. It said 0.1.0 while everything else was at
 * 0.8.36 — the phone reported a version that had not been real for thirty-five releases.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ALL, EXPO_MANIFEST, ROOT, SOURCE } from "../scripts/versions.mjs";

async function versionIn(relative: string): Promise<string | undefined> {
	const json = JSON.parse(await readFile(join(ROOT, relative), "utf8"));
	return relative === EXPO_MANIFEST ? json.expo?.version : json.version;
}

test("每个 manifest 的版本都与根 package.json 一致", async () => {
	const expected = await versionIn(SOURCE);
	assert.match(expected ?? "", /^\d+\.\d+\.\d+$/, "根版本号应该是 x.y.z");

	for (const relative of ALL) {
		assert.equal(await versionIn(relative), expected, `${relative} 的版本与根不一致`);
	}
});

test("没有漏登记的包——工作区里每个 package.json 都在清单里", async () => {
	const entries = await readdir(join(ROOT, "packages"), { withFileTypes: true });
	const found = entries.filter((e) => e.isDirectory()).map((e) => `packages/${e.name}/package.json`);

	for (const relative of found) {
		assert.ok(
			ALL.includes(relative),
			`${relative} 不在 scripts/versions.mjs 的清单里；新加的包要一起登记，否则发版时它的版本会停在原地`,
		);
	}
});
