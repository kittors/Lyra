/**
 * Reasoning going back to the provider that produced it.
 *
 * A reasoning block arrives with the provider's own item id and is replayed under that id — that
 * is the ordinary case, and OpenAI's endpoint always names its items so it is the only case there.
 * Relays that translate Responses into Chat Completions are where it stops holding: several of them
 * stream reasoning without ever sending an `item.id`, and the block used to be dropped on the way
 * back for lacking one.
 *
 * Dropping it is not a degraded request, it is a broken one. Upstreams reached through those relays
 * — DeepSeek among them — require the thinking they produced to come back with the turn that
 * followed it, and answer a request without it:
 *
 *     The `reasoning_text` in the thinking mode must be passed back to the API.
 *
 * Which is a 400 on every turn after the first, and no retry clears it because the history being
 * retried is the thing being rejected. Turning thinking off was the only way out.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { toResponsesInput } from "../src/ai/openai-responses-request.ts";
import type { AssistantMessage, Message } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

function assistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "opencode-go",
		model: "deepseek-v4-flash",
		usage: emptyUsage(),
		stopReason: "endTurn",
		timestamp: 1,
	};
}

const user: Message = { role: "user", content: [{ type: "text", text: "继续" }], timestamp: 0 };

/** The reasoning items in a request, which is all these tests are about. */
type ReasoningItem = {
	type: string;
	id?: string;
	summary?: { type: string; text: string }[];
	content?: { type: string; text: string }[];
	encrypted_content?: string;
};

const reasoning = (input: unknown[]): ReasoningItem[] =>
	input.filter((item): item is ReasoningItem => (item as { type?: string }).type === "reasoning");

test("reasoning that arrived with an item id is replayed under that id", () => {
	const input = toResponsesInput([
		user,
		assistant([
			{ type: "thinking", thinking: "先看看目录", signature: "rs_abc123", encrypted: "gAAAAA" },
			{ type: "text", text: "好的" },
		]),
	]);

	assert.deepEqual(reasoning(input), [
		{
			type: "reasoning",
			id: "rs_abc123",
			summary: [{ type: "summary_text", text: "先看看目录" }],
			encrypted_content: "gAAAAA",
		},
	]);
});

test("reasoning without an item id goes back as reasoning_text rather than being dropped", () => {
	const input = toResponsesInput([
		user,
		assistant([
			{ type: "thinking", thinking: "用户要我继续，先确认上一步的结果" },
			{ type: "text", text: "继续了" },
		]),
	]);

	/*
	 * `content`, not `summary`. The upstream asks for the reasoning itself; a summary of it is a
	 * different thing and is what the relay would have had to send in its place.
	 */
	assert.deepEqual(reasoning(input), [
		{
			type: "reasoning",
			summary: [],
			content: [{ type: "reasoning_text", text: "用户要我继续，先确认上一步的结果" }],
		},
	]);
});

test("an id-less block keeps its encrypted payload, which is replayable on its own", () => {
	const input = toResponsesInput([user, assistant([{ type: "thinking", thinking: "", encrypted: "gAAAAA" }])]);

	assert.deepEqual(reasoning(input), [{ type: "reasoning", summary: [], encrypted_content: "gAAAAA" }]);
});

test("a block with neither a handle nor any text is still dropped", () => {
	// Nothing to send and nothing to resume — an empty reasoning item would be noise in the request.
	const input = toResponsesInput([user, assistant([{ type: "thinking", thinking: "" }, { type: "text", text: "嗯" }])]);

	assert.deepEqual(reasoning(input), []);
});

test("reasoning stripped of its handles by a model switch still goes back as text", () => {
	/*
	 * `stripStaleHandles` removes `signature` and `encrypted` from everything written before a
	 * mid-conversation model switch, leaving exactly the id-less shape above. Before this, switching
	 * models on a relay-backed session silently emptied the reasoning out of the history and the
	 * next turn was rejected — the switch looked like the cause, the encoder was.
	 */
	const input = toResponsesInput([user, assistant([{ type: "thinking", thinking: "旧模型想的" }])]);

	assert.equal(reasoning(input).length, 1);
	assert.deepEqual(reasoning(input)[0].content, [{ type: "reasoning_text", text: "旧模型想的" }]);
});

test("reasoning keeps its place among the other blocks of the turn", () => {
	// Order is the transcript's own; a reasoning item that floats away from the text it preceded
	// reads to the model as thinking about something else.
	const input = toResponsesInput([
		user,
		assistant([
			{ type: "thinking", thinking: "先列目录" },
			{ type: "toolCall", id: "call_1", name: "bash", arguments: {}, argumentsText: "{}" },
		]),
	]);

	assert.deepEqual(
		input.map((item) => (item as { type: string }).type),
		["message", "reasoning", "function_call"],
	);
});
