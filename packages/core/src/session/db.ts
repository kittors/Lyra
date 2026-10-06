/**
 * The session database: one SQLite file, one connection per process.
 *
 * `node:sqlite` rather than a dependency: it ships with the runtime (Node 24, Electron 43), and a
 * native module would have to be rebuilt per platform on every release.
 *
 * The API is synchronous, and that is load-bearing. A transaction here never spans an `await`, so
 * nothing else in this process can interleave with it — which is what lets the store drop the
 * per-session write queues and the index rewrites the JSONL files needed. Keep it that way: **a
 * transaction only reads and writes the database**. No file I/O, no network, no waiting on
 * anything, because every session in every process queues on the same write lock. See ADR-0032.
 */

import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The schema, and its version. A file written under any other version is reported with its path and
 * left alone, never converted: writing into tables of another shape is how a database gets quietly
 * corrupted. Bump the version with every change to the tables.
 *
 * `records.body` is the whole record as JSON, so a new record type changes nothing here.
 */
const SCHEMA_VERSION = 1;
const SCHEMA = `
	CREATE TABLE sessions (
		id TEXT PRIMARY KEY,
		project_id TEXT NOT NULL,
		seq INTEGER NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		archived INTEGER NOT NULL DEFAULT 0,
		message_count INTEGER NOT NULL,
		meta TEXT NOT NULL
	);
	CREATE INDEX sessions_recent ON sessions (updated_at DESC);

	-- body last: filtering on kind does not have to read a large body's overflow pages.
	CREATE TABLE records (
		id INTEGER PRIMARY KEY,
		session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		seq INTEGER NOT NULL,
		ts INTEGER NOT NULL,
		kind TEXT NOT NULL,
		body TEXT NOT NULL,
		UNIQUE (session_id, seq)
	);

	-- \`token\` is which beginPartial a streamed copy belongs to. A new stream takes the same key, so
	-- without it a writer that had been taken over could still extend, drop or settle its successor's.
	CREATE TABLE partials (
		session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		stream TEXT NOT NULL,
		token TEXT NOT NULL,
		head TEXT NOT NULL,
		owner_pid INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		PRIMARY KEY (session_id, stream)
	);
	CREATE TABLE partial_chunks (
		session_id TEXT NOT NULL,
		stream TEXT NOT NULL,
		n INTEGER NOT NULL,
		body TEXT NOT NULL,
		PRIMARY KEY (session_id, stream, n),
		FOREIGN KEY (session_id, stream) REFERENCES partials (session_id, stream) ON DELETE CASCADE
	);

	-- No foreign key on purpose: deleting a conversation does not unspend its money.
	CREATE TABLE spend (
		id INTEGER PRIMARY KEY,
		session_id TEXT,
		stream TEXT,
		kind TEXT NOT NULL,
		ts INTEGER NOT NULL,
		source TEXT,
		provider TEXT,
		model TEXT,
		call TEXT
	);

	-- A name for this file, made once, and facts about it (when the old JSONL logs were imported).
	-- A cursor kept outside the file — the usage page's cache of spend rows read — checks the name
	-- first: a database recreated or restored from a backup numbers its rows afresh.
	CREATE TABLE info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
	INSERT INTO info (key, value) VALUES ('id', lower(hex(randomblob(16))));
`;

/** The session database would not open. Carries where it is, because the person has to go and look. */
export class SessionDbUnavailable extends Error {
	readonly path: string;
	/** What SQLite, or the version check, said. */
	readonly reason: string;

	constructor(path: string, cause: unknown) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		super(`Cannot open the session database ${path}: ${reason}`, { cause });
		this.name = "SessionDbUnavailable";
		this.path = path;
		this.reason = reason;
	}
}

/** What the WAL file is cut back to after a checkpoint. A few seconds of streaming, not a whole cleanup. */
const WAL_LIMIT_BYTES = 16 * 1024 * 1024;

const open = new Map<string, DatabaseSync>();

/**
 * The connection for `path`, opened and given its tables on first use.
 *
 * Shared by every store on the same file in this process: the API is synchronous, so a second
 * connection buys no concurrency, and one connection is what keeps "which streams are live here" a
 * question with a single answer (see `partial.ts`).
 *
 * A file that cannot be opened is reported with its path and left alone. Rebuilding it would erase
 * every conversation to recover from what may be a transient lock or a half-synced copy.
 */
