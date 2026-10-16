/**
 * Which thinking levels a model is offered, and what gets sent when one is picked.
 *
 * The rule that matters is the order the rules are tried in. Vendor first, because the vendor is
 * whose API rejects the request: Google's returns HTTP 400 for `minimal`, and a rule matching a
 * bare `ultra` anywhere in an id used to reach past the Google check and hand `gemini-ultra` — a
 * real model — the GPT-5.6-sol set, `minimal` included.
 *
 * The OpenAI ladders are the API's own, read off each model's page at developers.openai.com. They
 * were wrong in three ways before: GPT-6.1 Sol had no rule and was drawn with four levels and no
 * `xhigh`/`max`; GPT-5.6 was offered `minimal`, and its sol tier and GPT-6 Astra `ultra`, neither of
 * which the API accepts; and Astra and 6.1 Sol were offered 「关」, which sends `none` — a 400.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveModelThinkingOptions, resolveReasoningEffort, resolveThinkingOption } from "../src/ai/thinking-options.ts";
import type { ModelConfig } from "../src/types/provider.ts";

const model = (modelId: string): ModelConfig => ({
	id: modelId,
	providerId: "p",
	modelId,
	name: modelId,
	contextWindow: 200_000,
	maxOutputTokens: 8192,
	supportsThinking: true,
	supportsImages: false,
	supportsTools: true,
});

const ids = (modelId: string) => resolveModelThinkingOptions(model(modelId)).map((option) => option.id);
const defaultOf = (modelId: string) => resolveModelThinkingOptions(model(modelId)).filter((option) => option.isDefault).map((option) => option.id);

test("every offered level reaches the wire unchanged, including explicit provider levels", () => {
	for (const config of [model("gpt-5.6-terra"), model("gpt-5.4-mini"), model("gpt-6.1-sol"), model("gpt-5-pro"), {
		...model("gemini-custom"), thinkingOptions: [{ id: "adaptive", label: "自适应", detail: "", isDefault: true }],
	}]) {
		for (const option of resolveModelThinkingOptions(config)) {
			assert.equal(resolveReasoningEffort(option.id, config), option.id === "off" ? undefined : option.id);
		}
	}
});

/**
 * The contract, model by model: what each one's `reasoning.effort` accepts, `off` standing for
 * `none`. Codex models without a documented line follow Codex's own presets.
 */
const DOCUMENTED: Record<string, string[]> = {
	"gpt-6.1-sol": ["low", "medium", "high", "xhigh", "max"],
	"gpt-6-astra": ["low", "medium", "high", "xhigh", "max"],
	"gpt-6-sol": ["off", "low", "medium", "high", "xhigh", "max"],
	"gpt-6-luna": ["off", "low", "medium", "high", "xhigh", "max"],
	"gpt-5.6": ["off", "low", "medium", "high", "xhigh", "max"],
	"gpt-5.6-sol": ["off", "low", "medium", "high", "xhigh", "max"],
	"gpt-5.6-terra": ["off", "low", "medium", "high", "xhigh", "max"],
	"gpt-5.6-luna": ["off", "low", "medium", "high", "xhigh", "max"],
	"gpt-5.5": ["off", "low", "medium", "high", "xhigh"],
	"gpt-5.5-pro": ["medium", "high", "xhigh"],
	"gpt-5.4": ["off", "low", "medium", "high", "xhigh"],
	"gpt-5.4-mini": ["off", "low", "medium", "high", "xhigh"],
	"gpt-5.4-nano": ["off", "low", "medium", "high", "xhigh"],
	"gpt-5.4-pro": ["medium", "high", "xhigh"],
	"gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
	"gpt-5.2": ["off", "low", "medium", "high", "xhigh"],
	"gpt-5.2-pro": ["medium", "high", "xhigh"],
	"gpt-5.2-codex": ["low", "medium", "high", "xhigh"],
	"gpt-5.2-chat-latest": ["medium"],
	"gpt-5.1": ["off", "low", "medium", "high"],
	"gpt-5.1-codex-max": ["low", "medium", "high", "xhigh"],
	"gpt-5.1-codex": ["low", "medium", "high"],
	"gpt-5.1-codex-mini": ["medium", "high"],
	"gpt-5": ["minimal", "low", "medium", "high"],
	"gpt-5-mini": ["minimal", "low", "medium", "high"],
	"gpt-5-nano": ["minimal", "low", "medium", "high"],
	"gpt-5-pro": ["high"],
	"gpt-5-codex": ["low", "medium", "high"],
	"o3": ["low", "medium", "high"],
	"o3-pro": ["low", "medium", "high"],
	"o4-mini": ["low", "medium", "high"],
	"o1": ["low", "medium", "high"],
	"gpt-oss-120b": ["low", "medium", "high"],
};

