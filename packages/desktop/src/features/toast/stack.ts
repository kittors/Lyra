/**
 * What a stack of toasts is, before anything draws one.
 *
 * The interesting decisions are all about *many* messages rather than one, and they are the kind
 * that get quietly wrong when they live inside a component: deleting five files that all fail the
 * same way should say one thing five times over, not stack five identical cards; a repeat should
 * not make its card jump to the end of the queue and move under the pointer; and a burst must
 * still drain rather than leaving a backlog to reappear later.
 *
 * Pure, so `node --test` can hold it to those claims.
 */

import { explain } from "./explain.ts";

export type ToastLevel = "info" | "warn" | "error";

export interface Notice {
	id: string;
	level: ToastLevel;
	message: string;
}

/** One card: the message, and every notice that is currently saying it. */
export interface ToastGroup {
	/** Stable across repeats, so React keeps the same card rather than replacing it. */
	key: string;
	level: ToastLevel;
	message: string;
	/** What to do about it, when the message is one we recognise. See `explain`. */
	hint?: string;
	/** Newest last. More than one means the same thing happened again. */
	ids: string[];
}

/**
 * How long each kind stays before it goes on its own.
 *
 * Everything expires, including errors. A column of dismissed-by-nobody messages across the top of
 * the window is worse than missing one, and every one of these is about something you just did —
 * the moment it stops being current is the moment you have moved on. Hovering pauses the clock,
 * which is what makes a long message readable without a permanent one.
 */
export const TOAST_LIFETIME: Record<ToastLevel, number> = { info: 6000, warn: 9000, error: 9000 };

/**
 * How many cards are on screen at once.
 *
 * Past three it stops being feedback and becomes a wall in front of the app. The rest are not
 * discarded — they keep their timers and drain in order, so a burst empties instead of queueing up
 * behind whatever is visible.
 */
export const TOAST_LIMIT = 3;

/**
 * Above everything, and by a margin.
 *
 * A toast is the one surface that must never be behind another: it is frequently the *answer* to
 * what the thing on top just did, and a failure reported underneath the panel that caused it has
 * not been reported.
 *
 * The margin is deliberate rather than tidy. The app's own layers run to 120 (the image
 * annotator's toolbar), but the app is not the only thing numbering layers here — CodeMirror puts
 * its gutters at 200, and a dependency's stylesheet is not something to be one better than. A tie
 * is decided by document order, which is the sort of thing that changes without anybody meaning to.
 *
 * Kept as a number rather than a class so there is one place to read when a new layer is added,
 * and one place a test can hold to it.
 */
export const TOAST_Z = 1000;

/**
 * Fold notices into cards.
 *
 * Same level and same words is the same event happening again — merged, and counted. A merged
 * group keeps the position of its *first* member: promoting it to the end would slide the whole
 * column up under the pointer at the moment somebody is reaching for its close button.
 */
export function groupNotices(notices: readonly Notice[]): ToastGroup[] {
	const byKey = new Map<string, ToastGroup>();
	for (const notice of notices) {
		/*
		 * Restated before anything else, because that is what decides both whether this is said at
		 * all and what counts as "the same message again".
		 *
		 * Grouping on the raw text would keep two cards apart that say the same thing to the reader
		 * — a socket dropped twice arrives with two different errnos in the sentence.
		 */
		const said = explain(notice.message);
		if (said.silent) continue;
		const key = `${notice.level}:${said.message}`;
		const existing = byKey.get(key);
		if (existing) existing.ids.push(notice.id);
		else byKey.set(key, { key, level: notice.level, message: said.message, hint: said.hint, ids: [notice.id] });
	}
	return [...byKey.values()];
}

/**
 * Which cards are drawn, newest last.
 *
 * The ones past the limit still exist and still expire — see `TOAST_LIMIT`. This is only about
 * what is on screen.
 */
export function visibleToasts(groups: readonly ToastGroup[], limit = TOAST_LIMIT): ToastGroup[] {
	return groups.slice(-limit);
}
