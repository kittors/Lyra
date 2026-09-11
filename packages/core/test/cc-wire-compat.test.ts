/**
 * Chat Completions 链上那几条「撞一次学一次」的轴。
 *
 * 每个 400 的正文都是真实形状——OpenAI 官方 `invalid_request_error` 的四个字段（message / type /
 * param / code）一个不少，因为学习靠的就是 `message` 里那句自带诊断的话。用占位符测不出这件事。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	learnChatCompletionsCompat,
	maxTokensField,
	openaiChatCompletionsProvider,
	resetChatCompletionsCompat,
} from "../src/ai/openai-chat-completions.ts";
import { resetReasoningCompat } from "../src/ai/reasoning-compat.ts";
import { droppedParams, resetRequestParamsCompat } from "../src/ai/request-params-compat.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig } from "../src/types.ts";

// ---------------------------------------------------------------------------
// 真实形状的 fixture
// ---------------------------------------------------------------------------

/**
 * OpenAI 官方对 o 系列 / gpt-5.x 走 `/v1/chat/completions` 时的原话。
 *
 * 这是 P0-2 的全部依据：错误自己点名了该用的字段，所以不需要普查表也能学到结论。
 */
const MAX_TOKENS_400 = JSON.stringify({
	error: {
		message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
		type: "invalid_request_error",
		param: "max_tokens",
		code: "unsupported_parameter",
	},
});

/** 同一族的另一句：采样参数被拒。也点名了参数。 */
const TEMPERATURE_400 = JSON.stringify({
	error: {
		message: "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) is supported.",
		type: "invalid_request_error",
		param: "temperature",
		code: "unsupported_value",
	},
});

/**
 * `tool_choice` 被拒。
 *
 * 措辞是照 OpenAI 的 `unsupported_parameter` 模板套的（和 `MAX_TOKENS_400` 同一个模子，只换参数名）
 * ——**没有真实样本，推断，未验证**。它存在的意义是证明这条轴接得上，而不是证明哪个端点会这么说。
 */
const TOOL_CHOICE_400 = JSON.stringify({
	error: {
		message: "Unsupported parameter: 'tool_choice' is not supported with this model.",
		type: "invalid_request_error",
		param: "tool_choice",
		code: "unsupported_parameter",
	},
});

/** 一条最短的正常回答。三个 chunk + `[DONE]`，和真实端点的分片方式一致。 */
const OK_STREAM = [
	`data: ${JSON.stringify({
		id: "chatcmpl-BqR8hV2mKpLzXn4Wd",
		object: "chat.completion.chunk",
		created: 1_757_600_000,
		model: "o3",
		choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
	})}`,
	`data: ${JSON.stringify({
		id: "chatcmpl-BqR8hV2mKpLzXn4Wd",
		object: "chat.completion.chunk",
		created: 1_757_600_000,
		model: "o3",
		choices: [{ index: 0, delta: { content: "好了。" }, finish_reason: null }],
	})}`,
	`data: ${JSON.stringify({
		id: "chatcmpl-BqR8hV2mKpLzXn4Wd",
		object: "chat.completion.chunk",
		created: 1_757_600_000,
		model: "o3",
		choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
		usage: { prompt_tokens: 42, completion_tokens: 3, total_tokens: 45 },
	})}`,
	"data: [DONE]",
	"",
].join("\n\n");

function providerOf(): ProviderConfig {
	return {
		id: "openai",
		name: "OpenAI",
		baseUrl: "https://api.openai.com",
		api: "openai-chat-completions",
		apiKey: "sk-test",
		enabled: true,
		models: [],
	};
}

function modelOf(overrides: Partial<ModelConfig> = {}): ModelConfig {
	return {
		id: "openai/o3",
		providerId: "openai",
		modelId: "o3",
		name: "o3",
		contextWindow: 200_000,
		maxOutputTokens: 2_000,
		supportsThinking: true,
		supportsImages: false,
		supportsTools: true,
		...overrides,
	};
}

