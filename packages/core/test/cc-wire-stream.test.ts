/**
 * Chat Completions 链的入站解码：推理字段名、累积快照、finish_reason、断流、泄漏 token。
 *
 * 每个 SSE fixture 都是端点真实发出来的形状——`id` / `object` / `created` / `model` 一个不少，推理和
 * 文本按真实端点的粒度分片。这些 bug 全都出在「某一家的分片方式和我们假设的不一样」上，用简化过的帧
 * 测不出来。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mapFinishReason, openaiChatCompletionsProvider, reasoningFromDelta, resetChatCompletionsCompat, stripDeepseekTokens, trailingPartialDeepseekToken } from "../src/ai/openai-chat-completions.ts";
import { resetReasoningCompat } from "../src/ai/reasoning-compat.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig, StreamEvent, ThinkingContent } from "../src/types.ts";

const provider: ProviderConfig = {
	id: "relay",
	name: "中转",
	baseUrl: "https://relay.example.com",
	api: "openai-chat-completions",
	apiKey: "sk-test",
	enabled: true,
	models: [],
};

const model: ModelConfig = {
	id: "relay/m",
	providerId: "relay",
	modelId: "m",
	name: "M",
	contextWindow: 128_000,
	maxOutputTokens: 4_096,
	supportsThinking: true,
	supportsImages: false,
	supportsTools: true,
};

/** 一个 chunk，按真实端点的字段齐备度写。 */
function chunk(delta: Record<string, unknown>, finish: string | null = null): string {
	return `data: ${JSON.stringify({
		id: "chatcmpl-CkT2vXm9QsLdRp7Bn",
		object: "chat.completion.chunk",
		created: 1_757_600_123,
		model: "m",
		choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
	})}`;
}

function sse(...frames: string[]): string {
	return `${frames.join("\n\n")}\n\n`;
}

interface Ran {
	done: AssistantMessage | null;
	failed: AssistantMessage | null;
	events: StreamEvent[];
}

async function run(payload: string, overrides: Partial<ModelConfig> = {}): Promise<Ran> {
	resetChatCompletionsCompat();
	resetReasoningCompat();
	const events: StreamEvent[] = [];
	let done: AssistantMessage | null = null;
	let failed: AssistantMessage | null = null;
	for await (const event of openaiChatCompletionsProvider.stream(
		{ ...provider },
		{ ...model, ...overrides },
		{ systemPrompt: "", messages: [{ role: "user", content: [{ type: "text", text: "在吗" }], timestamp: 1 }], tools: [] },
		{
			retryAttempts: 1,
			fetch: async () => new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } }),
		},
	)) {
		events.push(event);
		if (event.type === "done") done = event.message;
		if (event.type === "error") failed = event.message;
	}
	return { done, failed, events };
}

const thinkingOf = (message: AssistantMessage): ThinkingContent | undefined =>
	message.content.find((c): c is ThinkingContent => c.type === "thinking");

const textOf = (message: AssistantMessage): string =>
	message.content.filter((c) => c.type === "text").map((c) => (c.type === "text" ? c.text : "")).join("");

// ---------------------------------------------------------------------------
// P0-3 推理挂在三个键之一上
// ---------------------------------------------------------------------------

test("CC：reasoning_content 照旧能读到，字段名记在块上", async () => {
	const { done } = await run(sse(
		chunk({ role: "assistant", content: "" }),
		chunk({ reasoning_content: "先看一下文件。" }),
		chunk({ content: "看完了。" }),
		chunk({}, "stop"),
		"data: [DONE]",
	));
	assert.equal(thinkingOf(done!)?.thinking, "先看一下文件。");
	assert.equal(thinkingOf(done!)?.reasoningField, "reasoning_content");
});

test("CC：OpenRouter 的 delta.reasoning 也能读到——从前这里一个思考字都没有", async () => {
	const { done, events } = await run(sse(
		chunk({ role: "assistant", content: "" }),
		chunk({ reasoning: "用户问的是" }),
		chunk({ reasoning: "一个很短的问题。" }),
		chunk({ content: "在。" }),
		chunk({}, "stop"),
		"data: [DONE]",
	));
	assert.equal(thinkingOf(done!)?.thinking, "用户问的是一个很短的问题。");
	assert.equal(thinkingOf(done!)?.reasoningField, "reasoning");
	assert.equal(textOf(done!), "在。");
	// 界面靠这几个事件画思考块，不只是靠最后那条消息。
	assert.equal(events.filter((e) => e.type === "thinking_delta").length, 2);
	assert.equal(events.filter((e) => e.type === "thinking_start").length, 1);
	assert.equal(events.filter((e) => e.type === "thinking_end").length, 1);
});

