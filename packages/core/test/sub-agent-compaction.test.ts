/* oxlint-disable react-hooks/rules-of-hooks -- `useCompaction` installs the compaction strategy; the name predates this rule and has nothing to do with React */

/**
 * A delegated run compacts its own context, the same way the session that dispatched it does.
 *
 * It was the one that did not. `runSubAgent` built its `runTurn` config without a `compact`
 * callback, so a sub-agent's history only ever grew — and a sub-agent is the run most likely to
 * need compaction, because sixty turns of reading files is precisely what it is dispatched to do.
 * What that looked like was not degradation but a wall: the provider refuses the request for being
 * over the window, `task` turns the throw into a tool error, and delegation appears to fail on big
 * jobs while working on small ones.
 *
 * Driven through the real `runSubAgent` with the compaction strategy replaced, because what is
 * being checked is the wiring — that the loop is handed a `compact` at all, and that it is handed
 * this run's own overhead rather than the parent's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { useCompaction } from "../src/runtime/compaction.ts";
import { runSubAgent } from "../src/runtime/sub-agent.ts";
import { SubAgentRegistry } from "../src/runtime/sub-agents.ts";
import type { AssistantMessage, Message, ModelConfig, ProviderConfig, Settings, Tool } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model",
	providerId: "fake",
	modelId: "model",
	name: "Fake",
	contextWindow: 100_000,
	maxOutputTokens: 4096,
	supportsThinking: false,
	supportsImages: false,
	supportsTools: true,
};

const PROVIDER: ProviderConfig = {
	id: "fake",
	name: "Fake",
	baseUrl: "http://localhost",
	api: "openai-responses",
	apiKey: "x",
	enabled: true,
	models: [MODEL],
};

function says(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		api: "openai-responses",
		provider: "fake",
		model: "model",
		usage: emptyUsage(),
		stopReason,
		timestamp: Date.now(),
		content: [{ type: "text", text }],
	};
}

function callsNoop(): AssistantMessage {
	return {
		...says("", "toolUse"),
		content: [{ type: "toolCall", id: `c${Math.floor(performance.now() * 1000) % 100000}`, name: "noop", arguments: {}, argumentsText: "{}" }],
	};
}

const noop: Tool = {
	name: "noop",
	snippet: "does nothing",
	description: "does nothing",
	parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
	summarize: () => "看了一眼",
	async execute() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

interface Seen {
	messages: Message[];
	model: ModelConfig;
}

/** Run one sub-agent with the compaction strategy replaced, and report what it was asked to compact. */
async function dispatch(replies: AssistantMessage[], compaction: { squash: boolean }) {
	const seen: Seen[] = [];
	useCompaction({
		compact: async (messages, model) => {
			seen.push({ messages: [...messages], model });
			if (!compaction.squash) return null;
			// A summary and the last message, which is the shape the loop expects back.
			return {
				messages: [
					{ role: "user", content: [{ type: "text", text: "【摘要】前面读了一堆文件" }], timestamp: 1, synthetic: true },
					messages[messages.length - 1]!,
				],
				summary: "前面读了一堆文件",
				kept: 1,
			};
		},
	});

	try {
		let turn = 0;
		const registry = new SubAgentRegistry();
		const requests: Message[][] = [];
		const answer = await runSubAgent(
			{
				sessionId: "s1",
				cwd: "/tmp",
				settings: { thinking: "off", retryAttempts: 0 } as unknown as Settings,
				tools: [noop],
				skills: [],
				agents: [],
				registry,
				requestApproval: async () => "allow",
				emit: async () => {},
				streamFn: async (context) => {
					requests.push([...context.messages]);
					return replies[Math.min(turn++, replies.length - 1)]!;
				},
			},
			{ description: "找登录入口", prompt: "去找", agentType: "general" },
			PROVIDER,
			MODEL,
			"",
		);
		return { seen, requests, answer, registry };
	} finally {
		useCompaction(null);
	}
}

test("a delegated run is given a compaction pass at all", async () => {
	const { seen } = await dispatch([says("找到了")], { squash: false });

	assert.ok(seen.length > 0, "the loop was handed no `compact`, so a long run could only grow until it broke");
	assert.equal(seen[0].model.id, "fake/model", "and it compacts against the model it is actually running on");
});

test("it is asked before every request, not only the first", async () => {
	const { seen } = await dispatch([callsNoop(), says("看完了")], { squash: false });

	assert.equal(seen.length, 2, "two requests, two chances to notice the window filling up");
});

test("what comes back replaces the history the sub-agent carries on with", async () => {
	const { requests } = await dispatch([callsNoop(), says("看完了")], { squash: true });

	assert.ok(requests.length >= 2);
	const second = requests[1].flatMap((m) => m.content.filter((c) => c.type === "text").map((c) => c.text));
	assert.ok(
		second.some((text) => text.includes("【摘要】")),
		`the compacted history did not reach the provider: ${JSON.stringify(second)}`,
	);
});

test("compacting does not derail the run — it still answers", async () => {
	const { answer, registry } = await dispatch([callsNoop(), says("在 auth.ts:42")], { squash: true });

	assert.equal(answer.text, "在 auth.ts:42");
	assert.equal(registry.list()[0].status, "done");
});

test("what it compacts is its own history, not the parent's", async () => {
	// The dispatch prompt is the sub-agent's first message. Seeing it here is what says the
	// callback was built against this run rather than handed down from the session.
	const { seen } = await dispatch([says("好")], { squash: false });

	const texts = seen[0].messages.flatMap((m) => m.content.filter((c) => c.type === "text").map((c) => c.text));
	assert.deepEqual(texts, ["去找"]);
});
