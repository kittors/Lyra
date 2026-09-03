/**
 * Which reasoning level the conversation on screen is actually running at.
 *
 * Three places ask this — the composer's label, the effort menu, the fast-mode switch — and they
 * have to agree, because they are drawn next to each other and describe the same fact. The order is
 * the one `Session.thinkingFor` uses on the other side of the boundary: the conversation's own
 * level, then the app default.
 *
 * A separate file rather than a method on the store: it is also the answer for a session that is
 * not open yet, where there is no conversation to ask.
 */

import type { SessionMeta, Settings, ThinkingLevel } from "@lyra/core";

/** What the app falls back to when nothing has ever been chosen. Mirrors `DEFAULT_SETTINGS`. */
export const THINKING_FALLBACK: ThinkingLevel = "medium";

export function sessionThinking(
	meta: Pick<SessionMeta, "thinking"> | null | undefined,
	settings: Pick<Settings, "thinking"> | null | undefined,
): ThinkingLevel {
	return meta?.thinking ?? settings?.thinking ?? THINKING_FALLBACK;
}
