/**
 * A turn's clock and its tokens across a pause.
 *
 * Pressing stop and then 继续 is one piece of work with a gap in it, and it used to be reported as
 * two: `agent_end` dropped the meter, the next send lit a fresh one, and a task that ran twenty
 * minutes with one pause in the middle reported the length of its second half. The tokens went the
 * same way, which is worse than a wrong duration — tokens ÷ seconds is then a rate for a stretch of
 * work that never took place.
 *
 * What survives the gap is elapsed time, never the start time. The pause is time somebody spent
 * reading; charging the turn for it would be as wrong as charging it for none of it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { elapsedOf, freeze, loadCarried, meterFor, relight, saveCarried } from "../src/store/turn-meter.ts";

const MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Which meter a send picks up
// ---------------------------------------------------------------------------

test("插进正在跑的回合：钟接着走，账从零起", () => {
	/*
	 * The reported bug: a reply is still being written, you add a line, and the moment the new bubble
	 * lands the running line reads 「本轮 600 tokens」 — with this turn not a token old. Those 600 are
	 * the *previous* reply's output, and they are already printed under it by `MessageActions`, so
	 * counting them here bills the same work twice.
	 *
	 * The clock is the other half and it does carry: adding a requirement to a task in flight does not
	 * restart how long you have been waiting on that task. See this file's header.
	 */
	const running = { startedAt: 1_000_000, tokens: 600, inputTokens: 4_000, cacheRead: 3_000 };
	const meter = meterFor({ running, carried: null, carryOn: false, now: 1_000_000 + 5 * MINUTE });
	assert.equal(meter.startedAt, 1_000_000, "同一件事，等了多久还是那么久");
	assert.equal(meter.tokens, 0, "但这一轮还没产出任何 token");
	assert.equal(meter.inputTokens, undefined, "输入和缓存计数一起从零起");
	assert.equal(meter.cacheRead, undefined);
});

test("「继续」是同一轮被按了暂停，钟和账一起接", () => {
	const carried = freeze({ startedAt: 0, tokens: 31_400 }, 5 * MINUTE);
	const meter = meterFor({ running: undefined, carried, carryOn: true, now: 15 * MINUTE });
	assert.equal(elapsedOf(meter, 15 * MINUTE), 5 * MINUTE, "读的那十分钟不算在回合头上");
	assert.equal(meter.tokens, 31_400, "而账是接着的——两半本来就是一次请求");
});

test("闲着的会话有人开口，才是新的一件事", () => {
	const carried = freeze({ startedAt: 0, tokens: 31_400 }, 5 * MINUTE);
	// 不是「继续」，那份冻着的表就不该被接起来。
	const meter = meterFor({ running: undefined, carried, carryOn: false, now: 15 * MINUTE });
	assert.equal(meter.startedAt, 15 * MINUTE);
	assert.equal(meter.tokens, 0);
});

test("freezing keeps how long it ran, not when it started", () => {
	const frozen = freeze({ startedAt: 1_000_000, tokens: 31_400 }, 1_000_000 + 5 * MINUTE);
	assert.deepEqual(frozen, { elapsedMs: 5 * MINUTE, tokens: 31_400 });
});

test("a conversation that never ran has nothing to carry", () => {
	assert.equal(freeze(undefined, Date.now()), null);
});

test("the pause itself is not charged to the turn", () => {
	/*
	 * The whole reason elapsed is carried rather than `startedAt`. Five minutes of work, ten minutes
	 * of the user reading it, then 继续 — the turn has run five minutes, not fifteen.
	 */
	const paused = freeze({ startedAt: 0, tokens: 100 }, 5 * MINUTE);
	const resumedAt = 15 * MINUTE;
	const meter = relight(paused, resumedAt);
	assert.equal(elapsedOf(meter, resumedAt), 5 * MINUTE);
});

