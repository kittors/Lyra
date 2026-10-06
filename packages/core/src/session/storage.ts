/**
 * What a session store has to be able to do.
 *
 * Extracted from the class rather than designed ahead of it: the JSONL store came first, and this is
 * the shape it turned out to have. Naming it is what let the sessions move into a database (ADR-0032)
 * without the runtime knowing — and what lets the desktop wrap the store to broadcast its writes.
 *
 * The append-only contract is part of the interface, not an implementation detail. Callers rely on
 * `append` never rewriting history and on `read` replaying it in order; a store that compacted its
 * own records in place would satisfy the types and break every client syncing with `?since=N`.
 *
 * The `projectId` arguments are the JSONL store's: its logs were filed by project. The database does
 * not need them, and every caller still passes one.
 */

import type { Message, Usage } from "../types.ts";
import type { PartialSink } from "./partial.ts";
import type { SessionReadCursor, SessionRecordChanges } from "./read-changes.ts";
import type { SpendRow } from "./spend.ts";
import type { LoadedSession } from "./store.ts";
import type { SessionMeta, SessionRecord, SessionRecordInput } from "./types.ts";

/** One local day of activity. */
export interface ActiveDay {
	/** `YYYY-MM-DD`, local. */
	day: string;
	/** Conversations that said or heard anything that day. */
	sessions: number;
	/** Messages on both sides. */
	messages: number;
}

export interface SessionStorage extends Partial<PartialSink> {
	/** `options.thinking` is written into the first record; see `SessionMeta.thinking` for why every new session gets one. */
	create(cwd: string, modelId: string, title?: string, options?: Pick<SessionMeta, "thinking">): Promise<SessionMeta>;
	/**
	 * Add one record and return the meta it produced. Never rewrites what is already there.
	 * `copy` marks history carried over from another session, whose cost was counted there.
	 * Null when the session is gone: nothing was committed, though what the record spent is kept.
	 * `stream` is the streamed copy a reply settles, dropped with it; no other stream is touched.
	 */
	append(meta: Pick<SessionMeta, "id">, payload: SessionRecordInput, options?: { copy?: boolean; stream?: string }): Promise<SessionMeta | null>;
	/** One session's meta, or null when there is no such session. */
	get?(sessionId: string): Promise<SessionMeta | null>;
	read(projectId: string, sessionId: string, sinceSeq?: number, options?: { display?: boolean }): AsyncGenerator<SessionRecord>;
	/** Optional incremental reads for consumers that already hold what came before. */
	readChanges?(projectId: string, sessionId: string, cursor?: SessionReadCursor): Promise<SessionRecordChanges<SessionRecord>>;
	messages(projectId: string, sessionId: string): Promise<Message[]>;
	load(projectId: string, sessionId: string, options?: { display?: boolean }): Promise<LoadedSession | null>;
	/** Most recently used first. */
	listSessions(): Promise<SessionMeta[]>;
	rebuildIndex(): Promise<SessionMeta[]>;
	truncateFrom(projectId: string, sessionId: string, messageIndex: number): Promise<{ meta: SessionMeta; messages: Message[] } | null>;
	setArchived(projectId: string, sessionId: string, archived: boolean): Promise<SessionMeta | null>;
	/** Re-file a session under another project: a new `cwd`, and with it a new `projectId`. */
	move(projectId: string, sessionId: string, cwd: string, projectName: string): Promise<SessionMeta | null>;
	delete(projectId: string, sessionId: string): Promise<void>;
	deleteMany(targets: { projectId: string; id: string }[]): Promise<void>;
	pruneEmpty(minAgeMs?: number): Promise<number>;
	/** A model call that belongs to no conversation. */
	recordUsage?(spent: { source: string; providerId: string; modelId: string; usage: Usage }): Promise<void>;
	/**
	 * Billed calls and prefix boundaries after `afterId`, deleted conversations included, in id order
	 * and a page at a time: read on from the last id until a page comes back empty.
	 */
	readSpend?(afterId?: number): Promise<SpendRow[]>;
	/** Names this store. A `readSpend` cursor kept anywhere else means nothing against another one. */
	storeId?(): Promise<string>;
	activeDays?(): Promise<ActiveDay[]>;
	/** Bytes each session's records take. */
	sizes?(): Promise<Record<string, number>>;
}
