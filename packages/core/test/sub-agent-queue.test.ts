/**
 * 子代理在闸门后面排队、被停、要授权、撞上检查点——这几件事从 `runSubAgent` 这一头看。
 *
 * 每一条都对应 2026-09-26 那场真实会话里的一个症状：排着的在界面上一个都看不见；会话停了排着的
 * 照样开跑；授权卡片说不出是谁在要；没写清单的审查者在第六十轮被一刀切下，不管它读到哪了。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { runSubAgent } from "../src/runtime/sub-agent.ts";
import { SubAgentRegistry } from "../src/runtime/sub-agents.ts";
import { DispatchGate } from "../src/runtime/dispatch-guard.ts";
import { todoTool } from "../src/tools/todo.ts";
import type { AgentDefinition } from "../src/agents-builtin.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import type { Settings } from "../src/config/settings.ts";
import type { ApprovalRequest, AssistantMessage, LlmContext, ModelConfig, ProviderConfig, Tool } from "../src/types.ts";
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

const SETTINGS = { thinking: "off", retryAttempts: 0, permissionMode: "ask" } as unknown as Settings;

/** 只读审查者：定义里没有 `todo_write`。 */
const REVIEW: AgentDefinition = { name: "review", description: "审查", systemPrompt: "review", tools: ["read"], source: "builtin", maxTurns: 2 };
const WRITER: AgentDefinition = { name: "general", description: "改代码", systemPrompt: "general", tools: "*", source: "builtin" };

const read: Tool = {
	name: "read",
	snippet: "reads",
	description: "reads",
	parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
	summarize: () => "读了一个文件",
	async execute() {
		return { content: [{ type: "text", text: "ok" }] };
	},
};

/** 一个要授权的写工具——按会话的闸门去问人。 */
const write: Tool = {
	name: "write",
	snippet: "writes",
	description: "writes",
	parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
	summarize: () => "写了一个文件",
	async execute(_args, ctx) {
		const decision = await ctx.requestApproval?.({ kind: "write", title: "写入 a.ts", detail: "a.ts", subject: "a.ts" });
		return { content: [{ type: "text", text: `decision=${String(decision)}` }] };
	},
};

function assistant(parts: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "toolUse"): AssistantMessage {
	return { role: "assistant", api: "openai-responses", provider: "fake", model: "model", usage: emptyUsage(), stopReason, timestamp: Date.now(), content: parts };
}
const says = (text: string) => assistant([{ type: "text", text }], "stop");
const call = (id: string, name: string, args: Record<string, unknown>) =>
	assistant([{ type: "toolCall", id, name, arguments: args, argumentsText: JSON.stringify(args) }]);

function base(overrides: Partial<Parameters<typeof runSubAgent>[0]> = {}) {
	const registry = new SubAgentRegistry();
	const events: AgentEvent[] = [];
	const options: Parameters<typeof runSubAgent>[0] = {
		sessionId: "s1",
		cwd: "/tmp",
		settings: SETTINGS,
		tools: [read, write, todoTool as unknown as Tool],
		skills: [],
		agents: [REVIEW, WRITER],
		registry,
		requestApproval: async () => "once",
		emit: async (event) => {
			events.push(event);
		},
		streamFn: async () => says("好了"),
		...overrides,
	};
	return { registry, events, options };
}

test("排着的时候就在名单上，轮到它才开跑", async () => {
	const gate = new DispatchGate(1);
	const holding = await gate.acquire();
	const { registry, options } = base({ gate, admission: (signal) => gate.acquire(signal) });
	let registered = "";
	const run = runSubAgent({ ...options, onRegistered: (id) => (registered = id) }, { description: "审查 A", prompt: "看", agentType: "general" }, PROVIDER, MODEL, "");
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.ok(registered, "一派出去就有 id——父会话放手时要说得出放下的是谁");
	assert.equal(registry.list()[0]?.status, "queued", "闸门后面排着，名单上写着排队");

	holding();
	const answer = await run;
	assert.equal(answer.text, "好了");
	assert.equal(registry.list()[0]?.status, "done");
});

test("排着的时候被停：一轮都不跑，记作停下，名额不占", async () => {
	const gate = new DispatchGate(1);
	const holding = await gate.acquire();
	let requests = 0;
	const { registry, events, options } = base({
		gate,
		admission: (signal) => gate.acquire(signal),
		streamFn: async () => {
			requests += 1;
			return says("不该跑到这里");
		},
	});
	let id = "";
	const run = runSubAgent({ ...options, onRegistered: (registered) => (id = registered) }, { description: "审查 B", prompt: "看", agentType: "general" }, PROVIDER, MODEL, "");
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(registry.abort(id), true, "排着的也停得下");
	const answer = await run;
	assert.equal(requests, 0, "一次请求都没发");
	assert.equal(registry.list()[0]?.status, "aborted");
	assert.equal(answer.stoppedByUser, true, "面板上按停的，父会话要知道那是人的决定");
	assert.ok(events.some((event) => event.type === "subagent_done" && event.status === "aborted"));

	holding();
	assert.equal(gate.running, 0, "它从没占过名额");
});

test("会话已经停了才派出去的：不上名单、不发请求", async () => {
	const stop = new AbortController();
	stop.abort();
	let requests = 0;
	const { registry, options } = base({ signal: stop.signal, streamFn: async () => ((requests += 1), says("x")) });
	const answer = await runSubAgent(options, { description: "晚到的", prompt: "看", agentType: "general" }, PROVIDER, MODEL, "");
	assert.equal(requests, 0);
	assert.equal(registry.list().length, 0);
	assert.match(answer.text, /没有开始/);
});

