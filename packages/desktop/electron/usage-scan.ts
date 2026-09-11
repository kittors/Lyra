/**
 * What was actually spent, by day and by model.
 *
 * The session index already carries a total per conversation, and that is the wrong shape for
 * every question worth asking: it is stamped with `updatedAt`, so a refactor spread over three
 * days lands entirely on the third, and it has no idea which model did the spending — which is
 * the one thing you want to know when four relays are configured and one of them is expensive.
 *
 * So the logs themselves are read. They are append-only, which makes that cheap to keep doing:
 * a file whose size has grown is read from where the last scan stopped rather than from the top,
 * and one that has not changed at all is not opened. First pass over a real home here — 264MB
 * across 185 conversations — takes a couple of seconds; every pass after it is a few kilobytes.
 */

import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { lyraHome, type ProviderConfig } from "@lyra/core";
import { freshTokens } from "@lyra/core/tokens";
import { readUsageCache, USAGE_CACHE_VERSION, type UsageFileEntry, type UsageFiles } from "./usage-cache.ts";
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

function emptyEntry(mtimeMs: number, size: number): UsageFileEntry {
	return { mtimeMs, size, buckets: [], days: {} };
}

function bucketFor(entry: UsageFileEntry, day: string, key: string, provider: string, model: string): UsageBucket {
	const found = entry.buckets.find((each) => each.day === day && each.key === key);
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
	entry.buckets.push(fresh);
	return fresh;
}

/**
 * Read one log, from `entry.size` onwards.
 *
 * Records are whole lines appended atomically, so the previous size is always a line boundary —
 * but a line that fails to parse is skipped rather than thrown on, because a log truncated by a
 * crash mid-write is a thing that happens and losing one turn's numbers is not worth losing the
 * page over.
 */
async function readLog(path: string, entry: UsageFileEntry, size: number, providers: ProviderConfig[]): Promise<void> {
	const from = entry.size;
	if (size <= from) return;

	const stream = createReadStream(path, { encoding: "utf8", start: from });
	const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			/*
			 * Cheaper than parsing: most records in a busy log are events, not messages.
			 *
			 * 子 Agent 的消息是这条快速通道的例外——它落盘成 `type: "event"` 里的 `subagent_message`，
			 * 所以按 `"type":"message"` 筛会把它连同别的 event 一起跳过。这一行**在 `JSON.parse` 之前**，
			 * 于是下面认得再准也够不着：改完扫描逻辑之后打点量过，`event` 记录命中 0 条。
			 *
			 * 只放行这一种 event，别的照旧跳过——这条通道的价值就在于不去解析那些跟花销无关的行。
			 */
			if (
				!line.includes('"type":"message"') &&
				!line.includes('"type":"usage"') &&
				!line.includes('"subagent_message"')
			)
				continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}
			const record = asRecord(parsed);
			if (!record) continue;
			/*
			 * 三个来源，都是花出去的钱。
			 *
			 * `usage` 是辅助调用（自动起标题那种），它有花销但不算一条对话消息。`message` 是主 Agent 自己
			 * 说的话。第三个是**子 Agent**——它的消息落盘成 `type: "event"` 里的 `subagent_message`，从前
			 * 这里够不着，于是一整个委派的用量在用量页上不存在。实测漏掉的量不小：用户的一个会话里子 Agent
			 * 比主 Agent 还多烧 40%，统计里少了 58%。
			 *
			 * 和辅助调用一样按 `auxiliary` 处理，因为它们在「是不是一条对话消息」这件事上是同一类：算钱，
			 * 不算条数。子 Agent 的往返是委派内部的事，混进日活消息数会让一次委派看起来像聊了几十轮。
			 */
			const subagent =
				record.type === "event" && asRecord(record.event)?.type === "subagent_message"
					? asRecord(asRecord(record.event)?.message)
					: null;
			const auxiliary = record.type === "usage" || subagent !== null;
			const message =
				record.type === "usage"
					? { role: "assistant", timestamp: record.ts, provider: record.providerId, model: record.modelId, usage: record.usage }
					: (subagent ?? (record.type === "message" ? asRecord(record.message) : null));
			if (!message) continue;

			const at = typeof message.timestamp === "number" ? message.timestamp : 0;
			if (!at) continue;
			const day = dayKey(at);
			entry.days[day] = (entry.days[day] ?? 0) + (auxiliary ? 0 : 1);

			if (message.role !== "assistant") continue;
			const usage = asRecord(message.usage);
			const provider = String(message.provider ?? "unknown");
			const model = String(message.model ?? "unknown");
			const bucket = bucketFor(entry, day, `${provider}/${model}`, provider, model);
			const tokens: TokenUsage = {
				input: numberAt(usage, "input"),
				output: numberAt(usage, "output"),
				cacheRead: numberAt(usage, "cacheRead"),
				cacheWrite: numberAt(usage, "cacheWrite"),
			};
			const priced = priceUsage(tokens, usage, providers, provider, model);
			// Fresh tokens, matching what the page reports as its total — these figures are shown as
			// percentages *of* that total, and counting cache reads in one but not the other would
			// put 「未计价」 over 100%.
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
	} finally {
		lines.close();
		stream.close();
	}
	entry.size = size;
}

