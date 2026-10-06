/**
 * Where the JSONL store kept sessions, and what becomes of those files now (ADR-0032).
 *
 * `<root>/<projectId>/<id>.jsonl` per session, an `index.json` the sidebar was drawn from, and a
 * `<id>.display.json` beside a log that had been opened. The import reads them once
 * (`legacy-jsonl.ts`); after that a log stays only as a backup of what was imported, and goes when
 * its session does.
 */

import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../utils/atomic-write.ts";
import type { SessionMeta } from "./types.ts";

export interface LegacyLog {
	projectId: string;
	id: string;
	path: string;
}

/** Every session log under `root`, as `<projectId>/<id>.jsonl`. */
export async function legacyLogs(root: string): Promise<LegacyLog[]> {
	const out: LegacyLog[] = [];
	for (const project of await readdir(root, { withFileTypes: true }).catch(() => [])) {
		if (!project.isDirectory()) continue;
		for (const file of await readdir(join(root, project.name)).catch(() => [])) {
			if (file.endsWith(".jsonl")) out.push({ projectId: project.name, id: file.slice(0, -".jsonl".length), path: join(root, project.name, file) });
		}
	}
	return out;
}

/**
 * What the JSONL store's sidebar listed: its `index.json`, in order. Null when there is none to read
 * — missing or damaged — in which case the JSONL store rebuilt it from every log, and so does the import.
 */
export async function readLegacyIndex(root: string): Promise<SessionMeta[] | null> {
	const raw = await readFile(join(root, "index.json"), "utf8").catch(() => null);
	if (raw === null) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		return parsed.filter((entry): entry is SessionMeta => typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string");
	} catch {
		return null;
	}
}

/** The files in any project's directory whose name `wanted` accepts. */
async function projectFiles(root: string, wanted: (name: string) => boolean): Promise<string[]> {
	const out: string[] = [];
	for (const project of await readdir(root, { withFileTypes: true }).catch(() => [])) {
		if (!project.isDirectory()) continue;
		for (const file of await readdir(join(root, project.name)).catch((): string[] => [])) {
			if (wanted(file)) out.push(join(root, project.name, file));
		}
	}
	return out;
}

/** Each one that can go, goes; one that will not — open elsewhere, on Windows — is said, and the rest still go. */
async function removeAll(paths: string[]): Promise<void> {
	for (const path of paths) {
		await rm(path, { force: true }).catch((error: unknown) => console.warn(`[sessions] Could not remove ${path}:`, error));
	}
}

/**
 * The display caches: a whole transcript per session — 48 MB of them on one real history — written so
 * a long conversation could open without replaying its log. Nothing reads them since the database,
 * and kept they would hold on to conversations deleted since.
 */
export async function removeDisplayCaches(root: string): Promise<void> {
	await removeAll(await projectFiles(root, (name) => name.endsWith(".display.json")));
}

/** One removal at a time: two rewriting `index.json` together would each put back what the other took out. */
let removing: Promise<void> = Promise.resolve();

/**
 * Delete what the JSONL store kept of these sessions: their logs, wherever they are, and their
 * entries in its index. Never rejects — the sessions themselves are already gone.
 *
 * The JSONL store deleted a conversation's log with it, and a backup must not keep what its owner
 * deleted. Every project is looked in: a session moved since the import keeps its log under the
 * project it came from. The index entry goes too. It holds the title, and a database made afresh —
 * the old one moved aside — would bring the session back from it.
 */
export function removeLegacyFiles(root: string, ids: string[]): Promise<void> {
	const run = removing.then(async () => {
		const doomed = new Set(ids.flatMap((id) => [`${id}.jsonl`, `${id}.display.json`]));
		await removeAll(await projectFiles(root, (name) => doomed.has(name)));
		const index = await readLegacyIndex(root);
		if (!index) return;
		const gone = new Set(ids);
		const kept = index.filter((meta) => !gone.has(meta.id));
		if (kept.length === index.length) return;
		await writeFileAtomic(join(root, "index.json"), JSON.stringify(kept)).catch((error: unknown) => console.warn("[sessions] Could not update the old index:", error));
	});
	removing = run.catch(() => {});
	return run;
}
