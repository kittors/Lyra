/** Data returned by the main-process usage scanner. */

/** One day's spend on one model. The unit the page slices every way. */
export interface UsageBucket {
	/** `YYYY-MM-DD`, local. A turn at 23:00 belongs to the day you had it. */
	day: string;
	/** `${provider}/${model}` as the message recorded it, using wire names. */
	key: string;
	provider: string;
	model: string;
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
	/** The same request priced as if every cached token were ordinary input. */
	rawCost: number;
	cacheSavings: number;
	providerPricedTokens: number;
	catalogPricedTokens: number;
	manualPricedTokens: number;
	recordedPricedTokens: number;
	unpricedTokens: number;
	/** Replies, which is what token counts belong to. */
	replies: number;
}

/** One day, across every model. */
export interface UsageDay {
	day: string;
	/** Conversations that said or heard anything that day. */
	sessions: number;
	/** Messages on both sides. */
	messages: number;
}

export interface UsageScan {
	days: UsageDay[];
	buckets: UsageBucket[];
	/** How many spend rows were read this time, and whether the figures built on a cached scan (1) or started over (0). */
	scanned: number;
	cached: number;
	tookMs: number;
}
