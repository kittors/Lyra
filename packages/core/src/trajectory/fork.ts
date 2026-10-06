import type { SessionStorage } from "../session/storage.ts";
/**
 * Starting a new conversation from a point in an old one.
 *
 * The append-only log makes this cheap and honest: everything up to a sequence number is a complete
 * history, so a fork is that history copied into a fresh session. The original is not touched — no
 * truncate record, no rewriting — which is the difference between forking and editing. You can fork
 * the same point twice and compare what happens.
 *
 * Reads through the same path as resuming and replaying; there is one definition of "what had
 * happened by then", and it lives in `replay.ts`.
 */

import type { SessionMeta } from "../session/store.ts";
import type { Message } from "../types.ts";
import { historyUpTo } from "./replay.ts";

export interface ForkResult {
	meta: SessionMeta;
	/** How many messages the fork inherited. */
	messages: number;
}

/**
 * Copy a session's history up to `seq` into a new session.
 *
 * The new session carries the same working directory, model and reasoning level, because a fork is
 * a different continuation of the same work rather than a different piece of work.
 */
export async function forkSession(
	store: SessionStorage,
	projectId: string,
	sessionId: string,
	seq: number,
	title?: string,
): Promise<ForkResult | null> {
	const source = (await store.listSessions()).find((candidate) => candidate.id === sessionId);
	if (!source || source.projectId !== projectId) return null;

	const history = await historyUpTo(store, projectId, sessionId, seq);
	let meta = await store.create(source.cwd, source.modelId, title ?? `${source.title}（分叉）`, { thinking: source.thinking });
	/*
	 * Where the model changed, carried over — or the fork replays one provider's opaque handles to
	 * another, which rejects them (see `modelSwitchedAt`). A change made after the fork point still
	 * counts: the fork continues on the session's current model, and every message it inherits came
	 * from the one before.
	 */
	const switchedAt = source.modelSwitchedAt === undefined ? 0 : Math.min(source.modelSwitchedAt, history.messages);
	if (switchedAt > 0) meta = (await store.append(meta, { type: "meta", meta: { ...meta, modelSwitchedAt: switchedAt } })) ?? meta;
	for (const item of history.items) {
		// A copy: these replies were paid for once, in the session they were first given in.
		meta = (await store.append(meta, "message" in item ? { type: "message", message: item.message } : { type: "event", event: item.compacted }, { copy: true })) ?? meta;
	}
	return { meta, messages: history.messages };
}

/**
 * Fork from just before a message the person wrote — Claude Code's "Fork from here".
 *
 * The same thing 撤回 does to a conversation, done to a copy: the fork holds everything before the
 * message, and the message itself goes back to the composer (the caller's job) to be sent as it was
 * or rewritten. The original is not touched.
 *
 * The window names the message by its position in the transcript it shows, which is not a sequence
 * number, and positions drift — a message the window drew before the log had it. So the position is
 * checked against the message's timestamp and, when they disagree, the message is looked up by its
 * timestamp; a message that cannot be found is not forked, rather than forking from the wrong place.
 */
export async function forkBeforeMessage(
	store: SessionStorage,
	projectId: string,
	sessionId: string,
	messageIndex: number,
	timestamp: number,
	title?: string,
): Promise<ForkResult | null> {
	const loaded = await store.load(projectId, sessionId);
	if (!loaded) return null;
	const isIt = (message: Message | undefined) => message?.role === "user" && message.timestamp === timestamp;
	const target = isIt(loaded.entries[messageIndex]?.message)
		? loaded.entries[messageIndex]
		: loaded.entries.find((entry) => isIt(entry.message));
	if (!target) return null;
	return forkSession(store, projectId, sessionId, target.seq - 1, title);
}
