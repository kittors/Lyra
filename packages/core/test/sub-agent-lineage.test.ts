/**
 * 派生树与成本：注册表里每条记录知道谁派的它、在第几层、花了多少。
 *
 * 面板要画的树和「本次编排 $2.40」都从这里来。没有这几个字段之前，八个并行的子代理在面板上是
 * 八个平级的标签；父代理那边看不到它们的上下文，也就看不到账单——派生在父代理那一侧是免费
 * 的，这正是需要刹车的原因（16 §6.2）。
 *
 * 两层。注册表自己的：字段进得去、usage 按助手消息累加、用户消息不算。接线的：一个真的往下
 * 派了一层的 `runSubAgent`，第二层的记录要指着第一层的 id、深度是 2、usage 是它自己那份——
 * 把 `sub-agent.ts` 里传 `parentId`/`depth` 那几行摘掉，这条必须变红。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { SubAgentRegistry } from "../src/runtime/sub-agents.ts";
import { runSubAgent } from "../src/runtime/sub-agent.ts";
import { childDispatch, rootDispatch } from "../src/runtime/dispatch-guard.ts";
import { taskTool, type AgentDefinition } from "../src/tools/task.ts";
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

const SETTINGS = { thinking: "off", retryAttempts: 0, maxConcurrentSubAgents: 4 } as unknown as Settings;

/** 一条带账单的回复：provider 在真实运行里就是这样把 usage 填好再交出来的。 */
function priced(text: string, input: number, output: number, cost: number): AssistantMessage {
	return {
		role: "assistant",
		api: "openai-responses",
		provider: "fake",
		model: "model",
		usage: { ...emptyUsage(), input, output, total: input + output, cost: { ...emptyUsage().cost, total: cost } },
		stopReason: "stop",
		timestamp: Date.now(),
		content: [{ type: "text", text }],
	};
}

function delegatesTo(agent: string, input: number, output: number, cost: number): AssistantMessage {
	return {
		...priced("", input, output, cost),
		stopReason: "toolUse",
		content: [
			{
				type: "toolCall",
				id: `c${Math.random().toString(36).slice(2, 7)}`,
				name: "task",
				arguments: { description: "再往下一层", prompt: "去", subagent_type: agent },
				argumentsText: "{}",
			},
		],
	};
}

test("注册表：谁派的、第几层、花了多少，都在摘要里", () => {
	const registry = new SubAgentRegistry();
	registry.start({ id: "a", agent: "boss", description: "编排", abort: () => {} });
	registry.start({ id: "b", agent: "leaf", description: "叶子", abort: () => {}, parentId: "a", depth: 2 });

	const [a, b] = registry.list();
	assert.equal(a.parentId, undefined, "主会话派的没有父级");
	assert.equal(a.depth, 1, "不传深度就是主会话直接派的那一层");
	assert.equal(b.parentId, "a");
	assert.equal(b.depth, 2);
	assert.deepEqual(a.usage, emptyUsage(), "还没说话，账单是零");

	registry.record("a", priced("一", 100, 10, 0.5));
	registry.record("a", priced("二", 200, 20, 0.25));
	const user: Message = { role: "user", content: [{ type: "text", text: "插话" }], timestamp: 0 };
	registry.record("a", user);

	const after = registry.list()[0].usage;
	assert.equal(after.input, 300, "每条助手消息是一次请求，输入按次累加");
	assert.equal(after.output, 30);
	assert.equal(after.total, 330);
	assert.equal(after.cost.total, 0.75);
	assert.equal(registry.detail("a")?.messages.length, 3, "用户消息进了记录，但不进账单");
});

test("派生上下文带着这次运行的注册 id，往下一层传", () => {
	const here = childDispatch(rootDispatch(), "boss", "s1:sub:abc");
	assert.equal(here.id, "s1:sub:abc");
	assert.equal(here.depth, 1);
	const deeper = childDispatch(here, "leaf");
	assert.equal(deeper.id, undefined, "id 是每一层自己的，不继承——继承了就分不清父子");
	assert.deepEqual(deeper.chain, ["boss", "leaf"]);
});

test("接线：真的往下派了一层之后，第二层指着第一层的 id，账单各记各的", async () => {
	/*
	 * 剧本按调用顺序：boss 派 leaf（第一笔）→ leaf 回答（第二笔）→ boss 收尾（第三笔）。
	 * 三笔的数字互不相同，所以谁的账记到谁头上是能分辨的，不是「总数对了」就算。
	 */
	const replies = [delegatesTo("leaf", 1000, 50, 0.1), priced("叶子说完了", 300, 30, 0.03), priced("收下了", 1500, 60, 0.15)];
	let at = 0;
	const registry = new SubAgentRegistry();
	const boss = { name: "boss", description: "编排者", systemPrompt: "orchestrate", tools: "*", spawns: "*" } as AgentDefinition;
	const leaf = { name: "leaf", description: "叶子", systemPrompt: "do", tools: "*" } as AgentDefinition;

	await runSubAgent(
		{
			sessionId: "s1",
			cwd: "/tmp",
			settings: SETTINGS,
			tools: [taskTool as unknown as Tool],
			skills: [],
			agents: [boss, leaf],
			registry,
			requestApproval: async () => "allow",
			emit: async () => {},
			dispatch: rootDispatch(),
			streamFn: async () => replies[Math.min(at++, replies.length - 1)],
		},
		{ description: "顶层", prompt: "开始", agentType: "boss" },
		PROVIDER,
		MODEL,
		"# Environment\ncwd: /tmp\n",
	);

	const all = registry.list();
	assert.equal(all.length, 2, `两层都该在注册表里：${JSON.stringify(all.map((one) => one.agent))}`);
	const top = all.find((one) => one.agent === "boss");
	const child = all.find((one) => one.agent === "leaf");
	assert.ok(top && child);

	assert.equal(top.depth, 1);
	assert.equal(top.parentId, undefined);
	assert.equal(child.depth, 2);
	assert.equal(child.parentId, top.id, "第二层要指着第一层在注册表里的 id，而不是名字");

	assert.equal(top.usage.input, 2500, "boss 的两笔：派生那次 1000 加收尾那次 1500");
	assert.equal(top.usage.cost.total, 0.25);
	assert.equal(child.usage.input, 300, "leaf 只有它自己那一笔");
	assert.equal(child.usage.cost.total, 0.03);
});
