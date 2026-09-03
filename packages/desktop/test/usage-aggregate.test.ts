/**
 * The definitions behind the numbers on the usage page.
 *
 * Each of these is a decision rather than a calculation — where a range starts, whether today
 * counts towards a streak before you have worked, whether cache reads are tokens — and a wrong
 * decision here produces a page that is confidently, plausibly wrong.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageBucket, UsageDay, UsageScan } from "../electron/usage-scan.ts";
import {
	currentStreak,
	dailySeries,
	dayTotals,
	modelRanking,
	providerLabel,
	rangeStart,
	summarise,
	totalsFor,
	withinRange,
} from "../src/features/settings/usage-aggregate.ts";

function bucket(day: string, key: string, over: Partial<UsageBucket> = {}): UsageBucket {
	const [provider, model] = key.split("/");
	return {
		day,
		key,
		provider,
		model,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		replies: 0,
		...over,
	};
}

const day = (day: string, sessions: number, messages: number): UsageDay => ({ day, sessions, messages });

describe("rangeStart", () => {
	const now = new Date(2026, 8, 2, 14, 0);

	it("「最近 7 天」 includes today as one of the seven", () => {
		assert.equal(rangeStart(7, now), "2026-08-27");
	});

	it("「最近 30 天」 likewise", () => {
		assert.equal(rangeStart(30, now), "2026-08-04");
	});

	it("「全部」 has no start", () => {
		assert.equal(rangeStart(0, now), null);
	});

	it("crossing a month boundary is the calendar's problem, not ours", () => {
		assert.equal(rangeStart(7, new Date(2026, 2, 3, 9, 0)), "2026-02-25");
	});
});

describe("withinRange", () => {
	const rows = [{ day: "2026-08-01" }, { day: "2026-08-27" }, { day: "2026-09-02" }];

	it("keeps the first day of the range", () => {
		assert.deepEqual(withinRange(rows, "2026-08-27").map((r) => r.day), ["2026-08-27", "2026-09-02"]);
	});

	it("a null start keeps everything", () => {
		assert.equal(withinRange(rows, null).length, 3);
	});
});

describe("totalsFor", () => {
	it("counts cache reads as tokens, because they are tokens the model read", () => {
		const totals = totalsFor([bucket("2026-09-01", "relay/m", { input: 10, output: 5, cacheRead: 100, cacheWrite: 2 })], []);
		assert.equal(totals.tokens, 117);
		assert.equal(totals.input, 10);
		assert.equal(totals.cacheRead, 100);
	});

	it("a day with messages is an active day; one without is not", () => {
		const totals = totalsFor([], [day("2026-09-01", 2, 8), day("2026-09-02", 0, 0)]);
		assert.equal(totals.activeDays, 1);
		assert.equal(totals.messages, 8);
		assert.equal(totals.sessionDays, 2);
	});

	it("nothing at all is zeroes rather than NaN", () => {
		const totals = totalsFor([], []);
		assert.equal(totals.tokens, 0);
		assert.equal(totals.cost, 0);
		assert.equal(totals.activeDays, 0);
	});
});

describe("currentStreak", () => {
	const now = new Date(2026, 8, 2, 9, 0);

	it("counts back from today while the days are unbroken", () => {
		const days = [day("2026-08-31", 1, 2), day("2026-09-01", 1, 2), day("2026-09-02", 1, 2)];
		assert.equal(currentStreak(days, now), 3);
	});

	it("a day whose work has not happened yet does not break it", () => {
		// Nothing today; yesterday and the day before. At 09:00 that is a live streak of two.
		const days = [day("2026-08-31", 1, 2), day("2026-09-01", 1, 2)];
		assert.equal(currentStreak(days, now), 2);
	});

	it("two silent days do break it", () => {
		const days = [day("2026-08-29", 1, 2), day("2026-08-30", 1, 2)];
		assert.equal(currentStreak(days, now), 0);
	});

	it("a gap in the middle ends the count there", () => {
		const days = [day("2026-08-20", 1, 2), day("2026-09-01", 1, 2), day("2026-09-02", 1, 2)];
		assert.equal(currentStreak(days, now), 2);
	});

	it("a day recorded with no messages is not a day worked", () => {
		assert.equal(currentStreak([day("2026-09-02", 0, 0)], now), 0);
	});

	it("no history at all is zero, not one", () => {
		assert.equal(currentStreak([], now), 0);
	});
});

describe("modelRanking", () => {
	const buckets = [
		bucket("2026-09-01", "relay/big", { input: 1000, cacheRead: 9000, replies: 3, cost: 2 }),
		bucket("2026-09-02", "relay/big", { output: 1000, replies: 1, cost: 1 }),
		bucket("2026-09-01", "deer/small", { input: 500, replies: 9 }),
	];

	it("ranks by tokens, not by how many replies it produced", () => {
		const ranked = modelRanking(buckets);
		assert.deepEqual(ranked.map((r) => r.key), ["relay/big", "deer/small"]);
		assert.equal(ranked[0].replies, 4, "the same model's days are merged");
		assert.equal(ranked[0].tokens, 11_000);
		assert.equal(ranked[0].cost, 3);
	});

	it("shares add up to one", () => {
		const ranked = modelRanking(buckets);
		assert.ok(Math.abs(ranked.reduce((sum, r) => sum + r.share, 0) - 1) < 1e-9);
	});

	it("keeps provider and model apart, so two houses with one name stay two rows", () => {
		const ranked = modelRanking([
			bucket("2026-09-01", "relayA/grok-4.6", { input: 10 }),
			bucket("2026-09-01", "relayB/grok-4.6", { input: 20 }),
		]);
		assert.equal(ranked.length, 2);
		assert.deepEqual(ranked.map((r) => r.provider), ["relayB", "relayA"]);
	});

	it("all-zero usage does not divide by zero", () => {
		const ranked = modelRanking([bucket("2026-09-01", "relay/m")]);
		assert.equal(ranked[0].share, 0);
	});
});

describe("dailySeries", () => {
	const now = new Date(2026, 8, 2, 12, 0);

	it("has one entry per day of the range, including the empty ones", () => {
		const series = dailySeries([bucket("2026-09-02", "relay/m", { input: 5 })], 7, now);
		assert.equal(series.length, 7);
		assert.equal(series[0].day, "2026-08-27");
		assert.equal(series[6].day, "2026-09-02");
		assert.equal(series[6].tokens, 5);
		assert.equal(series[0].tokens, 0, "a quiet day is a zero, not a missing column");
	});

	it("「全部」 runs from the first day anything happened", () => {
		const series = dailySeries([bucket("2026-08-30", "relay/m", { input: 1 })], 0, now, "2026-08-30");
		assert.equal(series.length, 4);
		assert.equal(series[0].day, "2026-08-30");
	});

	it("「全部」 with no history at all is empty rather than a year of zeroes", () => {
		assert.deepEqual(dailySeries([], 0, now), []);
	});

	it("several models on one day are summed into that day's column", () => {
		const series = dailySeries(
			[
				bucket("2026-09-02", "relay/a", { input: 10, cost: 1 }),
				bucket("2026-09-02", "relay/b", { output: 20, cost: 2 }),
			],
			7,
			now,
		);
		assert.equal(series[6].tokens, 30);
		assert.equal(series[6].cost, 3);
	});
});

describe("dayTotals", () => {
	it("joins messages and tokens on the same day", () => {
		const scan = {
			days: [day("2026-09-01", 2, 10)],
			buckets: [bucket("2026-09-01", "relay/m", { input: 100, cacheRead: 50, cost: 0.5 })],
			scanned: 1,
			cached: 0,
			tookMs: 1,
		} as UsageScan;
		const [totals] = dayTotals(scan);
		assert.equal(totals.messages, 10);
		assert.equal(totals.sessions, 2);
		assert.equal(totals.tokens, 150);
		assert.equal(totals.cost, 0.5);
	});

	it("a day with tokens but no message record still appears", () => {
		const scan = { days: [], buckets: [bucket("2026-09-01", "relay/m", { input: 7 })], scanned: 0, cached: 0, tookMs: 0 } as UsageScan;
		assert.equal(dayTotals(scan)[0]?.tokens, 7);
	});
});

describe("summarise", () => {
	const now = new Date(2026, 8, 2, 12, 0);
	const scan = {
		days: [day("2026-07-01", 1, 4), day("2026-09-01", 1, 6), day("2026-09-02", 2, 8)],
		buckets: [
			bucket("2026-07-01", "relay/old", { input: 1_000_000 }),
			bucket("2026-09-01", "relay/new", { input: 100, output: 50 }),
			bucket("2026-09-02", "relay/new", { input: 10 }),
		],
		scanned: 3,
		cached: 0,
		tookMs: 5,
	} as UsageScan;

	it("a range excludes what is outside it, including from the ranking", () => {
		const view = summarise(scan, 7, now);
		assert.equal(view.totals.tokens, 160);
		assert.deepEqual(view.models.map((m) => m.key), ["relay/new"]);
	});

	it("「全部」 includes the old day", () => {
		const view = summarise(scan, 0, now);
		assert.equal(view.totals.tokens, 1_000_160);
		assert.equal(view.models.length, 2);
	});

	it("the streak is about the whole history, not the range", () => {
		// Seven days would not reach 2026-07-01 either way; the point is that a range never
		// shortens a streak that runs up to today.
		assert.equal(summarise(scan, 7, now).streak, 2);
		assert.equal(summarise(scan, 0, now).streak, 2);
	});
});

describe("providerLabel", () => {
	const providers = [
		{ id: "relay", name: "Relay" },
		{ id: "provider-mszq0hpb", name: "deerGpt" },
	];

	it("puts the configured name to an id the log recorded", () => {
		assert.equal(providerLabel(providers, "provider-mszq0hpb"), "deerGpt");
	});

	it("a provider that has since been deleted still says something", () => {
		// It spent what it spent; a blank row would be worse than the id.
		assert.equal(providerLabel(providers, "gone"), "gone");
	});

	it("survives having no providers configured", () => {
		assert.equal(providerLabel(undefined, "relay"), "relay");
	});
});
