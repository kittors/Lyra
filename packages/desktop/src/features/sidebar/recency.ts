/**
 * Conversations ordered by when you last touched them, cut into bands.
 *
 * The 「聊天」 half of the sidebar. Its whole reason for existing is that a project orders its
 * conversations by belonging and never by recency, so the one you were in five minutes ago can be
 * anywhere in the pane. Here it is first, always.
 *
 * A flat run of forty titles has the opposite problem — nothing in it says how far back you have
 * scrolled — so the run is banded. The bands are calendar-relative rather than a rolling window:
 * 「昨天」 has to mean yesterday, not "between 24 and 48 hours ago", or a conversation from last
 * night lands in it at breakfast and out of it by lunch without anyone touching it.
 */

import type { SessionMeta } from "@lyra/core";

export interface RecencyBand {
	/** Stable across renders and unique within the list — the sticky heading keys off it. */
	key: string;
	label: string;
	sessions: SessionMeta[];
}

/**
 * The cuts, in whole days back from today.
 *
 * `within` is inclusive, and the list is walked in order, so the first band a conversation fits is
 * the one it lands in. Anything past the last cut falls through to 「更早」.
 */
const BANDS: { key: string; label: string; within: number }[] = [
	{ key: "today", label: "今天", within: 0 },
	{ key: "yesterday", label: "昨天", within: 1 },
	{ key: "week", label: "过去 7 天", within: 7 },
	{ key: "month", label: "过去 30 天", within: 30 },
];

const OLDER = { key: "older", label: "更早" };

const DAY_MS = 86_400_000;

/**
 * Whole days between two instants, counted by the dates they fall on rather than by their distance.
 *
 * Rounding rather than flooring the division is what carries the clock changes. A local day is 23
 * or 25 hours twice a year, so midnight-to-midnight is not always a multiple of `DAY_MS`, and the
 * floor of 23/24 is zero — which on the morning the clocks went forward would have put every one of
 * yesterday's conversations under 「今天」.
 */
function daysBetween(now: number, then: number): number {
	const midnight = (ms: number) => {
		const date = new Date(ms);
		date.setHours(0, 0, 0, 0);
		return date.getTime();
	};
	return Math.round((midnight(now) - midnight(then)) / DAY_MS);
}

/**
 * Band a flat list of conversations, newest first, dropping the bands nothing fell into.
 *
 * `now` is passed in rather than read from the clock so this can be tested at a fixed instant, and
 * so a list rendered twice in the same frame cannot band itself two different ways.
 */
export function bandByRecency(
	sessions: SessionMeta[],
	now: number,
	/** Which timestamp the bands mean. The list is sorted and cut by the same one, necessarily. */
	key: "updatedAt" | "createdAt" = "updatedAt",
): RecencyBand[] {
	const bands = new Map<string, SessionMeta[]>();
	for (const session of [...sessions].sort((a, b) => b[key] - a[key])) {
		// A timestamp in the future is a clock that disagrees with itself, not a conversation from
		// tomorrow: `Math.max` files it under 「今天」 rather than inventing a band above it.
		const days = Math.max(0, daysBetween(now, session[key]));
		const band = BANDS.find((candidate) => days <= candidate.within) ?? OLDER;
		const bucket = bands.get(band.key);
		if (bucket) bucket.push(session);
		else bands.set(band.key, [session]);
	}

	return [...BANDS, OLDER]
		.filter((band) => bands.has(band.key))
		.map((band) => ({ key: band.key, label: band.label, sessions: bands.get(band.key) ?? [] }));
}