/** 跑一轮，返回每一次发出去的请求体和最后那条消息。 */
async function runTurn(
	responses: Array<{ status: number; body: string }>,
	model: ModelConfig = modelOf(),
	options: Record<string, unknown> = {},
): Promise<{ bodies: Array<Record<string, any>>; done: AssistantMessage | null; failed: AssistantMessage | null }> {
	const bodies: Array<Record<string, any>> = [];
	let done: AssistantMessage | null = null;
	let failed: AssistantMessage | null = null;
	const fetchStub = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		bodies.push(JSON.parse(String(init?.body)));
		const next = responses[Math.min(bodies.length - 1, responses.length - 1)];
		return new Response(next.body, {
			status: next.status,
			headers: { "content-type": next.status === 200 ? "text/event-stream" : "application/json" },
		});
	};
	for await (const event of openaiChatCompletionsProvider.stream(
		providerOf(),
		model,
		{ systemPrompt: "你是 Lyra。", messages: [{ role: "user", content: [{ type: "text", text: "在吗" }], timestamp: 1 }], tools: [] },
		{ retryAttempts: 1, fetch: fetchStub as typeof globalThis.fetch, ...options },
	)) {
		if (event.type === "done") done = event.message;
		if (event.type === "error") failed = event.message;
	}
	return { bodies, done, failed };
}

// ---------------------------------------------------------------------------
// P0-2 max_tokens 字段名
// ---------------------------------------------------------------------------

test("CC：默认发 max_tokens——不动任何现在能用的端点", async () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	resetReasoningCompat();
	const { bodies, done } = await runTurn([{ status: 200, body: OK_STREAM }]);
	assert.equal(bodies.length, 1);
	assert.equal(bodies[0].max_tokens, 2_000);
	assert.equal("max_completion_tokens" in bodies[0], false);
	assert.equal(done?.stopReason, "stop");
});

test("CC：撞上 'Use max_completion_tokens instead' 就学到它，并且立刻重发一次", async () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	resetReasoningCompat();
	const { bodies, done, failed } = await runTurn([
		{ status: 400, body: MAX_TOKENS_400 },
		{ status: 200, body: OK_STREAM },
	]);
	assert.equal(failed, null, "学到之后那次重发成功了，这一轮不该以失败收场");
	assert.equal(bodies.length, 2, "撞一次、重发一次");
	// 第一发还是老形状。
	assert.equal(bodies[0].max_tokens, 2_000);
	// 第二发换了字段名，而且老字段**不能**还留在里面——两个一起发会再被顶回来。
	assert.equal(bodies[1].max_completion_tokens, 2_000);
	assert.equal("max_tokens" in bodies[1], false);
	assert.ok(done, "第二发要成功并给回消息");
	assert.equal(done.stopReason, "stop");
	assert.equal((done.content[0] as { text: string }).text, "好了。");
	// 结论留在表里，下一轮不必再撞一次。
	assert.equal(maxTokensField("openai", "openai/o3"), "max_completion_tokens");
});

test("CC：学到 max_completion_tokens 后，用户手填的 max_tokens 也要从请求里清掉", async () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	resetReasoningCompat();
	const model = modelOf({ samplingParams: { max_tokens: 999 } });
	const { bodies } = await runTurn([{ status: 400, body: MAX_TOKENS_400 }, { status: 200, body: OK_STREAM }], model);
	assert.equal(bodies.length, 2);
	assert.equal(bodies[0].max_tokens, 999, "第一发照用户填的走");
	assert.equal("max_tokens" in bodies[1], false, "第二发不能让它从 samplingParams 里溜回来");
	assert.equal(bodies[1].max_completion_tokens, 2_000);
});

test("CC：字段名双向可学——端点反过来要 max_tokens 时能走回来", () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	assert.equal(
		learnChatCompletionsCompat("relay", "relay/x", "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."),
		true,
	);
	assert.equal(maxTokensField("relay", "relay/x"), "max_completion_tokens");
	assert.equal(
		learnChatCompletionsCompat("relay", "relay/x", "Unsupported parameter: 'max_completion_tokens' is not supported. Use 'max_tokens' instead."),
		true,
	);
	assert.equal(maxTokensField("relay", "relay/x"), "max_tokens");
});

test("CC：后半句被裁掉也能学——只剩「max_tokens 不支持」时切到另一个", () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	assert.equal(learnChatCompletionsCompat("relay", "relay/y", "invalid_request_error: 'max_tokens' is not supported"), true);
	assert.equal(maxTokensField("relay", "relay/y"), "max_completion_tokens");
	// 已经在那一格上了，同一句话不该再让它来回跳。
	assert.equal(learnChatCompletionsCompat("relay", "relay/y", "invalid_request_error: 'max_tokens' is not supported"), false);
});

test("CC：跟字段名无关的 400 一个字都不学", () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	for (const said of [
		// 真实的 DeepSeek 推理回放要求，属于 reasoning-compat 那条轴。
		"The reasoning_content in the thinking mode must be passed back to the API.",
		// 一句顺口提到 max_tokens 的长错误。跨句号，不算。
		"Invalid request. Your prompt is too long. Reduce the prompt or lower max_tokens.",
		"Rate limit reached for gpt-4o in organization org-abc on tokens per min (TPM): Limit 30000.",
	]) {
		assert.equal(learnChatCompletionsCompat("relay", "relay/z", said), false, said);
	}
	assert.equal(maxTokensField("relay", "relay/z"), "max_tokens");
});

