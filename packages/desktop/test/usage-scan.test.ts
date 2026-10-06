/**
 * Reading spend out of the session database's `spend` table.
 *
 * The incremental cache is the part that can be quietly wrong: it reads on from the last row it saw,
 * so a mistake there does not throw — it double-counts a day, or silently stops counting a
 * conversation that is still being written to. Every test here writes through the session store the
 * way the app does and then checks the totals against what was written.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { SessionStore, type ProviderConfig, type SessionMeta } from "@lyra/core";
import { scanUsage } from "../electron/usage-scan.ts";

let home = "";
let sessions = "";
let opened = new Map<string, SessionMeta>();

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-usage-"));
	sessions = join(home, "sessions");
	await mkdir(sessions, { recursive: true });
	opened = new Map();
});

afterEach(async () => {
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

const AT = new Date(2026, 8, 1, 10, 0).getTime();
const NEXT_DAY = new Date(2026, 8, 2, 10, 0).getTime();

type Payload = Parameters<SessionStore["append"]>[1];

/** Write one record into conversation `name`, as if written at `at`: the store stamps records with its clock. */
async function write(name: string, at: number, payload: Payload): Promise<void> {
	mock.timers.enable({ apis: ["Date"], now: at });
	try {
		const store = new SessionStore(sessions);
		const meta = opened.get(name) ?? (await store.create("/tmp/x", "relay/m", name));
		opened.set(name, (await store.append(meta, payload)) ?? meta);
	} finally {
		mock.timers.reset();
	}
}

const user = (at: number): Payload => ({ type: "message", message: { role: "user", content: [], timestamp: at } });

