import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchWithRetry, isRetryableError, isRetryableStatus, retryDelay, serverDelay, toolCallId } from "../src/ai/retry.ts";
import { FailureError } from "../src/ai/failure.ts";

const socketError = () => Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } });
const noSleep = async () => {};

test("认不出来的也重试，只有确定不会变的才拒绝", () => {
	assert.equal(isRetryableError(socketError()), true);
	assert.equal(isRetryableError(Object.assign(new Error("x"), { cause: { code: "ECONNRESET" } })), true);
	/*
	 * 这一行从前断言的是 `false`，理由写着「a bad request body is not going to become good on the
	 * second try」——可 `new TypeError("Invalid JSON")` 并不是请求体有问题，它只是一个白名单没收录
	 * 的异常，而白名单外一律不重试正是这次要改掉的东西。默认翻过来之后，认不出来的会被重试，
	 * 真正该拒绝的由 `failure.ts` 那份短黑名单挡住。
	 */
	assert.equal(isRetryableError(new TypeError("Invalid JSON")), true);
	assert.equal(isRetryableError(Object.assign(new Error("bad cert"), { cause: { code: "CERT_HAS_EXPIRED" } })), false);
	assert.equal(isRetryableStatus(429), true);
	assert.equal(isRetryableStatus(503), true);
	// 白名单时代这两个是漏网的：没见过的状态码等于不重试。
	assert.equal(isRetryableStatus(520), true);
	assert.equal(isRetryableStatus(530), true);
	assert.equal(isRetryableStatus(400), false);
	assert.equal(isRetryableStatus(401), false);
});

test("a dropped socket is retried and the answer still arrives", async () => {
	let calls = 0;
	const response = await fetchWithRetry(
		async () => {
			calls++;
			if (calls < 3) throw socketError();
			return new Response("ok", { status: 200 });
		},
		"https://example.test",
		{},
		{ attempts: 3, sleep: noSleep },
	);
	assert.equal(calls, 3);
	assert.equal(response.status, 200);
});

test("giving up rethrows the last error rather than inventing one", async () => {
	let calls = 0;
	await assert.rejects(
		fetchWithRetry(
			async () => {
				calls++;
				throw socketError();
			},
			"https://example.test",
			{},
			{ attempts: 2, sleep: noSleep },
		),
		/fetch failed/,
	);
	assert.equal(calls, 2);
});

/**
 * 4xx 带着结论抛出来，而不是原样交回去。
 *
 * 从前它是「返回，让调用方自己报」。三个调用方拿到之后做的第一件事都是 `if (!response.ok) throw`，
 * 抛出去的是一个 `HTTP 401: ...` 字符串——那个结论在路上被重新猜了一遍，而流那一层看不懂字符串，
 * 只能把它当成「没见过的连接问题」再重试一遍。判断走到哪儿都带着自己。
 */
test("一个 4xx 带着分类结果抛出来，且不会有第二次尝试", async () => {
	let calls = 0;
	await assert.rejects(
		fetchWithRetry(
			async () => {
				calls++;
				return new Response("nope", { status: 401 });
			},
			"https://example.test",
			{},
			{ attempts: 3, sleep: noSleep },
		),
		(error: unknown) => {
			assert.ok(error instanceof FailureError, "抛的是带结论的那种异常");
			assert.equal(error.failure.kind, "fatal");
			assert.equal(error.failure.hint, "check-key", "并且说得出下一步该去哪儿");
			return true;
		},
	);
	assert.equal(calls, 1);
});

test("a 429 is retried, and the caller is told each time", async () => {
	let calls = 0;
	const notices: string[] = [];
	const response = await fetchWithRetry(
		async () => {
			calls++;
			return calls < 2 ? new Response("slow down", { status: 429 }) : new Response("ok", { status: 200 });
		},
		"https://example.test",
		{},
		{ attempts: 3, sleep: noSleep, onRetry: (info) => notices.push(info.reason) },
	);
	assert.equal(calls, 2);
	assert.equal(response.status, 200);
	// 说的是给人看的话，不是状态码——这一行最后会出现在界面上。
	assert.deepEqual(notices, ["被限流"]);
});

test("an aborted turn during backoff wait stops immediately without waiting", async () => {
	const controller = new AbortController();
	let calls = 0;
	const start = Date.now();

	const promise = fetchWithRetry(
		async () => {
			calls++;
			return new Response("Too Many Requests", { status: 429, headers: { "retry-after": "10" } });
		},
		"https://example.test",
		{},
		{ attempts: 3, signal: controller.signal },
	);

	// Abort after 20ms while in the 10s wait
	setTimeout(() => {
		controller.abort();
	}, 20);

	await assert.rejects(promise);
	const duration = Date.now() - start;
	assert.ok(duration < 2000, `aborted promptly instead of waiting full delay (took ${duration}ms)`);
	assert.equal(calls, 1);
});

