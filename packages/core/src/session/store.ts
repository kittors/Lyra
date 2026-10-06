/**
 * Session storage: one SQLite database, `sessions/sessions.db` (ADR-0032).
 *
 * Every session is an append-only list of records with a monotonic `seq`, and a row in `sessions`
 * holding its current meta. The two are written in the same transaction, so the list the sidebar
 * reads can never disagree with the records it summarises — which is what the JSONL files and their
 * separately rewritten `index.json` spent most of this module working around: per-session write
 * queues, an index queue, rebuilds, and the races between all three.
 *
 * Nothing is rewritten in place. An edit is a `truncate` record, a rename a `title` record; a reader
 * that has seen up to seq N asks for what came after N and replays it. The logs sessions were kept
 * in before are imported the first time the database is opened (`legacy-jsonl.ts`).
 *
 * The methods still take a `projectId` beside the session id, as the JSONL store did, because every
 * caller passes one. The database does not need it: a session id is a UUID, and moving a session to
 * another project is a record, not a different file.
 */

import { createHash, randomUUID } from "node:crypto";
import { homedir, uptime } from "node:os";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { CommandRun } from "../agent/events.ts";
import type { AssistantMessage, Message, Usage } from "../types.ts";
import { emptyUsage } from "../types.ts";
import { applyRecord, persistedPayload, recordKind } from "./apply-record.ts";
import { beforeSessionDbClose, closeSessionDb, sessionDb, transaction } from "./db.ts";
import { importLegacySessions } from "./legacy-jsonl.ts";
import { assemblePartial, flushPendingPartials, type PartialPiece, type PartialSink } from "./partial.ts";
import { materializeJsonlLine, parkRecordPayload, rehydrateMessages } from "./payload.ts";
import type { SessionReadCursor, SessionRecordChanges } from "./read-changes.ts";
import { REPLAY_KINDS, replayRecords } from "./replay-records.ts";
import { auxiliaryCall, spendOf, type SpendEntry, type SpendRow } from "./spend.ts";
import type { ActiveDay, SessionStorage } from "./storage.ts";
import type { Boundary, SessionMeta, SessionRecord, SessionRecordInput } from "./types.ts";

export type { Boundary, SessionMeta, SessionRecord, SessionRecordInput } from "./types.ts";

export function lyraHome(): string {
	return process.env.LYRA_HOME || join(homedir(), ".lyra");
}

