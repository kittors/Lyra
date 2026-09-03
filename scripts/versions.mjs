/**
 * Every place the version number is written down.
 *
 * AGENTS.md used to say "版本号在 6 个 package.json 里，要一起改". It is seven now, plus the Expo
 * manifest — `packages/relay` arrived with the relay service and `app.json` was already out of step
 * at 0.1.0 while everything else was at 0.8.x. A list nobody can forget to extend is the point of
 * putting it here rather than in a sentence.
 *
 * Internal dependencies use `workspace:*` and are unaffected.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The file that decides; everything else is made to agree with it. */
export const SOURCE = "package.json";

export const MANIFESTS = [
	"package.json",
	"packages/core/package.json",
	"packages/desktop/package.json",
	"packages/mobile/package.json",
	"packages/agent-cli/package.json",
	"packages/registry-shared/package.json",
	"packages/relay/package.json",
];

/** Expo keeps its own copy, under a different key. */
export const EXPO_MANIFEST = "packages/mobile/app.json";

export async function readVersion(relative) {
	const json = JSON.parse(await readFile(join(ROOT, relative), "utf8"));
	return relative === EXPO_MANIFEST ? json.expo?.version : json.version;
}

/**
 * Rewrite one version string, leaving the rest of the file byte-identical.
 *
 * A regex rather than `JSON.parse` + `stringify`: these files are hand-formatted — two-space here,
 * tab there — and re-serialising one turns a one-line change into a whole-file diff that hides it.
 */
export async function writeVersion(relative, version) {
	const path = join(ROOT, relative);
	const text = await readFile(path, "utf8");
	const pattern = relative === EXPO_MANIFEST ? /("expo"[\s\S]*?"version"\s*:\s*")([^"]+)(")/ : /("version"\s*:\s*")([^"]+)(")/;
	if (!pattern.test(text)) throw new Error(`${relative} 里找不到 version 字段`);
	await writeFile(path, text.replace(pattern, `$1${version}$3`));
}

export const ALL = [...MANIFESTS, EXPO_MANIFEST];
