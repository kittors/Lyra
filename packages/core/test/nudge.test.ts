import assert from "node:assert/strict";
import { test } from "node:test";
import { runAgent } from "../src/agent/loop.ts";
import { TODOS_KEY, type TodoItem } from "../src/tools/todo.ts";
import type { AssistantMessage, Message, ModelConfig, ProviderConfig, Tool } from "../src/types.ts";
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

function base(): Omit<AssistantMessage, "content"> {
	return {
		role: "assistant",
		api: "openai-responses",
		provider: "fake",
		model: "model",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/** The shape of the failure: a sentence about what comes next, and no tool call. */
const narrates = (text: string): AssistantMessage => ({ ...base(), content: [{ type: "text", text }] });

const callsTool = (): AssistantMessage => ({
	...base(),
	stopReason: "toolUse",
	content: [{ type: "toolCall", id: "c1", name: "noop", arguments: {}, argumentsText: "{}" }],
});

const noop: Tool = {
	name: "noop",
	snippet: "does nothing",
	description: "does nothing",
	parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
	async execute() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

function todos(...statuses: TodoItem["status"][]): TodoItem[] {
	return statuses.map((status, i) => ({ content: `step ${i}`, status }));
}

async function run(
	replies: AssistantMessage[],
	plan: TodoItem[],
	/** Lets a turn update the plan, the way `todo_write` would. */
	mutate?: (turn: number, state: Map<string, unknown>) => void,
) {
	const prompts: Message[][] = [];
	const state = new Map<string, unknown>([[TODOS_KEY, plan]]);
	let turn = 0;
	const result = await runAgent(
		{
			sessionId: "test",
			cwd: "/tmp",
			provider: PROVIDER,
			model: MODEL,
			systemPrompt: "",
			tools: [noop],
			messages: [{ role: "user", content: [{ type: "text", text: "do the work" }], timestamp: 1 }],
			maxTurns: 12,
			// The list the agent would have written with `todo_write`.
			state,
			streamFn: async (context) => {
				prompts.push([...context.messages]);
				mutate?.(turn, state);
				return replies[Math.min(turn++, replies.length - 1)];
			},
		},
		() => {},
	);
	return { result, prompts, turns: turn };
}

/** Mirrors `MAX_NUDGES` in the loop; the give-up point is part of the contract being tested. */
const MAX_NUDGES = 3;

const nudgeCount = (messages: Message[]) =>
	messages.filter((m) => m.role === "user" && m.content.some((c) => c.type === "text" && c.text.includes("自动继续")))
		.length;

test("unfinished todos cannot override a question or a requested text-only report", async () => {
	for (const text of ["请问现在是否可以开始修改代码？", "按你的要求仅输出分析，等待确认。", "Analysis complete. Awaiting your decision."]) {
		const { result, turns } = await run([narrates(text)], todos("completed", "in_progress", "pending"));
		assert.equal(turns, 1, text);
		assert.equal(nudgeCount(result.messages), 0);
		assert.equal(result.reason, "done");
	}
});

test("an unfinished checklist alone cannot authorize another model request", async () => {
	const { result, turns } = await run([narrates("后端完成，现在做前台页面")], todos("completed", "pending"));
	assert.equal(turns, 1);
	assert.equal(nudgeCount(result.messages), 0);
	assert.equal(result.reason, "done");
});

test("a finished plan is left alone", async () => {
	const { result, turns } = await run([narrates("all done")], todos("completed", "completed"));
	assert.equal(turns, 1);
	assert.equal(nudgeCount(result.messages), 0);
	assert.equal(result.reason, "done");
});

test("a conversation with no plan at all is never nudged", async () => {
	const { result, turns } = await run([narrates("hello")], []);
	assert.equal(turns, 1);
	assert.equal(nudgeCount(result.messages), 0);
});

test("empty retries remain bounded even when interleaved with tools", async () => {
	const empty: AssistantMessage = { ...base(), content: [] };
	const { result } = await run([empty, callsTool(), empty, callsTool(), empty, callsTool(), empty], todos("pending"));
	assert.equal(nudgeCount(result.messages), MAX_NUDGES);
	assert.equal(result.reason, "error");
	assert.match(result.error ?? "", /空回复/);
});

test("an empty reply is nudged even before there is a plan", async () => {
	/*
	 * The case that killed a real run four messages in: the model spent its turn thinking, emitted
	 * no text and called nothing, and an empty workspace was read as a finished job.
	 */
	const empty: AssistantMessage = { ...base(), content: [] };
	const { result, turns } = await run([empty, narrates("开始建项目骨架")], []);

	assert.equal(nudgeCount(result.messages), 1, "the silence was not taken for an answer");
	assert.equal(turns, 2, "and it was asked again");
});

test("an ordinary reply with no plan is still left alone", async () => {
	const { result } = await run([narrates("好的，已经完成了")], []);
	assert.equal(nudgeCount(result.messages), 0, "saying something is answering");
});

/*
 * The three below are a fence around wording, put up after a pass at catching plan-only stalls
 * by matching phrases — 「随时告诉我」, 「准备就绪」, 「请问是否」 — in the reply. Each of those is
 * ordinary at the end of a finished answer, so each turned into a nudge telling a model with
 * nothing left to do to go and call a tool. What a reply says is not evidence about what it owed.
 */
test("a finished answer that signs off politely is not mistaken for a stall", async () => {
	const { result, turns } = await run([narrates("这个函数把 SID 规范化。还有别的问题随时告诉我。")], []);
	assert.equal(nudgeCount(result.messages), 0, "answering and then being polite is still answering");
	assert.equal(turns, 1);
});

test("a completion report is not mistaken for a stall", async () => {
	const { result } = await run(
		[narrates("修改完成，测试已通过，构建环境准备就绪。")],
		todos("completed", "completed"),
	);
	assert.equal(nudgeCount(result.messages), 0, "reporting that it is done is not stopping short");
});

test("a question the user has to answer is left standing", async () => {
	// Two files could be meant and the answer changes the edit, so asking *is* the work this turn.
	const { result } = await run([narrates("有两个同名配置文件，请问是否两个都要改？")], []);
	assert.equal(nudgeCount(result.messages), 0, "a question worth asking is not a pause to push past");
});

test("a checklist created during this run does not override a later text reply", async () => {
	const { result, turns } = await run(
		[callsTool(), narrates("清单已经记下，等待确认")], [],
		(turn, state) => { if (turn === 1) state.set(TODOS_KEY, todos("in_progress", "pending")); },
	);
	assert.equal(nudgeCount(result.messages), 0);
	assert.equal(turns, 2);
	assert.equal(result.reason, "done");
});
