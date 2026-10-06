/**
 * The JSONL logs sessions were kept in before the database, imported into it once (ADR-0032).
 *
 * Lyra had shipped with them: every conversation anybody has is in one of these files, so the move
 * to SQLite carries them over rather than starting empty. The files are left where they were — a
 * backup, never read again once imported (an `info` row says so) — because a re-import after the
 * fact would bring back every session deleted since.
 *
 * Each log is read whole, outside any transaction (no file I/O inside one, see `db.ts`), and then
 * written in one transaction of its own: a session is either all there or not at all, and a process
 * that dies part-way through picks up at the first log not yet in the database.
 */

import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { DatabaseSync } from "node:sqlite";
import { applyRecord, recordKind } from "./apply-record.ts";
import { infoOf, setInfo, transaction } from "./db.ts";
import { replayRecords } from "./replay-records.ts";
import { spendOf, type SpendEntry } from "./spend.ts";
import { emptyUsage, type Usage } from "../types.ts";
import type { SessionMeta, SessionRecord, SessionRecordInput } from "./types.ts";

/** Set once every log under the root has been imported; from then on the files are only a backup. */
const LEGACY_IMPORTED = "legacy_jsonl_imported";

interface LegacyLog {
	projectId: string;
	id: string;
	path: string;
}

/** Every session log under `root`, as `<projectId>/<id>.jsonl`. */
async function legacyLogs(root: string): Promise<LegacyLog[]> {
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
 * The records of one log, in the order written.
 *
 * A line that does not parse — a crash mid-append leaves a partial last line — or that parses to
 * something that is not a record is skipped, as the JSONL store did when it read them.
 */
async function readLegacyLog(path: string): Promise<SessionRecord[]> {
	const out: SessionRecord[] = [];
	const lines = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (!line.trim()) continue;
			let record: unknown;
			try {
				record = JSON.parse(line);
			} catch {
				continue;
			}
			if (typeof record === "object" && record !== null && typeof (record as { type?: unknown }).type === "string") out.push(record as SessionRecord);
		}
	} finally {
		lines.close();
	}
	return out;
}

/**
 * What the JSONL store's sidebar listed: its `index.json`, in order. Null when there is none to read
 * — missing or damaged — in which case the JSONL store rebuilt it from every log, and so does this.
 */
