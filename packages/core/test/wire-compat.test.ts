/**
 * 三条协议链上那些「端点会因此拒收整个请求」的形状。
 *
 * 每一条都对应一次真实端点复现，错误原文写在各自的测试名里。这类问题的共同点是：历史本身就是请求，
 * 所以一旦某一轮编出了坏形状，那个会话之后**每一轮**都会用同样的方式失败，重试和切回去都救不了。
 * 单元测试守的就是这个——形状错了要在这里响，而不是等到用户的会话再也说不了话。
 *
 * 审计过程和证据：`docs/2026-09-10-wire-protocol-compat-audit.md`。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { toAnthropicMessages } from "../src/ai/anthropic-messages-request.ts";
import { toChatCompletionsMessages } from "../src/ai/openai-chat-completions-request.ts";
import { toResponsesInput } from "../src/ai/openai-responses-request.ts";
import { joinUrl } from "../src/ai/anthropic-messages.ts";
import { sanitizeToolPairing } from "../src/ai/sanitize-history.ts";
import { argumentFragment } from "../src/utils/sse.ts";
import { learnReasoningReplay, reasoningReplay, resetReasoningCompat } from "../src/ai/reasoning-compat.ts";
import type { Message } from "../src/types.ts";

/** 一轮「想过 → 调了工具 → 拿到结果」，三条链共用。 */
function turn(overrides: { signature?: string; encrypted?: string; callId?: string } = {}): Message[] {
	const { signature, encrypted, callId = "call_1" } = overrides;
	return [
		{ role: "user", content: [{ type: "text", text: "算 1+1" }], timestamp: 1 },
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "这是个纯算术问题。", ...(signature ? { signature } : {}), ...(encrypted ? { encrypted } : {}) },
				{ type: "toolCall", id: callId, name: "calc", arguments: { expr: "1+1" } },
			],
			api: "openai-responses", provider: "qa", model: "m",
			usage: { input: 0, output: 0 }, stopReason: "toolUse", timestamp: 2,
		},
		{ role: "toolResult", toolCallId: callId, toolName: "calc", content: [{ type: "text", text: "2" }], isError: false, timestamp: 3 },
	] as Message[];
}

test("Chat Completions 把思考原样带回去：DeepSeek 系推理模型要求它，缺了整条链没救", () => {
	// 复现原文：The `reasoning_content` in the thinking mode must be passed back to the API.
	const out = toChatCompletionsMessages("", turn()) as Array<Record<string, unknown>>;
	const assistant = out.find((m) => m.role === "assistant");
	assert.ok(assistant, "助手轮应该在");
	assert.equal(assistant.reasoning_content, "这是个纯算术问题。");
	// 工具调用没被这次改动挤掉。
	assert.equal((assistant.tool_calls as unknown[]).length, 1);
});

test("Chat Completions 没有思考时不编一段出来", () => {
	const history: Message[] = [
		{ role: "user", content: [{ type: "text", text: "你好" }], timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "你好" }], api: "openai-chat-completions", provider: "qa", model: "m",
			usage: { input: 0, output: 0 }, stopReason: "endTurn", timestamp: 2 },
	] as Message[];
	const assistant = (toChatCompletionsMessages("", history) as Array<Record<string, unknown>>).find((m) => m.role === "assistant");
	assert.ok(assistant && !("reasoning_content" in assistant), "手上没有的东西不该凭空补一段");
});

test("Chat Completions 的地址带 /v1，和另外两条链一样", () => {
	// 实测：https://api.openai.com/chat/completions → 404；/v1/chat/completions → 401（路由在）。
	assert.equal(joinUrl("https://api.openai.com", "/v1/chat/completions"), "https://api.openai.com/v1/chat/completions");
	// baseUrl 自己带了 /v1 的不能拼出两个。
	assert.equal(joinUrl("https://api.openai.com/v1", "/v1/chat/completions"), "https://api.openai.com/v1/chat/completions");
	assert.equal(joinUrl("https://api.openai.com/v1/", "/v1/chat/completions"), "https://api.openai.com/v1/chat/completions");
});

test("Responses：有 item id 但没有密文时，思考进 content.reasoning_text", () => {
	// 复现原文：The `reasoning_text` in the thinking mode must be passed back to the API.
	// `summary` 是对推理的概括，要求原样回放的上游不接受它顶替。
	const [item] = toResponsesInput(turn({ signature: "rs_abc" }), { provider: "qa", model: "m" }).slice(1) as Array<Record<string, unknown>>;
	assert.equal(item.type, "reasoning");
	assert.equal(item.id, "rs_abc");
	assert.deepEqual(item.content, [{ type: "reasoning_text", text: "这是个纯算术问题。" }]);
	assert.deepEqual(item.summary, [{ type: "summary_text", text: "这是个纯算术问题。" }]);
});

test("Responses：有密文时不动——那条路本来就是通的", () => {
	const [item] = toResponsesInput(turn({ signature: "rs_abc", encrypted: "ENC" }), { provider: "qa", model: "m" }).slice(1) as Array<Record<string, unknown>>;
	assert.equal(item.encrypted_content, "ENC");
	assert.ok(!("content" in item), "密文已经是可回放的那一份，不必再塞一遍文本");
});

