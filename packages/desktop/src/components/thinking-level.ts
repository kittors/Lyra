/**
 * Which effort level a conversation is actually running at.
 *
 * Two places store one: the session, and the app. They are not competing answers to the same
 * question — the session's is what this conversation chose, the app's is what a conversation starts
 * at when it has not chosen. So this is a fallback, not a merge, and the order is the whole content
 * of the module: a session that has chosen keeps its choice when the default moves, and one that
 * has not follows it.
 *
 * Its own file so the composer's label and the menu's slider cannot answer this differently. They
 * did, briefly, and a menu showing 「高」 over a conversation running at 「中」 is worse than either
 * value being wrong on its own.
 */

import type { SessionMeta, Settings, ThinkingLevel } from "@lyra/core";

/** The level, or the default when neither is set — which is what `Settings` itself defaults to. */
export function sessionThinking(
	meta: Pick<SessionMeta, "thinking"> | null | undefined,
	settings: Pick<Settings, "thinking"> | null | undefined,
): ThinkingLevel {
	return meta?.thinking ?? settings?.thinking ?? "medium";
}