test("每个 OpenAI 模型拿到的正是它的接口收的那几档", () => {
	for (const [id, levels] of Object.entries(DOCUMENTED)) {
		assert.deepEqual(ids(id), levels, `${id} 的档位不对`);
	}
});

test("GPT 的档位不认前缀、日期快照和大小写", () => {
	// Relays put a vendor in front, Bedrock a dot, and pinned snapshots a date behind.
	assert.deepEqual(ids("openai/gpt-6.1-sol"), DOCUMENTED["gpt-6.1-sol"]);
	assert.deepEqual(ids("azure/gpt-5.4-mini"), DOCUMENTED["gpt-5.4-mini"]);
	assert.deepEqual(ids("gpt-5.4-2026-03-05"), DOCUMENTED["gpt-5.4"]);
	assert.deepEqual(ids("gpt-5-2025-08-07"), DOCUMENTED["gpt-5"]);
	assert.deepEqual(ids("GPT-6.1-Sol"), DOCUMENTED["gpt-6.1-sol"]);
	assert.deepEqual(ids("gpt6-astra"), DOCUMENTED["gpt-6-astra"]);
	assert.deepEqual(ids("openai-gpt-6-astra-pro"), DOCUMENTED["gpt-6-astra"]);
	assert.deepEqual(ids("openai.gpt-oss-120b-1:0"), DOCUMENTED["gpt-oss-120b"]);
	assert.deepEqual(ids("o4-mini-2025-04-16"), DOCUMENTED["o4-mini"]);
});

test("没有一个 GPT 模型被给了 ultra——那是 Codex 界面上的别名，不是接口的取值", () => {
	for (const id of [...Object.keys(DOCUMENTED), "gpt-5.6-ultra", "gpt-6-astra-pro"]) {
		assert.ok(!ids(id).includes("ultra"), `${id} 竟然给了 ultra`);
	}
	assert.equal(resolveReasoningEffort("ultra", model("gpt-6-astra")), "max", "旧会话里存的 ultra 要落到 max");
});

test("GPT-5.6 不给 minimal：它的接口没有这一档", () => {
	for (const id of ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
		assert.ok(!ids(id).includes("minimal"), `${id} 竟然给了 minimal`);
	}
});

test("GPT-6 家族里没见过的成员拿到所有已知成员都收的那几档", () => {
	// Not the conservative four: two documented members reject its `off`, and all four take `xhigh`/`max`.
	for (const id of ["gpt-6-nebula", "gpt-6.2-sol", "gpt-6"]) {
		assert.deepEqual(ids(id), ["low", "medium", "high", "xhigh", "max"], `${id} 的档位不对`);
	}
});

test("vendor defaults: medium wherever the API documents it, high for the pro tiers that say so", () => {
	for (const id of ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4-pro", "gpt-5", "o3"]) {
		assert.deepEqual(defaultOf(id), ["medium"], `${id} 的默认档不对`);
	}
	assert.deepEqual(defaultOf("gpt-5.5-pro"), ["high"]);
	assert.deepEqual(defaultOf("gpt-5-pro"), ["high"]);
});

test("关不掉推理的模型上，「关」发的是它最低的一档，而不是会 400 的 none", () => {
	assert.equal(resolveReasoningEffort("off", model("gpt-6.1-sol")), "low");
	assert.equal(resolveReasoningEffort("off", model("gpt-6-astra")), "low");
	assert.equal(resolveReasoningEffort("off", model("gpt-5.3-codex")), "low");
	assert.equal(resolveReasoningEffort("off", model("gpt-5")), "minimal");
	assert.equal(resolveReasoningEffort("off", model("gpt-5.1-codex-mini")), "medium");
	assert.equal(resolveReasoningEffort("off", model("gpt-5-pro")), "high");
	// Unspecified is treated as off, as the adapters always have.
	assert.equal(resolveReasoningEffort(undefined, model("gpt-6.1-sol")), "low");
});

