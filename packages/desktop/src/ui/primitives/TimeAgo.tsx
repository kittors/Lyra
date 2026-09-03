/**
 * A span of time that keeps up with itself.
 *
 * "刚刚" written into the DOM at 14:02 still says 刚刚 at 14:40 — which used to be a fair trade,
 * because nothing stayed on screen that long. A list that refreshes itself changes that: the rows
 * update underneath you and the ages beside them do not, so the one part of the row that is purely
 * a function of the clock became the one part that was wrong.
 *
 * One timer for every instance, held in module scope and running only while something is mounted.
 * A tick re-renders the labels and nothing else — the rows themselves are memoised on their data,
 * which has not changed — so keeping sixty ages honest costs sixty text nodes a minute.
 */

import { useSyncExternalStore } from "react";
import { exactTime, shortRelativeTime } from "../../lib/relative-time.ts";

/**
 * Half the smallest unit shown, so nothing is ever a full unit behind.
 *
 * The label rounds to minutes; ticking every thirty seconds means the worst case is a label half a
 * minute stale, which cannot be read as wrong.
 */
const TICK_MS = 30_000;

const listeners = new Set<() => void>();
let now = Date.now();
let timer = 0;

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	if (!timer) {
		timer = window.setInterval(() => {
			now = Date.now();
			for (const each of listeners) each();
		}, TICK_MS);
	}
	return () => {
		listeners.delete(listener);
		// Nothing on screen, nothing to keep honest: the timer stops rather than ticking into an
		// empty set for the life of the window.
		if (listeners.size === 0 && timer) {
			window.clearInterval(timer);
			timer = 0;
		}
	};
}

export function TimeAgo({ iso, className = "" }: { iso: string; className?: string }) {
	const at = useSyncExternalStore(subscribe, () => now);

	return (
		<span className={`tabular-nums ${className}`} data-ly-tip={exactTime(iso)}>
			{shortRelativeTime(iso, at)}
		</span>
	);
}
