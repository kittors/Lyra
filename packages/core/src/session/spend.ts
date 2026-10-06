/**
 * Money spent, kept apart from the conversations that spent it.
 *
 * The usage page used to be summed from the session logs, so deleting a conversation took its cost
 * out of the all-time totals — the settings page then said less had been spent than the provider
 * billed. Each billed call is written here, in the same transaction as the record that carries it,
 * and nothing that deletes a session touches this table.
 *
 * Besides calls, the table marks the two places a request prefix is rewritten on purpose —
 * compaction and rewind — so a reader going through one request sequence in order knows where it
 * was broken deliberately.
 */

import type { AssistantMessage, Usage } from "../types.ts";
import type { SessionRecordInput } from "./types.ts";

/** The fields of a reply that pricing reads. Never the content. */
type SpendCall = Pick<AssistantMessage, "usage" | "provider" | "model" | "timestamp">;

export interface SpendEntry {
	/**
	 * Which request sequence this belongs to: `main`, or `sub:<id>` for a sub-agent. Null for calls
	 * made beside the conversation (a title, a summary), which share no prefix with anything.
	 */
	stream: string | null;
	kind: "call" | "compaction" | "rewind";
	/** What made the call: `reply`, `subagent`, or an auxiliary source such as `title-summary`. */
	source: string | null;
	provider: string | null;
	model: string | null;
	call: SpendCall | null;
}

export interface SpendRow extends SpendEntry {
	id: number;
	/** Null for calls that belong to no conversation, and still set after that conversation is deleted. */
	sessionId: string | null;
	ts: number;
}

function callOf(message: AssistantMessage): SpendCall {
	return { usage: message.usage, provider: message.provider, model: message.model, timestamp: message.timestamp };
}

export function auxiliaryCall(spent: { source: string; providerId: string; modelId: string; usage: Usage }, now: number): SpendEntry {
	return {
		stream: null,
		kind: "call",
		source: spent.source,
		provider: spent.providerId,
		model: spent.modelId,
		call: { usage: spent.usage, provider: spent.providerId, model: spent.modelId, timestamp: now },
	};
}

/** What a record adds to the spend table; usually nothing. */
export function spendOf(payload: SessionRecordInput, now: number): SpendEntry[] {
	const mark = (stream: string, kind: "compaction" | "rewind"): SpendEntry => ({ stream, kind, source: null, provider: null, model: null, call: null });
	if (payload.type === "message" && payload.message?.role === "assistant") {
		const message = payload.message;
		return [{ stream: "main", kind: "call", source: "reply", provider: message.provider ?? null, model: message.model ?? null, call: callOf(message) }];
	}
	if (payload.type === "usage") return [auxiliaryCall(payload, now)];
	if (payload.type === "truncate") return [mark("main", "rewind")];
	if (payload.type !== "event") return [];
	const event = payload.event;
	if (event.type === "subagent_message" && event.message.role === "assistant") {
		const message = event.message;
		return [{ stream: `sub:${event.id}`, kind: "call", source: "subagent", provider: message.provider ?? null, model: message.model ?? null, call: callOf(message) }];
	}
	if (event.type === "compacted") return [mark("main", "compaction")];
	if (event.type === "subagent_event" && event.event.type === "compacted") return [mark(`sub:${event.id}`, "compaction")];
	return [];
}
