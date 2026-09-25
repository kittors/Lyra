/**
 * 子代理的检查点、交接与续跑。
 *
 * 反馈原话：「子代理设置了 60 步，很容易跑满就导致啥活都没干好……重开三个子代理，都是 60 步，
 * 最后主会话看不下去了，自己做了。这不是白烧 token 嘛」。那条链上有四个环节，这里每个环节一组：
 *
 *   1. 到了检查点，清单在推进就接着跑（不再一刀切在 60）；
 *   2. 停下来的，不管什么类型都交一份交接（`general` 从前交的是停下前随口说的一句话）；
 *   3. 停下来的上下文留着，同一个 id 可以续跑，续跑的第一个请求原样接在它上一次看到的历史后面；
 *   4. 父模型被告知「它还在，用 resume」，而不是「拆小再派一次」。
 *
 * 断言一律落在模型实际收到的请求上（`streamFn` 拿到的 context），不读运行时内部状态——「续跑
 * 省了钱」这件事，只有请求的前缀逐字相同才成立。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { HANDOFF_SCHEMA, runSubAgent, SUB_AGENT_CHECKPOINT_TURNS } from "../src/runtime/sub-agent.ts";
import { SubAgentRegistry } from "../src/runtime/sub-agents.ts";
import { useCompaction } from "../src/runtime/compaction.ts";
import { taskTool } from "../src/tools/task.ts";
import { TODOS_KEY, todoTool, type TodoItem } from "../src/tools/todo.ts";
import { SUBAGENTS_KEY } from "../src/resources/handlers.ts";
import type { AgentDefinition } from "../src/agents-builtin.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import type { Settings } from "../src/config/settings.ts";
import type { AssistantMessage, LlmContext, Message, ModelConfig, ProviderConfig, Tool, ToolContext } from "../src/types.ts";
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

/** 检查点调小，测试不用跑六十轮；行为跟默认值是同一套。 */
const CHECKPOINT = 4;

/** 没有输出格式的通用子代理——反馈里那种。 */
const GENERAL: AgentDefinition = {
	name: "general",
	description: "通用",
	systemPrompt: "do the work",
	tools: "*",
	source: "builtin",
	maxTurns: CHECKPOINT,
};

const EXPLORE: AgentDefinition = {
	name: "explore",
	description: "只读搜索",
	systemPrompt: "read-only",
	tools: ["read"],
	source: "builtin",
	maxTurns: CHECKPOINT,
	output: {
		type: "object",
		required: ["summary", "files"],
		properties: { summary: { type: "string" }, files: { type: "array", items: { type: "object" } } },
	},
};

/** 记下它被读过什么，续跑之后能看出来有没有重读。 */
const read: Tool = {
	name: "read",
	snippet: "reads",
	description: "reads",
	parameters: { type: "object", properties: { path: { type: "string" } }, required: [], additionalProperties: false },
	summarize: (args) => `读 ${String((args as { path?: string }).path ?? "?")}`,
	async execute(args) {
		return { content: [{ type: "text", text: `内容：${String((args as { path?: string }).path ?? "?")}` }] };
	},
};

/** 把它自己状态图里的清单念出来——续跑之后状态还在不在，从它能看见什么来判断。 */
const peek: Tool = {
	name: "peek",
	snippet: "peek",
	description: "peek",
	parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
	summarize: () => "看清单",
	async execute(_args, ctx) {
		return { content: [{ type: "text", text: JSON.stringify(ctx.state.get(TODOS_KEY) ?? null) }] };
	},
};

function assistant(parts: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "toolUse"): AssistantMessage {
	return { role: "assistant", api: "openai-responses", provider: "fake", model: "model", usage: emptyUsage(), stopReason, timestamp: Date.now(), content: parts };
}
const says = (text: string) => assistant([{ type: "text", text }], "stop");
const call = (n: number, name: string, args: Record<string, unknown>) =>
	assistant([{ type: "toolCall", id: `c${n}-${name}`, name, arguments: args, argumentsText: JSON.stringify(args) }]);
