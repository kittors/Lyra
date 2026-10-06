/**
 * Forgetting the repository this process was started from, before any test runs.
 *
 * Several tests build a git repository in a temporary directory and commit to it. They pass `cwd`,
 * which is enough — until the tests are run from a git hook.
 *
 * A hook is invoked with `GIT_DIR` (and often `GIT_WORK_TREE`, `GIT_INDEX_FILE`) exported, naming
 * the real repository. Those variables outrank `cwd`: `git init` writes the fixture, and every
 * command afterwards operates on the repository the hook came from instead. What that looks like
 * is `pnpm test` passing on its own and failing under `git push`, with the checkout left on a
 * commit called "init" authored by `t@example.com` and the working tree of a different project.
 *
 * It happened here: a `git push` moved this repository's HEAD onto a fixture commit and emptied
 * the tree to a single file. The push was refused — by the same hook, reporting the fixture's
 * failures — so nothing reached the remote, which is the only reason it was noticed rather than
 * shipped.
 *
 * Cleared for the whole process rather than per call site, because the next test to shell out to
 * git will not be written with this in mind, and the failure is silent until it is spectacular.
 * A test has no business inheriting an ambient repository in any case.
 */

for (const key of Object.keys(process.env)) {
	if (key.startsWith("GIT_")) delete process.env[key];
}

/*
 * Removing a temporary home closes the session database inside it first — the same guard as
 * `packages/core/test/setup.ts`: Windows will not delete a file that is open.
 */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { closeSessionDbsUnder } from "../../core/src/session/db.ts";

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