export function sessionDb(path: string): DatabaseSync {
	const known = open.get(path);
	if (known?.isOpen) return known;
	let db: DatabaseSync | undefined;
	try {
		mkdirSync(dirname(path), { recursive: true });
		db = new DatabaseSync(path, { timeout: 5_000 });
		// Only takes effect before the first table exists, which is why it comes first.
		db.exec("PRAGMA auto_vacuum = INCREMENTAL");
		db.exec("PRAGMA journal_mode = WAL");
		/*
		 * NORMAL, not FULL. Under WAL it survives the process dying at any point; only a power cut can
		 * lose the last few commits. FULL would fsync every commit, and a streaming reply commits a
		 * dozen times a second.
		 */
		db.exec("PRAGMA synchronous = NORMAL");
		/*
		 * The WAL file is reused, never shrunk, unless this is set: deleting 320MB of sessions wrote
		 * 313MB of relocated pages into it and the file stayed that size. With a limit it is cut back
		 * the next time it is reset.
		 */
		db.exec(`PRAGMA journal_size_limit = ${WAL_LIMIT_BYTES}`);
		db.exec("PRAGMA foreign_keys = ON");
		prepareSchema(db);
	} catch (cause) {
		if (db?.isOpen) db.close();
		throw new SessionDbUnavailable(path, cause);
	}
	open.set(path, db);
	closeAtExit();
	return db;
}

export function closeSessionDb(path: string): void {
	const db = open.get(path);
	open.delete(path);
	if (db?.isOpen) db.close();
}

/**
 * Close every connection to a database inside `dir`.
 *
 * For whatever is about to remove the directory — the tests' temporary homes, above all: Windows
 * will not delete a file that is open, and a store left open fails the removal there and nowhere else.
 */
export function closeSessionDbsUnder(dir: string): void {
	for (const path of open.keys()) {
		const inside = relative(resolve(dir), path);
		if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))) closeSessionDb(path);
	}
}

/** Writes still held in memory, to land before the connections close at exit. */
const lastWrites = new Set<() => void>();

/** Register a synchronous flush to run at exit, before the database is closed. */
export function beforeSessionDbClose(flush: () => void): void {
	lastWrites.add(flush);
}

let exitHooked = false;

/*
 * Close every connection when the process exits normally, after the last writes.
 *
 * Closing is what folds the WAL back into the database file and removes it. Left open, a quit
 * leaves the newest commits only in `sessions.db-wal`, and "quit before copying `~/.lyra`" stops
 * being true. `exit` runs synchronously, which is enough here because every write in this module is.
 */
function closeAtExit(): void {
	if (exitHooked) return;
	exitHooked = true;
	process.once("exit", () => {
		for (const flush of lastWrites) {
			try {
				flush();
			} catch {
				// One writer failing must not keep the rest of the data from being folded in.
			}
		}
		// Deleting the entry being visited is safe for a Map iterator.
		for (const path of open.keys()) closeSessionDb(path);
	});
}

/** Run `fn` inside one write transaction. Re-entrant: an inner call joins the outer one. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
	if (db.isTransaction) return fn();
	db.exec("BEGIN IMMEDIATE");
	try {
		const result = fn();
		db.exec("COMMIT");
		return result;
	} catch (error) {
		if (db.isTransaction) db.exec("ROLLBACK");
		throw error;
	}
}

/** A fact recorded in the file, or null. */
export function infoOf(db: DatabaseSync, key: string): string | null {
	const row = db.prepare("SELECT value FROM info WHERE key = ?").get(key) as { value: string } | undefined;
	return row?.value ?? null;
}

export function setInfo(db: DatabaseSync, key: string, value: string): void {
	db.prepare("INSERT INTO info (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}

function userVersion(db: DatabaseSync): number {
	return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
}

/** Create the tables in a new file; refuse a file whose tables are not this version's. */
function prepareSchema(db: DatabaseSync): void {
	if (userVersion(db) === SCHEMA_VERSION) return;
	transaction(db, () => {
		// Read again under the write lock: another process may have created it in the meantime.
		const found = userVersion(db);
		if (found === SCHEMA_VERSION) return;
		if (found !== 0) {
			throw new Error(`its tables are version ${found} and this Lyra writes version ${SCHEMA_VERSION}; move the file aside and a new one is made`);
		}
		db.exec(SCHEMA);
		db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
	});
}
