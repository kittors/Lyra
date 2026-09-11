/**
 * 一轮里同时要了两个工具，回到供应商手上时该长什么样。
 *
 * 这个形状不是审美问题，**而且两家的要求正好相反**：
 *
 *   - 把 Responses 翻译成 Chat Completions 的中转要**交错**。它们给每个 `function_call` 造一条独立的
 *     助手消息，而 Chat Completions 要求带 `tool_calls` 的消息后面紧跟回答它的 tool 消息，于是两个调用
 *     连排直接被拒：
 *
 *         an assistant message with 'tool_calls' must be followed by tool messages responding to
 *         each 'tool_call_id'. The following tool_call_ids did not have response messages: bash:0
 *
 *   - `api.deepseek.com` 的 Responses 要**成组**。交错排一律 400，而且它报的是
 *     `The reasoning_text in the thinking mode must be passed back to the API.`——一句跟工具毫无关系
 *     的话，推理项一个都不发时报的还是这句。
 *
 * 这个文件头原来只写了前一条，还附了一句「实测：交错被接受，两个调用连排每次都 400」。那句话对它验过的
 * 那个中转是真的，错在被当成了普适规律——2026-09-11 有两个会话因此报废，而且那句撒谎的错误消息把排查
 * 带偏了三轮。默认值现在是成组，为什么见 `src/ai/tool-pairing-compat.ts` 的文件头。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { toAnthropicMessages } from "../src/ai/anthropic-messages-request.ts";
import { toResponsesInput } from "../src/ai/openai-responses-request.ts";
import { sanitizeChatCompletionsHistory, toChatCompletionsMessages } from "../src/ai/openai-chat-completions-request.ts";
import { learnToolPairing, resetToolPairingCompat, toolPairing } from "../src/ai/tool-pairing-compat.ts";
import { learnReasoningReplay, resetReasoningCompat, withReasoningRetry } from "../src/ai/reasoning-compat.ts";
import type { AssistantMessage, Message, ToolResultMessage } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

function assistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "relay",
		model: "kimi-k3",
		usage: emptyUsage(),
		stopReason: "toolUse",
		timestamp: 1,
	};
}

function call(id: string, name: string): Extract<AssistantMessage["content"][number], { type: "toolCall" }> {
	return { type: "toolCall", id, name, arguments: {}, argumentsText: "{}" };
}

function answer(id: string, text: string): ToolResultMessage {
	return { role: "toolResult", toolCallId: id, toolName: "x", content: [{ type: "text", text }], isError: false, timestamp: 2 };
}

const user: Message = { role: "user", content: [{ type: "text", text: "看看项目" }], timestamp: 0 };

/** Just the parts that decide whether the request is well formed. */
const shape = (input: unknown[]) =>
	input.map((item) => {
		const it = item as { type: string; call_id?: string };
		return it.call_id ? `${it.type}:${it.call_id}` : it.type;
	});

test("默认成组：一轮的所有调用排完，再排所有结果", () => {
	/*
	 * 这条原来断言的是交错（`function_call:a, output:a, function_call:b, output:b`），因为把 Responses
	 * 翻译成 Chat Completions 的中转需要那个形状。那个需求是真的，错在把它当成了普适形状。
	 *
	 * 实测（2026-09-11，`api.deepseek.com/v1/responses` + `deepseek-flash`）：交错排一律 400，成组排
	 * 200。二分的结果是一对调用/结果能过、第二对一加就挂。而它报的是
	 * `The reasoning_text in the thinking mode must be passed back to the API.`——一句跟工具无关的话，
	 * 推理项一个都不发时它报的还是这句。两个会话因此报废。
	 *
	 * 默认改成组的理由不是哪家更重要，是认错的代价不对称：要交错的那家会明确点名 `tool_call_ids`，
	 * 一看就知道该换形状；要成组的这家只会说推理没带回来，那句话里没有任何能指认排列问题的东西。
	 */
	const input = toResponsesInput([
		user,
		assistant([call("a", "bash"), call("b", "glob")]),
		answer("a", "listing"),
		answer("b", "no match"),
	]);

	assert.deepEqual(shape(input), [
		"message",
		"function_call:a",
		"function_call:b",
		"function_call_output:a",
		"function_call_output:b",
	]);
});

test("学到「这个端点要交错」之后，结果紧跟着自己的调用", () => {
	const input = toResponsesInput(
		[user, assistant([call("a", "bash"), call("b", "glob")]), answer("a", "listing"), answer("b", "no match")],
		undefined,
		"replay",
		"interleaved",
	);

	assert.deepEqual(shape(input), [
		"message",
		"function_call:a",
		"function_call_output:a",
		"function_call:b",
		"function_call_output:b",
	]);
});

