/**
 * When a prune is worth what it breaks, and which results are worth nothing to begin with.
 *
 * Every rule here is about the same hidden cost: rewriting the middle of a conversation
 * invalidates the provider's prefix cache from that point on, so tokens saved this turn come back
 * as cache misses on the next one. None of that is visible in a diff of the messages — it shows up
 * on the bill.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CACHE_TTL_MS,
	CHEAP_SUFFIX_CHARS,
	dropUneventful,
	PRUNE_FLOOR_CHARS,
	pruneText,
	worthPruning,
} from "../src/runtime/prune.ts";
import type { Message, ToolResultMessage } from "../src/types.ts";

function result(text: string, uneventful = false): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: `c-${text.length}-${uneventful}`,
		toolName: "grep",
		content: [{ type: "text", text }],
		isError: false,
		uneventful,
		timestamp: 0,
	};
}

function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0 };
}

// ---------------------------------------------------------------------------
// The floor
// ---------------------------------------------------------------------------

test("a result smaller than the marker is left alone", () => {
	/*
	 * The marker is prose and runs to a couple of hundred characters. Cutting a 150-character
	 * result to insert it saves nothing and rewrites history to do it.
	 */
	assert.equal(pruneText("x".repeat(150), 10), null);
});

test("above the floor, cutting happens as before", () => {
	const cut = pruneText("x".repeat(10_000));
	assert.ok(cut);
	assert.ok(cut.length < 10_000);
});

// ---------------------------------------------------------------------------
// Cache-aware timing
// ---------------------------------------------------------------------------

test("a small suffix makes a prune cheap", () => {
	const messages = [result("x".repeat(20_000)), user("短")];
	assert.equal(worthPruning(messages, 0, { lastRequestAt: Date.now(), now: Date.now() }), true);
});

test("a large suffix does not, while the cache is warm", () => {
	/*
	 * Everything below the edit has to be re-sent uncached. A long tail is the whole saving handed
	 * straight back.
	 */
	const messages = [result("x".repeat(20_000)), user("y".repeat(CHEAP_SUFFIX_CHARS + 1))];
	const now = Date.now();
	assert.equal(worthPruning(messages, 0, { lastRequestAt: now, now }), false);
});

test("once the cache has expired there is nothing left to invalidate", () => {
	const messages = [result("x".repeat(20_000)), user("y".repeat(CHEAP_SUFFIX_CHARS + 1))];
	const now = Date.now();
	assert.equal(worthPruning(messages, 0, { lastRequestAt: now - CACHE_TTL_MS - 1, now }), true);
});

test("with no request recorded, only the suffix decides", () => {
	const big = [result("x".repeat(10)), user("y".repeat(CHEAP_SUFFIX_CHARS + 1))];
	assert.equal(worthPruning(big, 0, {}), false);
	assert.equal(worthPruning([result("x"), user("短")], 0, {}), true);
});

// ---------------------------------------------------------------------------
// Uneventful results
// ---------------------------------------------------------------------------

test("an uneventful result is emptied, not removed", () => {
	/*
	 * The pairing is the reason. A `tool_use` whose `tool_result` is missing makes Anthropic reject
	 * the request — and every later one carrying the same history, including the one sent to
	 * recover from it. One orphan does not spoil a turn, it spoils the conversation.
	 */
	const messages = [result("没有匹配。".repeat(200), true), user("短")];
	const after = dropUneventful(messages, { now: 0, lastRequestAt: 0 });

	assert.equal(after.length, messages.length, "the message is still there");
	assert.equal(after[0].role, "toolResult");
	assert.equal((after[0] as ToolResultMessage).toolCallId, (messages[0] as ToolResultMessage).toolCallId, "and still paired");
	assert.match((after[0].content[0] as { text: string }).text, /无结果/);
});

test("a result with content is untouched even when it is enormous", () => {
	const messages = [result("真实的搜索结果".repeat(2000), false), user("短")];
	assert.equal(dropUneventful(messages, { now: 0, lastRequestAt: 0 }), messages, "same array, nothing allocated");
});

test("a tiny uneventful result is not worth the cache", () => {
	const messages = [result("x".repeat(PRUNE_FLOOR_CHARS - 1), true), user("短")];
	assert.equal(dropUneventful(messages, { now: 0, lastRequestAt: 0 }), messages);
});

test("timing applies to uneventful results too", () => {
	const long = "没有匹配。".repeat(200);
	const messages = [result(long, true), user("y".repeat(CHEAP_SUFFIX_CHARS + 1))];
	const now = Date.now();

	assert.equal(dropUneventful(messages, { lastRequestAt: now, now }), messages, "warm cache, long tail: leave it");
	assert.notEqual(dropUneventful(messages, { lastRequestAt: now - CACHE_TTL_MS - 1, now }), messages, "cold cache: take it");
});

test("nothing to do returns the same array", () => {
	const messages = [user("a"), result("b")];
	assert.equal(dropUneventful(messages, {}), messages);
});