// ---------------------------------------------------------------------------
// P3-14 采样参数
// ---------------------------------------------------------------------------

test("CC：samplingParams 默认一字不改地发出去", async () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	resetReasoningCompat();
	const model = modelOf({ supportsThinking: false, samplingParams: { temperature: 0.7, top_p: 0.95 } });
	const { bodies } = await runTurn([{ status: 200, body: OK_STREAM }], model);
	assert.equal(bodies[0].temperature, 0.7);
	assert.equal(bodies[0].top_p, 0.95);
});

test("CC：撞上 'temperature does not support' 就把整组采样参数省掉重发", async () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	resetReasoningCompat();
	const model = modelOf({ supportsThinking: false, samplingParams: { temperature: 0.7, top_p: 0.95 } });
	const { bodies, done } = await runTurn(
		[{ status: 400, body: TEMPERATURE_400 }, { status: 200, body: OK_STREAM }],
		model,
		{ temperature: 0.3 },
	);
	assert.equal(bodies.length, 2);
	assert.equal(bodies[0].temperature, 0.7, "samplingParams 盖掉 options.temperature，这是既有语义");
	assert.equal("temperature" in bodies[1], false, "options.temperature 也要一起省，否则再顶一次");
	assert.equal("top_p" in bodies[1], false);
	assert.equal(bodies[1].max_tokens, 2_000, "省的是采样参数，不是输出上限");
	assert.equal(done?.stopReason, "stop");
	// 采样参数那条轴是三条链共用的（`request-params-compat.ts`），不在这条链自己的表里。
	assert.equal(droppedParams("openai", "openai/o3").has("sampling"), true);
});

// ---------------------------------------------------------------------------
// P1-6 tool_choice
// ---------------------------------------------------------------------------

test("CC：有工具时默认仍然发 tool_choice: auto，无工具时两个都不发", async () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	resetReasoningCompat();
	const bodies: Array<Record<string, any>> = [];
	const fetchStub = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		bodies.push(JSON.parse(String(init?.body)));
		return new Response(OK_STREAM, { status: 200, headers: { "content-type": "text/event-stream" } });
	};
	const tools = [{ name: "bash", description: "跑一条命令", parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] } }];
	for (const withTools of [true, false]) {
		for await (const _ of openaiChatCompletionsProvider.stream(
			providerOf(),
			modelOf(),
			{
				systemPrompt: "",
				messages: [{ role: "user", content: [{ type: "text", text: "跑一下" }], timestamp: 1 }],
				tools: withTools ? tools : [],
			},
			{ retryAttempts: 1, fetch: fetchStub as typeof globalThis.fetch },
		)) {
			// 只要请求体。
		}
	}
	assert.equal(bodies[0].tool_choice, "auto");
	assert.equal((bodies[0].tools as unknown[]).length, 1);
	assert.equal("tool_choice" in bodies[1], false, "没有工具可管的 tool_choice 会绊倒一些代理，不发");
	assert.equal("tools" in bodies[1], false);
});

test("CC：端点点名不收 tool_choice 时学到省略，学到之后请求里就没有它了", async () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	resetReasoningCompat();
	assert.equal(learnChatCompletionsCompat("relay", "relay/tc", TOOL_CHOICE_400), true);
	assert.equal(droppedParams("relay", "relay/tc").has("tool-choice"), true);
	// 只省它——别的轴不该被顺手带走。
	assert.equal(maxTokensField("relay", "relay/tc"), "max_tokens");
	assert.equal(droppedParams("relay", "relay/tc").has("sampling"), false);

	const bodies: Array<Record<string, any>> = [];
	const fetchStub = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		bodies.push(JSON.parse(String(init?.body)));
		return new Response(OK_STREAM, { status: 200, headers: { "content-type": "text/event-stream" } });
	};
	for await (const _ of openaiChatCompletionsProvider.stream(
		{ ...providerOf(), id: "relay" },
		modelOf({ id: "relay/tc", providerId: "relay" }),
		{
			systemPrompt: "",
			messages: [{ role: "user", content: [{ type: "text", text: "跑一下" }], timestamp: 1 }],
			tools: [{ name: "bash", description: "跑一条命令", parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] } }],
		},
		{ retryAttempts: 1, fetch: fetchStub as typeof globalThis.fetch },
	)) {
		// 只要请求体。
	}
	assert.equal("tool_choice" in bodies[0], false);
	assert.equal((bodies[0].tools as unknown[]).length, 1, "省的是 tool_choice，工具本身还得发");
});

