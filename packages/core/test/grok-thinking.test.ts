/**
 * Grok's reasoning levels, and what each one puts on the wire.
 *
 * Every Grok model used to fall through to the fallback: 关/低/中/高, default 中. Grok 4.7 had no
 * 超高 and was drawn at 中 while xAI runs it at `high`; its 「关」 sent `none`, which only Grok 4.3
 * accepts; and Grok 4.20 and Grok Build 0.1, which take no effort at all, were sent one on every
 * turn — a 400. The ladders below are the "Reasoning efforts" lines on docs.x.ai (2026-11-05).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTO_THINKING, THINKING_LEVELS, resolveModelThinkingOptions, resolveReasoningEffort, resolveReasoningOn, resolveThinkingOption } from "../src/ai/thinking-options.ts";
import { refusesReasoningNone } from "../src/ai/request-params-compat.ts";
import { openaiChatCompletionsProvider } from "../src/ai/openai-chat-completions.ts";
import { openaiResponsesProvider } from "../src/ai/openai-responses.ts";
import type { ModelConfig, Provider, ThinkingLevel } from "../src/types.ts";

const model = (modelId: string): ModelConfig => ({
	id: modelId, providerId: "xai", modelId, name: modelId, contextWindow: 500_000,
	maxOutputTokens: 8192, supportsThinking: true, supportsImages: true, supportsTools: true,
});
const levels = (modelId: string) => resolveModelThinkingOptions(model(modelId)).map((option) => option.id);
const defaults = (modelId: string) => resolveModelThinkingOptions(model(modelId)).filter((option) => option.isDefault).map((option) => option.id);

/** Each model's documented efforts, `off` standing for `none`, and the one xAI runs when none is sent. */
const DOCUMENTED: Record<string, { levels: string[]; default: string[] }> = {
	"grok-4.7": { levels: ["low", "medium", "high", "xhigh"], default: ["high"] },
	"grok-4.6": { levels: ["low", "medium", "high", "xhigh"], default: ["high"] },
	// The page lists xhigh because the API takes it; the guide says it runs as high.
	"grok-4.5": { levels: ["low", "medium", "high"], default: ["high"] },
	"grok-4.3": { levels: ["off", "low", "medium", "high", "xhigh"], default: ["low"] },
	// The effort is the agent count here (4 or 16), with no documented default.
	"grok-4.20-multi-agent-0309": { levels: ["low", "medium", "high", "xhigh"], default: [] },
	"grok-4.20-0309-reasoning": { levels: [AUTO_THINKING], default: [AUTO_THINKING] },
	"grok-build-0.1": { levels: [AUTO_THINKING], default: [AUTO_THINKING] },
};

/** Aliases from the model pages, and the shapes relays and gateways put around an id. */
const ALIASES: Record<string, string> = {
	"grok-4.7-build-fast": "grok-4.7",
	"x-ai/grok-4.7": "grok-4.7",
	"xai/grok-4.6": "grok-4.6",
	"grok-4.5-latest": "grok-4.5",
	"grok-build-latest": "grok-4.5",
	"grok-4.3-latest": "grok-4.3",
	"grok-4.20-multi-agent": "grok-4.20-multi-agent-0309",
	"grok-4.20-multi-agent-beta-latest": "grok-4.20-multi-agent-0309",
	"grok-4.20": "grok-4.20-0309-reasoning",
	"grok-4.20-reasoning": "grok-4.20-0309-reasoning",
	"grok-4.20-beta-latest-reasoning": "grok-4.20-0309-reasoning",
	"grok-code-fast-1": "grok-build-0.1",
	"grok-code-fast": "grok-build-0.1",
};

test("every documented Grok model and alias offers the API's own efforts and default", () => {
	for (const [id, documented] of Object.entries(DOCUMENTED)) {
		assert.deepEqual(levels(id), documented.levels, id);
		assert.deepEqual(defaults(id), documented.default, id);
	}
	for (const [alias, id] of Object.entries(ALIASES)) {
		assert.deepEqual(levels(alias), DOCUMENTED[id].levels, alias);
		assert.deepEqual(defaults(alias), DOCUMENTED[id].default, alias);
	}
});

test("4.20's non-reasoning line has no level, and lookalikes or retired ids keep the fallback", () => {
	for (const id of ["grok-4.20-0309-non-reasoning", "grok-4.20-non-reasoning", "grok-4.20-non-reasoning-gv2"]) {
		assert.deepEqual(levels(id), [], id);
	}
	// Not documented, so unchanged: xAI serves the retired ones as 4.3, which takes all four.
	for (const id of ["grok-4.70", "grok-4.30", "grok-4", "grok-4-0709", "grok-4-fast-reasoning", "grok-3-mini", "grok-build", "notgrok-4.7"]) {
		assert.deepEqual(levels(id), ["off", "low", "medium", "high"], id);
	}
});

