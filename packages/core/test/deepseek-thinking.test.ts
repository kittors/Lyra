import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveModelThinkingOptions, resolveReasoningEffort } from "../src/ai/thinking-options.ts";
import { openaiChatCompletionsProvider } from "../src/ai/openai-chat-completions.ts";
import { openaiResponsesProvider } from "../src/ai/openai-responses.ts";
import type { ModelConfig, Provider, ThinkingLevel } from "../src/types.ts";

const model = (modelId: string): ModelConfig => ({
	id: modelId, providerId: "ds", modelId, name: modelId, contextWindow: 1_000_000,
	maxOutputTokens: 8192, supportsThinking: true, supportsImages: false, supportsTools: true,
});
const levels = (modelId: string) => resolveModelThinkingOptions(model(modelId)).map((option) => option.id);

// /models on 2026-10-21 declares low/high/max, default high, for Flash and V4 Pro.
test("DeepSeek V4 models and relay aliases offer max and the API's high default", () => {
	for (const id of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro",
		"deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash", "deepseek-ai/DeepSeek-V4-Pro",
		"command/deepseek-v4-flash:0731", "deepseek-v4-pro-2026-04-24"]) {
		assert.deepEqual(levels(id), ["off", "low", "high", "max"], id);
		assert.deepEqual(resolveModelThinkingOptions(model(id)).filter((option) => option.isDefault).map((option) => option.id), ["high"], id);
		assert.equal(resolveReasoningEffort("max", model(id)), "max", id);
	}
});

test("DeepSeek's ladder does not claim max for legacy or unrelated names", () => {
	for (const id of ["deepseek-chat", "deepseek-reasoner", "deepseek-r1", "deepseek-v3.2", "deepseek-v4",
		"deepseek-v40-pro", "deepseek-flashlight", "otherdeepseek-flash", "gemini-deepseek-v4-pro"]) {
		assert.deepEqual(levels(id), ["off", "low", "medium", "high"], id);
	}
});

test("DeepSeek model switches keep the requested depth and reasoning can still be disabled", () => {
	const config = model("deepseek-flash");
	assert.equal(resolveReasoningEffort("medium", config), "high");
	assert.equal(resolveReasoningEffort("xhigh", config), "max");
	assert.equal(resolveReasoningEffort("ultra", config), "max");
	assert.equal(resolveReasoningEffort("off", config), undefined);
	assert.equal(resolveReasoningEffort(undefined, config), undefined);
});

test("DeepSeek capability inference respects explicit options and supportsThinking", () => {
	assert.deepEqual(resolveModelThinkingOptions({ ...model("deepseek-flash"), supportsThinking: false }), []);
	assert.deepEqual(resolveModelThinkingOptions({ ...model("deepseek-flash"), thinkingOptions: [] }), []);
	const custom: ModelConfig = { ...model("deepseek-flash"), thinkingOptions: [{ id: "medium", label: "Custom", detail: "" }] };
	assert.deepEqual(resolveModelThinkingOptions(custom), custom.thinkingOptions);
	assert.equal(resolveReasoningEffort("max", custom), "medium");
});

async function payloadFor(adapter: Provider, modelId: string, thinking: ThinkingLevel): Promise<Record<string, unknown>> {
	const payloads: unknown[] = [];
	const stream = adapter.stream(
		{ id: "ds", name: "DeepSeek", api: adapter.api, baseUrl: "https://example.invalid", apiKey: "test", enabled: true, models: [] },
		model(modelId),
		{ messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }], tools: [] },
		{
			thinking,
			fetch: async (_input, init) => {
				assert.equal(typeof init?.body, "string");
				payloads.push(JSON.parse(String(init?.body)));
				return new Response(`data: ${JSON.stringify(adapter.api === "openai-responses"
					? { type: "response.created", response: { id: "captured", status: "in_progress" } }
					: { id: "captured", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\n`,
					{ headers: { "Content-Type": "text/event-stream" } });
			},
		},
	);
	// The first successful stream event suffices to observe the request.
	await stream.next();
	assert.equal(payloads.length, 1);
	const body = payloads[0];
	assert.ok(body && typeof body === "object" && !Array.isArray(body));
	return Object.fromEntries(Object.entries(body));
}

test("every DeepSeek menu level reaches both OpenAI-compatible adapters without downgrading max", async () => {
	for (const id of ["deepseek-flash", "deepseek-v4-pro", "command/deepseek-v4-flash:0731"]) {
		for (const effort of ["off", "low", "high", "max"] as const) {
			const chat = await payloadFor(openaiChatCompletionsProvider, id, effort);
			assert.equal(chat.reasoning_effort, effort === "off" ? "none" : effort, `${id}: ${effort}`);
			const responses = await payloadFor(openaiResponsesProvider, id, effort);
			assert.deepEqual(responses.reasoning, effort === "off" ? { effort: "none" } : { effort, summary: "auto" }, `${id}: ${effort}`);
		}
	}
});