test("CC：delta.reasoning_text 也读", async () => {
	const { done } = await run(sse(
		chunk({ reasoning_text: "想一下。" }),
		chunk({ content: "好。" }),
		chunk({}, "stop"),
		"data: [DONE]",
	));
	assert.equal(thinkingOf(done!)?.thinking, "想一下。");
	assert.equal(thinkingOf(done!)?.reasoningField, "reasoning_text");
});

test("CC：同一个 chunk 里挂了两个别名时只取第一个，不拼成两份", () => {
	const found = reasoningFromDelta({ reasoning_content: "一份", reasoning: "一份", role: "assistant" });
	assert.deepEqual(found, { field: "reasoning_content", text: "一份" });
	// 空串不算，`reasoning` 是对象时也不算（OpenRouter 的 reasoning_details 是数组，不是推理文本）。
	assert.deepEqual(reasoningFromDelta({ reasoning_content: "", reasoning: "真的在这" }), { field: "reasoning", text: "真的在这" });
	assert.equal(reasoningFromDelta({ reasoning: [{ type: "reasoning.text" }] }), undefined);
	assert.equal(reasoningFromDelta({ content: "没有推理" }), undefined);
});

// ---------------------------------------------------------------------------
// P2-9 累积式 reasoning delta
// ---------------------------------------------------------------------------

test("CC：全量快照式的推理 delta 被削成差量，不拼成 O(n²)", async () => {
	// MiniMax 的形状：每个 chunk 都是从头开始的完整快照。
	const { done, events } = await run(sse(
		chunk({ role: "assistant", content: "" }),
		chunk({ reasoning_content: "用户要我" }),
		chunk({ reasoning_content: "用户要我读一个文件，" }),
		chunk({ reasoning_content: "用户要我读一个文件，先看它在不在。" }),
		chunk({ content: "在的。" }),
		chunk({}, "stop"),
		"data: [DONE]",
	));
	assert.equal(thinkingOf(done!)?.thinking, "用户要我读一个文件，先看它在不在。");
	const deltas = events.filter((e) => e.type === "thinking_delta").map((e) => (e as { delta: string }).delta);
	assert.deepEqual(deltas, ["用户要我", "读一个文件，", "先看它在不在。"]);
});

test("CC：增量式的推理 delta 一个字都不削——包括恰好重复的那一帧", async () => {
	/*
	 * 这一条守的是启发式的误判边界。
	 *
	 * 第三帧「的」和已攒文本的开头不同，所以不会命中前缀判断；第四帧整句等于已攒文本（长度相等），
	 * 也不能当快照——长度相等的重复在增量流里是可能的，要求严格更长就是为了挡住它。
	 */
	const { done } = await run(sse(
		chunk({ reasoning_content: "嗯" }),
		chunk({ reasoning_content: "嗯" }),
		chunk({ reasoning_content: "，好" }),
		chunk({ content: "好。" }),
		chunk({}, "stop"),
		"data: [DONE]",
	));
	assert.equal(thinkingOf(done!)?.thinking, "嗯嗯，好");
});

test("CC：定性成快照之后，对不上前缀的那一帧照旧当增量追加", async () => {
	const { done } = await run(sse(
		chunk({ reasoning_content: "第一步：" }),
		chunk({ reasoning_content: "第一步：读文件。" }),
		// 快照流里换了段（有的端点在 `</think>` 之后重开一段），前缀对不上——不能丢掉它。
		chunk({ reasoning_content: "第二步：改文件。" }),
		chunk({ content: "改好了。" }),
		chunk({}, "stop"),
		"data: [DONE]",
	));
	assert.equal(thinkingOf(done!)?.thinking, "第一步：读文件。第二步：改文件。");
});

// ---------------------------------------------------------------------------
// P2-10 finish_reason
// ---------------------------------------------------------------------------

test("CC：finish_reason 的映射表", () => {
	assert.deepEqual(mapFinishReason("stop"), { stopReason: "stop" });
	assert.deepEqual(mapFinishReason("end"), { stopReason: "stop" });
	// Gemini 后端的网关发大写。
	assert.deepEqual(mapFinishReason("STOP"), { stopReason: "stop" });
	assert.deepEqual(mapFinishReason("MAX_TOKENS"), { stopReason: "length" });
	assert.deepEqual(mapFinishReason("length"), { stopReason: "length" });
	assert.deepEqual(mapFinishReason("tool_calls"), { stopReason: "toolUse" });
	assert.deepEqual(mapFinishReason("function_call"), { stopReason: "toolUse" });
	for (const bad of ["error", "network_error", "content_filter", "insufficient_system_resource", "something_new"]) {
		const mapped = mapFinishReason(bad);
		assert.equal(mapped.stopReason, undefined, bad);
		assert.ok(mapped.error, bad);
	}
});

