/**
 * The transcript a session's records add up to.
 *
 * Pure, over records already read: the store decides which kinds to fetch (`REPLAY_KINDS`), this
 * decides what they mean. `truncate` is honoured here rather than by deleting rows — history is
 * never edited, so a reader has to know that a tail was voided and leave it out.
 */

import type { CommandRun } from "../agent/events.ts";
import type { Message, Usage } from "../types.ts";
import { addUsage, emptyUsage } from "../types.ts";
import type { Boundary, SessionRecord } from "./types.ts";

/** The record kinds `replayRecords` reads. Everything else — prompts, requests, tool starts — is skipped unread. */
export const REPLAY_KINDS = ["message", "usage", "subagent_message", "compacted", "command_status", "truncate"] as const;

export interface Replayed {
	/** Kept with their sequence numbers so a truncate record can drop the right tail. */
	entries: { seq: number; message: Message }[];
	/**
	 * Where history was summarised, as positions in the transcript. Recorded while replaying rather
	 * than derived, because the messages themselves do not show it: the log keeps every original
	 * either way. The window draws a divider at each.
	 */
	compactions: number[];
	commandRuns: CommandRun[];
	/**
	 * And the newest of them in full, which is what the *model* is given. The transcript and the
	 * model's view diverge at this point, on purpose. Only the latest matters: each compaction
	 * summarises the one before it.
	 */
	compaction: Boundary | null;
	/** Everything the surviving transcript spent, sub-agents and side calls included. */
	usage: Usage;
}

export function replayRecords(records: Iterable<SessionRecord>): Replayed {
	let entries: { seq: number; message: Message }[] = [];
	let auxiliaryUsage = emptyUsage();
	const compactions: number[] = [];
	const commandRuns = new Map<string, { seq: number; run: CommandRun }>();
	let subagentEntries: { seq: number; usage: Usage }[] = [];
	let compaction: Boundary | null = null;

	for (const record of records) {
		if (record.type === "event" && record.event.type === "command_status") {
			const run = record.event.command;
			commandRuns.set(run.id, { seq: record.seq, run });
		} else if (record.type === "event" && record.event.type === "compacted") {
			compactions.push(entries.length);
			/*
			 * `kept` is absent on records written before compaction was stored, and on pruning passes
			 * that moved no boundary. Both mean the same thing here: no boundary to restore, so the
			 * session opens on its full history and compacts again if it has to.
			 */
			const { summary, kept } = record.event;
			if (kept !== undefined) compaction = { at: record.ts, summary: summary ?? "", keptFrom: Math.max(0, entries.length - kept) };
		} else if (record.type === "event" && record.event.type === "subagent_message" && record.event.message.role === "assistant") {
			subagentEntries.push({ seq: record.seq, usage: record.event.message.usage });
		} else if (record.type === "message") {
			/*
			 * `{"type":"message"}` is what an undefined message serialises to. Pushed through, it left a
			 * hole in the transcript that travelled to the window and took the whole interface down on
			 * the first pass over it; one lost message reads better than a session that cannot open.
			 */
			if (record.message) entries.push({ seq: record.seq, message: record.message });
		} else if (record.type === "usage") {
			auxiliaryUsage = addUsage(auxiliaryUsage, record.usage);
		} else if (record.type === "truncate") {
			entries = entries.filter((e) => e.seq <= record.afterSeq);
			subagentEntries = subagentEntries.filter((e) => e.seq <= record.afterSeq);
			for (const [id, entry] of commandRuns) if (entry.seq > record.afterSeq) commandRuns.delete(id);
			while (compactions.length && compactions[compactions.length - 1] > entries.length) compactions.pop();
			// A rewind past the boundary retires it: the tail it was paired with is gone.
			if (compaction && compaction.keptFrom > entries.length) compaction = null;
		}
	}

	let usage = auxiliaryUsage;
	for (const entry of subagentEntries) if (entry.usage) usage = addUsage(usage, entry.usage);
	for (const { message } of entries) if (message.role === "assistant" && message.usage) usage = addUsage(usage, message.usage);

	return {
		entries,
		compactions,
		compaction,
		// Still running in the log means the process that ran it is gone: it did not finish.
		commandRuns: [...commandRuns.values()].map(({ run }) =>
			run.status === "running" ? { ...run, status: "cancelled", detail: "压缩中断，未完成的操作没有自动重试。" } : run,
		),
		usage,
	};
}
