import assert from "node:assert/strict";
import { test } from "node:test";
import { openaiResponsesProvider } from "../src/ai/openai-responses.ts";
import { openaiChatCompletionsProvider } from "../src/ai/openai-chat-completions.ts";
import { anthropicMessagesProvider } from "../src/ai/anthropic-messages.ts";
import type { ModelConfig, Provider, ProviderConfig } from "../src/types/provider.ts";

const model: ModelConfig = { id: "qa/model", providerId: "qa", modelId: "gemini-relay", name: "QA", supportsThinking: true, supportsImages: false, supportsTools: true, contextWindow: 200000, maxOutputTokens: 32768 };
const context = { systemPrompt: "", messages: [], tools: [] };
async function payload(adapter: Provider, config: ModelConfig, thinking: string): Promise<Record<string, unknown>> {
	const provider: ProviderConfig = { id: "qa", name: "QA", api: adapter.api, apiKey: "test", baseUrl: "https://example.invalid", enabled: true, models: [config] };
	let captured: unknown;
	const stream = adapter.stream(provider, config, context, { thinking, onPayload: (body) => { captured = body; }, retryAttempts: 1,
		fetch: async () => new Response(JSON.stringify({ error: { message: "stop after payload capture" } }), { status: 400 }),
	});
	for await (const event of stream) { if (event.type === "error") break; }
	assert.ok(captured && typeof captured === "object");
	return Object.fromEntries(Object.entries(captured));
}

test("both OpenAI protocols honour explicit relay levels and the existing terra catalogue", async () => {
	for (const adapter of [openaiResponsesProvider, openaiChatCompletionsProvider]) {
		for (const [config, requested, expected] of [
			[{ ...model, thinkingOptions: [{ id: "adaptive", label: "自适应", detail: "Provider-defined", isDefault: true }] }, "adaptive", "adaptive"],
			[{ ...model, modelId: "gpt-5.6-terra" }, "ultra", "ultra"],
			[{ ...model, modelId: "unknown-relay" }, "ultra", "medium"],
		] satisfies [ModelConfig, string, string][]) {
			const body = await payload(adapter, config, requested);
			assert.deepEqual(adapter.api === "openai-responses" ? body.reasoning : body.reasoning_effort,
				adapter.api === "openai-responses" ? { effort: expected, summary: "auto" } : expected);
		}
	}
});

test("with thinking off, both OpenAI protocols leave the reasoning field out for Gemini and say none elsewhere", async () => {
	// Gemini refuses an explicit "none" (a 400 on the user's relay for gemini-3.8-flash-high and
	// gemini-2.5-flash). The Chat Completions adapter used to send it anyway, so thinking off failed there.
	for (const adapter of [openaiResponsesProvider, openaiChatCompletionsProvider]) {
		for (const modelId of ["gemini-3.8-flash-high", "Gemini-2.5-Flash", "gemma-3-27b"]) {
			const body = await payload(adapter, { ...model, id: `qa/${modelId}`, modelId }, "off");
			assert.equal(body.reasoning, undefined, `${adapter.api} ${modelId}`);
			assert.equal(body.reasoning_effort, undefined, `${adapter.api} ${modelId}`);
		}
		const other = await payload(adapter, { ...model, id: "qa/deepseek-v4-flash", modelId: "deepseek-v4-flash" }, "off");
		assert.deepEqual(adapter.api === "openai-responses" ? other.reasoning : other.reasoning_effort,
			adapter.api === "openai-responses" ? { effort: "none" } : "none");
	}
});

test("Anthropic uses the same fallback and an explicit budget for custom levels; invalid budgets never reach fetch", async () => {
	assert.deepEqual((await payload(anthropicMessagesProvider, model, "ultra")).thinking, { type: "enabled", budget_tokens: 12288 });
	const custom = { ...model, thinkingOptions: [{ id: "adaptive", label: "自适应", detail: "", budgetTokens: 2048 }] };
	assert.deepEqual((await payload(anthropicMessagesProvider, custom, "adaptive")).thinking, { type: "enabled", budget_tokens: 2048 });
	assert.equal((await payload(anthropicMessagesProvider, custom, "off")).thinking, undefined);
	for (const budgetTokens of [undefined, 100, Number.NaN]) {
		await assert.rejects(payload(anthropicMessagesProvider, { ...custom, thinkingOptions: [{ ...custom.thinkingOptions[0], budgetTokens }] }, "adaptive"), /requires budgetTokens/);
	}
});