test("time keeps running from where it stopped", () => {
	const paused = freeze({ startedAt: 0, tokens: 100 }, 5 * MINUTE);
	const resumedAt = 15 * MINUTE;
	const meter = relight(paused, resumedAt);
	// Two more minutes of work after the resume: seven in total, and it never went backwards.
	assert.equal(elapsedOf(meter, resumedAt + 2 * MINUTE), 7 * MINUTE);
});

test("tokens come across too, and go on accumulating", () => {
	const paused = freeze({ startedAt: 0, tokens: 31_400 }, MINUTE);
	const meter = relight(paused, 10 * MINUTE);
	assert.equal(meter.tokens, 31_400, "the count resumed where it left off rather than at zero");
});

test("resuming from nothing is an ordinary start", () => {
	/*
	 * `relight` is called for every send, not only for 继续, so this is the common path: with nothing
	 * carried it must produce exactly what a fresh turn would.
	 */
	const now = 1_700_000_000_000;
	assert.deepEqual(relight(null, now), { startedAt: now, tokens: 0 });
	assert.deepEqual(relight(undefined, now), { startedAt: now, tokens: 0 });
});

test("a clock that jumped backwards does not produce a turn that counts down", () => {
	/*
	 * Suspending a laptop or an NTP correction can move the clock behind the moment the turn began.
	 * Elapsed would go negative, `relight` would then set `startedAt` in the future, and the running
	 * line would show a number that shrinks — which reads as the app having lost its mind.
	 */
	const frozen = freeze({ startedAt: 5 * MINUTE, tokens: 0 }, 3 * MINUTE);
	const meter = relight(frozen, 4 * MINUTE);
	assert.equal(elapsedOf(meter, 4 * MINUTE), 0);
});

test("loadCarried and saveCarried round-trip cleanly", () => {
	// Mock localStorage
	const storage: Record<string, string> = {};
	(globalThis as unknown as { window: { localStorage: Storage } }).window = {
		localStorage: {
			getItem: (k: string) => storage[k] ?? null,
			setItem: (k: string, v: string) => {
				storage[k] = v;
			},
			removeItem: (k: string) => {
				delete storage[k];
			},
			clear: () => {},
			key: () => null,
			length: 0,
		},
	};

	assert.equal(loadCarried("test-sess"), null);

	saveCarried("test-sess", { elapsedMs: 12500, tokens: 420 });
	assert.deepEqual(loadCarried("test-sess"), { elapsedMs: 12500, tokens: 420 });

	saveCarried("test-sess", null);
	assert.equal(loadCarried("test-sess"), null);
});

test("two pauses in one turn add up rather than replacing each other", () => {
	// The case that made the old behaviour indefensible: whichever leg ran last was the whole report.
	let meter = { startedAt: 0, tokens: 1_000 };

	const firstPause = freeze(meter, 3 * MINUTE);
	meter = relight(firstPause, 20 * MINUTE);
	// Another two minutes of work, and the tokens it spent.
	meter = { ...meter, tokens: meter.tokens + 500 };

	const secondPause = freeze(meter, 22 * MINUTE);
	meter = relight(secondPause, 60 * MINUTE);
	meter = { ...meter, tokens: meter.tokens + 500 };

	assert.equal(elapsedOf(meter, 61 * MINUTE), 6 * MINUTE, "3 + 2 + 1 minutes of actual work");
	assert.equal(meter.tokens, 2_000);
});

test("cache input counts survive pause, continuation and disk persistence", async () => {
	const { addTurnUsage, freeze, relight } = await import("../src/store/turn-meter.ts");
	const { emptyUsage } = await import("@lyra/core");
	const usage = { ...emptyUsage(), input: 10, cacheRead: 80, cacheWrite: 10, output: 500 };
	const metered = addTurnUsage({ startedAt: 100, tokens: 0 }, usage);
	assert.equal(metered.tokens, 520); assert.equal(metered.inputTokens, 100); assert.equal(metered.cacheRead, 80);
	const next = relight(freeze(metered, 200), 500);
	assert.equal(next.inputTokens, 100); assert.equal(next.cacheRead, 80); assert.equal(next.tokens, 520);
});
