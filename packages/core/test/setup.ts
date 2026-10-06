/**
 * Forgetting the repository this process was started from, before any test runs.
 *
 * The same guard as `packages/desktop/test/setup.ts`, for the same reason: a git hook exports
 * `GIT_DIR` naming the real repository, and it outranks the `cwd` a test passes when it builds a
 * fixture repository in a temporary directory. Tests then commit to the checkout they were
 * launched from.
 *
 * See that file for what it looked like when it happened.
 */

for (const key of Object.keys(process.env)) {
	if (key.startsWith("GIT_")) delete process.env[key];
}

/*
 * Removing a temporary home closes the session database inside it first.
 *
 * Windows will not delete a file that is open, and every store keeps its database open for the life
 * of the process (`session/db.ts`). A test that cleans up with `rm` would pass everywhere else and
 * fail there — so `rm` is taught to close what is under the path, once, here, rather than by every
 * test that builds a store remembering to.
 */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { closeSessionDbsUnder } from "../src/session/db.ts";

const rm = fs.promises.rm;
fs.promises.rm = ((path, options) => {
	closeSessionDbsUnder(String(path));
	return rm(path, options);
}) as typeof rm;
const rmSync = fs.rmSync;
fs.rmSync = ((path, options) => {
	closeSessionDbsUnder(String(path));
	rmSync(path, options);
}) as typeof rmSync;
syncBuiltinESMExports();
