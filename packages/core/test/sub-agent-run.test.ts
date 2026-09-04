/**
 * `runSubAgent` driving the registry, with a fake model on the other end.
 *
 * The registry has tests of its own; what those cannot reach is whether the run actually feeds it —
 * whether a transcript arrives, whether a steering message reaches the loop, whether a run that
 * threw is marked instead of being left as "running" forever. Every one of those failures is
 * silent: the roster looks plausible and is wrong.
 *
 * Driven through the real `runSubAgent` with a stand-in `streamFn`, because the interesting part is
 * the wiring between it, `runTurn` and the registry — three pieces that each work alone.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { runSubAgent } from "../src/runtime/sub-agent.ts";
import { SubAgentRegistry } from "../src/runtime/sub-agents.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig, Settings, Tool } from "../src/types.ts";
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
	return { ...says("", "toolUse"), content: [{ type: "toolCall", id: "c1", name: "noop", arguments: {}, argumentsText: "{}" }] };
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

/**
 * Dispatch one sub-agent against a scripted model.
 *
 * `onTurn` runs before each reply is handed back, which is the only place a test can act "while it
 * is running" — steering, aborting — without a timer to race against.
 */
async function dispatch(options: {
	replies: AssistantMessage[];
	onTurn?: (turn: number, registry: SubAgentRegistry, id: string) => void;
	signal?: AbortSignal;
}) {
	const registry = new SubAgentRegistry();
	const events: AgentEvent[] = [];
	let turn = 0;

	const answer = await runSubAgent(
		{
			sessionId: "s1",
			cwd: "/tmp",
			settings: { thinking: "off", retryAttempts: 0 } as unknown as Settings,
			tools: [noop],
			skills: [],
			agents: [],
			signal: options.signal,
			registry,
			requestApproval: async () => "allow",
			emit: async (event) => {
				events.push(event);
			},
			streamFn: async () => {
				const id = registry.list()[0]?.id ?? "";
				options.onTurn?.(turn, registry, id);
				return options.replies[Math.min(turn++, options.replies.length - 1)];
			},
		},
		{ description: "找登录入口", prompt: "去找", agentType: "general" },
		PROVIDER,
		MODEL,
		"# Environment\ncwd: /tmp\n",
	);

	return { registry, events, answer, turns: turn };
}

test("a dispatched sub-agent is registered before it starts, and finished when it ends", () => {
	return dispatch({ replies: [says("在 auth.ts:42")] }).then(({ registry, answer }) => {
		const one = registry.list()[0];
		assert.equal(one.description, "找登录入口");
		assert.equal(one.agent, "general");
		assert.equal(one.status, "done");
		assert.equal(one.answer, "在 auth.ts:42");
		assert.equal(answer.text, "在 auth.ts:42", "and the parent gets the same thing");
		assert.equal(answer.output, undefined, "an agent with no declared schema returns prose, as it always did");
		assert.equal(registry.running, 0);
	});
});

test("its transcript is recorded as it speaks", async () => {
	// The whole point of the pane: what the sub-agent did, not just what it concluded.
	const { registry } = await dispatch({ replies: [callsNoop(), says("看完了")] });
	const id = registry.list()[0].id;
	const transcript = registry.detail(id)?.messages ?? [];

	assert.ok(transcript.length >= 3, `expected prompt + tool call + result + answer, got ${transcript.length}`);
	assert.equal(transcript[0].role, "user", "starting with what it was asked");
	assert.ok(
		transcript.some((m) => m.role === "assistant" && m.content.some((c) => c.type === "toolCall")),
		"including the tool call",
	);
});

test("tool calls are counted and the newest one is kept, for 'is this stuck?'", async () => {
	const { registry } = await dispatch({ replies: [callsNoop(), says("好了")] });
	const one = registry.list()[0];

	assert.equal(one.toolCalls, 1);
	assert.equal(one.lastActivity, "看了一眼");
});

test("a message steered mid-run reaches the sub-agent's own history", async () => {
	/*
	 * The claim the pane's composer rests on. Steering is not a second conversation — it is spliced
	 * between turns, so the next request the sub-agent makes contains it and it carries on with
	 * everything it already had.
	 */
	const seen: string[][] = [];
	const registry = new SubAgentRegistry();
	let turn = 0;

	await runSubAgent(
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
				seen.push(
					context.messages.flatMap((m) =>
						m.role === "user" ? m.content.filter((c) => c.type === "text").map((c) => c.text) : [],
					),
				);
				if (turn === 0) registry.steer(registry.list()[0].id, "别看测试目录");
				turn += 1;
				return turn === 1 ? callsNoop() : says("换了方向");
			},
		},
		{ description: "找登录入口", prompt: "去找", agentType: "general" },
		PROVIDER,
		MODEL,
		"",
	);

	assert.deepEqual(seen[0], ["去找"], "the first request is just the dispatch prompt");
	assert.ok(seen[1].includes("别看测试目录"), `steering did not reach the loop: ${JSON.stringify(seen[1])}`);
	assert.ok(seen[1].includes("去找"), "and its original context is still there — it did not start over");
});

test("steering is refused once it has finished, rather than queued for a loop that has stopped", async () => {
	const { registry } = await dispatch({ replies: [says("完成")] });
	const id = registry.list()[0].id;

	assert.equal(registry.steer(id, "再看看"), null);
});

test("a run that throws is marked failed, not left running", async () => {
	// The silent one: a record stuck on `running` is indistinguishable from work in progress, so
	// the roster shows a spinner for something that died.
	const registry = new SubAgentRegistry();

	await assert.rejects(() =>
		runSubAgent(
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
				streamFn: async () => {
					throw new Error("provider exploded");
				},
			},
			{ description: "会炸的活", prompt: "去", agentType: "general" },
			PROVIDER,
			MODEL,
			"",
		),
	);

	const one = registry.list()[0];
	assert.equal(one.status, "failed");
	assert.match(one.error ?? "", /provider exploded/);
	assert.equal(registry.running, 0);
});

test("aborting one sub-agent stops it and records it as stopped rather than failed", async () => {
	/*
	 * Pressing stop is not an error. Recording it as one would put a failure in the parent's
	 * transcript for a button the user pressed on purpose.
	 */
	const { registry } = await dispatch({
		replies: [callsNoop(), callsNoop(), says("不该走到这里")],
		onTurn: (turn, reg, id) => {
			if (turn === 1) reg.abort(id);
		},
	});

	const one = registry.list()[0];
	assert.equal(one.status, "aborted");
	assert.equal(registry.running, 0);
});

test("the parent's own abort still reaches a sub-agent", async () => {
	// Chaining the controllers is what keeps "the session went away" working while making
	// "stop this one" local — losing the first would leave orphans running past the session.
	const parent = new AbortController();
	const { registry } = await dispatch({
		replies: [callsNoop(), says("不该走到这里")],
		signal: parent.signal,
		onTurn: (turn) => {
			if (turn === 1) parent.abort();
		},
	});

	assert.equal(registry.running, 0);
	assert.equal(registry.list()[0].status, "aborted");
});

test("the transcript is emitted for a live window as well as recorded", async () => {
	const { events } = await dispatch({ replies: [says("好")] });
	const streamed = events.filter((event) => event.type === "subagent_message");

	assert.ok(streamed.length > 0, "a window watching gets the messages without polling");
	assert.ok(
		streamed.every((event) => event.type === "subagent_message" && event.id.startsWith("s1:sub:")),
		"each carrying which sub-agent it came from",
	);
});
