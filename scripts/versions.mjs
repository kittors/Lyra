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
	"packages/contract/package.json",
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

/**
 * The integer both platforms want for a native build, derived from the version they already share.
 *
 * Android calls it `versionCode` and refuses an APK whose number is not higher than the installed
 * one; iOS calls it `CFBundleVersion` and expects it to rise between builds of the same version
 * string. Neither accepts `0.9.11`.
 *
 * `major * 1000000 + minor * 1000 + patch`, so 0.9.11 → 9011 and 1.0.0 → 1000000. It rises with
 * the version as long as minor and patch stay under 1000, and throws rather than returning a
 * number that goes backwards if either ever reaches 1000.
 */
export function buildNumber(version) {
	const parts = version.split(".").map(Number);
	if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`不是 x.y.z：${version}`);
	const [major, minor, patch] = parts;
	if (minor > 999 || patch > 999) throw new Error(`${version} 的 minor 或 patch 超过 999，这个进位方式会让构建号倒退——先改这里的算法`);
	return major * 1000000 + minor * 1000 + patch;
}

/**
 * Write that integer into `app.json`, where `expo prebuild` will pick it up.
 *
 * It lives in the manifest rather than being passed to the build because `app.json` is the only
 * description of the app that exists — `android/` and `ios/` are generated. The alternative was
 * `-Pandroid.injected.version.code`, which was tried on a runner: Gradle accepted the property,
 * the build succeeded, and the APK came out carrying versionCode 1 anyway.
 */
export async function writeBuildNumber(version) {
	const path = join(ROOT, EXPO_MANIFEST);
	const text = await readFile(path, "utf8");
	const code = buildNumber(version);
	const android = /("versionCode"\s*:\s*)(\d+)/;
	const ios = /("buildNumber"\s*:\s*")([^"]+)(")/;
	if (!android.test(text)) throw new Error(`${EXPO_MANIFEST} 里找不到 android.versionCode`);
	if (!ios.test(text)) throw new Error(`${EXPO_MANIFEST} 里找不到 ios.buildNumber`);
	await writeFile(path, text.replace(android, `$1${code}`).replace(ios, `$1${code}$3`));
	return code;
}