async function readLegacyIndex(root: string): Promise<SessionMeta[] | null> {
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

/** One session to bring over: where its records are, and what the index said of it. */
interface Planned {
	id: string;
	/** Its logs, the one to read first; none for a session the index listed with no log behind it. */
	logs: LegacyLog[];
	listed?: SessionMeta;
}

/**
 * The sessions to import, in the order to import them, and the logs of which only what they spent
 * comes over.
 *
 * With an index, the sessions it lists, in its order — the list breaks ties in last use by which came
 * first, as the index did. A session it lists with no log comes over too: the JSONL store's sidebar
 * showed it from the index alone. A log it does not name was no session to the JSONL store —
 * deleting removed the log and then the entry, and a removal that failed was ignored — so importing
 * it would bring back a conversation someone deleted. Its spending is another matter: the JSONL
 * store's usage page summed every log on disk, and deleting no longer takes a conversation's cost
 * off the totals.
 */
function plan(logs: LegacyLog[], index: SessionMeta[] | null): { sessions: Planned[]; spentOnly: LegacyLog[] } {
	const byId = new Map<string, LegacyLog[]>();
	for (const log of logs) byId.set(log.id, [...(byId.get(log.id) ?? []), log]);
	if (!index) return { sessions: [...byId].map(([id, found]) => ({ id, logs: found })), spentOnly: [] };
	const listed = new Set(index.map((meta) => meta.id));
	const sessions = index.map((meta) => ({
		id: meta.id,
		listed: meta,
		// The same id under two projects is a move whose old log was not removed: the index says which is current.
		logs: [...(byId.get(meta.id) ?? [])].sort((a, b) => Number(a.projectId !== meta.projectId) - Number(b.projectId !== meta.projectId)),
	}));
	return { sessions, spentOnly: logs.filter((log) => !listed.has(log.id)) };
}

/** A session the index listed with no log behind it, as the index had it: the row and nothing under it. */
function importListedOnly(db: DatabaseSync, meta: SessionMeta): boolean {
	return transaction(db, () => {
		if (db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(meta.id)) return false;
		const seq = Number.isInteger(meta.seq) && meta.seq > 0 ? meta.seq : 0;
		db.prepare("INSERT INTO sessions (id, project_id, seq, created_at, updated_at, archived, message_count, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
			.run(meta.id, meta.projectId, seq, meta.createdAt, meta.updatedAt, meta.archived ? 1 : 0, meta.messageCount ?? 0, JSON.stringify({ ...meta, seq }));
		return true;
	});
}

function spendWriter(db: DatabaseSync): (sessionId: string, ts: number, entries: SpendEntry[]) => void {
	const insert = db.prepare("INSERT INTO spend (session_id, stream, kind, ts, source, provider, model, call) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
	return (sessionId, ts, entries) => {
		// `?? null` on every field: an old record missing a provider must not fail its whole session, and SQLite will not bind undefined.
		for (const entry of entries) insert.run(sessionId, entry.stream ?? null, entry.kind, ts, entry.source ?? null, entry.provider ?? null, entry.model ?? null, entry.call ? JSON.stringify(entry.call) : null);
	};
}

/** A log's billed calls without its session: for one that is not a session (see `plan`). */
function importLegacySpend(db: DatabaseSync, id: string, records: SessionRecord[]): void {
	transaction(db, () => {
		const spend = spendWriter(db);
		// A record without a time of its own is dated by the one before it, or the first that has one.
		let last = records.find((record) => Number.isFinite(record.ts))?.ts ?? Date.now();
		for (const record of records) {
			if (Number.isFinite(record.ts)) last = record.ts;
			let entries: SpendEntry[];
			try {
				entries = spendOf(readable(payloadOf(record)), last);
			} catch {
				continue;
			}
			spend(id, last, entries);
		}
	});
}

const whole = (usage: unknown): boolean => typeof usage === "object" && usage !== null && typeof (usage as Usage).cost === "object" && (usage as Usage).cost !== null;

function wholeUsage(usage: unknown): Usage {
	const empty = emptyUsage();
	const given = typeof usage === "object" && usage !== null ? (usage as Partial<Usage>) : {};
	return { ...empty, ...given, cost: { ...empty.cost, ...given.cost } };
}

/**
 * A record as the meta arithmetic reads it.
 *
 * Old logs — and hand-written ones, which is what the e2e fixtures are — have replies with no
 * `usage`, or one without its `cost`. The JSONL store showed them all the same and left them out of
 * its sums; adding them up here would throw, and the reply would be lost. They come over with the
 * missing parts as zeros: no tokens recorded, which is what they said.
 */
function readable(payload: SessionRecordInput): SessionRecordInput {
	if (payload.type === "message" && payload.message?.role === "assistant" && !whole(payload.message.usage)) {
		return { ...payload, message: { ...payload.message, usage: wholeUsage(payload.message.usage) } };
	}
	if (payload.type === "event" && payload.event?.type === "subagent_message" && payload.event.message?.role === "assistant" && !whole(payload.event.message.usage)) {
		return { ...payload, event: { ...payload.event, message: { ...payload.event.message, usage: wholeUsage(payload.event.message.usage) } } };
	}
	if (payload.type === "usage" && !whole(payload.usage)) return { ...payload, usage: wholeUsage(payload.usage) };
	return payload;
}

function payloadOf(record: SessionRecord): SessionRecordInput {
	const { seq: _seq, ts: _ts, ...payload } = record;
	return payload as SessionRecordInput;
}

/**
 * Write one log's records under `id`, with the meta they add up to. False when there was nothing to
 * import — no meta record — or the session is already in the database.
 *
 * `listed` is the session as the index had it. Its `updatedAt` is when it was last used as far as
 * the sidebar knew, which is what the list was sorted by; and a log whose own meta record is gone —
 * a first line cut short — still comes over from it, as the sidebar still showed it.
 *
 * Sequence numbers are kept, because a phone syncing with `?since=N` holds them; only where an old
 * log has them out of order (two writes once raced to the same number) is a record renumbered to
 * follow the one before, and a `truncate` pointing into the renumbered stretch is pointed at the
 * same place in the new numbering.
 */
function importLegacyLog(db: DatabaseSync, id: string, records: SessionRecord[], listed?: SessionMeta): boolean {
	const first = records.find((record): record is Extract<SessionRecord, { type: "meta" }> => record.type === "meta" && typeof record.meta === "object" && record.meta !== null);
	const base = first?.meta ?? listed;
	if (!base) return false;
	return transaction(db, () => {
		if (db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(id)) return false;
		const insertRecord = db.prepare("INSERT INTO records (session_id, seq, ts, kind, body) VALUES (?, ?, ?, ?, ?)");
		const spend = spendWriter(db);
		let meta: SessionMeta = { ...base, id, seq: 0 };
		// The row first: the records point at it. Its meta is rewritten once they are all in.
		db.prepare("INSERT INTO sessions (id, project_id, seq, created_at, updated_at, archived, message_count, meta) VALUES (?, ?, 0, ?, ?, 0, 0, ?)")
			.run(id, meta.projectId, meta.createdAt, meta.updatedAt, JSON.stringify(meta));
		let last = 0;
		const renumbered: { from: number; to: number }[] = [];
		const kept: SessionRecord[] = [];
		for (const record of records) {
			const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : meta.updatedAt;
			const seq = Number.isInteger(record.seq) && record.seq > last ? record.seq : last + 1;
			renumbered.push({ from: record.seq, to: seq });
			last = seq;
			let payload = readable(payloadOf(record));
			if (payload.type === "truncate") {
				// The newest record at or before the old cut, in the new numbering.
				const at = renumbered.slice(0, -1).findLast((entry) => entry.from <= (payload as { afterSeq: number }).afterSeq);
				payload = { ...payload, afterSeq: at?.to ?? 0 };
			}
			let next: SessionMeta;
			try {
				next = applyRecord(meta, payload, ts);
			} catch {
				// A record with nothing in it to read — an event with no body, a message with no message —
				// is dropped like a line that does not parse, rather than failing the session.
				continue;
			}
			meta = { ...(next === meta ? meta : next), seq };
			const written = { seq, ts, ...payload } as SessionRecord;
			kept.push(written);
			insertRecord.run(id, seq, ts, recordKind(payload), JSON.stringify(written));
			spend(id, ts, spendOf(payload, ts));
		}
		// What the JSONL store reported for a session when it read one back: counted from the transcript.
		const replayed = replayRecords(kept);
		meta.messageCount = replayed.entries.length;
		if (replayed.usage.total > 0 || meta.usage.total === 0) meta.usage = replayed.usage;
		if (listed && Number.isFinite(listed.updatedAt)) meta.updatedAt = listed.updatedAt;
		db.prepare("UPDATE sessions SET project_id = ?, seq = ?, created_at = ?, updated_at = ?, archived = ?, message_count = ?, meta = ? WHERE id = ?")
			.run(meta.projectId, meta.seq, meta.createdAt, meta.updatedAt, meta.archived ? 1 : 0, meta.messageCount, JSON.stringify(meta), id);
		return true;
	});
}

/**
 * Bring every log under `root` into the database, once.
 *
 * Returns how many sessions came over this time; zero when it had been done before.
 */
export async function importLegacySessions(db: DatabaseSync, root: string): Promise<number> {
	if (infoOf(db, LEGACY_IMPORTED)) return 0;
	const index = await readLegacyIndex(root);
	const { sessions, spentOnly } = plan(await legacyLogs(root), index);
	const exists = (id: string) => Boolean(db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(id));
	/*
	 * What a log that is not a session spent: the JSONL store's usage page summed every log on disk,
	 * session or not. Once per id, and never for one that came over as a session, which brought its
	 * spending with it.
	 */
	const counted = new Set<string>();
	const spendOnly = (log: LegacyLog, records: SessionRecord[]) => {
		if (counted.has(log.id) || exists(log.id)) return;
		counted.add(log.id);
		try {
			importLegacySpend(db, log.id, records);
		} catch (error) {
			console.warn(`[sessions] Could not import what ${log.path} spent:`, error);
		}
	};
	let imported = 0;
	for (const session of sessions) {
		if (exists(session.id)) continue;
		const [log] = session.logs;
		const records = log ? await readLegacyLog(log.path).catch(() => []) : [];
		let done = false;
		try {
			done = log ? importLegacyLog(db, session.id, records, session.listed) : session.listed ? importListedOnly(db, session.listed) : false;
		} catch (error) {
			// One log the import cannot make sense of must not keep every other session out of the
			// app. Its transaction rolled back; the file stays where it was.
			console.warn(`[sessions] Could not import ${log?.path ?? `${session.id} from the index`}:`, error);
		}
		// No meta record and nothing in the index to stand in for one: no session to the JSONL store either.
		if (done) imported += 1;
		else if (log) spendOnly(log, records);
	}
	for (const log of spentOnly) spendOnly(log, await readLegacyLog(log.path).catch(() => []));
	transaction(db, () => setInfo(db, LEGACY_IMPORTED, JSON.stringify({ at: Date.now(), sessions: imported })));
	return imported;
}