/** Every session log under `~/.lyra/sessions`, as `projectId/session.jsonl`. */
async function logPaths(root: string): Promise<string[]> {
	const out: string[] = [];
	const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
	for (const project of projects) {
		if (!project.isDirectory()) continue;
		const files = await readdir(join(root, project.name)).catch(() => []);
		for (const file of files) {
			if (file.endsWith(".jsonl")) out.push(join(project.name, file));
		}
	}
	return out;
}

/**
 * Everything spent, by day and by model.
 *
 * The cache is an optimisation and never a source of truth: a file whose mtime or size disagrees
 * with what was recorded is re-read from scratch — including one that shrank, which means it was
 * rewritten rather than appended to and nothing about the old numbers can be trusted.
 */
export async function scanUsage(home = lyraHome(), providers: ProviderConfig[] = []): Promise<UsageScan> {
	const started = Date.now();
	const root = join(home, "sessions");
	const cachePath = join(home, "usage-cache.json");
	const currentPricingKey = usagePricingKey(providers);
	const cache = await readUsageCache(cachePath, currentPricingKey);

	const next: UsageFiles = {};
	const days = new Map<string, UsageDay>();
	const totals = new Map<string, UsageBucket>();
	let scanned = 0;
	let cached = 0;

	for (const relative of await logPaths(root)) {
		const path = join(root, relative);
		const info = await stat(path).catch(() => null);
		if (!info) continue;

		const known = cache[relative];
		/*
		 * Three cases, and the middle one is the whole reason this is fast.
		 *
		 * Untouched: not opened at all. Grown: read from where the last pass stopped, because the
		 * log is append-only and the previous size is a line boundary. Anything else — smaller,
		 * or the same size under a different mtime — means it was rewritten rather than appended
		 * to, and nothing recorded about it can be trusted, so it is read from the top.
		 */
		const untouched = known !== undefined && known.mtimeMs === info.mtimeMs && known.size === info.size;
		const grown = known !== undefined && !untouched && info.size > known.size;
		const entry = untouched || grown ? { ...known, buckets: known.buckets.map((b) => ({ ...b })), days: { ...known.days } } : emptyEntry(info.mtimeMs, 0);

		if (untouched) cached += 1;
		else {
			await readLog(path, entry, info.size, providers);
			scanned += 1;
		}
		entry.mtimeMs = info.mtimeMs;
		entry.size = info.size;
		next[relative] = entry;

		for (const [day, messages] of Object.entries(entry.days)) {
			const seen = days.get(day) ?? { day, sessions: 0, messages: 0 };
			// One log is one conversation, so its presence on a day is one active conversation.
			seen.sessions += 1;
			seen.messages += messages;
			days.set(day, seen);
		}
		for (const bucket of entry.buckets) {
			const id = `${bucket.day}\u0000${bucket.key}`;
			const seen = totals.get(id);
			if (!seen) {
				totals.set(id, { ...bucket });
				continue;
			}
			seen.input += bucket.input;
			seen.output += bucket.output;
			seen.cacheRead += bucket.cacheRead;
			seen.cacheWrite += bucket.cacheWrite;
			seen.reasoning += bucket.reasoning;
			seen.cost += bucket.cost;
			seen.inputCost += bucket.inputCost;
			seen.outputCost += bucket.outputCost;
			seen.cacheReadCost += bucket.cacheReadCost;
			seen.cacheWriteCost += bucket.cacheWriteCost;
			seen.rawCost += bucket.rawCost;
			seen.cacheSavings += bucket.cacheSavings;
			seen.providerPricedTokens += bucket.providerPricedTokens;
			seen.catalogPricedTokens += bucket.catalogPricedTokens;
			seen.manualPricedTokens += bucket.manualPricedTokens;
			seen.recordedPricedTokens += bucket.recordedPricedTokens;
			seen.unpricedTokens += bucket.unpricedTokens;
			seen.replies += bucket.replies;
		}
	}

	// Best effort: a cache that cannot be written costs a re-scan, which is not worth failing over.
	await writeFile(cachePath, JSON.stringify({ version: USAGE_CACHE_VERSION, pricingKey: currentPricingKey, files: next }), "utf8").catch(() => {});

	return {
		days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
		buckets: [...totals.values()].sort((a, b) => a.day.localeCompare(b.day)),
		scanned,
		cached,
		tookMs: Date.now() - started,
	};
}
