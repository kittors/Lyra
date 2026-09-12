/**
 * That binding a compaction strategy does not turn features off.
 *
 * `compactWith` used to take seven positional arguments and forward four of them to the bound
 * strategy. The desktop binds one at boot, so on the only host that ships, automatic compaction
 * ran with no overhead accounting (the threshold ignored the system prompt and every tool schema,
 * which is the case the code's own comment says lands over the line and then compacts on every
 * turn), no artifact sink (so a pruned placeholder advertised an `artifact://` address that had
 * nothing behind it) and no summarizer (so the `@compact` model role was ignored). All three
 * type-checked. None of it was visible.
 *
 * These tests fail against that shape and are cheap to keep, which is the point: the request is
 * one object now, and a field added to it either reaches the strategy or fails to compile.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "../src/kernel/index.ts";
import { COMPACTION, type CompactionRequest, type CompactionStrategy } from "../src/kernel/services.ts";
import { compactWith, useCompaction } from "../src/runtime/compaction.ts";
import { estimateTokens } from "../src/tokens.ts";
import type { AssistantMessage, Message, ModelConfig, ProviderConfig } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model",
	providerId: "fake",
	modelId: "model",
	name: "Fake",
	contextWindow: 10_000,
	maxOutputTokens: 1000,
	supportsThinking: false,
	supportsImages: false,
	supportsTools: true,
};

const SUMMARY_MODEL: ModelConfig = { ...MODEL, id: "fake/cheap", modelId: "cheap", name: "Cheap" };

const PROVIDER: ProviderConfig = {
	id: "fake",
	name: "Fake",
	baseUrl: "http://localhost",
	api: "openai-responses",
	apiKey: "x",
	enabled: true,
	models: [MODEL, SUMMARY_MODEL],
};

const reply = (text: string): AssistantMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "openai-responses",
	provider: "fake",
	model: "model",
	usage: emptyUsage(),
	stopReason: "stop",
	timestamp: 1,
});

const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }];

/** Records what the seam was handed, and compacts nothing. */
function recorder(): { seen: CompactionRequest[]; strategy: CompactionStrategy } {
	const seen: CompactionRequest[] = [];
	return {
		seen,
		strategy: {
			compact: async (request) => {
				seen.push(request);
				return null;
			},
		},
	};
}

test("a bound strategy receives the whole request, not the first four arguments", async () => {
	const { seen, strategy } = recorder();
	const artifacts = { keep: () => "artifact://x" };
	const signal = new AbortController().signal;
	const stream = async function* () {
		yield { type: "start" as const, partial: reply("") };
		return reply("s");
	};
	useCompaction(strategy);
	try {
		await compactWith({
			messages,
			model: MODEL,
			provider: PROVIDER,
			streamFn: stream as never,
			overhead: 4321,
			force: true,
			artifacts,
			manual: { instructions: "focus on the migration", signal },
			summarizer: { provider: PROVIDER, model: SUMMARY_MODEL },
		});
	} finally {
		useCompaction(null);
	}

	assert.equal(seen.length, 1);
	const request = seen[0];
	assert.equal(request.overhead, 4321, "overhead reached the strategy");
	assert.equal(request.force, true, "force reached the strategy");
	assert.equal(request.artifacts, artifacts, "the artifact sink reached the strategy");
	assert.equal(request.manual?.instructions, "focus on the migration");
	assert.equal(request.manual?.signal, signal);
	assert.equal(request.summarizer?.model.modelId, "cheap", "the @compact summarizer reached the strategy");
	assert.equal(request.streamFn, stream as never, "the model seam reached the strategy");
});

test("the built-in strategy honours overhead the same way an unbound call does", async () => {
	/*
	 * Measured as behaviour, not as structure: overhead does not decide *whether* to compact — the
	 * threshold is checked against the provider's own count of the request that already happened —
	 * it decides how much tail can be afforded afterwards. So the observable consequence of losing
	 * it is a result that is too big, and next turn compacts again, and the turn after that.
	 *
	 * The same conversation through the seam twice, once with the prompt and schemas accounted for
	 * and once without. Dropping the field makes the two identical, which is the failure.
	 */
	const conversation: Message[] = [{ role: "user", content: [{ type: "text", text: "task" }], timestamp: 1 }];
	for (let i = 0; i < 40; i++) {
		conversation.push(reply(`step ${i} ${"detail ".repeat(170)}`));
		conversation.push({ role: "toolResult", toolCallId: `c${i}`, toolName: "read", content: [{ type: "text", text: `out ${i} ${"line ".repeat(240)}` }], isError: false, timestamp: 1 });
	}
	const stream = async function* () {
		yield { type: "start" as const, partial: reply("") };
		return reply("summary of the earlier work");
	};

	const ctx = await createContext();
	try {
		useCompaction(ctx.require<CompactionStrategy>(COMPACTION));
		const light = await compactWith({ messages: conversation, model: MODEL, provider: PROVIDER, streamFn: stream as never, overhead: 0 });
		const heavy = await compactWith({ messages: conversation, model: MODEL, provider: PROVIDER, streamFn: stream as never, overhead: 4000 });
		assert.ok(light && heavy, "both compacted");
		assert.ok(
			estimateTokens(heavy.messages) < estimateTokens(light.messages),
			`a 4000-token prompt leaves less room for history (${estimateTokens(heavy.messages)} vs ${estimateTokens(light.messages)})`,
		);
	} finally {
		useCompaction(null);
		await ctx.dispose();
	}
});

test("the built-in strategy forces when asked, which is what /compact needs", async () => {
	const conversation: Message[] = Array.from({ length: 20 }, (_, index) =>
		index % 2 ? reply(`Details ${index} ${"context ".repeat(150)}`) : { role: "user", content: [{ type: "text", text: `Task ${index} ${"requirements ".repeat(80)}` }], timestamp: 1 },
	);
	const wide = { ...MODEL, contextWindow: 1_000_000 };
	let requests = 0;
	const stream = async function* () {
		requests++;
		yield { type: "start" as const, partial: reply("") };
		return reply("Tasks and decisions preserved.");
	};

	const ctx = await createContext();
	try {
		useCompaction(ctx.require<CompactionStrategy>(COMPACTION));
		assert.equal(await compactWith({ messages: conversation, model: wide, provider: PROVIDER, streamFn: stream as never }), null, "precondition: nothing is needed in a million-token window");
		const forced = await compactWith({ messages: conversation, model: wide, provider: PROVIDER, streamFn: stream as never, force: true });
		assert.equal(requests, 1, "forcing summarises exactly once");
		assert.ok(forced && forced.kept !== undefined && forced.messages.length < conversation.length);
	} finally {
		useCompaction(null);
		await ctx.dispose();
	}
});
