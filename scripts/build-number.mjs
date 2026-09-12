#!/usr/bin/env node
/**
 * Print the native build number, for a shell that needs it.
 *
 * The arithmetic and the reason for it live in `versions.mjs` next to the version it is derived
 * from; this is only a way to ask from bash. `app.json` carries the value, so the workflows read
 * it back from what they built rather than computing it a second time — this exists so they have
 * something to compare against.
 *
 *   node scripts/build-number.mjs            当前版本的构建号
 *   node scripts/build-number.mjs 1.2.3      指定版本的
 */

import { buildNumber, readVersion, SOURCE } from "./versions.mjs";

try {
	console.log(buildNumber(process.argv[2] ?? (await readVersion(SOURCE))));
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