test("Anthropic：中转风格的工具 id 改写成合规的，调用和结果换成同一个", () => {
	// 复现原文：messages.1.content.0.tool_use.id: String should match pattern '^[a-zA-Z0-9_-]+$'
	const out = toAnthropicMessages(sanitizeToolPairing(turn({ callId: "bash:0" })));
	const use = out.flatMap((m) => m.content).find((b) => b.type === "tool_use");
	const result = out.flatMap((m) => m.content).find((b) => b.type === "tool_result");
	assert.equal(use?.id, "bash_0");
	assert.equal(result?.tool_use_id, "bash_0", "配对断了换来的是另一个 400");
	assert.match(String(use?.id), /^[a-zA-Z0-9_-]+$/);
});

test("Anthropic：合规的 id 原样不动", () => {
	const out = toAnthropicMessages(sanitizeToolPairing(turn({ callId: "toolu_01ABC" })));
	const use = out.flatMap((m) => m.content).find((b) => b.type === "tool_use");
	assert.equal(use?.id, "toolu_01ABC");
});

test("端点说「不收推理」之后，下一份请求体里一个推理项都没有", () => {
	resetReasoningCompat();
	const history = turn({ signature: "rs_abc" });
	const before = toResponsesInput(history, { provider: "qa", model: "m" });
	assert.ok(before.some((i) => (i as { type?: string }).type === "reasoning"), "默认是回放");

	// 中转把 Responses 转译成别的协议时的原话，四种推理形状都会撞上它。它一格一格往下走：
	// 先只发带句柄的（这一段本来就没有句柄，等于全不发），还被拒就一个都不发。
	const said = "Expected a(n) 'messages' array element to be an object.";
	assert.equal(learnReasoningReplay("qa", "m", said), true, "第一次撞上要学到东西");
	assert.equal(reasoningReplay("qa", "m"), "handled");
	assert.equal(learnReasoningReplay("qa", "m", said), true, "还被拒就再往下一格");
	assert.equal(reasoningReplay("qa", "m"), "omit");

	const after = toResponsesInput(history, { provider: "qa", model: "m" }, reasoningReplay("qa", "m"));
	assert.ok(!after.some((i) => (i as { type?: string }).type === "reasoning"), "学过之后一个都不该发");
	// 工具历史照旧——实测删掉推理项之后，同一段工具历史是能过的。
	assert.equal(after.filter((i) => (i as { type?: string }).type === "function_call").length, 1);
	assert.equal(after.filter((i) => (i as { type?: string }).type === "function_call_output").length, 1);
});

test("端点说「推理得带签名」之后，只发带句柄的那些", () => {
	resetReasoningCompat();
	// 中转把 Responses 翻成 Anthropic 时的原话，剥过句柄的思考块必然撞上。
	assert.equal(learnReasoningReplay("qa", "m", "messages.1.content.0.thinking.signature: Field required"), true);
	assert.equal(reasoningReplay("qa", "m"), "handled");

	const stripped = toResponsesInput(turn(), { provider: "qa", model: "m" }, "handled");
	assert.ok(!stripped.some((i) => (i as { type?: string }).type === "reasoning"), "没有句柄的那块不发");

	// 带句柄的照常发——Claude 自己那几轮的思维链不该被这一档连累。
	const signed = toResponsesInput(turn({ signature: "rs_abc" }), { provider: "qa", model: "m" }, "handled");
	assert.ok(signed.some((i) => (i as { type?: string }).type === "reasoning"), "带句柄的还得发");
});

test("补上 summary：只给 content 时中转翻译不出文本", () => {
	// 实测：summary 空 + content → thinking.thinking: Field required；两个都给 → 换成 signature 那条。
	const [item] = toResponsesInput(turn(), { provider: "qa", model: "m" }).slice(1) as Array<Record<string, unknown>>;
	assert.equal(item.type, "reasoning");
	assert.deepEqual(item.summary, [{ type: "summary_text", text: "这是个纯算术问题。" }]);
	assert.deepEqual(item.content, [{ type: "reasoning_text", text: "这是个纯算术问题。" }]);
});

test("梯子一格一格往下走，走到底就不再重发", () => {
	resetReasoningCompat();
	const said = "messages.1.content.0.thinking.signature: Field required";
	assert.equal(learnReasoningReplay("qa", "m", said), true);
	assert.equal(reasoningReplay("qa", "m"), "handled");
	assert.equal(learnReasoningReplay("qa", "m", "Expected a(n) 'messages' array element to be an object."), true);
	assert.equal(reasoningReplay("qa", "m"), "omit");
	assert.equal(learnReasoningReplay("qa", "m", said), false, "最底下没有格子了，别再花一次钱");
});

