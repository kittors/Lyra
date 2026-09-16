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
	 * 两个字段都给。
	 *
	 * `content` 是主要的那个：要求原样回放的上游要的是推理本身，`summary` 是对它的概括，顶不了。
	 * 这条原本就是这么写的，`summary` 留了空数组。
	 *
	 * 后来实测发现空着不行。把 Responses 翻译成 Anthropic 的中转只认 `summary`——只给 `content` 时
	 * 它翻出来的是一个没有文本的 thinking 块：
	 *
	 *     messages.1.content.0.thinking.thinking: Field required
	 *
	 * 两个都给不会被任何一边拒（在官方 DeepSeek 上量过），所以两个都给。
	 */
	assert.deepEqual(reasoning(input), [
		{
			type: "reasoning",
			summary: [{ type: "summary_text", text: "用户要我继续，先确认上一步的结果" }],
			content: [{ type: "reasoning_text", text: "用户要我继续，先确认上一步的结果" }],
		},
	]);
});

test("an id-less block keeps its encrypted payload, which is replayable on its own", () => {
	const input = toResponsesInput([user, assistant([{ type: "thinking", thinking: "", encrypted: "gAAAAA" }])]);

	assert.deepEqual(reasoning(input), [{ type: "reasoning", summary: [], encrypted_content: "gAAAAA" }]);
});

test("a block with neither a handle nor any text is still dropped", () => {
	/*
	 * Nothing to send and nothing to resume — that block contributes no reasoning item of its own.
	 *
	 * 这一轮因此没有推理项，于是补位分支给它补了一个（`api.deepseek.com` 要求助手轮以推理项开头）。
	 * 两件事不矛盾，而且要分得开：**原来那块没有被回放**——补出来的这个既没有 id 也没有密文，文本是
	 * 固定的那一句，跟 `""` 的那块无关。
	 */
	const input = toResponsesInput([user, assistant([{ type: "thinking", thinking: "" }, { type: "text", text: "嗯" }])]);

	assert.deepEqual(reasoning(input), [
		{ type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "（自动追加）这一轮没有留下推理记录。" }] },
	]);
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

/*
 * 每个助手轮都要以一个推理项开头——没有可发的就补一个。
 *
 * 这是 2026-09-15 报废一个会话的那条规则。压缩在摘要后面补的那句「Understood. Continuing from that
 * summary.」是一条没有推理的助手消息，而 `api.deepseek.com` 在思考模式下不收这种助手轮，它对此只有
 * 一句话可说——正是文件头那句点名 `reasoning_text` 的话。
 *
 * 真实端点上分离过（`~/.lyra/scratch/deepseek-compaction-400.txt`）：那条助手消息原样留着 400，前面
 * 插一个合成推理项 200，改成 user 200，整条删掉 200；而推理项带不带 `content.reasoning_text`，两种
 * 都是 400。所以这一组测试盯的是**位置**，不是那个字段——盯错了一次，代价是一整天。
 */
test("a turn with no reasoning of its own still opens with a reasoning item", () => {
	const input = toResponsesInput([
		{ role: "user", content: [{ type: "text", text: "<session-summary>…</session-summary>" }], timestamp: 0, synthetic: true },
		assistant([{ type: "text", text: "Understood. Continuing from that summary." }]),
	]);

	assert.deepEqual(
		input.map((item) => (item as { type: string }).type),
		// 末尾那条 user 是「历史不能以助手的话收尾」那道闸补的，和这条无关。
		["message", "reasoning", "message", "message"],
		"助手轮前面没有推理项，这份请求会被 400 顶回来，而且重试和切回去都救不了",
	);
	assert.ok(reasoning(input)[0].content?.[0]?.text, "补出来的推理项得有文本，空壳顶不了");
	assert.deepEqual(reasoning(input)[0].summary, [], "补的是文本不是概括，`summary` 留空");
});

test("a tool call with no reasoning before it gets one too", () => {
	// 换过模型、退到 handled 档、或者模型自己想都没想就调工具——路子不同，形状一样。
	const input = toResponsesInput([
		user,
		assistant([{ type: "toolCall", id: "call_1", name: "bash", arguments: {}, argumentsText: "{}" }]),
	]);

	assert.deepEqual(
		input.map((item) => (item as { type: string }).type),
		["message", "reasoning", "function_call"],
	);
});

test("a turn that brought its own reasoning is left alone", () => {
	// 补位只在这一轮一个推理项都没有时发生，真有推理的轮次一个字都不该多。
	const input = toResponsesInput([user, assistant([{ type: "thinking", thinking: "先列目录" }, { type: "text", text: "好" }])]);

	assert.equal(reasoning(input).length, 1);
	assert.deepEqual(reasoning(input)[0].content, [{ type: "reasoning_text", text: "先列目录" }]);
});

test("the ladder's lower rungs are not given a synthetic item to choke on", () => {
	/*
	 * `omit` 的端点一个推理项都不收，`handled` 的只收带得动句柄的，而补出来的这个两样都不是。
	 * 在那两档补等于拿一个必被拒的请求去换另一个。
	 */
	const bare: Message[] = [user, assistant([{ type: "text", text: "好" }])];

	assert.deepEqual(reasoning(toResponsesInput(bare, undefined, "omit")), []);
	assert.deepEqual(reasoning(toResponsesInput(bare, undefined, "handled")), []);
});
