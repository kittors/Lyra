/** Pure definitions behind the usage dashboard. */

import { freshTokens } from "@lyra/core/tokens";
import type { UsageBucket, UsageDay, UsageScan } from "../../../electron/usage-scan.ts";

export type Range = 7 | 30 | 90 | 0;

interface CostQuality {
	provider: number;
	catalog: number;
	manual: number;
	recorded: number;
	unpriced: number;
}

export interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
	cost: number;
	inputCost: number;
	outputCost: number;
	cacheReadCost: number;
	cacheWriteCost: number;
	rawCost: number;
	cacheSavings: number;
	tokens: number;
	replies: number;
	messages: number;
	sessionDays: number;
	activeDays: number;
	quality: CostQuality;
}

export interface ModelUse {
	key: string;
	provider: string;
	model: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	tokens: number;
	cost: number;
	unpricedTokens: number;
	replies: number;
	share: number;
}

export interface ProviderUse {
	id: string;
	tokens: number;
	cost: number;
	unpricedTokens: number;
	share: number;
}

export interface DailyUse {
	day: string;
	tokens: number;
	cost: number;
}

export interface ProviderTrend extends ProviderUse {
	points: DailyUse[];
}

export function providerLabel(providers: { id: string; name: string }[] | undefined, id: string): string {
	return providers?.find((each) => each.id === id)?.name ?? id;
}