test("CC：finish_reason: error 是失败，而且是可重试的失败——不是把半截答案当成功交出去", async () => {
	const { done, failed } = await run(sse(
		chunk({ role: "assistant", content: "" }),
		chunk({ content: "我先读一下这个文" }),
		chunk({}, "error"),
		"data: [DONE]",
	));
	assert.equal(done, null, "不能以 done 收场");
	assert.ok(failed);
	assert.equal(failed.stopReason, "error");
	assert.equal(failed.errorRetryable, true);
	assert.equal(failed.failure?.kind, "upstream");
	// 已经吐过字，服务商收过钱了——这一点要说出来。
	assert.equal(failed.failure?.costIncurred, true);
});

test("CC：insufficient_system_resource 也是可重试的失败", async () => {
	const { failed } = await run(sse(
		chunk({ content: "开始" }),
		chunk({}, "insufficient_system_resource"),
		"data: [DONE]",
	));
	assert.equal(failed?.stopReason, "error");
	assert.equal(failed?.errorRetryable, true);
});

test("CC：content_filter 是终局失败，重试一百次也是同一个策略", async () => {
	const { failed } = await run(sse(
		chunk({ content: "这" }),
		chunk({}, "content_filter"),
		"data: [DONE]",
	));
	assert.equal(failed?.stopReason, "error");
	assert.equal(failed?.errorRetryable, false);
	assert.equal(failed?.failure?.kind, "fatal");
});

test("CC：没见过的 finish_reason 一律当失败，原话带在错误里", async () => {
	const { done, failed } = await run(sse(
		chunk({ content: "半句" }),
		chunk({}, "model_length"),
		"data: [DONE]",
	));
	assert.equal(done, null);
	assert.match(failed?.errorMessage ?? "", /model_length/);
	assert.equal(failed?.errorRetryable, true);
});

test("CC：大写的 STOP 不能被当成失败", async () => {
	const { done, failed } = await run(sse(
		chunk({ content: "说完了。" }),
		chunk({}, "STOP"),
		"data: [DONE]",
	));
	assert.equal(failed, null);
	assert.equal(done?.stopReason, "stop");
	assert.equal(textOf(done!), "说完了。");
});

// ---------------------------------------------------------------------------
// P2-11 流提前断开
// ---------------------------------------------------------------------------

test("CC：有内容、没 finish_reason、没 [DONE]——这是断了，报可重试的失败", async () => {
	const { done, failed } = await run(sse(
		chunk({ role: "assistant", content: "" }),
		chunk({ content: "我正在说一句很长的话，说到这里就" }),
	));
	assert.equal(done, null, "无声截断是这条改动要消灭的东西");
	assert.equal(failed?.stopReason, "error");
	assert.equal(failed?.errorRetryable, true);
	assert.equal(failed?.failure?.kind, "upstream");
});

test("CC：只靠 [DONE] 收尾的宿主不能被误判成截断", async () => {
	// 这类宿主压根不发 finish_reason。误判它们等于每一轮都白重试一次。
	const { done, failed } = await run(sse(
		chunk({ role: "assistant", content: "" }),
		chunk({ content: "说完了。" }),
		"data: [DONE]",
	));
	assert.equal(failed, null);
	assert.equal(done?.stopReason, "stop");
	assert.equal(textOf(done!), "说完了。");
});

test("CC：发了 finish_reason 但没发 [DONE] 的宿主也不算截断", async () => {
	const { done, failed } = await run(sse(
		chunk({ content: "说完了。" }),
		chunk({}, "stop"),
	));
	assert.equal(failed, null);
	assert.equal(done?.stopReason, "stop");
});

test("CC：一个字都没有的空流仍然走空回答那条路，错误信息说得更准", async () => {
	const { done, failed } = await run(sse(chunk({ role: "assistant", content: "" })));
	assert.equal(done, null);
	assert.match(failed?.errorMessage ?? "", /空回答/);
});

// ---------------------------------------------------------------------------
// P2-13 DeepSeek 特殊 token 泄漏
// ---------------------------------------------------------------------------

