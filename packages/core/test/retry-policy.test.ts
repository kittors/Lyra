import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RETRY_POLICY, DEFAULT_RETRY_RULE, normalizeRetryPolicy, policyDelay, type RetryPolicy } from "../src/config/retry-policy.ts";
import { normalizeSettings } from "../src/config/settings.ts";
import { RetryBudget, fetchWithRetry, retryStream, isRetryableError } from "../src/ai/retry.ts";
const socket = () => new Error("fetch failed");

test("defaults mean ten retries after the first request, always five seconds", async () => {
	assert.deepEqual(normalizeSettings({}).retryPolicy, DEFAULT_RETRY_POLICY);
	assert.equal(new RetryBudget().policy.network.retries, null);
	let calls = 0; const waits: number[] = [];
	await assert.rejects(fetchWithRetry(async () => { calls++; throw socket(); }, "https://example.test", {}, { budget: new RetryBudget({ ...DEFAULT_RETRY_POLICY, network: DEFAULT_RETRY_RULE }), sleep: async ms => { waits.push(ms); } }), /fetch failed/);
	assert.equal(calls, 11); assert.deepEqual(waits, Array(10).fill(5000));
});

test("linear delays reach the configured ceiling; fixed ignores server hints", async () => {
	const policy = { ...DEFAULT_RETRY_RULE, strategy: "linear" as const };
	assert.deepEqual([1, 2, 3, 6, 100].map(n => policyDelay(policy, n)), [5000, 10000, 15000, 30000, 30000]);
	const waits: number[] = []; let calls = 0;
	/*
	 * 预算用尽之后抛出来，而不是把那个 503 交回去——见 `fetchWithRetry` 的说明。
	 *
	 * `retry-after: 60` 依然被无视，这条测试的后半句问的就是这个：设置页上写着固定间隔「不受服务端
	 * 建议或随机抖动影响」，那是用户明确要求的事。
	 */
	await assert.rejects(fetchWithRetry(async () => { calls++; return new Response("busy", { status: 503, headers: { "retry-after": "60" } }); }, "https://example.test", {}, { budget: new RetryBudget({ ...DEFAULT_RETRY_POLICY, upstream: { ...DEFAULT_RETRY_RULE, retries: 2 } }), sleep: async ms => { waits.push(ms); } }));
	assert.equal(calls, 3); assert.deepEqual(waits, [5000, 5000]);
});

test("HTTP and broken streams spend one shared budget without multiplying retries", async () => {
	const budget = new RetryBudget({ ...DEFAULT_RETRY_POLICY, network: { ...DEFAULT_RETRY_RULE, retries: 3 } });
	let calls = 0; const attempts: number[] = [];
	const options = { budget, sleep: async () => {}, onRetry: (info: { attempt: number }) => { attempts.push(info.attempt); } };
	const stream = retryStream(async function* () {
		await fetchWithRetry(async () => { calls++; if (calls % 2) throw socket(); return new Response("ok"); }, "https://example.test", {}, options);
		yield "partial"; throw socket();
	}, { ...options, reset: () => {} });
	await assert.rejects(async () => { for await (const value of stream) assert.equal(value, "partial"); }, /fetch failed/);
	assert.equal(calls, 4); assert.deepEqual(attempts, [1, 2, 3]);
});

test("unlimited retry remains abortable during a real wait and never starts another stream", async () => {
	const controller = new AbortController(); let calls = 0;
	const start = Date.now();
	const stream = retryStream(async function* () { calls++; yield "partial"; throw socket(); }, {
		budget: new RetryBudget(DEFAULT_RETRY_POLICY), signal: controller.signal, reset: () => {},
		onRetry: () => { setTimeout(() => controller.abort(), 10); },
	});
	await assert.rejects(async () => { for await (const value of stream) assert.equal(value, "partial"); });
	assert.equal(calls, 1); assert.ok(Date.now() - start < 1000);
});

test("the old default upgrades to ten retries, explicit alternatives migrate, and invalid numbers cannot create tight loops", () => {
	assert.equal(normalizeRetryPolicy(undefined, 5).upstream.retries, 10);
	assert.equal(normalizeRetryPolicy(undefined, 3).upstream.retries, 2);
	assert.equal(normalizeRetryPolicy(undefined, 1).upstream.retries, 0);
	assert.deepEqual(normalizeRetryPolicy({ upstream: { retries: Infinity, intervalMs: -1, maxIntervalMs: NaN, strategy: "unknown" } }).upstream, { retries: 10, intervalMs: 1000, maxIntervalMs: 30000, strategy: "fixed" });
	assert.equal(normalizeRetryPolicy({ upstream: { intervalMs: 40000, maxIntervalMs: 30000 } }).upstream.maxIntervalMs, 40000);
});


/*
 * The reason the budget reads rather than copies.
 *
 * A request retrying on the unlimited network rule can sit there for hours, which is exactly when
 * someone opens the settings page — and under a snapshot their edit would have reached it after it
 * finished, i.e. never. Both halves of the rule have to move: the interval it waits next, and the
 * ceiling that decides whether there is a next one at all.
 */
test("a policy edited mid-request applies from the next retry, and tightening the limit ends it", async () => {
	let live: RetryPolicy = { ...DEFAULT_RETRY_POLICY };
	const budget = new RetryBudget(() => live);
	const waits: number[] = []; let calls = 0;
	await assert.rejects(fetchWithRetry(async () => {
		calls++;
		if (calls === 2) live = { ...live, network: { retries: 3, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 30_000 } };
		throw socket();
	}, "https://example.test", {}, { budget, sleep: async ms => { waits.push(ms); } }), /fetch failed/);
	// The first wait was quoted before the edit; every one after it is the new interval, and the
	// three retries the new rule allows are counted from the start rather than from the edit.
	assert.deepEqual(waits, [5000, 1000, 1000]); assert.equal(calls, 4);
});

test("an explicit low-level attempt count still bounds both categories, whatever the settings say", () => {
	const bounded = new RetryBudget(undefined, 3).policy;
	assert.equal(bounded.upstream.retries, 2); assert.equal(bounded.network.retries, 2);
	// A live source that has nothing to say falls back to the same bounded lifetime.
	assert.equal(new RetryBudget(() => undefined, 3).policy.network.retries, 2);
	assert.equal(new RetryBudget(() => DEFAULT_RETRY_POLICY, 3).policy.network.retries, null);
});

test("fault categories keep independent limits, and certificate errors are not transient network outages", async () => {
	const policy = { network: { ...DEFAULT_RETRY_RULE, retries: 2, intervalMs: 1000 }, upstream: { ...DEFAULT_RETRY_RULE, retries: 1, intervalMs: 3000 } };
	const budget = new RetryBudget(policy); let calls = 0; const waits: number[] = [];
	// 两类交替耗着各自的额度，各用各的间隔；upstream 先见底，于是最后那个 503 带着分类结果抛出来。
	await assert.rejects(fetchWithRetry(async () => { calls++; if (calls === 1 || calls === 3) throw socket(); return new Response("busy", { status: 503 }); }, "https://example.test", {}, { budget, sleep: async ms => { waits.push(ms); } }));
	assert.equal(calls, 4); assert.deepEqual(waits, [1000, 3000, 1000]);
	assert.equal(isRetryableError(new Error("fetch failed", { cause: { code: "CERT_HAS_EXPIRED" } })), false);
	assert.equal(isRetryableError(new Error("fetch failed", { cause: { code: "ENETUNREACH" } })), true);
});
