/**
 * Anthropic Messages 链上「流断在半路」的判定。
 *
 * 两条 OpenAI 链各自修过这件事（`openai-chat-completions.ts` 的 `sawFinish`/`sawDone`、
 * `openai-responses.ts` 的 `settled`），这条一直没有。缺的后果不是少几个字：`mapStopReason` 在
 * 没有 `stop_reason` 时落到 `"stop"`，于是一个半截的回答带着「模型说完了」交给 loop——该发生的
 * 重发不会发生，而半截的 `toolCall` 参数照样会被收下。
 *
 * 判据是**两个收尾信号都没有**才算断，所以这里既测断的那一侧，也测两种只发一个信号的中转——
 * 那两种如果被判成断，每一轮都会白重发一次。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { anthropicMessagesProvider } from "../src/ai/anthropic-messages.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig } from "../src/types.ts";

const model: ModelConfig = {
	id: "qa/claude", providerId: "qa", modelId: "claude-test", name: "Claude Test",
	contextWindow: 200_000, maxOutputTokens: 8192, supportsThinking: true, supportsImages: true, supportsTools: true,
};

const provider: ProviderConfig = {
	id: "qa", name: "QA", api: "anthropic-messages", baseUrl: "https://api.example.test", apiKey: "k", enabled: true, models: [model],
};

const frame = (type: string, rest: Record<string, unknown> = {}) =>
	`event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`;

/** 一段说到一半的回答：开了块、吐了字、收了块，然后什么都没有了。 */
const HALF = [
	frame("message_start", { message: { id: "msg_01", usage: { input_tokens: 31, output_tokens: 1 } } }),
	frame("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
	frame("content_block_delta", { index: 0, delta: { type: "text_delta", text: "答案的前半截" } }),
	frame("content_block_stop", { index: 0 }),
];

/** 同一段，正常收尾。 */
const WHOLE = [
	...HALF.slice(0, 3),
	frame("content_block_delta", { index: 0, delta: { type: "text_delta", text: "和后半截" } }),
	frame("content_block_stop", { index: 0 }),
	frame("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } }),
	frame("message_stop"),
];

const sse = (frames: string[]) =>
	new Response(frames.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });

/** 把一条流跑到底，返回最后那条消息和 fetch 被调用了几次。 */
async function run(replies: string[][], retryAttempts = 1) {
	let calls = 0;
	const stream = anthropicMessagesProvider.stream(provider, model, { messages: [{ role: "user", content: [{ type: "text", text: "问一句" }], timestamp: 1 }], tools: [] }, {
		retryAttempts,
		fetch: async () => sse(replies[Math.min(calls++, replies.length - 1)]),
	});
	let last: AssistantMessage | undefined;
	for await (const event of stream) {
		if (event.type === "done" || event.type === "error") last = event.message;
	}
	return { message: last!, calls };
}

const textOf = (message: AssistantMessage) =>
	message.content.map((block) => (block.type === "text" ? block.text : "")).join("");

test("说到一半就断的流不会被当成说完了", async () => {
	const { message } = await run([HALF]);
	assert.equal(message.stopReason, "error", `半截被当成了 ${message.stopReason}`);
	assert.match(String(message.errorMessage), /一半/);
});

test("断了是可以重发的，重发之后拿到的是完整那次，不是两次拼起来", async () => {
	const { message, calls } = await run([HALF, WHOLE], 3);
	assert.equal(calls, 2, "第一次断了就该再问一次");
	assert.equal(message.stopReason, "stop");
	// 前半截在重试里被 `reset` 清掉；没清的话这里会是「答案的前半截答案的前半截和后半截」。
	assert.equal(textOf(message), "答案的前半截和后半截");
});

test("正常收尾的流一个字节都不受影响", async () => {
	const { message, calls } = await run([WHOLE]);
	assert.equal(calls, 1);
	assert.equal(message.stopReason, "stop");
	assert.equal(textOf(message), "答案的前半截和后半截");
});

/*
 * 下面两条是判据里「两个都没有」那个 and 的理由。
 *
 * 官方两个信号都发，中转不一定。只认其中一个的话，凡是少发那个的中转，每一轮都会被判成截断然后
 * 白重发一次——用户看到的是慢一倍和贵一倍，而不是一条错误。
 */
test("只发 message_delta、不发 message_stop 的中转，不算断", async () => {
	const { message, calls } = await run([WHOLE.slice(0, -1)]);
	assert.equal(calls, 1, "这是正常结束，不该重发");
	assert.equal(message.stopReason, "stop");
});

test("只发 message_stop、不带 stop_reason 的中转，也不算断", async () => {
	const { message, calls } = await run([[...WHOLE.slice(0, -2), frame("message_stop")]]);
	assert.equal(calls, 1);
	assert.equal(message.stopReason, "stop");
});

test("什么内容都没有的流仍然走空回答，原因说的是空回答", async () => {
	// 截断那条要求 `content.length > 0`，否则这里会被它抢走，而它的话说得没有空回答准。
	const { message } = await run([[frame("message_start", { message: { id: "msg_02", usage: {} } })]]);
	assert.equal(message.stopReason, "error");
	assert.ok(!/一半/.test(String(message.errorMessage)), `空回答被说成了截断: ${message.errorMessage}`);
});