function dayKey(date: Date): string {
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

export function rangeStart(range: Range, now: Date): string | null {
	if (range === 0) return null;
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	start.setDate(start.getDate() - (range - 1));
	return dayKey(start);
}

export function withinRange<T extends { day: string }>(rows: T[], from: string | null): T[] {
	return from === null ? rows : rows.filter((row) => row.day >= from);
}

/**
 * Fresh tokens — see `freshTokens` in core, and the session card that reports the same figure.
 *
 * The page still breaks out `cacheRead` on its own, which is where that number belongs: as one of
 * the four bars, next to what it saved. Folding it into the headline total instead made 「已处理
 * Token」 a number about caching rather than about work.
 */
function tokensFor(bucket: UsageBucket): number {
	return freshTokens(bucket);
}

export function totalsFor(buckets: UsageBucket[], days: UsageDay[]): Totals {
	const totals: Totals = {
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
		tokens: 0,
		replies: 0,
		messages: 0,
		sessionDays: 0,
		activeDays: 0,
		quality: { provider: 0, catalog: 0, manual: 0, recorded: 0, unpriced: 0 },
	};
	for (const bucket of buckets) {
		totals.input += bucket.input;
		totals.output += bucket.output;
		totals.cacheRead += bucket.cacheRead;
		totals.cacheWrite += bucket.cacheWrite;
		totals.reasoning += bucket.reasoning;
		totals.cost += bucket.cost;
		totals.inputCost += bucket.inputCost;
		totals.outputCost += bucket.outputCost;
		totals.cacheReadCost += bucket.cacheReadCost;
		totals.cacheWriteCost += bucket.cacheWriteCost;
		totals.rawCost += bucket.rawCost;
		totals.cacheSavings += bucket.cacheSavings;
		totals.tokens += tokensFor(bucket);
		totals.replies += bucket.replies;
		totals.quality.provider += bucket.providerPricedTokens;
		totals.quality.catalog += bucket.catalogPricedTokens;
		totals.quality.manual += bucket.manualPricedTokens;
		totals.quality.recorded += bucket.recordedPricedTokens;
		totals.quality.unpriced += bucket.unpricedTokens;
	}
	for (const day of days) {
		totals.messages += day.messages;
		totals.sessionDays += day.sessions;
		if (day.messages > 0) totals.activeDays += 1;
	}
	return totals;
}

export function currentStreak(days: UsageDay[], now: Date): number {
	const active = new Set(days.filter((day) => day.messages > 0).map((day) => day.day));
	const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	if (!active.has(dayKey(cursor))) {
		cursor.setDate(cursor.getDate() - 1);
		if (!active.has(dayKey(cursor))) return 0;
	}
	let streak = 0;
	while (active.has(dayKey(cursor))) {
		streak += 1;
		cursor.setDate(cursor.getDate() - 1);
	}
	return streak;
}

export function modelRanking(buckets: UsageBucket[]): ModelUse[] {
	const byKey = new Map<string, ModelUse>();
	for (const bucket of buckets) {
		const seen = byKey.get(bucket.key);
		if (seen) {
			seen.input += bucket.input;
			seen.output += bucket.output;
			seen.cacheRead += bucket.cacheRead;
			seen.cacheWrite += bucket.cacheWrite;
			seen.tokens += tokensFor(bucket);
			seen.cost += bucket.cost;
			seen.unpricedTokens += bucket.unpricedTokens;
			seen.replies += bucket.replies;
			continue;
		}
		byKey.set(bucket.key, {
			key: bucket.key,
			provider: bucket.provider,
			model: bucket.model,
			input: bucket.input,
			output: bucket.output,
			cacheRead: bucket.cacheRead,
			cacheWrite: bucket.cacheWrite,
			tokens: tokensFor(bucket),
			cost: bucket.cost,
			unpricedTokens: bucket.unpricedTokens,
			replies: bucket.replies,
			share: 0,
		});
	}
	const ranked = [...byKey.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
	const totalCost = ranked.reduce((sum, each) => sum + each.cost, 0);
	const totalTokens = ranked.reduce((sum, each) => sum + each.tokens, 0);
	for (const each of ranked) each.share = totalCost > 0 ? each.cost / totalCost : totalTokens > 0 ? each.tokens / totalTokens : 0;
	return ranked;
}

export function providerRanking(buckets: UsageBucket[]): ProviderUse[] {
	const byProvider = new Map<string, ProviderUse>();
	for (const bucket of buckets) {
		const seen = byProvider.get(bucket.provider) ?? { id: bucket.provider, tokens: 0, cost: 0, unpricedTokens: 0, share: 0 };
		seen.tokens += tokensFor(bucket);
		seen.cost += bucket.cost;
		seen.unpricedTokens += bucket.unpricedTokens;
		byProvider.set(bucket.provider, seen);
	}
	const ranked = [...byProvider.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
	const totalCost = ranked.reduce((sum, each) => sum + each.cost, 0);
	const totalTokens = ranked.reduce((sum, each) => sum + each.tokens, 0);
	for (const each of ranked) each.share = totalCost > 0 ? each.cost / totalCost : totalTokens > 0 ? each.tokens / totalTokens : 0;
	return ranked;
}

export function dailySeries(buckets: UsageBucket[], range: Range, now: Date, earliest?: string): DailyUse[] {
	const byDay = new Map<string, Omit<DailyUse, "day">>();
	for (const bucket of buckets) {
		const seen = byDay.get(bucket.day) ?? { tokens: 0, cost: 0 };
		seen.tokens += tokensFor(bucket);
		seen.cost += bucket.cost;
		byDay.set(bucket.day, seen);
	}
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const start = new Date(end);
	if (range === 0) {
		const first = earliest ?? [...byDay.keys()].sort()[0];
		if (!first) return [];
		const [year, month, date] = first.split("-").map(Number);
		start.setFullYear(year, month - 1, date);
	} else start.setDate(start.getDate() - (range - 1));
	const span = Math.round((end.getTime() - start.getTime()) / 86_400_000);
	return Array.from({ length: span + 1 }, (_, offset) => {
		const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
		const day = dayKey(cursor);
		const found = byDay.get(day);
		return { day, tokens: found?.tokens ?? 0, cost: found?.cost ?? 0 };
	});
}

function providerTrends(buckets: UsageBucket[], series: DailyUse[], ranked: ProviderUse[], limit = 4): ProviderTrend[] {
	const byProviderDay = new Map<string, { tokens: number; cost: number }>();
	for (const bucket of buckets) {
		const key = `${bucket.provider}\u0000${bucket.day}`;
		const seen = byProviderDay.get(key) ?? { tokens: 0, cost: 0 };
		seen.tokens += tokensFor(bucket);
		seen.cost += bucket.cost;
		byProviderDay.set(key, seen);
	}
	return ranked.slice(0, limit).map((provider) => ({
		...provider,
		points: series.map((day) => {
			const found = byProviderDay.get(`${provider.id}\u0000${day.day}`);
			return { day: day.day, tokens: found?.tokens ?? 0, cost: found?.cost ?? 0 };
		}),
	}));
}

export function dayTotals(scan: UsageScan): { day: string; sessions: number; messages: number; tokens: number; cost: number }[] {
	const byDay = new Map<string, { day: string; sessions: number; messages: number; tokens: number; cost: number }>();
	for (const day of scan.days) byDay.set(day.day, { day: day.day, sessions: day.sessions, messages: day.messages, tokens: 0, cost: 0 });
	for (const bucket of scan.buckets) {
		const seen = byDay.get(bucket.day) ?? { day: bucket.day, sessions: 0, messages: 0, tokens: 0, cost: 0 };
		seen.tokens += tokensFor(bucket);
		seen.cost += bucket.cost;
		byDay.set(bucket.day, seen);
	}
	return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function summarise(scan: UsageScan, range: Range, now: Date) {
	const from = rangeStart(range, now);
	const buckets = withinRange(scan.buckets, from);
	const days = withinRange(scan.days, from);
	const providers = providerRanking(buckets);
	const series = dailySeries(buckets, range, now, scan.days[0]?.day);
	return {
		totals: totalsFor(buckets, days),
		models: modelRanking(buckets),
		providers,
		series,
		providerTrends: providerTrends(buckets, series, providers),
		streak: currentStreak(scan.days, now),
	};
}
