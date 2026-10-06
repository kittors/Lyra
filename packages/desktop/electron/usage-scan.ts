/**
 * What was actually spent, by day and by model.
 *
 * The session list carries a total per conversation, and that is the wrong shape for every question
 * worth asking: it is stamped with `updatedAt`, so a refactor spread over three days lands entirely
 * on the third, and it has no idea which model did the spending — which is the one thing you want to
 * know when four relays are configured and one of them is expensive.
 *
 * So every billed call is read, from the `spend` table the session store writes beside each reply
 * (ADR-0032). It only grows, which keeps this cheap to keep doing: the last scan's figures are cached
 * with the last row it read, and each scan after it reads only the rows since. Deleting a
 * conversation leaves its rows there — what was spent stays spent.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lyraHome, SessionStore, type ProviderConfig, type SessionStorage, type SpendRow } from "@lyra/core";
import { freshTokens } from "@lyra/core/tokens";
import { readUsageCache, USAGE_CACHE_VERSION } from "./usage-cache.ts";
import { priceUsage, usagePricingKey, type TokenUsage } from "./usage-pricing.ts";
import type { UsageBucket, UsageDay, UsageScan } from "./usage-types.ts";

export type { UsageBucket, UsageDay, UsageScan } from "./usage-types.ts";

/** Local date key, deliberately not ISO/UTC. Mirrors `dayKey` in the settings page. */
function dayKey(ms: number): string {
	const date = new Date(ms);
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : null;
}

function numberAt(record: Record<string, unknown> | null, key: string): number {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function bucketFor(buckets: Map<string, UsageBucket>, day: string, key: string, provider: string, model: string): UsageBucket {
	const id = `${day}\u0000${key}`;
	const found = buckets.get(id);
	if (found) return found;
	const fresh: UsageBucket = {
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
	};
	buckets.set(id, fresh);
	return fresh;
}

/**
 * One billed call, into its day's bucket for its model.
 *
 * Three sources, all of them money spent: the main agent's replies, a sub-agent's (they are
 * `subagent_message` events in the log, which the scan of the log files once missed — a sub-agent
 * had spent 40% more than the main agent in one of the user's sessions), and calls beside the
 * conversation such as a title or a side chat. The spend table holds all three alike.
 */
function addCall(buckets: Map<string, UsageBucket>, row: SpendRow, providers: ProviderConfig[]): void {
	const call = row.call;
	if (row.kind !== "call" || !call) return;
	const at = typeof call.timestamp === "number" && call.timestamp > 0 ? call.timestamp : row.ts;
	const usage = asRecord(call.usage);
	const provider = String(call.provider ?? row.provider ?? "unknown");
	const model = String(call.model ?? row.model ?? "unknown");
	const bucket = bucketFor(buckets, dayKey(at), `${provider}/${model}`, provider, model);
	const tokens: TokenUsage = {
		input: numberAt(usage, "input"),
		output: numberAt(usage, "output"),
		cacheRead: numberAt(usage, "cacheRead"),
		cacheWrite: numberAt(usage, "cacheWrite"),
	};
	const priced = priceUsage(tokens, usage, providers, provider, model);
	// Fresh tokens, matching what the page reports as its total — these figures are shown as
	// percentages *of* that total, and counting cache reads in one but not the other would put
	// 「未计价」 over 100%.
	const tokenTotal = freshTokens(tokens);
	bucket.input += tokens.input;
	bucket.output += tokens.output;
	bucket.cacheRead += tokens.cacheRead;
	bucket.cacheWrite += tokens.cacheWrite;
	bucket.reasoning += numberAt(usage, "reasoning");
	bucket.cost += priced.cost.total;
	bucket.inputCost += priced.cost.input;
	bucket.outputCost += priced.cost.output;
	bucket.cacheReadCost += priced.cost.cacheRead;
	bucket.cacheWriteCost += priced.cost.cacheWrite;
	bucket.rawCost += priced.rawCost;
	bucket.cacheSavings += priced.cacheSavings;
	if (priced.source === "provider") bucket.providerPricedTokens += tokenTotal;
	else if (priced.source === "catalog") bucket.catalogPricedTokens += tokenTotal;
	else if (priced.source === "manual") bucket.manualPricedTokens += tokenTotal;
	else if (priced.source === "recorded") bucket.recordedPricedTokens += tokenTotal;
	else bucket.unpricedTokens += tokenTotal;
	bucket.replies += 1;
}

/**
 * Everything spent, by day and by model.
 *
 * The cache is an optimisation and never a source of truth: one written under other prices, or for
 * another database, is dropped and the table read from its first row.
 *
 * **`~/.lyra/sidechats` is not read, and should not be.** A side chat adds a `usage` record
 * (`source: "side-chat"`) to the conversation it belongs to for every reply, so its spend is already
 * in the table; reading the side chats' own snapshots as well counted the same replies twice.
 */
export async function scanUsage(
	home = lyraHome(),
	providers: ProviderConfig[] = [],
	store: Pick<SessionStorage, "readSpend" | "storeId" | "activeDays"> = new SessionStore(join(home, "sessions")),
): Promise<UsageScan> {
	const started = Date.now();
	const cachePath = join(home, "usage-cache.json");
	const pricingKey = usagePricingKey(providers);
	const storeId = (await store.storeId?.()) ?? "";
	const cache = await readUsageCache(cachePath, pricingKey, storeId);
	const buckets = new Map(cache.buckets.map((bucket) => [`${bucket.day}\u0000${bucket.key}`, { ...bucket }]));
	let after = cache.after;
	let scanned = 0;
	while (store.readSpend) {
		const rows = await store.readSpend(after);
		if (rows.length === 0) break;
		for (const row of rows) {
			after = row.id;
			addCall(buckets, row, providers);
			scanned += 1;
		}
	}
	const days: UsageDay[] = ((await store.activeDays?.()) ?? []).map((day) => ({ day: day.day, sessions: Number(day.sessions), messages: Number(day.messages) }));
	const sorted = [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));

	// Best effort: a cache that cannot be written costs a re-read, which is not worth failing over.
	await writeFile(cachePath, JSON.stringify({ version: USAGE_CACHE_VERSION, pricingKey, storeId, after, buckets: sorted }), "utf8").catch(() => {});

	return {
		days,
		buckets: sorted,
		scanned,
		cached: cache.after > 0 ? 1 : 0,
		tookMs: Date.now() - started,
	};
}
