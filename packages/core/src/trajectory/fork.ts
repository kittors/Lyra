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
import { messagesUpTo } from "./replay.ts";

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

	const messages = await messagesUpTo(store, projectId, sessionId, seq);
	let meta = await store.create(source.cwd, source.modelId, title ?? `${source.title}（分叉）`, { thinking: source.thinking });
	for (const message of messages) {
		meta = await store.append(meta, { type: "message", message });
	}
	return { meta, messages: messages.length };
}
