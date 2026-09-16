/**
 * Reading spend out of the session logs.
 *
 * The incremental cache is the part that can be quietly wrong: it re-reads a file from where it
 * stopped, so a mistake there does not throw — it double-counts a day, or silently stops counting
 * a conversation that is still being written to. Every test here appends to a log the way the app
 * does and then checks the totals against what was written.
 */

import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ProviderConfig } from "@lyra/core";
import { scanUsage } from "../electron/usage-scan.ts";

let home = "";
let sessions = "";

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-usage-"));
	sessions = join(home, "sessions");
	await mkdir(join(sessions, "proj-a"), { recursive: true });
});

afterEach(async () => {
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

const AT = new Date(2026, 8, 1, 10, 0).getTime();
const NEXT_DAY = new Date(2026, 8, 2, 10, 0).getTime();

function userLine(at: number): string {
	return `${JSON.stringify({ seq: 1, ts: at, type: "message", message: { role: "user", content: [], timestamp: at } })}\n`;
}

function replyLine(at: number, over: { provider?: string; model?: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; cost?: number } = {}): string {
	const message = {
		role: "assistant",
		content: [],
		provider: over.provider ?? "relay",
		model: over.model ?? "gemini-3.7",
		usage: {
			input: over.input ?? 100,
			output: over.output ?? 20,
			cacheRead: over.cacheRead ?? 0,
			cacheWrite: over.cacheWrite ?? 0,
			reasoning: over.reasoning ?? 0,
			total: (over.input ?? 100) + (over.output ?? 20),
			cost: { total: over.cost ?? 0.25 },
		},
		timestamp: at,
	};
	return `${JSON.stringify({ seq: 2, ts: at, type: "message", message })}\n`;
}

function pricedProvider(price: number, baseUrl = "https://relay.example/v1"): ProviderConfig {
	return {
		id: "relay",
		name: "Relay",
		baseUrl,
		api: "openai-responses",
		apiKey: "",
		enabled: true,
		models: [{
			id: "relay/gemini-3.7",
			providerId: "relay",
			modelId: "gemini-3.7",
			name: "Gemini",
			contextWindow: 1_000_000,
			maxOutputTokens: 100_000,
			supportsThinking: true,
			supportsImages: true,
			supportsTools: true,
			pricing: { input: price, output: price * 2, cacheRead: price / 10, cacheWrite: price * 1.25, source: "manual" },
		}],
	};
}

/** A record that is not a message, which is most of a real log. */
function eventLine(at: number): string {
	return `${JSON.stringify({ seq: 3, ts: at, type: "event", event: { type: "context", systemPrompt: "x", tools: [] } })}\n`;
}

const log = (name: string) => join(sessions, "proj-a", `${name}.jsonl`);

describe("scanUsage", () => {
	it("an empty home is zeroes, not a failure", async () => {
		const scan = await scanUsage(join(home, "nowhere"));
		assert.deepEqual(scan.days, []);
		assert.deepEqual(scan.buckets, []);
	});

	it("totals one conversation by day and by model", async () => {
		await writeFile(log("s1"), userLine(AT) + replyLine(AT, { input: 100, output: 20, cost: 0.25 }) + eventLine(AT));
		const scan = await scanUsage(home);

		assert.equal(scan.days.length, 1);
		assert.equal(scan.days[0].day, "2026-09-01");
		assert.equal(scan.days[0].messages, 2, "both sides count as messages");
		assert.equal(scan.days[0].sessions, 1);

		assert.equal(scan.buckets.length, 1);
		assert.equal(scan.buckets[0].key, "relay/gemini-3.7");
		assert.equal(scan.buckets[0].input, 100);
		assert.equal(scan.buckets[0].output, 20);
		assert.equal(scan.buckets[0].cost, 0.25);
		assert.equal(scan.buckets[0].recordedPricedTokens, 120);
		assert.equal(scan.buckets[0].replies, 1);
	});

	it("estimates old zero-cost logs from an exact configured model price", async () => {
		await writeFile(log("s1"), replyLine(AT, { input: 100, output: 100, cacheRead: 900, cost: 0 }));
		const scan = await scanUsage(home, [pricedProvider(1)]);
		const bucket = scan.buckets[0];
		// Fresh tokens (100 + 100), not the 1100 that crossed the wire: this figure is shown as a
		// share of the page's total, which excludes cache reads.
		assert.equal(bucket.manualPricedTokens, 200);
		assert.ok(Math.abs(bucket.cost - 0.00039) < 1e-12);
		assert.ok(Math.abs(bucket.rawCost - 0.0012) < 1e-12);
		assert.ok(Math.abs(bucket.cacheSavings - 0.00081) < 1e-12);
	});

	it("uses a catalogue reference for both official endpoints and relays", async () => {
		await writeFile(log("s1"), replyLine(AT, { provider: "openai-local", model: "gpt-5.2", input: 1_000_000, output: 0, cost: 0 }));
		const official: ProviderConfig = { ...pricedProvider(1, "https://api.openai.com/v1"), id: "openai-local", models: [] };
		const priced = await scanUsage(home, [official]);
		assert.equal(priced.buckets[0].catalogPricedTokens, 1_000_000);
		assert.equal(priced.buckets[0].cost, 1.75);

		const relay = { ...official, baseUrl: "https://relay.example/v1" };
		const reference = await scanUsage(home, [relay]);
		assert.equal(reference.buckets[0].catalogPricedTokens, 1_000_000);
		assert.equal(reference.buckets[0].unpricedTokens, 0);
		assert.equal(reference.buckets[0].cost, 1.75);
	});

	it("invalidates the file cache when configured prices change", async () => {
		await writeFile(log("s1"), replyLine(AT, { input: 1_000_000, output: 0, cost: 0 }));
		const first = await scanUsage(home, [pricedProvider(1)]);
		assert.equal(first.buckets[0].cost, 1);

		const second = await scanUsage(home, [pricedProvider(2)]);
		assert.equal(second.scanned, 1, "a price change must re-evaluate unchanged logs");
		assert.equal(second.cached, 0);
		assert.equal(second.buckets[0].cost, 2);
	});

	it("title request usage reaches model totals without inflating conversation messages", async () => {
		await writeFile(log("s1"), userLine(AT) + replyLine(AT));
		await scanUsage(home);
		await appendFile(log("s1"), `${JSON.stringify({ seq: 3, ts: AT, type: "usage", source: "title-summary", providerId: "fast-provider", modelId: "fast-model", usage: { input: 80, output: 8, cacheRead: 0, cacheWrite: 0, total: 88, cost: { total: 0.003 } } })}\n`);
		const scan = await scanUsage(home);
		assert.equal(scan.days[0].messages, 2);
		const title = scan.buckets.find((bucket) => bucket.key === "fast-provider/fast-model");
		assert.equal(title?.input, 80);
		assert.equal(title?.output, 8);
		assert.equal(title?.cost, 0.003);
		assert.equal(title?.replies, 1);
		assert.deepEqual((await scanUsage(home)).buckets, scan.buckets, "cached scans must not charge the request twice");
	});

	it("a conversation spanning two days is split across them", async () => {
		await writeFile(log("s1"), replyLine(AT, { input: 10 }) + replyLine(NEXT_DAY, { input: 90 }));
		const scan = await scanUsage(home);

		assert.deepEqual(scan.buckets.map((b) => [b.day, b.input]), [
			["2026-09-01", 10],
			["2026-09-02", 90],
		]);
		assert.deepEqual(scan.days.map((d) => d.day), ["2026-09-01", "2026-09-02"]);
		assert.equal(scan.days[0].sessions, 1, "and counts as active on both");
		assert.equal(scan.days[1].sessions, 1);
	});

	it("two models on one day are two buckets", async () => {
		await writeFile(log("s1"), replyLine(AT, { model: "a", input: 10 }) + replyLine(AT, { model: "b", input: 20 }));
		const scan = await scanUsage(home);
		assert.deepEqual(scan.buckets.map((b) => b.key).sort(), ["relay/a", "relay/b"]);
	});

	it("two conversations on one day are two active sessions", async () => {
		await writeFile(log("s1"), replyLine(AT));
		await writeFile(log("s2"), replyLine(AT));
		const scan = await scanUsage(home);
		assert.equal(scan.days[0].sessions, 2);
		assert.equal(scan.buckets[0].replies, 2, "and their tokens are merged into one bucket");
	});

	it("a second scan of an untouched home opens nothing", async () => {
		await writeFile(log("s1"), replyLine(AT));
		const first = await scanUsage(home);
		assert.equal(first.scanned, 1);

		const second = await scanUsage(home);
		assert.equal(second.scanned, 0, "nothing changed, so nothing was read");
		assert.equal(second.cached, 1);
		assert.deepEqual(second.buckets, first.buckets, "and the answer is the same");
	});

	it("an appended turn is counted once, not twice", async () => {
		await writeFile(log("s1"), replyLine(AT, { input: 100 }));
		await scanUsage(home);

		await appendFile(log("s1"), replyLine(AT, { input: 5 }));
		const scan = await scanUsage(home);

		assert.equal(scan.scanned, 1, "the file grew, so it was read");
		assert.equal(scan.buckets[0].input, 105, "the old turn is not re-counted");
		assert.equal(scan.buckets[0].replies, 2);
	});

	it("a rewritten log is read from the top rather than trusted", async () => {
		await writeFile(log("s1"), replyLine(AT, { input: 100 }) + replyLine(AT, { input: 100 }));
		await scanUsage(home);

		// Shorter than before: the log was rebuilt, so nothing cached about it holds.
		await writeFile(log("s1"), replyLine(AT, { input: 7 }));
		const scan = await scanUsage(home);
		assert.equal(scan.buckets[0].input, 7);
		assert.equal(scan.buckets[0].replies, 1);
	});

	it("a new conversation is picked up without disturbing the cached ones", async () => {
		await writeFile(log("s1"), replyLine(AT, { input: 100 }));
		await scanUsage(home);

		await writeFile(log("s2"), replyLine(AT, { input: 50 }));
		const scan = await scanUsage(home);
		assert.equal(scan.cached, 1);
		assert.equal(scan.scanned, 1);
		assert.equal(scan.buckets[0].input, 150);
		assert.equal(scan.days[0].sessions, 2);
	});

	it("a deleted conversation stops being counted", async () => {
		await writeFile(log("s1"), replyLine(AT, { input: 100 }));
		await writeFile(log("s2"), replyLine(AT, { input: 50 }));
		await scanUsage(home);

		await rm(log("s2"));
		const scan = await scanUsage(home);
		assert.equal(scan.buckets[0].input, 100);
		assert.equal(scan.days[0].sessions, 1);
	});

	it("a half-written line is skipped, and the rest of the log still counts", async () => {
		await writeFile(log("s1"), `${replyLine(AT, { input: 10 })}{"type":"message","message":{"role":"ass\n${replyLine(AT, { input: 20 })}`);
		const scan = await scanUsage(home);
		assert.equal(scan.buckets[0].input, 30);
	});

	it("a reply with no usage recorded counts as a message and no tokens", async () => {
		const at = AT;
		const line = `${JSON.stringify({ seq: 1, ts: at, type: "message", message: { role: "assistant", provider: "relay", model: "m", timestamp: at } })}\n`;
		await writeFile(log("s1"), line);
		const scan = await scanUsage(home);
		assert.equal(scan.days[0].messages, 1);
		assert.equal(scan.buckets[0].input, 0);
		assert.equal(scan.buckets[0].replies, 1);
	});

	it("a message with no timestamp is left out rather than filed under 1970", async () => {
		const line = `${JSON.stringify({ seq: 1, ts: 0, type: "message", message: { role: "assistant", provider: "relay", model: "m" } })}\n`;
		await writeFile(log("s1"), line);
		const scan = await scanUsage(home);
		assert.deepEqual(scan.days, []);
		assert.deepEqual(scan.buckets, []);
	});

	it("files that are not logs are ignored", async () => {
		await writeFile(join(sessions, "proj-a", "notes.txt"), "not a log");
		await writeFile(join(sessions, "index.json"), "[]");
		await writeFile(log("s1"), replyLine(AT));
		const scan = await scanUsage(home);
		assert.equal(scan.scanned, 1);
	});

	it("side-chat auxiliary usage is recorded as auxiliary spend without inflating message count", async () => {
		const line = `${JSON.stringify({
			seq: 1,
			ts: AT,
			type: "usage",
			source: "side-chat",
			providerId: "relay",
			modelId: "gemini-3.7",
			usage: { input: 300, output: 50, cacheRead: 200, cacheWrite: 0, reasoning: 0, total: 350 },
		})}\n`;
		await writeFile(log("s1"), line);
		const scan = await scanUsage(home);
		assert.equal(scan.days[0].messages, 0, "auxiliary usage does not count as conversational message");
		assert.equal(scan.buckets[0].input, 300);
		assert.equal(scan.buckets[0].cacheRead, 200);
	});
});
