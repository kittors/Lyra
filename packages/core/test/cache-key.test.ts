/**
 * 缓存键上路：请求体里一份 `prompt_cache_key`，请求头里一份 `session_id`。
 *
 * 中转站的号池按这两样把同一段对话钉在同一个上游账号上（sub2api 的 `GenerateSessionHash`），
 * OpenAI 按它把请求路由到同一台机器。没有它们，号池随机分，换一个没见过这段前缀的账号就是一次
 * 全额冷启动——2026-09-26 那场会话的 76% 就是这么来的。
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { openaiResponsesProvider } from "../src/ai/openai-responses.ts";
import { openaiChatCompletionsProvider } from "../src/ai/openai-chat-completions.ts";
import { resetRequestParamsCompat } from "../src/ai/request-params-compat.ts";
import type { ModelConfig, Provider, ProviderConfig } from "../src/types/provider.ts";

const model: ModelConfig = { id: "qa/model", providerId: "qa", modelId: "relay-model", name: "QA", supportsThinking: false, supportsImages: false, supportsTools: true, contextWindow: 200000, maxOutputTokens: 4096 };
const context = { systemPrompt: "s", messages: [], tools: [] };

afterEach(() => resetRequestParamsCompat());

/** 发一次，抓下请求体和请求头；`fail` 决定每一次尝试怎么被拒。 */
async function capture(adapter: Provider, cacheKey: string | undefined, fail: (attempt: number) => string, headers?: Record<string, string>) {
	const provider: ProviderConfig = { id: "qa", name: "QA", api: adapter.api, apiKey: "test", baseUrl: "https://example.invalid", enabled: true, models: [model], headers };
	const sent: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
	const stream = adapter.stream(provider, model, context, {
		cacheKey,
		retryAttempts: 1,
		fetch: async (_url, init) => {
			sent.push({ body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
			return new Response(JSON.stringify({ error: { message: fail(sent.length) } }), { status: 400 });
		},
	});
	for await (const event of stream) if (event.type === "error") break;
	return sent;
}

for (const adapter of [openaiResponsesProvider, openaiChatCompletionsProvider]) {
	test(`${adapter.api}：同一个键同时放进请求体和请求头`, async () => {
		const [first] = await capture(adapter, "session-123", () => "stop");
		assert.equal(first.body.prompt_cache_key, "session-123");
		assert.equal(first.headers.session_id, "session-123");
	});

	test(`${adapter.api}：没有键就什么都不加`, async () => {
		const [first] = await capture(adapter, undefined, () => "stop");
		assert.equal("prompt_cache_key" in first.body, false);
		assert.equal("session_id" in first.headers, false);
	});

	test(`${adapter.api}：端点点名不认 prompt_cache_key，就撤掉它重发一次，以后也不再发`, async () => {
		const sent = await capture(adapter, "session-123", (attempt) =>
			attempt === 1 ? "Unrecognized request argument supplied: prompt_cache_key" : "stop",
		);
		assert.equal(sent.length, 2, "撞一次，削掉重发一次");
		assert.equal(sent[1].body.prompt_cache_key, undefined);
		assert.equal(sent[1].headers.session_id, "session-123", "头不会被拒，照样带着");

		const [later] = await capture(adapter, "session-456", () => "stop");
		assert.equal(later.body.prompt_cache_key, undefined, "记住了，以后不再发");
	});

	test(`${adapter.api}：用户自己配了同名头的，以他的为准`, async () => {
		const [first] = await capture(adapter, "session-123", () => "stop", { session_id: "mine" });
		assert.equal(first.headers.session_id, "mine");
	});
}