test("结果按调用顺序排，不按完成顺序——两种排法都是", () => {
	// 日志里躺着的是完成顺序：跑得快的那个先落地。发出去的形状不该取决于哪个工具更快。
	const history: Message[] = [
		user,
		assistant([call("a", "bash"), call("b", "glob")]),
		answer("b", "no match"),
		answer("a", "listing"),
	];

	const grouped = toResponsesInput(history);
	assert.deepEqual(shape(grouped), [
		"message",
		"function_call:a",
		"function_call:b",
		"function_call_output:a",
		"function_call_output:b",
	]);
	// 而且每条结果带的是自己的文本，没有串位。
	assert.equal((grouped[3] as { output: string }).output, "listing");
	assert.equal((grouped[4] as { output: string }).output, "no match");

	const interleaved = toResponsesInput(history, undefined, "replay", "interleaved");
	assert.equal((interleaved[2] as { output: string }).output, "listing");
	assert.equal((interleaved[4] as { output: string }).output, "no match");
});

test("a call with no result is left unanswered rather than given someone else's", () => {
	const input = toResponsesInput([user, assistant([call("a", "bash"), call("b", "glob")]), answer("b", "no match")]);

	assert.deepEqual(shape(input), ["message", "function_call:a", "function_call:b", "function_call_output:b"]);
});

test("a result whose call is not in the history keeps its place", () => {
	const input = toResponsesInput([user, assistant([call("a", "bash")]), answer("a", "listing"), answer("z", "orphan")]);

	assert.deepEqual(shape(input), [
		"message",
		"function_call:a",
		"function_call_output:a",
		"function_call_output:z",
	]);
});

test("a truncated history that starts with a result still sends it", () => {
	const input = toResponsesInput([answer("a", "listing"), user]);

	assert.deepEqual(shape(input), ["function_call_output:a", "message"]);
});

test("ids repeated across turns are answered within their own turn", () => {
	// Relays that name calls after the tool (`bash:0`) reuse the same id every turn.
	const input = toResponsesInput([
		user,
		assistant([call("bash:0", "bash")]),
		answer("bash:0", "first"),
		assistant([call("bash:0", "bash")]),
		answer("bash:0", "second"),
	]);

	assert.deepEqual(
		input.map((item) => (item as { output?: string }).output).filter(Boolean),
		["first", "second"],
	);
});

test("Anthropic gets its results in call order whatever order they finished in", () => {
	const messages: Message[] = [
		user,
		assistant([call("a", "bash"), call("b", "glob")]),
		answer("b", "no match"),
		answer("a", "listing"),
	];

	const out = toAnthropicMessages(messages);
	const results = out[out.length - 1];
	assert.equal(results.role, "user");
	assert.deepEqual(
		results.content.map((block) => (block as { tool_use_id: string }).tool_use_id),
		["a", "b"],
	);
});

test("an Anthropic result with no matching call is kept at the end of its run", () => {
	const out = toAnthropicMessages([
		user,
		assistant([call("a", "bash")]),
		answer("z", "orphan"),
		answer("a", "listing"),
	]);

	const results = out[out.length - 1];
	assert.deepEqual(
		results.content.map((block) => (block as { tool_use_id: string }).tool_use_id),
		["a", "z"],
	);
});

test("Chat Completions: prunes pure-thinking assistant without tools and drops subsequent synthetic nudge", () => {
	const pureThinkingAssistant: AssistantMessage = {
		role: "assistant",
		content: [{ type: "thinking", thinking: "Just thinking and no answer..." }],
		api: "openai-chat-completions",
		provider: "relay",
		model: "test",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: 10,
	};
	const syntheticNudge: Message = {
		role: "user",
		content: [{ type: "text", text: "（自动继续）上一条回复是空的。请直接开始执行：说明你要做什么，并调用工具去做。" }],
		timestamp: 11,
		synthetic: true,
	};
	const nextUser: Message = {
		role: "user",
		content: [{ type: "text", text: "真正的用户新消息" }],
		timestamp: 12,
	};

	const sanitized = sanitizeChatCompletionsHistory([user, pureThinkingAssistant, syntheticNudge, nextUser]);
	assert.equal(sanitized.length, 2);
	assert.deepEqual(sanitized, [user, nextUser]);

	const wire = toChatCompletionsMessages("", [user, pureThinkingAssistant, syntheticNudge, nextUser]);
	assert.equal(wire.length, 2);
	assert.equal((wire[0] as { role: string }).role, "user");
	assert.equal((wire[1] as { role: string }).role, "user");
});