test("a level a Grok model lacks lands on the nearest one, never on its default", () => {
	assert.equal(resolveReasoningEffort("max", model("grok-4.7")), "xhigh");
	assert.equal(resolveReasoningEffort("ultra", model("grok-4.7")), "xhigh");
	assert.equal(resolveReasoningEffort("minimal", model("grok-4.7")), "low");
	assert.equal(resolveReasoningEffort("xhigh", model("grok-4.5")), "high", "xhigh is high on 4.5, as xAI runs it");
	assert.equal(resolveReasoningEffort("max", model("grok-4.3")), "xhigh");
	assert.equal(resolveReasoningEffort("minimal", model("grok-4.3")), "low");
	// Grok 4.7 cannot stop reasoning: "off" runs its shallowest level rather than its default high.
	assert.equal(resolveReasoningEffort("off", model("grok-4.7")), "low");
	assert.equal(resolveReasoningEffort(undefined, model("grok-4.6")), "low");
	assert.equal(resolveReasoningOn("off", model("grok-4.7")), true);
	// 4.3 can: "off" stays off.
	assert.equal(resolveReasoningEffort("off", model("grok-4.3")), undefined);
	assert.equal(resolveReasoningOn("off", model("grok-4.3")), false);
	// The level is the person's: max on 4.7 shows 超高, and is max again on a model that has it.
	assert.equal(resolveReasoningEffort("max", model("gpt-6.1-sol")), "max");
});

test("a model with no dial reasons at every level and names none of them", () => {
	for (const id of ["grok-4.20-0309-reasoning", "grok-build-0.1", "grok-code-fast-1"]) {
		for (const level of [...THINKING_LEVELS, undefined]) {
			assert.equal(resolveThinkingOption(level, model(id))?.id, AUTO_THINKING, `${id}: ${level}`);
			assert.equal(resolveReasoningEffort(level, model(id)), undefined, `${id}: ${level}`);
			assert.equal(resolveReasoningOn(level, model(id)), true, `${id}: ${level}`);
		}
	}
	// A level somebody configured is theirs to send, even one called auto.
	const custom: ModelConfig = { ...model("grok-build-0.1"), thinkingOptions: [{ id: "auto", label: "Auto", detail: "" }] };
	assert.equal(resolveReasoningEffort("high", custom), "auto");
	// Switching away gives the person's own level back.
	assert.equal(resolveReasoningEffort("high", model("grok-4.7")), "high");
});

test("only Grok 4.3 is ever sent none", () => {
	for (const id of ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.20-0309-reasoning", "grok-4.20-0309-non-reasoning",
		"grok-4.20-multi-agent-0309", "grok-build-0.1", "grok-build-latest", "grok-code-fast-1", "x-ai/grok-4.7"]) {
		assert.equal(refusesReasoningNone(id), true, id);
	}
	for (const id of ["grok-4.3", "grok-4.3-latest", "grok-4-0709", "gpt-5.6"]) {
		assert.equal(refusesReasoningNone(id), false, id);
	}
});

async function payloadFor(adapter: Provider, config: ModelConfig, thinking: ThinkingLevel): Promise<Record<string, unknown>> {
	const payloads: unknown[] = [];
	const stream = adapter.stream(
		{ id: "xai", name: "xAI", api: adapter.api, baseUrl: "https://example.invalid", apiKey: "test", enabled: true, models: [] },
		config,
		{ systemPrompt: "", messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }], tools: [] },
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
	// The first stream event is enough to have seen the request.
	await stream.next();
	assert.equal(payloads.length, 1);
	const body = payloads[0];
	assert.ok(body && typeof body === "object" && !Array.isArray(body));
	return Object.fromEntries(Object.entries(body));
}

/** What each menu level, and 「关」, sends: the effort named, or nothing at all. */
const WIRE: Record<string, Partial<Record<ThinkingLevel, string | null>>> = {
	"grok-4.7": { off: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" },
	"grok-4.6": { off: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
	"grok-4.5": { off: "low", low: "low", medium: "medium", high: "high", xhigh: "high" },
	"grok-4.3": { off: "none", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
	"grok-4.20-multi-agent-0309": { off: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
	"grok-4.20-0309-reasoning": { off: null, low: null, medium: null, high: null, xhigh: null, max: null },
	"grok-build-0.1": { off: null, low: null, medium: null, high: null, xhigh: null, max: null },
	"grok-code-fast-1": { off: null, high: null },
	"grok-4.7-build-fast": { off: "low", high: "high", xhigh: "xhigh" },
};

test("every Grok level reaches both OpenAI-compatible wires as the effort xAI documents", async () => {
	for (const [id, sends] of Object.entries(WIRE)) {
		for (const [level, effort] of Object.entries(sends) as [ThinkingLevel, string | null][]) {
			const chat = await payloadFor(openaiChatCompletionsProvider, model(id), level);
			if (effort === null) assert.ok(!("reasoning_effort" in chat), `${id} ${level}: chat names no effort`);
			else assert.equal(chat.reasoning_effort, effort, `${id} ${level}: chat`);

			const responses = await payloadFor(openaiResponsesProvider, model(id), level);
			if (effort === null) assert.ok(!("reasoning" in responses), `${id} ${level}: responses names no effort`);
			else if (effort === "none") assert.deepEqual(responses.reasoning, { effort: "none" }, `${id} ${level}: responses`);
			else assert.deepEqual(responses.reasoning, { effort, summary: "auto" }, `${id} ${level}: responses`);
			// Reasoning that runs is asked back, so the next turn can replay it; reasoning off is not.
			assert.equal(Array.isArray(responses.include), effort !== "none", `${id} ${level}: include`);
		}
	}
});

test("the non-reasoning line set to think is sent nothing about reasoning, not none", async () => {
	for (const level of ["off", "high"] as const) {
		const chat = await payloadFor(openaiChatCompletionsProvider, model("grok-4.20-0309-non-reasoning"), level);
		assert.ok(!("reasoning_effort" in chat), level);
		const responses = await payloadFor(openaiResponsesProvider, model("grok-4.20-0309-non-reasoning"), level);
		assert.ok(!("reasoning" in responses) && !("include" in responses), level);
	}
});