test("能关的模型上，「关」仍然是不发档位", () => {
	assert.equal(resolveReasoningEffort("off", model("gpt-5.6")), undefined);
	assert.equal(resolveReasoningEffort("off", model("gpt-6-sol")), undefined);
	assert.equal(resolveReasoningEffort(undefined, model("gpt-5.6")), undefined);
});

test("a level the model lacks lands on the nearest one it has, not on its default", () => {
	// Picked on one model, carried to another: `max` is still a request for the most it has.
	assert.equal(resolveReasoningEffort("max", model("gpt-5.5")), "xhigh");
	assert.equal(resolveReasoningEffort("max", model("gpt-5.1")), "high");
	assert.equal(resolveReasoningEffort("xhigh", model("gemini-3.0-pro")), "high");
	assert.equal(resolveReasoningEffort("minimal", model("gpt-6.1-sol")), "low");
	assert.equal(resolveReasoningEffort("low", model("gpt-5.4-pro")), "medium");
	assert.equal(resolveReasoningEffort("ultra", model("unknown-relay-model")), "high");
	// Moving shallower never reaches 「关」: some reasoning was asked for.
	assert.equal(resolveThinkingOption("minimal", model("unknown-relay-model"))?.id, "low");
});

test("only a level outside the standard line falls back to the model default", () => {
	assert.equal(resolveReasoningEffort("adaptive", model("gpt-6.1-sol")), "medium");
	assert.equal(resolveReasoningEffort("high", { ...model("x"), supportsThinking: false }), undefined);
	assert.equal(resolveThinkingOption("high", { ...model("x"), supportsThinking: false }), undefined);
	assert.deepEqual(resolveModelThinkingOptions({ ...model("x"), thinkingOptions: [] }), []);
});

/** What Google's API accepts, and nothing else. */
const GEMINI_SAFE = ["off", "low", "medium", "high"];

test("every Gemini variant is offered exactly the levels Google accepts", () => {
	for (const id of ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3.0-pro", "gemini-ultra", "gemini-3.0-ultra", "gemma-3"]) {
		assert.deepEqual(ids(id), GEMINI_SAFE, `${id} 的档位不对`);
	}
});

test("no Gemini model is ever offered a level its API rejects", () => {
	// The specific failure this is here for: `minimal` on a Google endpoint is an HTTP 400.
	for (const id of ["gemini-ultra", "gemini-3.0-ultra", "gemma-3-ultra"]) {
		const offered = ids(id);
		for (const forbidden of ["minimal", "xhigh", "max", "ultra"]) {
			assert.ok(!offered.includes(forbidden), `${id} 竟然给了 ${forbidden}`);
		}
	}
});

test("whatever is picked on a Gemini model, what goes out is one of three values", () => {
	// The clamp, which is the second line of defence and must keep working.
	const sent = new Set(
		["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].map((level) =>
			resolveReasoningEffort(level, model("gemini-ultra")),
		),
	);
	assert.deepEqual([...sent].sort(), ["high", "low", "medium"]);
});

test("names that only look like a GPT family are not one", () => {
	// `id.includes("5.6")` once matched the first and handed it GPT-5.6's levels.
	assert.deepEqual(ids("llama-5.6b"), GEMINI_SAFE);
	assert.deepEqual(ids("chatgpt-4o-latest"), GEMINI_SAFE);
	assert.deepEqual(ids("gpt-4o"), GEMINI_SAFE, "4o 里的 o 不是 o 系列");
	assert.deepEqual(ids("o1-mini"), GEMINI_SAFE, "o1-mini 早于这个参数");
	assert.deepEqual(ids("gpt-5-chat-latest"), GEMINI_SAFE, "gpt-5-chat 不是带档位的 gpt-5");
	assert.deepEqual(ids("gpt-5.7"), GEMINI_SAFE, "gpt-5.7 不是 gpt-5");
});

