/**
 * The conversation Ctrl+Tab and Ctrl+Shift+Tab land on: the next or previous one by recency.
 *
 * Recency is when a conversation last changed (`updatedAt`), the order the sidebar's recent list
 * uses. Opening one does not change it, so pressing again keeps walking instead of bouncing between
 * two. Archived conversations are not walked into. Pure so the order can be tested on its own.
 */

import type { SessionMeta } from "@lyra/core";

export function stepInRecency(sessions: readonly SessionMeta[], activeId: string | null, step: 1 | -1): SessionMeta | null {
	const order = sessions.filter((session) => !session.archived).sort((a, b) => b.updatedAt - a.updatedAt);
	if (order.length === 0) return null;
	const at = activeId ? order.findIndex((session) => session.id === activeId) : -1;
	const next = at < 0 ? (step === 1 ? order[0] : order[order.length - 1]) : order[(at + step + order.length) % order.length];
	return next && next.id !== activeId ? next : null;
}
