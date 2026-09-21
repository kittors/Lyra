/**
 * What a session store has to be able to do.
 *
 * Extracted from the class rather than designed ahead of it: the JSONL store came first, and this
 * is the shape it turned out to have. Naming it is what lets a session be kept somewhere else —
 * a database, a server, a phone's local cache — without the runtime knowing which.
 *
 * The append-only contract is part of the interface, not an implementation detail. Callers rely on
 * `append` never rewriting history and on `read` replaying it in order; a store that compacted its
 * own file in place would satisfy the types and break every client syncing with `?since=N`.
 */

import type { Message } from "../types.ts";
import type { CommandRun } from "../agent/events.ts";
import type { Boundary, SessionMeta, SessionRecord, SessionRecordInput } from "./store.ts";
import type { SessionReadCursor, SessionRecordChanges } from "./read-changes.ts";

export interface SessionStorage {
	create(cwd: string, modelId: string, title?: string): Promise<SessionMeta>;
	/** Add one record and return the meta it produced. Never rewrites what is already there. */
	append(meta: SessionMeta, payload: SessionRecordInput): Promise<SessionMeta>;
	read(projectId: string, sessionId: string, sinceSeq?: number, options?: { display?: boolean }): AsyncGenerator<SessionRecord>;
	/** Optional byte-efficient snapshots for consumers that already hold the preceding log prefix. */
	readChanges?(projectId: string, sessionId: string, cursor?: SessionReadCursor): Promise<SessionRecordChanges<SessionRecord>>;
	messages(projectId: string, sessionId: string): Promise<Message[]>;
	load(
		projectId: string,
		sessionId: string,
		options?: { display?: boolean },
	): Promise<{
		meta: SessionMeta;
		messages: Message[];
		entries: { seq: number; message: Message }[];
		compactions: number[];
		commandRuns?: CommandRun[];
		compaction: Boundary | null;
	} | null>;
	listSessions(): Promise<SessionMeta[]>;
	rebuildIndex(): Promise<SessionMeta[]>;
	truncateFrom(
		projectId: string,
		sessionId: string,
		messageIndex: number,
	): Promise<{ meta: SessionMeta; messages: Message[] } | null>;
	setArchived(projectId: string, sessionId: string, archived: boolean): Promise<SessionMeta | null>;
	/**
	 * Re-file a session under another project: a new `cwd`, and with it a new home on disk.
	 *
	 * 归属不是一个标签——`projectId` 是 cwd 的哈希，而日志按 `projectId` 分目录存，所以这个方法
	 * 的实现必须真的把日志搬过去。放在接口上而不是留给调用方拼，正是因为「改字段」和「挪文件」
	 * 必须一起发生或者一起不发生。
	 */
	move(projectId: string, sessionId: string, cwd: string, projectName: string): Promise<SessionMeta | null>;
	delete(projectId: string, sessionId: string): Promise<void>;
	deleteMany(targets: { projectId: string; id: string }[]): Promise<void>;
	pruneEmpty(minAgeMs?: number): Promise<number>;
}