test("「必须带回来」把梯子一次拉回顶格", () => {
	resetReasoningCompat();
	const rejected = "Expected a(n) 'messages' array element to be an object.";
	// 一步走一格，走到底。
	learnReasoningReplay("qa", "m", rejected);
	learnReasoningReplay("qa", "m", rejected);
	assert.equal(reasoningReplay("qa", "m"), "omit");
	assert.equal(learnReasoningReplay("qa", "m", "The `reasoning_text` in the thinking mode must be passed back to the API."), true);
	assert.equal(reasoningReplay("qa", "m"), "replay");
});

test("端点说「必须带回来」之后，Chat 那边把思考发回去", () => {
	resetReasoningCompat();
	// 先掉到底下去，才看得出这条信号真的把它拉了回来。
	learnReasoningReplay("qa", "m", "Expected a(n) 'messages' array element to be an object.");
	learnReasoningReplay("qa", "m", "Expected a(n) 'messages' array element to be an object.");
	assert.equal(reasoningReplay("qa", "m"), "omit");
	assert.equal(learnReasoningReplay("qa", "m", "The `reasoning_content` in the thinking mode must be passed back to the API."), true);
	assert.equal(reasoningReplay("qa", "m"), "replay");
	const assistant = (toChatCompletionsMessages("", turn(), "replay") as Array<Record<string, unknown>>).find((m) => m.role === "assistant");
	assert.equal(assistant?.reasoning_content, "这是个纯算术问题。");
});

test("已经在顶格时「必须带回来」不引发重发", () => {
	resetReasoningCompat();
	const said = "The `reasoning_text` in the thinking mode must be passed back to the API.";
	// 默认就是顶格，发的已经是它要的那一份——这次 400 的原因在别处，重发只是多烧一次钱。
	assert.equal(learnReasoningReplay("qa", "m", said), false);
	assert.equal(reasoningReplay("qa", "m"), "replay");
});

test("认不出来的 400 不动结论——改坏了的请求比原样发出去更糟", () => {
	resetReasoningCompat();
	for (const said of [
		"You exceeded your current quota",
		"model_not_found",
		"context_length_exceeded: 200000 tokens",
		"messages.1.content.0.tool_use.id: String should match pattern",
	]) {
		assert.equal(learnReasoningReplay("qa", "m", said), false, said);
	}
	assert.equal(reasoningReplay("qa", "m"), "replay");
});

test("结论是按模型记的，不会串到别的模型上", () => {
	resetReasoningCompat();
	learnReasoningReplay("qa", "picky", "Expected a(n) 'messages' array element to be an object.");
	assert.equal(reasoningReplay("qa", "picky"), "handled");
	assert.equal(reasoningReplay("qa", "other"), "replay");
	assert.equal(reasoningReplay("other-provider", "picky"), "replay");
});

test("工具参数是对象时不会变成 [object Object]", () => {
	// 真实端点上量到过：deepseek-v4-flash:0731 经中转走 Chat，第二轮上游报
	// 「Value looks like object, but can't find closing」——那是它在解析我们发过去的那串字面量。
	assert.equal(argumentFragment({ expr: "1+1" }), '{"expr":"1+1"}');
	assert.equal(argumentFragment('{"expr":'), '{"expr":');
	assert.equal(argumentFragment(undefined), "");
	// 数字、布尔不是参数分片，接上去只会污染缓冲区。
	assert.equal(argumentFragment(42), "");
	// 循环引用不该把整轮对话炸掉。
	const loop: Record<string, unknown> = {};
	loop.self = loop;
	assert.equal(argumentFragment(loop), "");
});

test("Anthropic：改写撞车时两个调用不会被并成一个", () => {
	// `bash:0` 会变成 `bash_0`，而 `bash_0` 已经被另一个调用占了——两个工具结果认领同一次调用是最难查的那种坏。
	const history: Message[] = [
		{ role: "user", content: [{ type: "text", text: "跑两个" }], timestamp: 1 },
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "bash_0", name: "calc", arguments: {} },
				{ type: "toolCall", id: "bash:0", name: "calc", arguments: {} },
			],
			api: "openai-responses", provider: "qa", model: "m",
			usage: { input: 0, output: 0 }, stopReason: "toolUse", timestamp: 2,
		},
		{ role: "toolResult", toolCallId: "bash_0", toolName: "calc", content: [{ type: "text", text: "甲" }], isError: false, timestamp: 3 },
		{ role: "toolResult", toolCallId: "bash:0", toolName: "calc", content: [{ type: "text", text: "乙" }], isError: false, timestamp: 4 },
	] as Message[];
	const blocks = toAnthropicMessages(sanitizeToolPairing(history)).flatMap((m) => m.content);
	const uses = blocks.filter((b) => b.type === "tool_use").map((b) => String(b.id));
	const results = blocks.filter((b) => b.type === "tool_result").map((b) => String(b.tool_use_id));
	assert.equal(new Set(uses).size, 2, `两次调用要留两个不同的 id，拿到的是 ${JSON.stringify(uses)}`);
	assert.deepEqual([...results].sort(), [...uses].sort(), "每个结果都得能找回自己那次调用");
});
