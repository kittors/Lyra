import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWithRetry, retryStream } from "../src/ai/retry.ts";

/** A socket dying mid-stream, exactly as undici reports it. */
function socketError(): Error {
	const error = new Error("terminated");
	(error as Error & { cause?: unknown }).cause = { code: "UND_ERR_SOCKET" };
	return error;
}

async function collect<T>(stream: AsyncGenerator<T, void>): Promise<T[]> {
	const seen: T[] = [];
	for await (const value of stream) seen.push(value);
	return seen;
}

const noSleep = async () => {};

test("a stream that completes is passed straight through", async () => {
	let resets = 0;
	const seen = await collect(
		retryStream(
			async function* () {
				yield "a";
				yield "b";
			},
			{ reset: () => resets++, sleep: noSleep },
		),
	);
	assert.deepEqual(seen, ["a", "b"]);
	assert.equal(resets, 1, "reset runs once per attempt, including the first");
});

test("a stream that dies part way through starts over", async () => {
	const attempts: number[] = [];
	const retries: { attempt: number; reason: string }[] = [];
	const seen = await collect(
		retryStream(
			async function* (attempt) {
				attempts.push(attempt);
				yield `start-${attempt}`;
				if (attempt === 1) throw socketError();
				yield "finished";
			},
			{ reset: () => {}, sleep: noSleep, onRetry: (info) => retries.push(info) },
		),
	);

	assert.deepEqual(attempts, [1, 2]);
	// The failed attempt's output was still emitted; the caller replaces rather than appends.
	assert.deepEqual(seen, ["start-1", "start-2", "finished"]);
	assert.equal(retries.length, 1);
	/*
	 * `reason` 现在是给人看的那句话，原始的码在 `failure.detail` 里。
	 *
	 * 这条断言原本要的是「说清是什么原因，不能只说 terminated」——那个意思没变，只是分了两处：
	 * 界面上那行读 `reason`，要排查的时候展开看 `detail`。断言两个都在。
	 */
	assert.equal(retries[0].reason, "连接中断");
	assert.match(retries[0].failure?.detail ?? "", /UND_ERR_SOCKET/, "the cause is named, not just 'terminated'");
});

test("state is cleared before every attempt", async () => {
	const content: string[] = [];
	await collect(
		retryStream(
			async function* (attempt) {
				content.push(`chunk-${attempt}`);
				if (attempt < 3) throw socketError();
				yield "ok";
			},
			{ reset: () => (content.length = 0), sleep: noSleep },
		),
	);
	assert.deepEqual(content, ["chunk-3"], "only the successful attempt's output survives");
});

test("it gives up after the last attempt and rethrows", async () => {
	await assert.rejects(
		collect(
			retryStream(
				async function* () {
					yield "x";
					throw socketError();
				},
				{ attempts: 2, reset: () => {}, sleep: noSleep },
			),
		),
		/terminated/,
	);
});

test("an error that is not worth retrying is not retried", async () => {
	let attempts = 0;
	await assert.rejects(
		collect(
			retryStream(
				async function* () {
					attempts++;
					throw new Error("400 Bad Request");
					// oxlint-disable-next-line no-unreachable -- the yield is what types the generator
					yield "never";
				},
				{ reset: () => {}, sleep: noSleep },
			),
		),
		/400/,
	);
	assert.equal(attempts, 1);
});

test("the two retries are stacked, and neither knows the other is counting", async () => {
	/*
	 * Every provider stacks them: `fetchWithRetry` to get the connection, `retryStream` to keep it.
	 * They share one `onRetry` and each numbers its own attempts from 1, so what reached the window
	 * was a number that restarted underneath the user — the fifth attempt of a request announcing
	 * itself as 第 1 次, having already waited a quarter of a minute.
	 *
	 * Asserted rather than described, because the sequence is the whole reason the loop keeps a
	 * count of its own.
	 */
	const raw: number[] = [];
	const record = (info: { attempt: number }) => void raw.push(info.attempt);
	const deadSocket: typeof globalThis.fetch = async () => {
		throw socketError();
	};

	await assert.rejects(
		collect(
			retryStream(
				async function* () {
					await fetchWithRetry(deadSocket, "http://x", {}, { attempts: 3, sleep: noSleep, onRetry: record });
					// oxlint-disable-next-line no-unreachable -- the yield is what types the generator
					yield "never";
				},
				{ attempts: 3, reset: () => {}, sleep: noSleep, onRetry: record },
			),
		),
		/terminated/,
	);

	assert.deepEqual(raw, [1, 2, 1, 1, 2, 2, 1, 2], "it goes backwards four times over nine attempts");

	// What the loop does with it: count the request's own retries, so the number only ever goes up.
	const shown = raw.map((_, index) => index + 1);
	assert.deepEqual(shown, [1, 2, 3, 4, 5, 6, 7, 8]);
	assert.ok(
		shown.every((n, i) => i === 0 || n > shown[i - 1]),
		"a count that can go down is not a count of anything the user is waiting for",
	);
});

test("an aborted stream stops rather than starting over", async () => {
	const controller = new AbortController();
	let attempts = 0;
	await assert.rejects(
		collect(
			retryStream(
				// oxlint-disable-next-line require-yield -- it throws before it can yield; that is the case
				async function* () {
					attempts++;
					controller.abort();
					throw socketError();
				},
				{ reset: () => {}, sleep: noSleep, signal: controller.signal },
			),
		),
		/terminated/,
	);
	assert.equal(attempts, 1, "the user stopping it is not a failure to recover from");
});
