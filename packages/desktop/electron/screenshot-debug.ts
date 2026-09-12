/**
 * A written record of one capture, from the shortcut to the last window operation.
 *
 * Everything this file exists to answer is a question about *timing and actual values* on someone
 * else's machine: which branch ran, what the display really measures, what size the snapshot came
 * back at, when the window was shown relative to when it was activated. None of that can be
 * inferred from the source — the same code takes different paths depending on what was frontmost —
 * and none of it survives a screen recording, which shows the symptom and not the cause.
 *
 * Written to `screenshot-debug.log` in the app's own directory, appended, one line per event with a
 * millisecond stamp relative to the start of the capture. Cheap enough to leave on: a capture
 * produces a couple of dozen lines.
 */

import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { lyraHome } from "@lyra/core";

let started = 0;
let session = 0;
/**
 * A sequence number on every line.
 *
 * The write itself is fire-and-forget — a log that made the capture wait for the disk would change
 * the very timing it exists to measure — so lines can land out of order. The number is the order
 * things actually happened in, which is the whole point of reading this file.
 */
let seq = 0;

/** The file, so it can be quoted to the user in one piece. */
function debugLogPath(): string {
	return join(lyraHome(), "screenshot-debug.log");
}

export function beginCaptureLog(): void {
	started = Date.now();
	session += 1;
	seq = 0;
	void write(`\n===== capture #${session} @ ${new Date().toISOString()} =====`);
}

/**
 * One fact about this capture.
 *
 * Fire-and-forget: a log that made the capture wait for the disk would change the very timing it is
 * there to measure.
 */
export function captureLog(event: string, detail?: Record<string, unknown>): void {
	const ms = started ? Date.now() - started : 0;
	const body = detail ? ` ${JSON.stringify(detail)}` : "";
	seq += 1;
	void write(`#${String(seq).padStart(2, "0")} [+${String(ms).padStart(5, " ")}ms] ${event}${body}`);
}

async function write(line: string): Promise<void> {
	try {
		await appendFile(debugLogPath(), `${line}\n`, "utf8");
	} catch {
		// A capture must not fail because its diary could not be written.
	}
}
