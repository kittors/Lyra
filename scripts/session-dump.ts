/**
 * The records of a session as they are stored: one JSON record per line, the shape the `.jsonl`
 * logs had before sessions moved into SQLite (ADR-0032).
 *
 * `cat`, `grep` and `jq` cannot reach into the database, and reading a session by hand — to find
 * out why a turn ended, or to hand it to someone — is how most of the bugs here were found. Opened
 * read-only, so it can run while the app is open.
 *
 * Usage:
 *   pnpm dump:session                    every session: id, last used, messages, title
 *   pnpm dump:session <id or a prefix>   every record of that session
 *   pnpm dump:session <id> > s.jsonl
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const home = process.env.LYRA_HOME || join(homedir(), ".lyra");
const path = join(home, "sessions", "sessions.db");
if (!existsSync(path)) {
	// Before the first launch of a version with the database, the sessions are still the old logs.
	console.error(`No ${path}. Sessions not yet imported are still JSONL under ${join(home, "sessions")}.`);
	process.exit(1);
}
const db = new DatabaseSync(path, { readOnly: true });
const wanted = process.argv[2];

if (!wanted) {
	const rows = db.prepare("SELECT id, updated_at, message_count, meta FROM sessions ORDER BY updated_at DESC, rowid").all() as { id: string; updated_at: number; message_count: number; meta: string }[];
	for (const row of rows) {
		const title = (JSON.parse(row.meta) as { title?: string }).title ?? "";
		console.log(`${row.id}  ${new Date(row.updated_at).toISOString()}  ${String(row.message_count).padStart(5)}  ${title}`);
	}
} else {
	const ids = (db.prepare("SELECT id FROM sessions WHERE substr(id, 1, length(?)) = ?").all(wanted, wanted) as { id: string }[]).map((row) => row.id);
	if (ids.length !== 1) {
		console.error(ids.length === 0 ? `No session starts with ${wanted}.` : `${wanted} matches ${ids.length} sessions; give more of it:\n${ids.join("\n")}`);
		process.exit(1);
	}
	for (const row of db.prepare("SELECT body FROM records WHERE session_id = ? ORDER BY seq").iterate(ids[0]) as Iterable<{ body: string }>) {
		process.stdout.write(`${row.body}\n`);
	}
}
db.close();
