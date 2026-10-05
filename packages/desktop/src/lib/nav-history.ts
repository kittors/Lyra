/**
 * Back and forward between the places the window has been, as rules over a list.
 *
 * A place is a view and, for the conversations view, which conversation was open. The wiring that
 * records places and moves between them is `app/nav-history.ts`; what counts as the same place, how a
 * visit cuts off what was ahead, and which places a step passes over are here, where they can be
 * tested without a window.
 */

type NavView = "chat" | "settings" | "pull-requests" | "scheduled" | "plugins";

export interface NavEntry {
	view: NavView;
	/** Only meaningful for `chat`; the other views are the same place whatever conversation is open. */
	sessionId: string | null;
}

export interface NavHistory {
	entries: NavEntry[];
	index: number;
}

/** What `usable` needs to know about the window. */
export interface NavSnapshot {
	activeSessionId: string | null;
	/** Conversations that can still be opened. */
	exists: (sessionId: string) => boolean;
}

/** Far enough back for any afternoon, short enough that nobody pages through it. */
export const NAV_LIMIT = 100;

export const EMPTY_HISTORY: NavHistory = { entries: [], index: -1 };

export function sameEntry(a: NavEntry, b: NavEntry): boolean {
	return a.view === b.view && (a.view !== "chat" || a.sessionId === b.sessionId);
}

/** The history with `entry` as the current place: everything ahead of the old one is dropped, as in a browser. */
export function record(history: NavHistory, entry: NavEntry): NavHistory {
	const current = history.entries[history.index];
	if (current && sameEntry(current, entry)) return history;
	const entries = [...history.entries.slice(0, history.index + 1), entry].slice(-NAV_LIMIT);
	return { entries, index: entries.length - 1 };
}

/**
 * Whether a place can be shown now.
 *
 * A conversation deleted since the visit cannot be. A blank new conversation only while the window is
 * still on the blank one: recreating it would be 新对话, which resets a split window to one screen, and
 * going back is not supposed to rearrange anything.
 */
export function usable(entry: NavEntry, snapshot: NavSnapshot): boolean {
	if (entry.view !== "chat") return true;
	if (entry.sessionId === null) return snapshot.activeSessionId === null;
	return snapshot.exists(entry.sessionId);
}

/**
 * The nearest place in `direction` that can still be shown, or null.
 *
 * Skips the unusable ones and anything identical to where the window already is — a run of the same
 * place left behind by skipping would otherwise make a press do nothing.
 */
export function step(history: NavHistory, direction: -1 | 1, snapshot: NavSnapshot): { history: NavHistory; entry: NavEntry } | null {
	const current = history.entries[history.index];
	for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
		const entry = history.entries[index]!;
		if (!usable(entry, snapshot) || (current && sameEntry(current, entry))) continue;
		return { history: { ...history, index }, entry };
	}
	return null;
}