test("子代理要授权时，卡片上写着是谁在要；名单上它显示在等人", async () => {
	const asked: ApprovalRequest[] = [];
	let sawWaiting = false;
	const { registry, options } = base({
		requestApproval: async (request) => {
			asked.push(request);
			sawWaiting = registry.list()[0]?.awaitingApproval === true;
			return "once";
		},
	});
	let turn = 0;
	const answer = await runSubAgent(
		{ ...options, streamFn: async () => (turn++ === 0 ? call("w1", "write", {}) : says("写好了")) },
		{ description: "改 a.ts", prompt: "改", agentType: "general" },
		PROVIDER,
		MODEL,
		"",
	);
	assert.equal(answer.text, "写好了");
	assert.equal(asked.length, 1);
	assert.equal(asked[0].from?.agent, "general");
	assert.equal(asked[0].from?.description, "改 a.ts");
	assert.equal(asked[0].from?.subAgentId, registry.list()[0]?.id);
	assert.ok(sawWaiting, "等授权的那段时间，名单上说得出它在等人");
	assert.equal(registry.list()[0]?.awaitingApproval, undefined, "答完就不再等了");
});

test("只读审查者也有记事本；没写清单撞上检查点时再给一段，让它列出剩下的步骤", async () => {
	const seen: { tools: string[]; last: string }[] = [];
	const { registry, options } = base({
		streamFn: async (context: LlmContext) => {
			const turn = seen.length;
			const lastUser = [...context.messages].reverse().find((message) => message.role === "user");
			const text = lastUser?.content.map((part) => (part.type === "text" ? part.text : "")).join("") ?? "";
			seen.push({ tools: context.tools.map((tool) => tool.name), last: text });
			// 第一段（2 轮）：只读，不写清单。
			if (turn < 2) return call(`r${turn}`, "read", { at: turn });
			// 第二段开头：读到宽限那句话，列出清单（一项已完成），并且同一轮接着读。
			if (turn === 2)
				return assistant([
					{ type: "toolCall", id: "t1", name: "todo_write", arguments: { todos: [{ content: "读完 A", status: "completed" }, { content: "读完 B", status: "in_progress" }] }, argumentsText: "{}" },
					{ type: "toolCall", id: "r2", name: "read", arguments: { at: 2 }, argumentsText: "{}" },
				]);
			if (turn === 3) return call("r3", "read", { at: 3 });
			// 第三段：清单往前推了，接着跑到收尾。
			return says("审查完了：两处问题");
		},
	});
	const answer = await runSubAgent(options, { description: "审查", prompt: "审查一下", agentType: "review" }, PROVIDER, MODEL, "");

	assert.ok(seen[0].tools.includes("todo_write"), `定义里没写，清单工具照样在：${seen[0].tools.join(",")}`);
	assert.ok(!seen[0].tools.includes("write"), "能力边界不变：只读的还是只读");
	assert.match(seen[2].last, /（自动追加）这一段的 2 轮用完了/, "第二段以那句宽限的话开头");
	assert.equal(answer.text, "审查完了：两处问题", "清单在往前推，就一直跑到做完");
	assert.equal(registry.list()[0]?.incomplete, undefined, "不是阶段性交接");
});

test("宽限只给一次：给过之后还是不写清单，就照常停下交接", async () => {
	let turns = 0;
	const { options } = base({
		streamFn: async (context: LlmContext) => {
			turns += 1;
			const tools = context.tools.map((tool) => tool.name);
			if (tools.length === 1 && tools[0] === "yield") {
				return call("y", "yield", { summary: "读了几个文件", remaining: "还没看完" });
			}
			return call(`r${turns}`, "read", { at: turns });
		},
	});
	const answer = await runSubAgent(options, { description: "审查", prompt: "审查一下", agentType: "review" }, PROVIDER, MODEL, "");
	assert.equal(turns, 5, "两段各两轮，加上讨交接的那一轮");
	assert.match(answer.text, /到了检查点/);
});

test("停下一个正在派孩子的子代理，它派出去的孩子也跟着停", async () => {
	const ORCHESTRATOR: AgentDefinition = { name: "lead", description: "编排", systemPrompt: "lead", tools: "*", spawns: ["review"], source: "builtin" };
	const gate = new DispatchGate(4);
	const { registry, options } = base({ agents: [ORCHESTRATOR, REVIEW, WRITER], gate });
	const { taskTool } = await import("../src/tools/task.ts");
	let childStarted: () => void = () => {};
	const started = new Promise<void>((resolve) => (childStarted = resolve));
	const run = runSubAgent(
		{
			...options,
			tools: [read, taskTool as unknown as Tool],
			streamFn: async (context) => {
				// 孩子：手里没有 `task` 的那个。一直读下去，直到被停。
				if (!context.tools.some((tool) => tool.name === "task")) {
					childStarted();
					await new Promise((resolve) => setTimeout(resolve, 20));
					return call(`c${Date.now()}${Math.random()}`, "read", { at: Math.random() });
				}
				// 父亲：派一个孩子，然后等。
				if (!context.messages.some((message) => message.role === "toolResult")) {
					return call("t", "task", { description: "细看", prompt: "看", subagent_type: "review" });
				}
				return says("收到");
			},
		},
		{ description: "编排", prompt: "去", agentType: "lead" },
		PROVIDER,
		MODEL,
		"",
	);
	await started;
	const parent = registry.list().find((one) => one.agent === "lead")!;
	registry.abort(parent.id);
	await run;
	await new Promise((resolve) => setTimeout(resolve, 60));
	const child = registry.list().find((one) => one.agent === "review")!;
	assert.equal(child.status, "aborted", "孩子挂在父亲自己的绳子上，父亲一停它就停");
});
