/**
 * A file somebody else has open, on Windows, from any machine.
 *
 * Antivirus and the search indexer open every file that has just been written, and while they hold
 * it a rename onto it answers EPERM or EBUSY. That lasts a moment, which is why `renameWithRetry`
 * waits it out — and why it cannot be reproduced on demand, even on Windows. These fake both halves:
 * the platform, and the refusal.
 */

import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import type { TestContext } from "node:test";

/** Run the rest of the test as if on Windows, restoring the real platform however it ends. */
export function asWindows(t: TestContext): void {
	const platform = Object.getOwnPropertyDescriptor(process, "platform");
	assert.ok(platform);
	Object.defineProperty(process, "platform", { ...platform, value: "win32" });
	t.after(() => Object.defineProperty(process, "platform", platform));
}

/**
 * Answer every `rename` onto a file named `target` with `code`, `times` times, then really rename.
 * A pattern stands for a name that is made up at the moment of the rename.
 */
export function refuseRenames(t: TestContext, target: string | RegExp, code: string, times = Infinity): { refused: () => number } {
	const real = fsPromises.rename;
	const matches = (name: string) => (typeof target === "string" ? name === target : target.test(name));
	let refused = 0;
	const mocked = t.mock.method(fsPromises, "rename", async (from: string, to: string) => {
		if (matches(basename(to)) && refused < times) {
			refused += 1;
			throw Object.assign(new Error(`${code}: operation not permitted, rename '${from}' -> '${to}'`), { code });
		}
		return real(from, to);
	});
	// Named imports of a builtin are bindings to a copy; this is what points them at the mock.
	syncBuiltinESMExports();
	t.after(() => {
		mocked.mock.restore();
		syncBuiltinESMExports();
	});
	return { refused: () => refused };
}