test("Chat Completions: preserves assistant with tool calls even if text is empty", () => {
	const toolCallAssistant: AssistantMessage = {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "Thinking before call..." },
			call("call-1", "bash"),
		],
		api: "openai-chat-completions",
		provider: "relay",
		model: "test",
		usage: emptyUsage(),
		stopReason: "toolUse",
		timestamp: 20,
	};
	const wire = toChatCompletionsMessages("", [user, toolCallAssistant, answer("call-1", "ok")]);
	assert.equal(wire.length, 3);
	assert.equal((wire[1] as { role: string }).role, "assistant");
	assert.ok((wire[1] as { tool_calls: unknown[] }).tool_calls.length > 0);
	assert.equal((wire[2] as { role: string }).role, "tool");
});

test("Chat Completions: fallback protects against standalone unpruned empty assistant", () => {
	const standaloneEmptyAssistant: AssistantMessage = {
		role: "assistant",
		content: [{ type: "thinking", thinking: "pondering..." }],
		api: "openai-chat-completions",
		provider: "relay",
		model: "test",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: 30,
	};

	// Directly testing the serializer loop fallback net
	const wire = toChatCompletionsMessages("", [standaloneEmptyAssistant]);
	assert.equal(wire.length, 0); // because it is pruned by sanitizeChatCompletionsHistory

	// If an assistant has whitespace-only text that bypassed basic checks, it gets a non-empty fallback content
	const whitespaceAssistant: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "   " }],
		api: "openai-chat-completions",
		provider: "relay",
		model: "test",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: 31,
	};
	const wireWhitespace = toChatCompletionsMessages("", [whitespaceAssistant]);
	// whitespace-only is also pruned by sanitizeChatCompletionsHistory
	assert.equal(wireWhitespace.length, 0);
});

test("Chat Completions: parallel tool results are never duplicated", () => {
	const toolCallAssistant: AssistantMessage = {
		role: "assistant",
		content: [call("call-1", "bash"), call("call-2", "read"), call("call-3", "glob")],
		api: "openai-chat-completions",
		provider: "relay",
		model: "test",
		usage: emptyUsage(),
		stopReason: "toolUse",
		timestamp: 20,
	};
	const wire = toChatCompletionsMessages("", [
		user,
		toolCallAssistant,
		answer("call-1", "res1"),
		answer("call-2", "res2"),
		answer("call-3", "res3"),
		user,
	]) as any[];

	// 应该依次为: user, assistant(with 3 calls), tool(1), tool(2), tool(3), user
	assert.equal(wire.length, 6);
	assert.equal(wire[0].role, "user");
	assert.equal(wire[1].role, "assistant");
	assert.equal(wire[1].tool_calls.length, 3);

	const toolResults = wire.filter((m) => m.role === "tool");
	assert.equal(toolResults.length, 3);
	assert.deepEqual(
		toolResults.map((m) => m.tool_call_id),
		["call-1", "call-2", "call-3"],
	);
	assert.equal(wire[5].role, "user");
});

test("Chat Completions: orphan tool result with no prior assistant message still outputs once", () => {
	const wire = toChatCompletionsMessages("", [answer("orphan-1", "orphan result"), user]) as any[];
	assert.equal(wire.length, 2);
	assert.equal(wire[0].role, "tool");
	assert.equal(wire[0].tool_call_id, "orphan-1");
	assert.equal(wire[1].role, "user");
});