/** 每次读不同的文件，重复检测不会把它当成打转。 */
const reads = (n: number) => call(n, "read", { path: `src/file-${n}.ts` });
const todos = (n: number, items: TodoItem[]) => call(n, "todo_write", { todos: items });
const yields = (n: number, value: Record<string, unknown>) => call(n, "yield", value);

const plan = (done: number, total = 4): TodoItem[] =>
	Array.from({ length: total }, (_, index) => ({
		content: `第 ${index + 1} 步`,
		status: index < done ? "completed" : index === done ? "in_progress" : "pending",
	}));

interface Harness {
	registry: SubAgentRegistry;
	events: AgentEvent[];
	/** 每一次请求：发了哪些消息、桌上有哪些工具。 */
	requests: { messages: Message[]; tools: string[] }[];
	run(input: { prompt: string; resume?: string; agentType?: string }, reply: (turn: number, context: LlmContext) => AssistantMessage | Promise<AssistantMessage>, options?: { dispatchId?: string }): ReturnType<typeof runSubAgent>;
}

function harness(agents: AgentDefinition[] = [GENERAL, EXPLORE]): Harness {
	const registry = new SubAgentRegistry();
	const events: AgentEvent[] = [];
	const requests: Harness["requests"] = [];
	return {
		registry,
		events,
		requests,
		run(input, reply, options = {}) {
			let turn = 0;
			return runSubAgent(
				{
					sessionId: "s1",
					cwd: "/tmp",
					settings: { thinking: "off", retryAttempts: 0 } as unknown as Settings,
					tools: [read, todoTool as unknown as Tool, peek],
					skills: [],
					agents,
					registry,
					requestApproval: async () => "once",
					emit: async (event) => {
						events.push(event);
					},
					streamFn: async (context) => {
						requests.push({ messages: [...context.messages], tools: context.tools.map((one) => one.name) });
						return reply(turn++, context);
					},
					...(options.dispatchId ? { dispatch: { depth: 1, chain: ["general"], id: options.dispatchId } } : {}),
				},
				{ description: "梳理登录流程", ...input },
				PROVIDER,
				MODEL,
				"",
			);
		},
	};
}

/** 只剩 yield 的那一轮就是讨交接的那一轮。 */
const onlyYield = (context: LlmContext) => context.tools.length === 1 && context.tools[0]?.name === "yield";
const text = (message: Message | undefined) =>
	message && "content" in message && Array.isArray(message.content)
		? message.content.map((part) => ("text" in part ? part.text : "")).join("")
		: "";

// ---------------------------------------------------------------------------
// 1. 检查点：清单在推进就接着跑
// ---------------------------------------------------------------------------

test("a checkpoint is not a wall: a plan that is being ticked off keeps going past it", async () => {
	/*
	 * 反馈的第一半：「很容易跑满就导致啥活都没干好」。一个在清单上一项项打勾的子代理，到了
	 * 检查点就该接着跑——和主会话的续跑链同一个判据。
	 */
	const h = harness();
	const total = CHECKPOINT * 3;
	const answer = await h.run({ prompt: "把四步做完" }, (turn, context) => {
		if (onlyYield(context)) assert.fail("a run that is moving must not be pressed for a handoff");
		if (turn === 0) return todos(turn, plan(0));
		// 每一段都打一个勾：第 1 段末尾完成 1 项，第 2 段完成 2 项……
		if (turn < total - 1) return turn % CHECKPOINT === CHECKPOINT - 1 ? todos(turn, plan(Math.floor(turn / CHECKPOINT) + 1)) : reads(turn);
		return says("四步都做完了：登录在 auth.ts:42");
	});

	assert.ok(h.requests.length > CHECKPOINT * 2, `it ran well past one checkpoint (${h.requests.length} requests)`);
	assert.equal(answer.text, "四步都做完了：登录在 auth.ts:42", "the answer is its own conclusion, with nothing to warn about");
	assert.equal(answer.incomplete, undefined);
	const notices = h.events.filter((event) => event.type === "subagent_event" && event.event.type === "notice");
	assert.ok(notices.length >= 1, "the continuation is said in its own pane");
	assert.ok(
		notices.every((event) => event.type === "subagent_event" && event.event.type === "notice" && /继续执行/.test(event.event.message)),
		"as a continuation",
	);
});