test("CC：一句话同时点名两样，两条轴一起学，不留一条到下一轮再撞", () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	const both =
		"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead. Unsupported value: 'temperature' does not support 0.7 with this model.";
	assert.equal(learnChatCompletionsCompat("openai", "openai/gpt-5.6", both), true);
	assert.equal(maxTokensField("openai", "openai/gpt-5.6"), "max_completion_tokens");
	assert.equal(droppedParams("openai", "openai/gpt-5.6").has("sampling"), true);
	// 结论没变了，就别再重发。
	assert.equal(learnChatCompletionsCompat("openai", "openai/gpt-5.6", both), false);
});

test("CC：只学到 Responses 那两条轴时不重发——这条链压根不发那两个字段", () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	/*
	 * `request-params-compat.ts` 管四个参数，这条链只照着改两个。学到 `include-encrypted` 这种
	 * Responses 专属的结论也返回 true 的话，会触发一次重发，而重发的请求体和刚被拒的那份一模一样。
	 */
	const saidEncrypted = "Invalid value: 'reasoning.encrypted_content' is not supported for include";
	assert.equal(learnChatCompletionsCompat("relay", "relay/enc", saidEncrypted), false);
	assert.equal(droppedParams("relay", "relay/enc").has("include-encrypted"), true, "结论还是要记下来，只是不值得为它重发");
});

test("CC：学到的结论按 provider+model 分开记，不串台", () => {
	resetChatCompletionsCompat();
	resetRequestParamsCompat();
	learnChatCompletionsCompat("openai", "openai/o3", MAX_TOKENS_400);
	assert.equal(maxTokensField("openai", "openai/o3"), "max_completion_tokens");
	assert.equal(maxTokensField("openai", "openai/gpt-4o"), "max_tokens");
	assert.equal(maxTokensField("deepseek", "deepseek/deepseek-chat"), "max_tokens");
});

// ---------------------------------------------------------------------------
// 关思考：不发 ≠ 关掉
// ---------------------------------------------------------------------------

test("关思考要明说 reasoning_effort:none —— 什么都不发等于没关", async () => {
	/*
	 * 实测（2026-09-11，`api.deepseek.com/v1/chat/completions` + `deepseek-flash`，七种写法，落盘
	 * `~/.lyra/scratch/cc-open-questions.txt`）：什么都不发时推理 45 字、`low` 63 字、`minimal` 39 字、
	 * `enable_thinking:false` 57 字，只有 `none` 和 `thinking:{type:"disabled"}` 是 0 字。
	 *
	 * 不发 = 用服务端默认，而这个模型的默认就在思考。用户关了思考照样被按推理 token 收费——不报错、
	 * 不可见，只有账单知道。这也顺带否掉了 oh-my-pi 的 `lowest-effort` 默认。
	 */
	resetRequestParamsCompat();
	const { bodies } = await runTurn([{ status: 200, body: OK_STREAM }], modelOf({ supportsThinking: true }), { thinking: "off" });
	assert.equal(bodies[0].reasoning_effort, "none", "关思考要明说，不能靠不发");
});

test("端点不认 none 时退回「什么都不发」——这条链原来的行为", async () => {
	// Gemini/Vertex 的原话。撞上之后这个键要整个消失，而不是换一个别的值去猜。
	resetRequestParamsCompat();
	const { bodies } = await runTurn(
		[
			{ status: 400, body: JSON.stringify({ error: { message: "none is not a valid ThinkingLevel enum value", type: "invalid_request_error" } }) },
			{ status: 200, body: OK_STREAM },
		],
		modelOf({ supportsThinking: true }),
		{ thinking: "off" },
	);
	assert.equal(bodies[0].reasoning_effort, "none", "第一发照常明说");
	assert.equal("reasoning_effort" in bodies[1], false, "撞过之后这个键整个消失");
});

test("开着思考时照常发用户选的档位，不受这条改动影响", async () => {
	resetRequestParamsCompat();
	const { bodies } = await runTurn([{ status: 200, body: OK_STREAM }], modelOf({ supportsThinking: true }), { thinking: "high" });
	assert.equal(bodies[0].reasoning_effort, "high");
});

test("不支持思考的模型一个 reasoning_effort 都不发", async () => {
	resetRequestParamsCompat();
	const { bodies } = await runTurn([{ status: 200, body: OK_STREAM }], modelOf({ supportsThinking: false }), { thinking: "off" });
	assert.equal("reasoning_effort" in bodies[0], false);
});