test("CC：泄漏的特殊 token 不进可见文本", async () => {
	const { done } = await run(sse(
		chunk({ role: "assistant", content: "" }),
		chunk({ content: "我来读一下。<｜tool▁calls▁begin｜>" }),
		chunk({ content: "读完了。" }),
		chunk({}, "stop"),
		"data: [DONE]",
	));
	assert.equal(textOf(done!), "我来读一下。读完了。");
});

test("CC：被 SSE 切成两半的 token 也能剥掉", async () => {
	// 一个 token 横跨两个 chunk 的时候，两半单独看都不匹配任何正则。
	const { done, events } = await run(sse(
		chunk({ content: "先看文件。<｜tool▁ca" }),
		chunk({ content: "lls▁begin｜>然后改它。" }),
		chunk({}, "stop"),
		"data: [DONE]",
	));
	assert.equal(textOf(done!), "先看文件。然后改它。");
	// 扣下来的那截不能凭空丢掉，也不能提前发出去。
	const deltas = events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta);
	assert.equal(deltas.join(""), "先看文件。然后改它。");
});

test("CC：正常文本里的尖括号一个字都不能少", async () => {
	const { done } = await run(sse(
		chunk({ content: "写个标签：<div class=\"x\">" }),
		chunk({ content: "</div>，还有 a < b 和 1 <" }),
		chunk({ content: " 2。" }),
		chunk({}, "stop"),
		"data: [DONE]",
	));
	assert.equal(textOf(done!), "写个标签：<div class=\"x\"></div>，还有 a < b 和 1 < 2。");
});

test("CC：末尾扣着的那截在流结束时吐出来", async () => {
	const { done } = await run(sse(
		chunk({ content: "泛型写成 Vec<" }),
		chunk({}, "stop"),
		"data: [DONE]",
	));
	assert.equal(textOf(done!), "泛型写成 Vec<");
});

test("CC：只有一个泄漏 token 的 chunk 不该开出一个空文本块，也不该把思考提前关掉", async () => {
	const { done, events } = await run(sse(
		chunk({ reasoning_content: "想一下。" }),
		chunk({ content: "<｜end▁of▁sentence｜>" }),
		chunk({ reasoning_content: "再想一下。" }),
		chunk({ content: "好了。" }),
		chunk({}, "stop"),
		"data: [DONE]",
	));
	assert.equal(thinkingOf(done!)?.thinking, "想一下。再想一下。");
	assert.equal(textOf(done!), "好了。");
	assert.equal(events.filter((e) => e.type === "text_start").length, 1);
	assert.equal(events.filter((e) => e.type === "thinking_start").length, 1);
});

test("CC：扣着的文本在工具调用开始前吐掉，不会被搬到调用后面", async () => {
	const { done } = await run(sse(
		chunk({ content: "先算一下 1 <" }),
		chunk({ tool_calls: [{ index: 0, id: "call_9xKpLm2Q", type: "function", function: { name: "bash", arguments: "" } }] }),
		chunk({ tool_calls: [{ index: 0, function: { arguments: "{\"cmd\":\"echo hi\"}" } }] }),
		chunk({}, "tool_calls"),
		"data: [DONE]",
	));
	assert.equal(done?.stopReason, "toolUse");
	assert.deepEqual(done!.content.map((c) => c.type), ["text", "toolCall"]);
	assert.equal(textOf(done!), "先算一下 1 <");
});

test("CC：剥离和扣留的两个纯函数", () => {
	assert.equal(stripDeepseekTokens("答案是 42"), "答案是 42");
	assert.equal(stripDeepseekTokens("<｜tool▁calls▁begin｜>答案是 42"), "答案是 42");
	assert.equal(stripDeepseekTokens("答案是 42<|end_of_sentence|>"), "答案是 42");
	assert.equal(stripDeepseekTokens("<div>a < b</div>"), "<div>a < b</div>");
	assert.equal(trailingPartialDeepseekToken("正文 <｜tool▁ca"), "<｜tool▁ca");
	assert.equal(trailingPartialDeepseekToken("正文 <｜done｜>"), "");
	assert.equal(trailingPartialDeepseekToken("一行以尖括号结尾 <"), "<");
	assert.equal(trailingPartialDeepseekToken("<div>普通文本</div>"), "");
	// 正文里一个孤零零的 `<｜` 不能让缓冲无限长。
	assert.equal(trailingPartialDeepseekToken(`<｜${"x".repeat(400)}`), "");
});