test("a plan that stops moving stops: two checkpoints without a tick, then a handoff", async () => {
	// 反过来的那一半：清单写了但一项都不打勾，接着跑只是烧钱。一段宽限（第一段可能全是读），第二段还不动就停。
	const h = harness();
	const answer = await h.run({ prompt: "做" }, (turn, context) => {
		if (onlyYield(context)) return yields(turn, { summary: "读了一堆，没理出头绪", remaining: "全部四步" });
		return turn === 0 ? todos(turn, plan(0)) : reads(turn);
	});

	const normal = h.requests.filter((request) => !(request.tools.length === 1 && request.tools[0] === "yield"));
	assert.equal(normal.length, CHECKPOINT * 2, `one grace segment, then it stopped (${normal.length} requests)`);
	assert.equal(answer.incomplete, true);
	assert.match(answer.text, /阶段性交接/);
});

// ---------------------------------------------------------------------------
// 2. 交接：不管什么类型都交
// ---------------------------------------------------------------------------

test("a general sub-agent stopped at a checkpoint hands over what it has, instead of its last stray sentence", async () => {
	/*
	 * 从前只有带 schema 的子代理有补交那一轮。`general` 到了上限交回的是「停下前最后说的话」——
	 * 读文件读到一半被截断的，最后说的多半是「让我再看看 xxx」。
	 */
	const h = harness();
	const answer = await h.run({ prompt: "梳理登录流程" }, (turn, context) => {
		if (onlyYield(context)) {
			return yields(turn, { summary: "入口在 auth.ts:42，令牌在 token.ts:10 签发", remaining: "刷新令牌那条路没看", next: "读 refresh.ts" });
		}
		return assistant([
			{ type: "text", text: `让我再看看 file-${turn}` },
			{ type: "toolCall", id: `c${turn}`, name: "read", arguments: { path: `src/file-${turn}.ts` }, argumentsText: "{}" },
		]);
	});

	const salvage = h.requests.at(-1)!;
	assert.deepEqual(salvage.tools, ["yield"], "the handoff round has nothing else on the table");
	assert.match(text(salvage.messages.at(-1)), /到检查点了/, "and it is told what the round is for");
	assert.match(text(salvage.messages.at(-1)), /上下文会原样留着/, "including that it may be continued, so the next step is written to be followed");
	assert.match(answer.text, /入口在 auth\.ts:42/, "the handoff is the answer");
	assert.match(answer.text, /refresh\.ts/, "with what is left and what comes next");
	assert.doesNotMatch(answer.text, /让我再看看/, "not the last thing it happened to say");
	assert.deepEqual(Object.keys(HANDOFF_SCHEMA.properties ?? {}), ["summary", "remaining", "next"]);
	assert.equal(answer.incomplete, true);
});

// ---------------------------------------------------------------------------
// 3. 续跑：同一个 id，原样接在它上一次看到的历史后面
// ---------------------------------------------------------------------------

