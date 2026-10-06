/**
 * What one record does to a session's meta.
 *
 * Pure, so the rules live in one place and can be tested without a database: the store applies it
 * inside the append transaction, and nothing else is allowed to compute a next meta.
 */

import type { AgentEvent } from "../agent/events.ts";
import { addUsage } from "../types.ts";
import type { SessionMeta, SessionRecordInput } from "./types.ts";

/**
 * The meta after `payload`, stamped at `now`; `base` itself when the record changes nothing and is
 * not to be written (an automatic title over one the user chose).
 *
 * `now` is both the record's `ts` and, for anything but filing it away, the new `updatedAt` — one
 * reading, so the two can never disagree.
 */
export function applyRecord(base: SessionMeta, payload: SessionRecordInput, now: number): SessionMeta {
	if (payload.type === "title" && payload.source === "auto" && base.titleSetByUser) return base;
	const next: SessionMeta = { ...base, seq: base.seq + 1, updatedAt: now };

	/*
	 * Tokens a sub-agent burns are this session's tokens.
	 *
	 * Its messages are written as `subagent_message` events, not `message` records, so the rule
	 * below never reached them — and a whole delegation was missing from the session's total.
	 * Measured on two real sessions (2026-09-11): the count missed 58.4% and 38.1%; in the first the
	 * sub-agent spent 40% more than the main agent.
	 *
	 * Assistant messages only: one assistant message is one request, and usage is recorded on it.
	 * `messageCount` is not advanced — it says how long the conversation is, and a delegation's
	 * internal round trips would make one delegation look like dozens of turns.
	 */
	if (payload.type === "event" && payload.event.type === "subagent_message" && payload.event.message.role === "assistant") {
		next.usage = addUsage(base.usage, payload.event.message.usage);
	}
	if (payload.type === "message") {
		next.messageCount = base.messageCount + 1;
		if (payload.message.role === "assistant") next.usage = addUsage(base.usage, payload.message.usage);
	}
	if (payload.type === "title") {
		next.title = payload.title;
		if (payload.source === "user") next.titleSetByUser = true;
	}
	if (payload.type === "usage") next.usage = addUsage(base.usage, payload.usage);
	if (payload.type === "archive") {
		next.archived = payload.archived;
		// Filing something away is not activity; the list stays sorted by last real use.
		next.updatedAt = base.updatedAt;
	}
	if (payload.type === "move") {
		// Same as `archive`: re-filing a conversation is not using it.
		next.updatedAt = base.updatedAt;
		next.cwd = payload.cwd;
		next.projectId = payload.projectId;
		next.projectName = payload.projectName;
	}
	if (payload.type === "meta") {
		// A meta record carries caller-side changes such as the selected model.
		Object.assign(next, payload.meta, { id: base.id, seq: next.seq, updatedAt: next.updatedAt, usage: payload.meta.usage ?? next.usage });
		// A model/settings snapshot cannot undo an explicit name chosen while it was in flight.
		if (base.titleSetByUser) {
			next.title = base.title;
			next.titleSetByUser = true;
		}
	}
	return next;
}

/** The record as written: a meta snapshot keeps the name the user chose, whatever it carried. */
export function persistedPayload(base: SessionMeta, payload: SessionRecordInput, next: SessionMeta): SessionRecordInput {
	if (payload.type !== "meta" || !base.titleSetByUser) return payload;
	return { ...payload, meta: { ...payload.meta, title: next.title, titleSetByUser: true } };
}

/** The `kind` column: the record type, or the event type for events, so reads can skip by it. */
export function recordKind(payload: SessionRecordInput): string {
	return payload.type === "event" ? (payload.event as AgentEvent).type : payload.type;
}
