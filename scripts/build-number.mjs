#!/usr/bin/env node
/**
 * The integer both app stores want, derived from the version both platforms already agree on.
 *
 * Android calls it `versionCode` and refuses to install an APK whose number is not higher than the
 * installed one; iOS calls it `CFBundleVersion` and expects it to increase between builds of the
 * same `CFBundleShortVersionString`. Neither accepts `0.9.11`.
 *
 * Derived rather than stored, and derived in one file rather than two:
 *
 *   - stored means a second number to bump, and this repository has the scar. `app.json` sat at
 *     0.1.0 for thirty-five releases because it was the last item on a list.
 *   - one file because the alternative is the same arithmetic written into a workflow step and
 *     into a shell script, which agree until somebody changes one of them.
 *
 * `major * 1000000 + minor * 1000 + patch`, so 0.9.11 → 9011 and 1.0.0 → 1000000. It rises with
 * the version as long as minor and patch stay under 1000, and if either ever reaches 1000 this
 * throws rather than emitting a number that goes backwards.
 *
 *   node scripts/build-number.mjs            当前版本的构建号
 *   node scripts/build-number.mjs 1.2.3      指定版本的
 */

import { readVersion, SOURCE } from "./versions.mjs";

const version = process.argv[2] ?? (await readVersion(SOURCE));
const parts = version.split(".").map(Number);

if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
	console.error(`不是 x.y.z：${version}`);
	process.exit(1);
}

const [major, minor, patch] = parts;
if (minor > 999 || patch > 999) {
	console.error(`${version} 的 minor 或 patch 超过 999，这个进位方式会让构建号倒退——先改这里的算法`);
	process.exit(1);
}

console.log(major * 1000000 + minor * 1000 + patch);