test("resuming continues the same conversation: the first request is the old one with one message added", async () => {
	/*
	 * 这是省钱的那一条。续跑的第一个请求，前缀必须跟它停下前最后一个请求逐字相同——供应商的
	 * 前缀缓存才接得上，那几十轮历史才几乎不花钱。讨交接那一轮不该混进来：它说的是「这是最后
	 * 一轮」，续跑的时候不是。
	 */
	const h = harness();
	const first = await h.run({ prompt: "梳理登录流程" }, (turn, context) =>
		onlyYield(context) ? yields(turn, { summary: "看了四个文件", remaining: "还没看 refresh" }) : reads(turn),
	);
	assert.ok(first.id, "a sub-agent with a registry is given an id it can be continued by");
	const lastWorking = h.requests.findLast((request) => !request.tools.includes("yield") || request.tools.length > 1)!;
	const before = h.requests.length;

	const second = await h.run({ prompt: "接着把 refresh 那条路看完", resume: first.id }, (turn) =>
		turn === 0 ? reads(100) : says("refresh 在 refresh.ts:7，刷新时会轮换令牌"),
	);

	const resumed = h.requests[before]!;
	const prefix = JSON.stringify(lastWorking.messages);
	assert.ok(JSON.stringify(resumed.messages).startsWith(prefix.slice(0, -1)), "the resumed request starts with exactly what it last sent");
	assert.equal(text(resumed.messages.at(-1)), "接着把 refresh 那条路看完", "and ends with what it was told next");
	assert.ok(!resumed.messages.some((message) => /到检查点了/.test(text(message))), "the handoff exchange is not part of its working history");
	assert.ok(
		resumed.messages.some((message) => /内容：src\/file-2\.ts/.test(text(message))),
		"what it read before is still in front of it, so nothing has to be read again",
	);
	assert.ok(resumed.tools.includes("read") && resumed.tools.length > 1, "and it has its tools back");
	assert.equal(second.text, "refresh 在 refresh.ts:7，刷新时会轮换令牌");
	assert.equal(second.id, first.id, "same sub-agent");
	assert.equal(second.incomplete, undefined);
});

test("a resumed sub-agent is the same row on the roster, running again and then done again", async () => {
	const h = harness();
	const first = await h.run({ prompt: "看看" }, (turn, context) =>
		onlyYield(context) ? yields(turn, { summary: "看了", remaining: "还有" }) : reads(turn),
	);
	assert.equal(h.registry.list().length, 1);
	assert.equal(h.registry.list()[0]!.resumable, true, "a stopped one says it can be continued — the pane swaps 重新派发 for 接着跑 on this");
	assert.equal(h.registry.list()[0]!.incomplete, true);

	let seenRunning = false;
	await h.run({ prompt: "接着看", resume: first.id }, (turn) => {
		const row = h.registry.list()[0]!;
		seenRunning ||= row.status === "running" && row.resumable === undefined && row.incomplete === undefined;
		return turn === 0 ? reads(7) : says("看完了");
	});

	const rows = h.registry.list();
	assert.equal(rows.length, 1, "not a second sub-agent");
	assert.ok(seenRunning, "while it ran it was running, and the last segment's warning was gone");
	assert.equal(rows[0]!.status, "done");
	assert.equal(rows[0]!.incomplete, undefined, "this segment finished");
	assert.equal(rows[0]!.resumes, 1);
	assert.equal(rows[0]!.answer, "看完了");
	const transcript = new Set(h.registry.detail(first.id!)!.messages.map(text));
	assert.ok(transcript.has("看看") && transcript.has("接着看"), "one transcript, both instructions in it");
	const dispatched = h.events.filter((event) => event.type === "subagent");
	assert.equal(dispatched.length, 2);
	assert.equal(dispatched[1]!.type === "subagent" && dispatched[1]!.resumed, true, "the trace pairs the second report with a start of its own");
	assert.ok(
		h.events.some((event) => event.type === "subagent_message" && text(event.message) === "接着看"),
		"the new instruction reaches a pane that is already open",
	);
});

test("its own state comes back with it — the plan it wrote is still there when it resumes", async () => {
	const h = harness();
	const first = await h.run({ prompt: "做" }, (turn, context) => {
		if (onlyYield(context)) return yields(turn, { summary: "写了计划", remaining: "都没做" });
		if (turn === 0) return todos(turn, plan(0));
		return reads(turn);
	});
	await h.run({ prompt: "接着", resume: first.id }, (turn) => (turn === 0 ? call(0, "peek", {}) : says("好")));

	const peeked = h.requests.at(-1)!.messages.find((message) => message.role === "toolResult" && /第 1 步/.test(text(message)));
	assert.ok(peeked, "the list written before the stop is what it sees after the resume");
});