export function projectIdFor(cwd: string): string {
	return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

/** Records per query when streaming a session out: bounded memory, and no statement held open across an `await`. */
const READ_PAGE = 500;
/** Spend rows per `readSpend`. The table only grows, and a reader starting from 0 would otherwise take all of it at once. */
const SPEND_PAGE = 5_000;

/** Streams this process is writing right now: token to the database it writes into. See `settlePartial`. */
const liveStreams = new Map<string, string>();

/** The import of the old JSONL logs, once per database file and process. */
const imports = new Map<string, Promise<void>>();
/** Files whose import has finished, so a write can begin without waiting a tick for it — see `appendPartial`. */
const imported = new Set<string>();

// A normal quit mid-stream writes out the last batch before the connection closes.
beforeSessionDbClose(flushPendingPartials);

/** When this machine last booted, in ms. Nothing written before it can have a live writer. */
function bootedAt(): number {
	return Date.now() - uptime() * 1000;
}

/**
 * Whether whoever wrote a row is still there to finish it: this process's own writers by what it
 * remembers, another's by its pid — unless the row predates this boot, when the pid may be anyone's.
 */
function writerAlive(row: { owner_pid: number; updated_at: number }, mine: () => boolean): boolean {
	if (row.owner_pid === process.pid) return mine();
	// A few seconds of slack: `uptime` is rounded, and a row written just after boot is live.
	if (row.updated_at < bootedAt() - 5_000) return false;
	return processAlive(row.owner_pid);
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: it exists, it just is not ours to signal.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * What `load` reports as the session's spend: the replayed total, except when it comes out empty
 * over a meta that says otherwise — a session whose replies carried no usage keeps what its meta
 * accumulated.
 */
function settledUsage(meta: Usage, replayed: Usage): Usage {
	return replayed.total > 0 || meta.total === 0 ? replayed : meta;
}

export type LoadedSession = {
	meta: SessionMeta;
	messages: Message[];
	entries: { seq: number; message: Message }[];
	compactions: number[];
	commandRuns?: CommandRun[];
	compaction: Boundary | null;
};

export class SessionStore implements SessionStorage, PartialSink {
	/** The directory the database lives in, and the old JSONL logs before it. */
	readonly root: string;
	/** The database file. */
	readonly path: string;

	constructor(root = join(lyraHome(), "sessions")) {
		this.root = root;
		this.path = join(root, "sessions.db");
	}

	private get db(): DatabaseSync {
		return sessionDb(this.path);
	}

	/**
	 * The database, with the old logs brought in first.
	 *
	 * Every public method goes through here. The import reads files, so it cannot happen inside the
	 * synchronous open; doing it before the first read or write is what keeps a session written
	 * before the import from racing one coming in from its log.
	 */
	private async ready(): Promise<DatabaseSync> {
		const db = this.db;
		let pending = imports.get(this.path);
		if (!pending) {
			pending = importLegacySessions(db, this.root).then(
				() => {
					imported.add(this.path);
				},
				(error: unknown) => {
					// Tried again by the next caller rather than remembered as failed for the life of the process.
					imports.delete(this.path);
					throw error;
				},
			);
			imports.set(this.path, pending);
		}
		await pending;
		return db;
	}

	/**
	 * Close this process's connection. Tests call it before removing the directory; Windows will not
	 * delete an open file.
	 *
	 * What was streaming into it ends here too. Left marked live, a stream cut off by the close was
	 * never recovered by a store reopened in this process: its pid is this one, still running.
	 */
	close(): void {
		for (const [token, path] of liveStreams) if (path === this.path) liveStreams.delete(token);
		imports.delete(this.path);
		imported.delete(this.path);
		closeSessionDb(this.path);
	}

	private metaOf(sessionId: string): SessionMeta | null {
		const row = this.db.prepare("SELECT meta FROM sessions WHERE id = ?").get(sessionId) as { meta: string } | undefined;
		return row ? (JSON.parse(row.meta) as SessionMeta) : null;
	}

	async create(cwd: string, modelId: string, title = "New session", options: Pick<SessionMeta, "thinking"> = {}): Promise<SessionMeta> {
		const db = await this.ready();
		// One reading of the clock for the whole creation, so `createdAt`, `updatedAt` and the first record agree.
		const now = Date.now();
		const meta: SessionMeta = {
			id: randomUUID(),
			title,
			cwd,
			projectId: projectIdFor(cwd),
			projectName: basename(cwd) || cwd,
			createdAt: now,
			updatedAt: now,
			modelId,
			...(options.thinking ? { thinking: options.thinking } : {}),
			messageCount: 0,
			usage: emptyUsage(),
			seq: 0,
		};
		return transaction(db, () => {
			db.prepare("INSERT INTO sessions (id, project_id, seq, created_at, updated_at, archived, message_count, meta) VALUES (?, ?, 0, ?, ?, 0, 0, ?)")
				.run(meta.id, meta.projectId, now, now, JSON.stringify(meta));
			return this.write(meta.id, { type: "meta", meta }, false, now) ?? meta;
		});
	}

	/**
	 * Append one record and return the meta it produced.
	 *
	 * `copy` marks history that already happened in another session (a fork): it is written like
	 * anything else, but its replies were paid for once, where they were first given. `stream` is the
	 * streamed copy a reply settles; see `partial.ts`.
	 *
	 * Null when the session no longer exists: a write can still be on its way when the session is
	 * deleted, and it must neither bring it back nor be reported as committed — the window would put
	 * the deleted conversation back in the sidebar. What it spent is still kept: the call was made and
	 * billed, and deleting a conversation does not unspend its money.
	 */
	async append(meta: Pick<SessionMeta, "id">, payload: SessionRecordInput, options: { copy?: boolean; stream?: string } = {}): Promise<SessionMeta | null> {
		const db = await this.ready();
		// Images go to files here, outside the transaction.
		const parked = parkRecordPayload(payload);
		return transaction(db, () => this.write(meta.id, parked, options.copy ?? false, Date.now(), options.stream));
	}

	/** The one place a record is written: the record, the meta row, the spend, all or nothing. */
	private write(sessionId: string, payload: SessionRecordInput, copy: boolean, now = Date.now(), stream?: string): SessionMeta | null {
		const db = this.db;
		return transaction(db, () => {
			// Read under the write lock: whatever a caller holds may be stale, and another process may be writing too.
			const base = this.metaOf(sessionId);
			if (!base) {
				if (!copy) for (const entry of spendOf(payload, now)) this.insertSpend(sessionId, entry, now);
				return null;
			}
			const next = applyRecord(base, payload, now);
			if (next === base) return base;
			const record = { seq: next.seq, ts: now, ...persistedPayload(base, payload, next) };
			db.prepare("INSERT INTO records (session_id, seq, ts, kind, body) VALUES (?, ?, ?, ?, ?)")
				.run(sessionId, next.seq, now, recordKind(payload), JSON.stringify(record));
			db.prepare("UPDATE sessions SET project_id = ?, seq = ?, updated_at = ?, archived = ?, message_count = ?, meta = ? WHERE id = ?")
				.run(next.projectId, next.seq, next.updatedAt, next.archived ? 1 : 0, next.messageCount, JSON.stringify(next), sessionId);
			if (!copy) for (const entry of spendOf(payload, now)) this.insertSpend(sessionId, entry, now);
			// The reply is in; what was kept of it while it streamed has done its job. Only its own: a
			// stream begun since belongs to whoever took over.
			if (payload.type === "message" && payload.message?.role === "assistant" && stream !== undefined) this.clearPartial(sessionId, stream);
			return next;
		});
	}

	private insertSpend(sessionId: string | null, entry: SpendEntry, now: number): void {
		this.db.prepare("INSERT INTO spend (session_id, stream, kind, ts, source, provider, model, call) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
			// A reply built without a provider or model (tests, synthetic messages) has undefined there, which SQLite will not bind.
			.run(sessionId, entry.stream ?? null, entry.kind, now, entry.source ?? null, entry.provider ?? null, entry.model ?? null, entry.call ? JSON.stringify(entry.call) : null);
	}

	/** One session's meta, or null. */
	async get(sessionId: string): Promise<SessionMeta | null> {
		await this.ready();
		return this.metaOf(sessionId);
	}

	async listSessions(): Promise<SessionMeta[]> {
		const db = await this.ready();
		// Ties go to whichever came in first: the JSONL store's index broke them the same way, and the import keeps its order.
		const rows = db.prepare("SELECT meta FROM sessions ORDER BY updated_at DESC, rowid").all() as { meta: string }[];
		return rows.map((row) => JSON.parse(row.meta) as SessionMeta);
	}

	/**
	 * The list, as `listSessions` reads it. The JSONL store kept an `index.json` that could go missing
	 * or stale and had to be rebuilt by reading every log; the `sessions` table is written with each
	 * record, so there is nothing left to rebuild.
	 */
	rebuildIndex(): Promise<SessionMeta[]> {
		return this.listSessions();
	}

	/** Stream records, optionally only those newer than `sinceSeq`. */
	async *read(_projectId: string, sessionId: string, sinceSeq = 0, options?: { display?: boolean }): AsyncGenerator<SessionRecord> {
		await this.ready();
		yield* this.records(sessionId, sinceSeq, options?.display ?? false);
	}

	/** The records after `sinceSeq`, a page at a time; what `read` and `readChanges` both hand out. */
	private *records(sessionId: string, sinceSeq: number, display: boolean): Generator<SessionRecord> {
		this.settlePartial(sessionId);
		const page = this.db.prepare("SELECT seq, body FROM records WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?");
		let after = sinceSeq;
		while (true) {
			const rows = page.all(sessionId, after, READ_PAGE) as { seq: number; body: string }[];
			for (const row of rows) {
				after = row.seq;
				yield JSON.parse(display ? materializeJsonlLine(row.body) : row.body) as SessionRecord;
			}
			if (rows.length < READ_PAGE) return;
		}
	}

	/**
	 * What came after `cursor`, for a reader that keeps the records it has seen (`trajectory/changes.ts`).
	 *
	 * The cursor is the last `seq` read. History is never rewritten — a truncate is a record of its
	 * own — so the only reason to start again is that the cursor came from somewhere else: another
	 * database, or another session.
	 */
	async readChanges(_projectId: string, sessionId: string, cursor?: SessionReadCursor): Promise<SessionRecordChanges<SessionRecord>> {
		// A session that is gone is its own identity, so a reader holding its records is told to drop them.
		const identity = (await this.get(sessionId)) ? `${await this.storeId()}:${sessionId}` : "missing";
		const reset = !cursor || cursor.identity !== identity;
		const after = reset ? 0 : cursor.offset;
		const records = [...this.records(sessionId, after, false)];
		const last = records.at(-1)?.seq ?? after;
		return { cursor: { identity, version: `${identity}:${last}`, size: last, offset: last }, reset, records };
	}

	/**
	 * Every message ever committed, in order — truncated ones included.
	 *
	 * This is "what was said", for `recall` and the memory pass; `load` is "what the conversation is
	 * now". A record saying it is a message but carrying none is dropped: see `replayRecords`.
	 */
	async messages(_projectId: string, sessionId: string): Promise<Message[]> {
		const db = await this.ready();
		this.settlePartial(sessionId);
		const rows = db.prepare("SELECT body FROM records WHERE session_id = ? AND kind = 'message' ORDER BY seq").all(sessionId) as { body: string }[];
		const out: Message[] = [];
		for (const row of rows) {
			const record = JSON.parse(row.body) as { message?: Message };
			if (record.message) out.push(record.message);
		}
		return out;
	}

	/** Only the kinds the transcript is built from; a turn's prompts and requests are never parsed here. */
	private replay(sessionId: string, display: boolean) {
		const marks = REPLAY_KINDS.map(() => "?").join(", ");
		const rows = this.db.prepare(`SELECT body FROM records WHERE session_id = ? AND kind IN (${marks}) ORDER BY seq`).all(sessionId, ...REPLAY_KINDS) as { body: string }[];
		return replayRecords(rows.map((row) => JSON.parse(display ? materializeJsonlLine(row.body) : row.body) as SessionRecord));
	}

	async load(_projectId: string, sessionId: string, options?: { display?: boolean }): Promise<LoadedSession | null> {
		await this.ready();
		this.settlePartial(sessionId);
		const meta = this.metaOf(sessionId);
		if (!meta) return null;
		const replayed = this.replay(sessionId, options?.display ?? false);
		let entries = replayed.entries;
		let messages = entries.map((entry) => entry.message);
		if (!options?.display) {
			const hydrated = await rehydrateMessages(messages);
			if (hydrated !== messages) {
				messages = hydrated;
				entries = entries.map((entry, index) => ({ ...entry, message: hydrated[index] ?? entry.message }));
			}
		}
		meta.messageCount = messages.length;
		meta.usage = settledUsage(meta.usage, replayed.usage);
		return { meta, messages, entries, compactions: replayed.compactions, compaction: replayed.compaction, commandRuns: replayed.commandRuns };
	}

	/**
	 * Drop a message and everything after it.
	 *
	 * Returns the messages that survive, so the caller can reset its own in-memory copy to match
	 * without re-reading. Null when the index is out of range — a stale UI can ask to edit a message
	 * that has since been truncated by another client.
	 */
	async truncateFrom(_projectId: string, sessionId: string, messageIndex: number): Promise<{ meta: SessionMeta; messages: Message[] } | null> {
		const db = await this.ready();
		// The transcript is read under the write lock too: another process appending between the read and the cut would move the cut.
		const cut = transaction(db, () => {
			const { entries } = this.replay(sessionId, false);
			if (!Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= entries.length) return null;
			// Never cut inside a tool-call turn: a cut on a tool result moves back past the call that produced it.
			let target = messageIndex;
			while (target > 0 && entries[target]?.message.role === "toolResult") target -= 1;
			// The seq to keep is the one just before the record carrying the doomed message.
			const truncated = this.write(sessionId, { type: "truncate", afterSeq: entries[target].seq - 1 }, false);
			if (!truncated) return null;
			const usage = settledUsage(truncated.usage, this.replay(sessionId, false).usage);
			// The meta row tracks message count; a truncate is the one write that lowers it.
			const corrected = this.write(sessionId, { type: "meta", meta: { ...truncated, messageCount: target, usage } }, false) ?? truncated;
			return { meta: { ...corrected, messageCount: target, usage }, kept: entries.slice(0, target).map((entry) => entry.message) };
		});
		if (!cut) return null;
		return { meta: cut.meta, messages: await rehydrateMessages(cut.kept) };
	}

	/** Null when there is no such session — a stale sidebar can ask about one already deleted. */
	async setArchived(_projectId: string, sessionId: string, archived: boolean): Promise<SessionMeta | null> {
		await this.ready();
		if (!this.metaOf(sessionId)) return null;
		return this.write(sessionId, { type: "archive", archived }, false);
	}

	/**
	 * File a session under another project. Null when there is no such session.
	 *
	 * Already there is not nothing: a renamed project keeps its id and changes its name, and that
	 * still has to be written. Only when neither changed is there nothing to record.
	 */
	async move(_projectId: string, sessionId: string, cwd: string, projectName: string): Promise<SessionMeta | null> {
		await this.ready();
		const base = this.metaOf(sessionId);
		if (!base) return null;
		const projectId = projectIdFor(cwd);
		if (projectId === base.projectId && base.cwd === cwd && base.projectName === projectName) return base;
		return this.write(sessionId, { type: "move", cwd, projectId, projectName }, false);
	}

	async delete(projectId: string, sessionId: string): Promise<void> {
		await this.deleteMany([{ projectId, id: sessionId }]);
	}

	/**
	 * Delete sessions, their records and anything streaming for them — not what they spent.
	 *
	 * Space is handed back to the file system straight after. Without it SQLite only marks the pages
	 * free, and clearing a range in settings would free nothing anyone could see.
	 */
	async deleteMany(targets: { projectId: string; id: string }[]): Promise<void> {
		if (targets.length === 0) return;
		const db = await this.ready();
		const streams = transaction(db, () => {
			const tokens = db.prepare("SELECT token FROM partials WHERE session_id = ?");
			const remove = db.prepare("DELETE FROM sessions WHERE id = ?");
			return targets.flatMap(({ id }) => {
				const found = (tokens.all(id) as { token: string }[]).map((row) => row.token);
				remove.run(id);
				return found;
			});
		});
		for (const token of streams) liveStreams.delete(token);
		/*
		 * In one go: measured on the fork this came from, 0.5s for 320MB and 1.7s for 1GB. In steps
		 * with the event loop let in between, the longest pause was still 150–670ms and the whole took
		 * three times as long. The vacuum moves pages through the WAL, so the checkpoint after it is
		 * what makes the space come back when the person pressed delete.
		 */
		db.exec("PRAGMA incremental_vacuum");
		db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	}

	/**
	 * Drop sessions that were created but never used.
	 *
	 * A session with no messages holds nothing. They accumulate from any path that reserves a session
	 * up front and then sends nothing: a scheduled task that failed to start, a client that navigated
	 * away. `minAgeMs` protects one another client is about to send its first message to.
	 */
	async pruneEmpty(minAgeMs = 5 * 60_000): Promise<number> {
		const db = await this.ready();
		const rows = db.prepare("SELECT id, project_id FROM sessions WHERE message_count = 0 AND created_at < ?").all(Date.now() - minAgeMs) as { id: string; project_id: string }[];
		await this.deleteMany(rows.map((row) => ({ projectId: row.project_id, id: row.id })));
		return rows.length;
	}

	// ---------------------------------------------------------------------------------------------
	// A reply while it streams. See `partial.ts`.
	// ---------------------------------------------------------------------------------------------

	/** Takes the place over from any stream before it, whose token from then on matches nothing. */
	async beginPartial(sessionId: string, token: string, head: AssistantMessage): Promise<void> {
		const db = await this.ready();
		const { replaced, started } = transaction(db, () => {
			const before = db.prepare("SELECT token FROM partials WHERE session_id = ? AND stream = 'main'").get(sessionId) as { token: string } | undefined;
			db.prepare("DELETE FROM partials WHERE session_id = ? AND stream = 'main'").run(sessionId);
			const inserted = db.prepare("INSERT INTO partials (session_id, stream, token, head, owner_pid, updated_at) SELECT id, 'main', ?, ?, ?, ? FROM sessions WHERE id = ?")
				.run(token, JSON.stringify(head), process.pid, Date.now(), sessionId).changes;
			return { replaced: before?.token, started: Number(inserted) > 0 };
		});
		if (replaced) liveStreams.delete(replaced);
		// A session deleted in the meantime gets no stream, and nothing here should claim one.
		if (started) liveStreams.set(token, this.path);
	}

	async appendPartial(sessionId: string, token: string, pieces: PartialPiece[]): Promise<void> {
		/*
		 * Synchronous once the database is open, with no `await` before the write: at a normal quit the
		 * last batch is written from an `exit` handler (`flushPendingPartials`), where nothing after an
		 * `await` ever runs.
		 */
		const db = imported.has(this.path) ? this.db : await this.ready();
		transaction(db, () => {
			// Nothing to extend once the reply was committed, thrown away, or taken over by a newer stream.
			const known = db.prepare("SELECT COALESCE((SELECT MAX(n) FROM partial_chunks WHERE session_id = ? AND stream = 'main'), 0) AS n, EXISTS (SELECT 1 FROM partials WHERE session_id = ? AND stream = 'main' AND token = ?) AS open")
				.get(sessionId, sessionId, token) as { n: number; open: number };
			if (!known.open) return;
			db.prepare("INSERT INTO partial_chunks (session_id, stream, n, body) VALUES (?, 'main', ?, ?)").run(sessionId, known.n + 1, JSON.stringify(pieces));
			db.prepare("UPDATE partials SET updated_at = ? WHERE session_id = ? AND stream = 'main'").run(Date.now(), sessionId);
		});
	}

	async dropPartial(sessionId: string, token: string): Promise<void> {
		const db = await this.ready();
		transaction(db, () => this.clearPartial(sessionId, token));
	}

	private clearPartial(sessionId: string, token: string): void {
		this.db.prepare("DELETE FROM partials WHERE session_id = ? AND stream = 'main' AND token = ?").run(sessionId, token);
		liveStreams.delete(token);
	}

	/**
	 * Commit what a dead writer left behind, as the reply it would have been had someone pressed stop.
	 *
	 * A stream is dead when it is this process's and nothing here is writing it any more, when it was
	 * last written before this machine booted, or when the process that wrote it is gone. The boot
	 * check comes before the pid: after a power cut — the case this exists for — the old pid may well
	 * belong to some other process. Checked and committed in one transaction, so two processes
	 * opening the same session cannot both commit it.
	 *
	 * Stamped with when it was last written, not now: a reply cut off on Monday and opened on
	 * Wednesday happened on Monday. Never earlier than the meta, which only moves forward.
	 */
	private settlePartial(sessionId: string): void {
		const db = this.db;
		type Row = { token: string; head: string; owner_pid: number; updated_at: number };
		const probe = db.prepare("SELECT token, head, owner_pid, updated_at FROM partials WHERE session_id = ? AND stream = 'main'");
		const alive = (row: Row) => writerAlive(row, () => liveStreams.has(row.token));
		const found = probe.get(sessionId) as Row | undefined;
		if (!found || alive(found)) return;
		transaction(db, () => {
			const row = probe.get(sessionId) as Row | undefined;
			if (!row || alive(row)) return;
			const chunks = db.prepare("SELECT body FROM partial_chunks WHERE session_id = ? AND stream = 'main' ORDER BY n").all(sessionId) as { body: string }[];
			const message = assemblePartial(JSON.parse(row.head) as AssistantMessage, chunks.map((chunk) => JSON.parse(chunk.body) as PartialPiece[]));
			if (!message) return this.clearPartial(sessionId, row.token);
			this.write(sessionId, { type: "message", message }, false, Math.max(row.updated_at, this.metaOf(sessionId)?.updatedAt ?? 0), row.token);
		});
	}

	// ---------------------------------------------------------------------------------------------
	// Spend and space, for the settings pages.
	// ---------------------------------------------------------------------------------------------

	/** A model call that belongs to no conversation, such as the project memory pass. */
	async recordUsage(spent: { source: string; providerId: string; modelId: string; usage: Usage }): Promise<void> {
		const db = await this.ready();
		const now = Date.now();
		transaction(db, () => this.insertSpend(null, auxiliaryCall(spent, now), now));
	}

	/** The database's own name, made once; a cursor from another file is not one into this. */
	async storeId(): Promise<string> {
		const db = await this.ready();
		return (db.prepare("SELECT value FROM info WHERE key = 'id'").get() as { value: string }).value;
	}

	async readSpend(afterId = 0): Promise<SpendRow[]> {
		const db = await this.ready();
		const rows = db.prepare("SELECT id, session_id, stream, kind, ts, source, provider, model, call FROM spend WHERE id > ? ORDER BY id LIMIT ?").all(afterId, SPEND_PAGE) as {
			id: number;
			session_id: string | null;
			stream: string | null;
			kind: SpendRow["kind"];
			ts: number;
			source: string | null;
			provider: string | null;
			model: string | null;
			call: string | null;
		}[];
		return rows.map((row) => ({
			id: row.id,
			sessionId: row.session_id,
			stream: row.stream,
			kind: row.kind,
			ts: row.ts,
			source: row.source,
			provider: row.provider,
			model: row.model,
			call: row.call ? JSON.parse(row.call) : null,
		}));
	}

	/**
	 * Per local day, how many conversations did anything and how many messages were written.
	 *
	 * A sub-agent reply or a side call makes the conversation active that day without being one of
	 * its messages. Deleted conversations are gone from here — this is activity, not spend.
	 *
	 * Dated by when a record was written, not by the message's own timestamp, which only the body
	 * holds: a reply streamed across midnight counts on the day it finished, while its tokens stay on
	 * the day it started. Reading the timestamp out of every body cost 11x on a real 15 MB history
	 * (32 ms against 2.9 ms, growing with it) to move 1 message in 3,933.
	 */
	async activeDays(): Promise<ActiveDay[]> {
		const db = await this.ready();
		return db.prepare(`
			SELECT date(ts / 1000, 'unixepoch', 'localtime') AS day,
				COUNT(DISTINCT session_id) AS sessions,
				SUM(kind = 'message') AS messages
			FROM records WHERE kind IN ('message', 'usage', 'subagent_message')
			GROUP BY day ORDER BY day
		`).all() as unknown as ActiveDay[];
	}

	/** Bytes of records per session: what deleting it gives back. */
	async sizes(): Promise<Record<string, number>> {
		const db = await this.ready();
		const rows = db.prepare("SELECT session_id, SUM(length(CAST(body AS BLOB))) AS bytes FROM records GROUP BY session_id").all() as { session_id: string; bytes: number }[];
		return Object.fromEntries(rows.map((row) => [row.session_id, row.bytes]));
	}
}