function reply(at: number, over: { provider?: string; model?: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; cost?: number } = {}): Payload {
	return {
		type: "message",
		message: {
			role: "assistant",
			content: [],
			api: "openai-responses",
			stopReason: "stop",
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
		},
	} as Payload;
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

describe("scanUsage", () => {
	it("an empty home is zeroes, not a failure", async () => {
		const scan = await scanUsage(join(home, "nowhere"));
		assert.deepEqual(scan.days, []);
		assert.deepEqual(scan.buckets, []);
	});

	it("totals one conversation by day and by model", async () => {
		await write("s1", AT, user(AT));
		await write("s1", AT, reply(AT, { input: 100, output: 20, cost: 0.25 }));
		await write("s1", AT, { type: "event", event: { type: "context", systemPrompt: "x", tools: [], skills: [] } } as Payload);
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

	it("estimates old zero-cost replies from an exact configured model price", async () => {
		await write("s1", AT, reply(AT, { input: 100, output: 100, cacheRead: 900, cost: 0 }));
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
		await write("s1", AT, reply(AT, { provider: "openai-local", model: "gpt-5.2", input: 1_000_000, output: 0, cost: 0 }));
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

	it("drops the cache when configured prices change", async () => {
		await write("s1", AT, reply(AT, { input: 1_000_000, output: 0, cost: 0 }));
		const first = await scanUsage(home, [pricedProvider(1)]);
		assert.equal(first.buckets[0].cost, 1);

		const second = await scanUsage(home, [pricedProvider(2)]);
		assert.equal(second.scanned, 1, "a price change must re-evaluate rows already read");
		assert.equal(second.cached, 0);
		assert.equal(second.buckets[0].cost, 2);
	});

	it("title request usage reaches model totals without inflating conversation messages", async () => {
		await write("s1", AT, user(AT));
		await write("s1", AT, reply(AT));
		await scanUsage(home);
		await write("s1", AT, { type: "usage", source: "title-summary", providerId: "fast-provider", modelId: "fast-model", usage: { input: 80, output: 8, cacheRead: 0, cacheWrite: 0, total: 88, cost: { total: 0.003 } } } as Payload);
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
		await write("s1", AT, reply(AT, { input: 10 }));
		await write("s1", NEXT_DAY, reply(NEXT_DAY, { input: 90 }));
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
		await write("s1", AT, reply(AT, { model: "a", input: 10 }));
		await write("s1", AT, reply(AT, { model: "b", input: 20 }));
		const scan = await scanUsage(home);
		assert.deepEqual(scan.buckets.map((b) => b.key).sort(), ["relay/a", "relay/b"]);
	});

	it("two conversations on one day are two active sessions", async () => {
		await write("s1", AT, reply(AT));
		await write("s2", AT, reply(AT));
		const scan = await scanUsage(home);
		assert.equal(scan.days[0].sessions, 2);
		assert.equal(scan.buckets[0].replies, 2, "and their tokens are merged into one bucket");
	});

	it("a second scan with nothing new reads nothing", async () => {
		await write("s1", AT, reply(AT));
		const first = await scanUsage(home);
		assert.equal(first.scanned, 1);

		const second = await scanUsage(home);
		assert.equal(second.scanned, 0, "nothing changed, so nothing was read");
		assert.equal(second.cached, 1);
		assert.deepEqual(second.buckets, first.buckets, "and the answer is the same");
	});

	it("a new turn is counted once, not twice", async () => {
		await write("s1", AT, reply(AT, { input: 100 }));
		await scanUsage(home);

		await write("s1", AT, reply(AT, { input: 5 }));
		const scan = await scanUsage(home);

		assert.equal(scan.scanned, 1, "only the new row was read");
		assert.equal(scan.buckets[0].input, 105, "the old turn is not re-counted");
		assert.equal(scan.buckets[0].replies, 2);
	});

	it("a database replaced under the cache is read from its first row", async () => {
		await write("s1", AT, reply(AT, { input: 100 }));
		await write("s1", AT, reply(AT, { input: 100 }));
		await scanUsage(home);

		// Restored from a backup, say: a database of its own, numbering its rows afresh.
		await rm(sessions, { recursive: true, force: true });
		await mkdir(sessions, { recursive: true });
		opened = new Map();
		await write("s1", AT, reply(AT, { input: 7 }));
		const scan = await scanUsage(home);
		assert.equal(scan.buckets[0].input, 7);
		assert.equal(scan.buckets[0].replies, 1);
	});

	it("a new conversation is picked up without disturbing the cached ones", async () => {
		await write("s1", AT, reply(AT, { input: 100 }));
		await scanUsage(home);

		await write("s2", AT, reply(AT, { input: 50 }));
		const scan = await scanUsage(home);
		assert.equal(scan.cached, 1);
		assert.equal(scan.scanned, 1);
		assert.equal(scan.buckets[0].input, 150);
		assert.equal(scan.days[0].sessions, 2);
	});

	it("a deleted conversation's spend still counts, though it is no longer an active one", async () => {
		await write("s1", AT, reply(AT, { input: 100 }));
		await write("s2", AT, reply(AT, { input: 50 }));
		await scanUsage(home);

		const gone = opened.get("s2");
		assert.ok(gone);
		await new SessionStore(sessions).delete(gone.projectId, gone.id);
		const scan = await scanUsage(home);
		assert.equal(scan.buckets[0].input, 150, "what was spent stays spent");
		assert.equal(scan.days[0].sessions, 1);
	});

	it("a reply with no timestamp of its own is filed under when it was written, not 1970", async () => {
		const { timestamp: _timestamp, ...undated } = (reply(AT) as { message: Record<string, unknown> }).message;
		await write("s1", AT, { type: "message", message: undated } as Payload);
		const scan = await scanUsage(home);
		assert.deepEqual(scan.buckets.map((bucket) => bucket.day), ["2026-09-01"]);
	});

	it("side-chat auxiliary usage is recorded as auxiliary spend without inflating message count", async () => {
		await write("s1", AT, {
			type: "usage",
			source: "side-chat",
			providerId: "relay",
			modelId: "gemini-3.7",
			usage: { input: 300, output: 50, cacheRead: 200, cacheWrite: 0, reasoning: 0, total: 350, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		} as Payload);
		const scan = await scanUsage(home);
		assert.equal(scan.days[0].messages, 0, "auxiliary usage does not count as conversational message");
		assert.equal(scan.buckets[0].input, 300);
		assert.equal(scan.buckets[0].cacheRead, 200);
	});
});