test("a sub-agent that had compacted resumes on its compacted history, not on the full one", async () => {
	/*
	 * 从转录重建会把压缩前的原文全部拿回来——子代理在同一个地方再撑爆一次。
	 * 续跑用的是模型最后看到的那一份。
	 */
	let compactions = 0;
	useCompaction({
		compact: async ({ messages }) => {
			if (compactions > 0 || messages.length < 6) return null;
			compactions += 1;
			return {
				messages: [{ role: "user", content: [{ type: "text", text: "【摘要】前面读了三个文件" }], timestamp: 1, synthetic: true }, messages.at(-1)!],
				summary: "前面读了三个文件",
				kept: 1,
			};
		},
	});
	try {
		const h = harness();
		const first = await h.run({ prompt: "读" }, (turn, context) =>
			onlyYield(context) ? yields(turn, { summary: "读了", remaining: "还有" }) : reads(turn),
		);
		const before = h.requests.length;
		await h.run({ prompt: "接着读", resume: first.id }, () => says("好了"));

		const resumed = h.requests[before]!;
		assert.ok(resumed.messages.some((message) => /【摘要】/.test(text(message))), "it resumes on the summary");
		assert.ok(!resumed.messages.some((message) => /内容：src\/file-0\.ts/.test(text(message))), "not on what the summary replaced");
		const salvage = h.requests[before - 1]!;
		assert.ok(salvage.messages.some((message) => /【摘要】/.test(text(message))), "and the handoff round was asked on the compacted history too");
	} finally {
		useCompaction(null);
	}
});

test("a schema agent resumes with a fresh yield: the handoff it gave last time is not its answer this time", async () => {
	const h = harness();
	const first = await h.run({ prompt: "找", agentType: "explore" }, (turn, context) =>
		onlyYield(context) ? yields(turn, { summary: "阶段一", files: [] }) : reads(turn),
	);
	// 续跑的这一段什么都不交就结束：拿到的不能是上一段那份。
	const second = await h.run({ prompt: "接着", resume: first.id }, () => says("没找到更多了"));

	assert.equal(second.output, undefined, "last segment's yield does not stand in for this one");
	assert.equal(second.text, "没找到更多了");
	assert.ok(h.requests.at(-1)!.tools.includes("yield") && h.requests.at(-1)!.tools.includes("read"), "it can still yield normally");
});

test("resuming is refused, with a sentence to act on, when it cannot work", async () => {
	const h = harness();
	await assert.rejects(h.run({ prompt: "接着", resume: "s1:sub:nothere" }, () => says("x")), /找不到子代理/);

	const first = await h.run({ prompt: "看" }, () => says("看完了"));
	await assert.rejects(
		h.run({ prompt: "接着", resume: first.id }, () => says("x"), { dispatchId: "s1:sub:someone-else" }),
		/不是你派出去的/,
		"only whoever dispatched it may continue it",
	);

	let resume: Promise<unknown> | undefined;
	const gate = Promise.withResolvers<void>();
	const running = h.run({ prompt: "慢慢看" }, async (turn) => {
		if (turn === 0) {
			const id = h.registry.list().at(-1)!.id;
			resume = h.run({ prompt: "插一句", resume: id }, () => says("x"));
			gate.resolve();
		}
		return says("看完了");
	});
	await gate.promise;
	await assert.rejects(resume!, /还在跑/);
	await running;

	const orphan = await runSubAgent(
		{
			sessionId: "s2",
			cwd: "/tmp",
			settings: { thinking: "off", retryAttempts: 0 } as unknown as Settings,
			tools: [read],
			skills: [],
			agents: [GENERAL],
			requestApproval: async () => "once",
			emit: async () => {},
			streamFn: async () => says("好"),
		},
		{ description: "d", prompt: "p" },
		PROVIDER,
		MODEL,
		"",
	);
	assert.equal(orphan.id, undefined, "a host with no registry keeps nothing, so it hands out no id to resume by");
});