test("Chat Completions: usage keeps input and cacheRead disjoint and captures reasoning tokens", async () => {
	const { openaiChatCompletionsProvider } = await import("../src/ai/openai-chat-completions.ts");
	const sseData = [
		`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
		`data: ${JSON.stringify({
			choices: [{ delta: {} }],
			usage: {
				prompt_tokens: 1000,
				completion_tokens: 50,
				prompt_tokens_details: { cached_tokens: 800 },
				completion_tokens_details: { reasoning_tokens: 30 },
			},
		})}\n\n`,
		"data: [DONE]\n\n",
	].join("");

	const mockFetch = async () => new Response(sseData, { status: 200, headers: { "content-type": "text/event-stream" } });
	const providerConfig = {
		id: "test",
		name: "test",
		baseUrl: "https://example.invalid",
		api: "openai-chat-completions" as const,
		apiKey: "test",
		enabled: true,
		models: [],
	};
	const modelConfig = {
		modelId: "test-model",
		contextWindow: 128000,
		maxOutputTokens: 4096,
		pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
	};

	const stream = openaiChatCompletionsProvider.stream(
		providerConfig,
		modelConfig,
		{ systemPrompt: "", messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }], tools: [] },
		{ fetch: mockFetch as any },
	);

	let finalMessage: AssistantMessage | null = null;
	for await (const event of stream) {
		if (event.type === "done") {
			finalMessage = event.message;
		}
	}

	assert.ok(finalMessage);
	// prompt_tokens (1000) = cacheRead (800) + input (200)
	assert.equal(finalMessage.usage.cacheRead, 800);
	assert.equal(finalMessage.usage.input, 200);
	assert.equal(finalMessage.usage.output, 50);
	assert.equal(finalMessage.usage.reasoning, 30);
	assert.equal(finalMessage.usage.total, 1050); // 200 + 50 + 800
});

/*
 * 排列这个轴的**学习路径**——默认值改成成组的全部理由就是这条路能自愈，所以它必须被测。
 *
 * 之所以单独说一句：普查过用户配置的每个 Responses 端点，没有一个需要交错排（见
 * `tool-pairing-compat.ts` 文件头），所以这条路径**没法用真实端点验**。离线测是它唯一的保障。少了它，
 * 「默认成组 + 撞上就学」就退化成「对那类端点的永久回归」，正好是当初选这个默认值的反面。
 */

test("撞上「工具调用没对上结果」就学到交错，并且只学一次", () => {
	resetToolPairingCompat();
	assert.equal(toolPairing("qa", "m"), "grouped", "默认成组");

	// 真实错误原话，来自把 Responses 翻译成 Chat Completions 的中转。
	const said =
		"an assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: bash:0";
	assert.equal(learnToolPairing("qa", "m", said), true, "第一次撞上要学到东西");
	assert.equal(toolPairing("qa", "m"), "interleaved");

	assert.equal(learnToolPairing("qa", "m", said), false, "已经在交错档，再撞不值得重发");
	assert.equal(toolPairing("qa", "m"), "interleaved", "结论不变");
});

test("同一句话的另一种写法也认得", () => {
	resetToolPairingCompat();
	assert.equal(learnToolPairing("qa", "m", "message must be followed by tool messages"), true);
	assert.equal(toolPairing("qa", "m"), "interleaved");
});

test("认不出来的 400 不动排列结论——改坏了的请求比原样发出去更糟", () => {
	resetToolPairingCompat();
	assert.equal(learnToolPairing("qa", "m", "Rate limit exceeded"), false);
	assert.equal(learnToolPairing("qa", "m", "Invalid API key"), false);
	assert.equal(toolPairing("qa", "m"), "grouped");
});

test("排列结论按模型记，不串到别的模型上", () => {
	resetToolPairingCompat();
	learnToolPairing("qa", "picky", "The following tool_call_ids did not have response messages: bash:0");
	assert.equal(toolPairing("qa", "picky"), "interleaved");
	assert.equal(toolPairing("qa", "other"), "grouped");
	assert.equal(toolPairing("other-provider", "picky"), "grouped");
});

test("排列轴排在推理轴前面看——两个轴会抢同一句话", async () => {
	/*
	 * DeepSeek 的 Responses 在工具排列不对时报的是 `reasoning_text ... must be passed back`，一句跟工具
	 * 毫无关系的话，而它正好落进推理轴的 `REQUIRES` 正则里。顺序反了的话，推理轴会把这次失败认领走、
	 * 退回一个于事无补的结论，排列永远学不到。
	 *
	 * 这里直接验 `withReasoningRetry` 的短路顺序：给一个两边都可能认领的错误，看谁先拿到。
	 */
	resetToolPairingCompat();
	resetReasoningCompat();

	const seen: string[] = [];
	const spyLearner = (providerId: string, modelId: string, error: string): boolean => {
		seen.push("排列轴先看到");
		return learnToolPairing(providerId, modelId, error);
	};

	const attempts: number[] = [];
	// oxlint-disable-next-line require-yield -- 这个假的 run 按定义永远抛，产出什么都不对
	const run = async function* (): AsyncGenerator<never, void> {
		attempts.push(attempts.length);
		// 两个轴都可能认领这句：排列轴认它的「tool_call_ids」，推理轴认它的「must be passed back」。
		throw new Error("The following tool_call_ids did not have response messages: bash:0");
	};

	try {
		for await (const _ of withReasoningRetry("qa", "m", () => {}, spyLearner, run)) {
			// 不会有产出，这个循环只是把生成器跑起来。
		}
	} catch {
		// 走完梯子后抛出是预期的。
	}

	assert.equal(seen[0], "排列轴先看到", "排列轴必须先于推理轴拿到这次失败");
	assert.equal(toolPairing("qa", "m"), "interleaved", "排列轴学到了");
	assert.ok(attempts.length >= 2, "学到之后要换个形状重发，而不是直接放弃");
});

test("推理轴认领的错误不会被排列轴误判", () => {
	// 反向：一句纯粹是推理签名问题的话，排列轴不该动。
	resetToolPairingCompat();
	resetReasoningCompat();
	const said = "messages.1.content.0.thinking.signature: Field required";
	assert.equal(learnToolPairing("qa", "m", said), false, "排列轴不认这句");
	assert.equal(toolPairing("qa", "m"), "grouped", "排列结论不动");
	assert.equal(learnReasoningReplay("qa", "m", said), true, "该推理轴认领");
});
