/**
 * The line that says why a turn is taking so long.
 *
 * Worth its own tests because the version this replaces was wrong in three ways at once, and every
 * one of them was invisible until a socket actually dropped: it stated a delay it then held for ten
 * times as long, it numbered attempts from a counter that restarted underneath it, and it stayed on
 * screen for the rest of the turn after the connection had already come back.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeRetry, type Retrying } from "../src/lib/retry-line.ts";

const NOW = 1_700_000_000_000;

const waiting = (over: Partial<Retrying> = {}): Retrying => ({
	attempt: 1,
	until: NOW + 5_000,
	reason: "UND_ERR_SOCKET",
	resume: false,
	...over,
});

test("the seconds count down as the clock moves", () => {
	const state = waiting({ until: NOW + 5_000 });
	const said = [0, 1_000, 2_000, 3_000, 4_000].map((elapsed) => describeRetry(state, NOW + elapsed));

	assert.deepEqual(said, [
		"连接中断，5 秒后重试（第 1 次）",
		"连接中断，4 秒后重试（第 1 次）",
		"连接中断，3 秒后重试（第 1 次）",
		"连接中断，2 秒后重试（第 1 次）",
		"连接中断，1 秒后重试（第 1 次）",
	]);
});

test("a sub-second wait is a second, not zero", () => {
	// 600ms is the first backoff, and `Math.round` made it "0 秒后重试".
	assert.match(describeRetry(waiting({ until: NOW + 600 }), NOW), /1 秒后重试/);
});

test("past zero it stops promising a time and says what is happening", () => {
	/*
	 * The failure this replaces: the wait ends, the request goes back out, and the line kept
	 * claiming a second was still to come — through a reconnect that took forty.
	 */
	assert.match(describeRetry(waiting({ until: NOW }), NOW), /正在重连/);
	assert.match(describeRetry(waiting({ until: NOW - 30_000 }), NOW), /正在重连/);
	assert.doesNotMatch(describeRetry(waiting({ until: NOW - 30_000 }), NOW), /秒后/);
});

test("the attempt number is shown, since it is the one thing that says this is not the first", () => {
	assert.match(describeRetry(waiting({ attempt: 4 }), NOW), /第 4 次/);
});

test("a resume leads with the work being safe, not with the wait", () => {
	/*
	 * By the time this shows, `agent_end` has already been through the window and the transcript
	 * shows the turn failing. "It will retry in a minute" is not the question being asked.
	 */
	const line = describeRetry(waiting({ resume: true, until: NOW + 60_000 }), NOW);

	assert.match(line, /进度已保留/);
	assert.match(line, /60 秒后从中断处继续/);
	assert.match(line, /第 1 次/);
});

test("a resume past zero says it is continuing, not starting", () => {
	const line = describeRetry(waiting({ resume: true, until: NOW }), NOW);

	assert.match(line, /正在从中断处继续/);
	assert.doesNotMatch(line, /重连/, "the word for this one is 继续 — nothing is being redone");
});

test("the two kinds of wait do not read the same", () => {
	const retry = describeRetry(waiting({ resume: false }), NOW);
	const resume = describeRetry(waiting({ resume: true }), NOW);

	assert.notEqual(retry, resume, "one is seconds inside a turn, the other is the turn coming back");
});