test("the short tail of an id is enough to resume by", async () => {
	const h = harness();
	const first = await h.run({ prompt: "看" }, () => says("看完了"));
	const tail = first.id!.split(":").at(-1)!;
	const second = await h.run({ prompt: "再看一眼", resume: tail }, () => says("还是那样"));
	assert.equal(second.id, first.id);
});

// ---------------------------------------------------------------------------
// 4. 父模型听到的话
// ---------------------------------------------------------------------------

function taskContext(registry: SubAgentRegistry, spawn: ToolContext["spawnSubAgent"]): ToolContext {
	return {
		cwd: "/tmp",
		state: new Map<string, unknown>([
			[SUBAGENTS_KEY, registry],
			["agents", [GENERAL, EXPLORE]],
		]),
		spawnSubAgent: spawn,
	} as unknown as ToolContext;
}

test("the parent is told the sub-agent is still there and how to continue it — not to split the task and dispatch again", async () => {
	const registry = new SubAgentRegistry();
	const result = await taskTool.execute(
		{ description: "梳理", prompt: "梳理登录流程" },
		taskContext(registry, async () => ({ text: "⚠ 到了检查点……\n\n入口在 auth.ts:42", id: "s1:sub:abcd1234", incomplete: true })),
	);
	const said = text({ role: "user", content: result.content } as unknown as Message);

	assert.match(said, /resume: "s1:sub:abcd1234"/, "the exact call to make");
	assert.match(said, /\*\*不要\*\*重新派一个/, "and the one not to make");
	assert.doesNotMatch(said, /拆小/);
	assert.equal((result.details as { subAgentId?: string }).subAgentId, "s1:sub:abcd1234");
});

test("a finished sub-agent's id is handed over too, for a follow-up question", async () => {
	const result = await taskTool.execute(
		{ description: "找", prompt: "找登录入口" },
		taskContext(new SubAgentRegistry(), async () => ({ text: "在 auth.ts:42", id: "s1:sub:abcd1234" })),
	);
	const said = text({ role: "user", content: result.content } as unknown as Message);
	assert.ok(said.startsWith("在 auth.ts:42"), "the answer first");
	assert.match(said, /s1:sub:abcd1234/);
	assert.doesNotMatch(said, /不要/, "a clean finish carries no warning");
});

test("one the user stopped from the pane is not to be resumed on the model's own initiative", async () => {
	const result = await taskTool.execute(
		{ description: "找", prompt: "找" },
		taskContext(new SubAgentRegistry(), async () => ({ text: "读到一半", id: "s1:sub:abcd1234", stoppedByUser: true })),
	);
	const said = text({ role: "user", content: result.content } as unknown as Message);
	assert.match(said, /用户在面板上手动停下的/);
	assert.doesNotMatch(said, /resume: "/);
});

test("task routes a resume to the same sub-agent, and turns a refusal into the refusal itself", async () => {
	const h = harness();
	const first = await h.run({ prompt: "看" }, () => says("看完了"));
	let routed: unknown;
	const ok = await taskTool.execute(
		{ description: "接着", prompt: "再看看", resume: first.id!, subagent_type: "explore" },
		taskContext(h.registry, async (input) => {
			routed = input;
			return { text: "好", id: first.id };
		}),
	);
	assert.deepEqual(routed, { description: "接着", prompt: "再看看", agentType: "general", resume: first.id }, "it is general because that is what it was dispatched as");
	assert.equal(ok.isError, undefined);

	const refused = await taskTool.execute(
		{ description: "接着", prompt: "再看看", resume: "s1:sub:gone0000" },
		taskContext(h.registry, async () => assert.fail("a resume that cannot work must not dispatch anything")),
	);
	assert.equal(refused.isError, true);
	const said = text({ role: "user", content: refused.content } as unknown as Message);
	assert.match(said, /找不到子代理/);
	assert.doesNotMatch(said, /Sub-agent failed/, "a refusal to act on, not a failure");
});

test("the default checkpoint is still sixty rounds — what changed is what happens there, not where it is", () => {
	assert.equal(SUB_AGENT_CHECKPOINT_TURNS, 60);
});