test("an aborted turn stops immediately instead of waiting to retry", async () => {
	const controller = new AbortController();
	let calls = 0;
	await assert.rejects(
		fetchWithRetry(
			async () => {
				calls++;
				controller.abort();
				throw socketError();
			},
			"https://example.test",
			{},
			{ attempts: 5, signal: controller.signal, sleep: noSleep },
		),
	);
	// Cancelling is a decision, not a failure: it is not retried.
	assert.equal(calls, 1);
});

test("attempts of 1 disables retrying", async () => {
	let calls = 0;
	await assert.rejects(
		fetchWithRetry(
			async () => {
				calls++;
				throw socketError();
			},
			"https://example.test",
			{},
			{ attempts: 1, sleep: noSleep },
		),
	);
	assert.equal(calls, 1);
});

test("the server's own Retry-After wins over the backoff curve", () => {
	const response = new Response("", { status: 429, headers: { "retry-after": "2" } });
	assert.equal(retryDelay(1, response), 2000);
	// Capped, so one unlucky header cannot stall a turn for ten minutes.
	const long = new Response("", { status: 429, headers: { "retry-after": "600" } });
	assert.equal(retryDelay(1, long), 60_000);
	// Without a header the curve grows, and stays inside its ceiling.
	assert.ok(retryDelay(1) < retryDelay(3));
	assert.ok(retryDelay(9) <= 60_000);
});

/*
 * The wait a relay puts in the body instead of in a header.
 *
 * This is the case that made retrying useless in practice: a 503 whose body says the model is
 * unavailable for another 54 seconds, with no `Retry-After` at all. Reading only the header meant
 * falling back to the curve and spending the entire budget in a couple of seconds — against an
 * outage that had announced its own length.
 */
test("the wait is found in the body when there is no header", () => {
	const relay = JSON.stringify({
		error: {
			code: "model_unavailable",
			message: "All credentials for model gemini-3.7-flash-high are temporarily unavailable",
			model: "gemini-3.7-flash-high",
			reset_seconds: 54,
			reset_time: "53s",
		},
	});
	assert.equal(serverDelay(null, relay), 54_000, "reset_seconds, in milliseconds");
	assert.equal(retryDelay(1, undefined, relay), 54_000, "and it is what the delay becomes");

	// The written form, for the servers that send only that.
	assert.equal(serverDelay(null, JSON.stringify({ reset_time: "12s" })), 12_000);
	// Other spellings of the same fact.
	assert.equal(serverDelay(null, JSON.stringify({ retry_after: 7 })), 7000);
	assert.equal(serverDelay(null, JSON.stringify({ retry_after_seconds: 7 })), 7000);
});

test("a header still beats the body, and a body without the field changes nothing", () => {
	const body = JSON.stringify({ error: { code: "model_unavailable", reset_seconds: 54 } });
	const response = new Response("", { status: 503, headers: { "retry-after": "3" } });
	assert.equal(retryDelay(1, response, body), 3000, "the header is the standard place to say it");

	// Numbers that are not a wait must not be mistaken for one.
	assert.equal(serverDelay(null, JSON.stringify({ model: "gemini-3.7-flash-high" })), null);
	assert.equal(serverDelay(null, JSON.stringify({ error: { code: 503 } })), null);
	assert.equal(serverDelay(null, "not json at all"), null);
	assert.equal(serverDelay(null, undefined), null);
});

test("the curve starts where a person would expect a retry to, not in a tight loop", () => {
	/*
	 * The first version began at 600ms and tripled: three attempts inside two and a half seconds,
	 * which reads as hammering a server that has just said it is busy. Jitter is ±25%, so these
	 * are bounds rather than equalities.
	 */
	assert.ok(retryDelay(1) >= 1500, `first wait is seconds, not milliseconds (${retryDelay(1)})`);
	assert.ok(retryDelay(1) <= 2500);
	assert.ok(retryDelay(2) >= 3750, `and the second is longer again (${retryDelay(2)})`);
	/*
	 * The four waits of a five-attempt budget span half a minute at worst.
	 *
	 * Not a full minute, and it does not need to be: an outage that knows its own length says so,
	 * and that path is exact rather than approximate (see the body test above). This curve is for
	 * the servers that say nothing, where the goal is only to stop asking so often.
	 */
	const total = [1, 2, 3, 4].reduce((sum, n) => sum + retryDelay(n), 0);
	assert.ok(total >= 30_000, `four waits add up to half a minute at least (${Math.round(total)}ms)`);
});

test("a call with no id gets its own, and keeps it across events", () => {
	const invented = new Map<number, string>();
	// Two events for the same call agree, because the fallback is remembered by index.
	const first = toolCallId(undefined, 0, invented);
	assert.equal(toolCallId(undefined, 0, invented), first);
	// A different call gets a different id, which is the whole point: they used to collide on
	// the empty string, so the newest call reset the record every earlier card was reading.
	assert.notEqual(toolCallId(undefined, 1, invented), first);
	assert.notEqual(toolCallId("", 2, invented), first);
});

test("a supplied id is used unchanged", () => {
	const invented = new Map<number, string>();
	assert.equal(toolCallId("call_abc", 0, invented), "call_abc");
	// Whitespace-only is not an id.
	assert.notEqual(toolCallId("   ", 1, invented), "   ");
});
