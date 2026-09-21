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
	providerRanking,
	providerIdentity,
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
		reasoning: 0,
		cost: 0,
		inputCost: 0,
		outputCost: 0,
		cacheReadCost: 0,
		cacheWriteCost: 0,
		rawCost: 0,
		cacheSavings: 0,
		providerPricedTokens: 0,
		catalogPricedTokens: 0,
		manualPricedTokens: 0,
		recordedPricedTokens: 0,
		unpricedTokens: 0,
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

	it("「最近 90 天」 likewise", () => {
		assert.equal(rangeStart(90, now), "2026-06-05");
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
	/*
	 * This used to assert the opposite — cache reads counted toward the headline total, "because
	 * they are tokens the model read". True, and it made the figure useless: a long agentic session
	 * re-reads its context on every tool call, so the total became a measure of how much caching
	 * happened rather than of how much work was done, running twenty times the fresh input.
	 *
	 * Cache reads are still here in full, as their own bucket, next to what they saved. They are
	 * just no longer added to the number the page leads with.
	 */
	it("leaves cache reads out of the total while keeping them as their own figure", () => {
		const totals = totalsFor([bucket("2026-09-01", "relay/m", { input: 10, output: 5, cacheRead: 100, cacheWrite: 2, reasoning: 3, rawCost: 2, cost: 0.5, cacheSavings: 1.5, catalogPricedTokens: 17 })], []);
		assert.equal(totals.tokens, 17, "input + cacheWrite + output; the 100 re-read is not work done again");
		assert.equal(totals.input, 10);
		assert.equal(totals.cacheRead, 100, "still reported, just not folded into the total");
		assert.equal(totals.reasoning, 3);
		assert.equal(totals.cacheSavings, 1.5);
		assert.equal(totals.quality.catalog, 17, "priced-token figures share the total's denominator");
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
		assert.equal(ranked[0].tokens, 2_000, "1000 in + 1000 out; the 9000 cache read is not ranked work");
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

describe("providerRanking", () => {
	it("groups models by their configured provider and ranks by cost", () => {
		const ranked = providerRanking([
			bucket("2026-09-01", "one/a", { input: 100, cost: 2 }),
			bucket("2026-09-01", "one/b", { input: 50, cost: 1 }),
			bucket("2026-09-01", "two/c", { input: 500, cost: 0.5 }),
		]);
		assert.deepEqual(ranked.map((row) => row.id), ["one", "two"]);
		assert.equal(ranked[0].tokens, 150);
		assert.ok(Math.abs(ranked.reduce((sum, row) => sum + row.share, 0) - 1) < 1e-9);
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
		assert.equal(totals.tokens, 100, "the 50 cache read is excluded");
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
		assert.equal(providerLabel({ providers }, "provider-mszq0hpb"), "deerGpt");
	});

	it("a provider that has since been deleted still says something", () => {
		// It spent what it spent; a blank row would be worse than the id.
		assert.equal(providerLabel({ providers }, "gone"), "gone");
	});

	it("survives having no providers configured", () => {
		assert.equal(providerLabel(undefined, "relay"), "relay");
	});

	it("名字档案顶上删掉的那个供应商", () => {
		// 账按 id 记，名字只活在 `providers` 里——供应商一删，这一行就只剩 id。档案是那份留下来的。
		const naming = { providers, names: { "provider-mttnetnn": "公司中转" } };
		assert.equal(providerLabel(naming, "provider-mttnetnn"), "公司中转");
		assert.deepEqual(providerIdentity(naming, "provider-mttnetnn"), {
			label: "公司中转",
			configured: false,
			named: true,
		});
	});

	it("配置里的名字压过档案里的旧名字", () => {
		// 在设置页改了名，用量页该跟着改；档案记的是「最后见过的」，不是「第一次见到的」。
		const naming = { providers, names: { relay: "以前的叫法" } };
		assert.equal(providerLabel(naming, "relay"), "Relay");
	});

	it("两处都查不到就只剩 id，而 `provider-` 前缀是噪音", () => {
		// 2026-09 之前删掉的供应商，名字在删除那一刻就没了。剩下的八位是唯一能区分两个供应商的
		// 东西，而每个自动生成的 id 都以同样六个字母开头——在一栏几十像素宽的表格里它挤掉的正是那八位。
		const identity = providerIdentity({ providers }, "provider-mtdoijtz");
		assert.deepEqual(identity, { label: "mtdoijtz", configured: false, named: false });
	});

	it("名字是空字符串等于没有名字", () => {
		// 一个刚建出来还没填名字的供应商，显示成一片空白比显示 id 更糟。
		const naming = { providers: [{ id: "blank", name: "  " }], names: { blank: "" } };
		assert.equal(providerLabel(naming, "blank"), "blank");
	});
});
