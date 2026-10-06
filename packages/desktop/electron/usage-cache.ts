/** Validation for the incremental usage cache. Invalid or old caches are simply rebuilt. */

import { readFile } from "node:fs/promises";
import type { UsageBucket } from "./usage-types.ts";

/**
 * Where the last scan stopped in the spend table, and what it had added up to by then.
 *
 * `storeId` names the database the cursor belongs to: one recreated or restored from a backup
 * numbers its rows afresh, and a cursor from the old one would skip everything new.
 */
export interface UsageCursor {
	storeId: string;
	after: number;
	buckets: UsageBucket[];
}

interface UsageCache extends UsageCursor {
	version: typeof USAGE_CACHE_VERSION;
	pricingKey: string;
}

/**
 * The cache's format version. **Anything that changes what is read from a spend row bumps it.**
 *
 * The cache holds the previous scanner's conclusions, and is only ever added to from where it
 * stopped — so a change to how a row is counted that does not bump this leaves everyone who already
 * has a cache on the old figures for good.
 *
 * 3: priced tokens counted from fresh tokens only, not every bucket.
 * 4: sub-agent spend counted (its messages are `subagent_message` events, which the log scan missed).
 * 5: sessions moved into SQLite (ADR-0032): spend is read from the `spend` table by row id, and the
 *    cache records the last row read rather than a size per log file.
 *
 * The interface reads the constant rather than repeating a literal: a `version: 2` once sat beside
 * a constant of 3, and neither noticed the other.
 */
export const USAGE_CACHE_VERSION = 5 as const;

const BUCKET_NUMBERS: (keyof UsageBucket)[] = [
	"input", "output", "cacheRead", "cacheWrite", "reasoning", "cost", "inputCost", "outputCost",
	"cacheReadCost", "cacheWriteCost", "rawCost", "cacheSavings", "providerPricedTokens",
	"catalogPricedTokens", "manualPricedTokens", "recordedPricedTokens", "unpricedTokens", "replies",
];

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : null;
}

function isUsageBucket(value: unknown): value is UsageBucket {
	const bucket = asRecord(value);
	if (!bucket || typeof bucket.day !== "string" || typeof bucket.key !== "string" || typeof bucket.provider !== "string" || typeof bucket.model !== "string") return false;
	return BUCKET_NUMBERS.every((key) => {
		const field = bucket[key];
		return typeof field === "number" && Number.isFinite(field);
	});
}

function isUsageCache(value: unknown, expectedPricingKey: string, storeId: string): value is UsageCache {
	const cache = asRecord(value);
	if (!cache || cache.version !== USAGE_CACHE_VERSION || cache.pricingKey !== expectedPricingKey || cache.storeId !== storeId) return false;
	return typeof cache.after === "number" && Number.isInteger(cache.after) && Array.isArray(cache.buckets) && cache.buckets.every(isUsageBucket);
}

/** The cursor to read on from, or the start when there is none worth trusting: other prices, another database. */
export async function readUsageCache(path: string, expectedPricingKey: string, storeId: string): Promise<UsageCursor> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (isUsageCache(parsed, expectedPricingKey, storeId)) return { storeId, after: parsed.after, buckets: parsed.buckets };
	} catch {
		// Missing or unreadable: read from the start.
	}
	return { storeId, after: 0, buckets: [] };
}
