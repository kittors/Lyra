/**
 * Walking the event stream forwards.
 *
 * "What had happened by sequence N" is the question underneath resuming, forking and replaying, so
 * it is answered once, here. Resuming asks for the end of the stream; forking asks for a point in
 * the middle; replaying asks for every point in turn.
 *
 * Truncation is applied as it is met rather than pre-scanned, because that is what it means: a
 * record that voids the tail behind it, in the order the file was written.
 */

import type { AgentEvent } from "../agent/events.ts";
import type { SessionRecord, SessionStore } from "../session/store.ts";
import type { Message } from "../types.ts";

/** The messages a session held at a given point. Pass `Infinity` for "all of it". */
export async function messagesUpTo(
	store: Pick<SessionStore, "read">,
	projectId: string,
	sessionId: string,
	seq: number,
): Promise<Message[]> {
	const kept: { seq: number; message: Message }[] = [];
	for await (const record of store.read(projectId, sessionId)) {
		if (record.seq > seq) break;
		if (record.type === "truncate") {
			const cutoff = record.afterSeq;
			while (kept.length > 0 && kept[kept.length - 1].seq > cutoff) kept.pop();
			continue;
		}
		if (record.type === "message") kept.push({ seq: record.seq, message: record.message });
	}
	return kept.map((entry) => entry.message);
}

type Compacted = Extract<AgentEvent, { type: "compacted" }>;

/** One thing a fork writes back, in the order the source wrote it. */
export type HistoryItem = { message: Message } | { compacted: Compacted };

/**
 * The messages a session held at a given point, with its compactions in place among them.
 *
 * A fork needs the compactions as well as the messages. The history the model is given starts at a
 * compaction boundary (`SessionStore.load`), and a fork that copied only the messages opened on the
 * full, uncompacted history — a long conversation forked into a request its model could not take.
 *
 * The walk is `load`'s, so the fork reads back exactly what the source read at that point: a
 * compaction is placed by how many messages preceded it; a truncate drops the tail behind it,
 * the dividers past the new end, and the boundary once its kept tail is gone. Only the boundary
 * still standing keeps its `kept`; the others are written as dividers — kept, a boundary this
 * session had retired would come back in a log that no longer carries the truncate that retired it.
 */
export async function historyUpTo(
	store: Pick<SessionStore, "read">,
	projectId: string,
	sessionId: string,
	seq: number,
): Promise<{ items: HistoryItem[]; messages: number }> {
	let entries: { seq: number; message: Message }[] = [];
	let marks: { position: number; event: Compacted }[] = [];
	let boundary: { position: number; event: Compacted } | null = null;
	for await (const record of store.read(projectId, sessionId)) {
		if (record.seq > seq) break;
		if (record.type === "truncate") {
			entries = entries.filter((entry) => entry.seq <= record.afterSeq);
			marks = marks.filter((mark) => mark.position <= entries.length);
			if (boundary && boundary.position - (boundary.event.kept ?? 0) > entries.length) boundary = null;
		} else if (record.type === "event" && record.event.type === "compacted") {
			const mark = { position: entries.length, event: record.event };
			marks.push(mark);
			if (record.event.kept !== undefined) boundary = mark;
		} else if (record.type === "message" && record.message) {
			// A message record with no message in it is a hole `load` skips; copied, it would throw.
			entries.push({ seq: record.seq, message: record.message });
		}
	}
	const items: HistoryItem[] = [];
	let next = 0;
	const divider = (mark: { position: number; event: Compacted }): HistoryItem => {
		if (mark === boundary) return { compacted: mark.event };
		const { kept: _kept, ...rest } = mark.event;
		return { compacted: rest };
	};
	for (const [index, entry] of entries.entries()) {
		while (next < marks.length && marks[next].position === index) items.push(divider(marks[next++]));
		items.push({ message: entry.message });
	}
	while (next < marks.length) items.push(divider(marks[next++]));
	return { items, messages: entries.length };
}

/**
 * Every record in order, as steps.
 *
 * A generator rather than an array: a replay is watched one step at a time, and a long session's
 * records are the one thing in this app that genuinely does not fit comfortably in memory.
 */
export async function* replaySession(
	store: Pick<SessionStore, "read">,
	projectId: string,
	sessionId: string,
	sinceSeq = 0,
): AsyncGenerator<SessionRecord> {
	for await (const record of store.read(projectId, sessionId, sinceSeq)) yield record;
}
