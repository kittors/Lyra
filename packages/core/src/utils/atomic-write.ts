/**
 * Replacing a file whole, so a reader finds the old contents or the new ones and never a mix.
 *
 * Write a temporary sibling, then rename it over the target. Both halves of that have gone wrong
 * here already — in the session index first (`store.ts`), then in the settings, the vault and the
 * symbol index, which had copied the same three lines:
 *
 * - The temporary name has to be unique per *write*, not per process. `${path}.${pid}.tmp` was the
 *   convention, and two writes inside one process — two sessions created at once, two settings saves
 *   a click apart — shared it: the first rename took the file out from under the second, which then
 *   failed with ENOENT, or put the other write's bytes in place.
 * - On Windows a rename onto a file somebody else has open fails with EPERM, EBUSY or EACCES, and
 *   antivirus and the search indexer open every file that has just been written. That is a moment
 *   rather than a state, so it is waited out before it is reported.
 */

import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

export interface AtomicWriteOptions {
	/**
	 * Permissions for the file. Given to the temporary file as it is created, so what it holds is
	 * never readable by anyone else — not even between the write and the rename.
	 */
	mode?: number;
}

export async function writeFileAtomic(path: string, data: string | Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
	const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
	try {
		await writeFile(tmp, data, options.mode === undefined ? {} : { mode: options.mode });
		await renameWithRetry(tmp, path);
	} catch (error) {
		// Unique names mean a failure's leftover is never overwritten by the next attempt; it would pile up.
		await rm(tmp, { force: true }).catch(() => {});
		throw error;
	}
}

export interface RenameRetry {
	/** Tries in all, the first included. */
	attempts?: number;
	/** The wait after the first refusal; each later wait is one step longer. */
	stepMs?: number;
}

/** What a Windows rename answers while another process has the file, or one inside it, open. */
const HELD_OPEN = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * `rename`, waiting out another process that has the target open on Windows.
 *
 * Only there: on macOS and Linux the same codes mean permissions, which do not change by waiting,
 * and a retry would only delay the error. The default budget is the one the session index used —
 * about half a second, enough for a scanner to let go of a small file. Callers moving something
 * large pass a longer one.
 */
export async function renameWithRetry(from: string, to: string, retry: RenameRetry = {}): Promise<void> {
	const attempts = retry.attempts ?? 8;
	const step = retry.stepMs ?? 20;
	for (let attempt = 1; ; attempt++) {
		try {
			await rename(from, to);
			return;
		} catch (error) {
			if (attempt >= attempts || !heldOpen(error)) throw error;
			await new Promise((resolve) => setTimeout(resolve, step * attempt));
		}
	}
}

function heldOpen(error: unknown): boolean {
	return process.platform === "win32" && HELD_OPEN.has((error as { code?: string } | null)?.code ?? "");
}