test("a model nobody recognises is offered the levels everything supports", () => {
	/*
	 * The fallback used to be GPT-5.6's seven, so an unknown model was offered `minimal`, `xhigh`
	 * and `max` — and the effort mapping passes those through unchanged for an id it cannot place.
	 * Picking one sent a string the endpoint may reject, which is the exact failure this file is
	 * supposed to prevent.
	 */
	for (const id of ["llama-5.6b", "deepseek-v4", "some-model-nobody-has-heard-of"]) {
		assert.deepEqual(ids(id), GEMINI_SAFE, `${id} 应该拿到最保守的一组`);
	}
});

test("a conservative default does not silently downgrade a model that declares more", () => {
	// The escape hatch: configuration outranks inference, so nothing is capped that said otherwise.
	const rich = {
		...model("some-model-nobody-has-heard-of"),
		thinkingOptions: [{ id: "low" as const, label: "低", detail: "" }, { id: "max" as const, label: "最高", detail: "" }],
	};
	assert.deepEqual(resolveModelThinkingOptions(rich).map((o) => o.id), ["low", "max"]);
});

test("a model that declares its own levels is taken at its word", () => {
	const custom = { ...model("gpt-6.1-sol"), thinkingOptions: [{ id: "low" as const, label: "低", detail: "" }] };
	assert.deepEqual(resolveModelThinkingOptions(custom).map((o) => o.id), ["low"]);
});

test("a configured ladder without off still turns reasoning off; only a built-in one knows it cannot", () => {
	// A ladder in the model's configuration lists what can be picked while it reasons — it says nothing
	// about whether it can stop, so off stays the request for none it was before ladders existed.
	const custom = { ...model("claude-relay"), thinkingOptions: [{ id: "adaptive", label: "自适应", detail: "", budgetTokens: 2048 }] };
	assert.equal(resolveThinkingOption("off", custom), undefined);
	assert.equal(resolveReasoningEffort("off", custom), undefined);
	assert.equal(resolveReasoningEffort("max", custom), "adaptive", "其余档位照常落到它有的那一档");
	assert.equal(resolveThinkingOption("off", model("gpt-6.1-sol"))?.id, "low");
});

test("a model that cannot think is offered nothing", () => {
	assert.deepEqual(resolveModelThinkingOptions({ ...model("x"), supportsThinking: false }), []);
	assert.deepEqual(resolveModelThinkingOptions(null), []);
});

/** The request body the Responses adapter builds for `thinking`, captured before it is sent. */
async function responsesReasoning(modelId: string, thinking: string): Promise<unknown> {
	const { openaiResponsesProvider } = await import("../src/ai/openai-responses.ts");
	let payload: Record<string, unknown> | null = null;
	const stream = openaiResponsesProvider.stream(
		{ id: "test", name: "test", baseUrl: "https://example.invalid", api: "openai-responses", apiKey: "test", enabled: true, models: [] },
		model(modelId),
		{ systemPrompt: "", messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }], tools: [] },
		{
			thinking,
			// A 400 ends the stream after the one request whose body is being looked at.
			fetch: (async () => new Response(JSON.stringify({ error: { message: "mock" } }), { status: 400 })) as typeof fetch,
			onPayload: (body) => {
				payload = body as Record<string, unknown>;
			},
		},
	);
	try {
		await stream.next();
	} catch {
		// The mock's 400.
	}
	assert.ok(payload, `${modelId} 没有发出请求`);
	return (payload as Record<string, unknown>).reasoning;
}

test("Gemini models never receive effort none when thinking is off in openai-responses adapter", async () => {
	assert.equal(await responsesReasoning("gemini-3.7-flash-high", "off"), undefined, "Gemini with thinking: 'off' must not have reasoning property");
	assert.deepEqual(await responsesReasoning("gpt-5.6", "off"), { effort: "none" }, "GPT with thinking: 'off' retains effort: 'none'");
});

test("关思考发到 GPT-6.1 Sol 上的是 low，选了「最高」发的是 max", async () => {
	// The request the screenshot's conversation made: `none` here is the 400 OpenAI documents.
	assert.deepEqual(await responsesReasoning("gpt-6.1-sol", "off"), { effort: "low", summary: "auto" });
	assert.deepEqual(await responsesReasoning("gpt-6.1-sol", "max"), { effort: "max", summary: "auto" });
	assert.deepEqual(await responsesReasoning("gpt-6.1-sol", "xhigh"), { effort: "xhigh", summary: "auto" });
});
