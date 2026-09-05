/**
 * When each memory was last put in front of the model.
 *
 * A memory that has not been injected for three months is one whose trigger is broken or whose
 * subject is gone — the plan (12 §7) calls this the easily-missed field, and it is the only one
 * on the page that says whether a memory is doing anything. Here everything is injected on
 * every turn, so the field mostly separates "reaching the model" from "added after the last
 * session" or "switched off"; that is still the question it answers.
 *
 * Kept beside the memory, never inside it. `memory.json` and `learned.md` are content that a
 * person edits and adds to; a timestamp written into them on every turn would race a hand-added
 * entry (read-modify-write of the whole file) or dirty a hand-edited markdown. Losing a write
 * here loses a timestamp. Losing a write there loses a memory.
 *
 * Throttled per file, because a turn is the hot path and the file is the same for a minute.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { lyraHome } from "../session/store.ts";
import { projectMemoryDir } from "./project-memory.ts";

export type InjectedMap = Record<string, number>;

/** The extracted `MEMORY.md` is one thing to the model; this is its key. */
export const EXTRACTED_KEY = "extracted";

/** A minute: injection happens every turn, and the timestamp does not need to. */
export const MARK_INTERVAL_MS = 60_000;

export function userInjectedPath(): string {
	return join(lyraHome(), "memory-injected.json");
}

export function projectInjectedPath(cwd: string): string {
	return join(projectMemoryDir(cwd), "injected.json");
}

export async function readInjected(file: string): Promise<InjectedMap> {
	const raw = await readFile(file, "utf8").catch(() => null);
	if (raw === null) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return {};
		const out: InjectedMap = {};
		for (const [key, value] of Object.entries(parsed)) if (typeof value === "number") out[key] = value;
		return out;
	} catch {
		return {};
	}
}

const lastWrite = new Map<string, number>();

/**
 * Record that `keys` were injected at `at`.
 *
 * Skipped when this process wrote the same file less than `minInterval` ago — pass 0 to write
 * every time, which a test does and a turn does not. Keys not in `keys` keep their old time.
 */
export async function markInjected(file: string, keys: string[], at = Date.now(), minInterval = MARK_INTERVAL_MS): Promise<boolean> {
	if (keys.length === 0) return false;
	const last = lastWrite.get(file);
	if (last !== undefined && at - last < minInterval) return false;
	lastWrite.set(file, at);
	const current = await readInjected(file);
	for (const key of keys) current[key] = at;
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify(current, null, 2)}\n`, "utf8");
	return true;
}

/** The entries, each with its time from the sidecar — the shape the settings page shows. */
export function annotateInjected<T extends { id: string }>(entries: T[], injected: InjectedMap): (T & { lastInjectedAt?: number })[] {
	return entries.map((entry) => (injected[entry.id] !== undefined ? { ...entry, lastInjectedAt: injected[entry.id] } : entry));
}
