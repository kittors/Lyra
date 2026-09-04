/**
 * Smoke: can we reach a model at all, and does it call tools?
 *
 * Everything else in this directory depends on this working, so it is its own file and it runs
 * first. It reuses the app's own settings and credential path rather than reading keys itself —
 * a harness that authenticates differently from the product is a harness that can pass while the
 * product is broken.
 */

import { streamAssistant } from "../../packages/core/src/ai/index.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import type { AssistantMessage, ToolSpec } from "../../packages/core/src/types.ts";

const MODEL_ID = process.env.LYRA_EVAL_MODEL ?? "relay/gemini-3.7-flash-high";

const ECHO_TOOL: ToolSpec = {
	name: "echo",
	description: "Return the text you are given. Call this exactly once with the word the user asks for.",
	parameters: {
		type: "object",
		properties: { text: { type: "string", description: "The text to echo." } },
		required: ["text"],
		additionalProperties: false,
	},
};

async function main(): Promise<void> {
	const settings = await loadSettings();
	const resolved = resolveModel(settings, MODEL_ID);
	if (!resolved) {
		const ids = settings.providers.flatMap((p) => p.models.map((m) => m.id));
		throw new Error(`Model ${MODEL_ID} not found. Available: ${ids.slice(0, 5).join(", ")}…`);
	}

	const { provider, model } = resolved;
	console.log(`provider=${provider.id} api=${provider.api} baseUrl=${provider.baseUrl}`);
	console.log(`model=${model.modelId} key=${provider.apiKey ? "present" : "MISSING"}`);

	const started = Date.now();
	const stream = streamAssistant(
		provider,
		model,
		{
			systemPrompt: "You are a test fixture. Follow instructions exactly.",
			messages: [{ role: "user", content: [{ type: "text", text: "Call the echo tool with the word: pineapple" }], timestamp: Date.now() }],
			tools: [ECHO_TOOL],
		},
		{ maxTokens: 512, retryAttempts: 2 },
	);

	let deltas = 0;
	let final: AssistantMessage | undefined;
	while (true) {
		const next = await stream.next();
		if (next.done) {
			final = next.value;
			break;
		}
		if (next.value.type === "toolcall_delta" || next.value.type === "text_delta") deltas += 1;
	}

	const elapsed = Date.now() - started;
	const calls = final?.content.filter((c) => c.type === "toolCall") ?? [];
	console.log(`\nelapsed=${elapsed}ms deltas=${deltas} stopReason=${final?.stopReason}`);
	console.log(`toolCalls=${calls.length}`);
	for (const call of calls) {
		if (call.type !== "toolCall") continue;
		console.log(`  ${call.name}(${JSON.stringify(call.arguments)})`);
	}

	const ok = calls.length === 1 && JSON.stringify(calls[0]).includes("pineapple");
	console.log(ok ? "\n✓ smoke passed" : "\n✗ smoke FAILED");
	if (!ok) process.exitCode = 1;
}

await main();
