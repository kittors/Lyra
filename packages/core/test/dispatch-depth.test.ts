/**
 * 嵌套派生：它到底能不能发生，以及在哪一层被拦下。
 *
 * 这三条限制里，只有并发是真的在跑的。深度和自递归有代码、有测试、有提示词里那句
 * 「派生最多嵌套 2 层」——而**没有任何东西调用它们**：`refuseDispatch`、`rootDispatch`、
 * `childDispatch` 在整个产品里零引用。
 *
 * 更糟的是另一半：`runSubAgent` 从来不给它派出去的 `runTurn` 传 `spawnSubAgent`，所以一个声明了
 * `spawns` 的定义会拿到 `task` 工具，然后从它那里得到「Sub-agents are not available」。字段解析
 * 得很仔细，工具老老实实地留在表里，功能不存在——而提示词还在向模型承诺那个层数。
 *
 * 所以这个文件测的不是那几个函数（它们本来就有测试），是**有没有人调用它们**。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { runSubAgent } from "../src/runtime/sub-agent.ts";
import { taskTool, type AgentDefinition } from "../src/tools/task.ts";
import { DEFAULT_MAX_DEPTH, DISPATCH_KEY, rootDispatch } from "../src/runtime/dispatch-guard.ts";
import { AGENTS_KEY } from "../src/tools/task.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig, Settings, Tool, ToolContext } from "../src/types.ts";
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

function says(text: string): AssistantMessage {
	return {
		role: "assistant",
		api: "openai-responses",
		provider: "fake",
		model: "model",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
		content: [{ type: "text", text }],
	};
}

/** 一个会调 `task` 的回复，用来让子代理真的往下派一层。 */
function delegatesTo(agent: string): AssistantMessage {
	return {
		...says(""),
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

/** 一个会编排的定义：它能派生，并且名单里写明了派谁。 */
function orchestrator(name: string, spawns: string | string[]): AgentDefinition {
	return { name, description: `${name}（编排者）`, systemPrompt: "orchestrate", tools: "*", spawns } as AgentDefinition;
}

const LEAF: AgentDefinition = { name: "leaf", description: "叶子", systemPrompt: "do", tools: "*" } as AgentDefinition;

/**
 * 从主会话派一层，脚本化地喂回复。
 *
 * `replies` 按调用顺序发；每一层的 `runTurn` 都从同一个数组里取，所以一条「先派生、再收尾」的
 * 剧本读起来就是它实际发生的顺序。
 */
async function fromMain(options: { agents: AgentDefinition[]; entry: string; replies: AssistantMessage[] }) {
	let at = 0;
	/*
	 * 每次请求带的工具结果，攒起来。
	 *
	 * 只看最后一句话是不够的：一个被拒绝的派生和一个成功的派生，模型的收尾话术可能一模一样。
	 * 真正的证据是**它读到了什么**——那句拒绝的理由有没有作为工具结果回到它面前。
	 */
	const toolResults: string[] = [];
	const answer = await runSubAgent(
		{
			sessionId: "s1",
			cwd: "/tmp",
			settings: SETTINGS,
			tools: [taskTool as unknown as Tool],
			skills: [],
			agents: options.agents,
			requestApproval: async () => "allow",
			emit: async () => {},
			dispatch: rootDispatch(),
			streamFn: async (context) => {
				// 工具结果是自己一条消息（`role: "toolResult"`），不是助手消息里的一个块。
				for (const message of context.messages) {
					if (message.role !== "toolResult") continue;
					for (const part of message.content) if (part.type === "text") toolResults.push(part.text);
				}
				return options.replies[Math.min(at++, options.replies.length - 1)];
			},
		},
		{ description: "顶层", prompt: "开始", agentType: options.entry },
		PROVIDER,
		MODEL,
		"# Environment\ncwd: /tmp\n",
	);
	return { answer, toolResults };
}

test("声明了 spawns 的子代理，真的能再派一层", async () => {
	/*
	 * 这条以前必然失败，而且失败得很安静：`task` 在工具表里，调用它得到的是
	 * 「Sub-agents are not available in this session」——一句关于会话的话，
	 * 用来解释一个关于接线的事实。
	 */
	const { answer, toolResults } = await fromMain({
		agents: [orchestrator("boss", "*"), LEAF],
		entry: "boss",
		replies: [delegatesTo("leaf"), says("叶子说完了"), says("我把叶子的结论收下了")],
	});

	assert.match(answer.text, /收下了/);
	assert.ok(
		toolResults.some((text) => text.includes("叶子说完了")),
		`第二层的回答要回到第一层手里，实际拿到的是：${toolResults.join(" | ")}`,
	);
});

test("到了深度上限，`task` 就不在工具表里了", async () => {
	/*
	 * 主路径是拿掉工具而不是拒绝调用：模型不会想要一个没见过的工具，而一个事后的报错要花掉
	 * 一整轮，去发现一件本来就不可能成的事。
	 */
	const tools: string[][] = [];
	await runSubAgent(
		{
			sessionId: "s1",
			cwd: "/tmp",
			settings: SETTINGS,
			tools: [taskTool as unknown as Tool],
			skills: [],
			agents: [orchestrator("boss", "*")],
			requestApproval: async () => "allow",
			emit: async () => {},
			// 已经在第 DEFAULT_MAX_DEPTH-1 层，所以这一次派生正好把它顶到上限。
			dispatch: { depth: DEFAULT_MAX_DEPTH - 1, chain: ["someone"] },
			streamFn: async (context) => {
				tools.push(context.tools.map((t) => t.name));
				return says("好");
			},
		},
		{ description: "顶层", prompt: "开始", agentType: "boss" },
		PROVIDER,
		MODEL,
		"# Environment\ncwd: /tmp\n",
	);

	assert.ok(tools.length > 0);
	assert.ok(!tools[0].includes("task"), `到顶那一层不该再有 task，实际有：${tools[0].join(", ")}`);
});

test("spawns 是一份名单，不是一个开关", async () => {
	/*
	 * 计划里它的作用是「让读定义的人一眼看出这是个编排者，以及它会派谁」。当成布尔用，
	 * 那份名单就成了注释。
	 */
	const { toolResults } = await fromMain({
		agents: [orchestrator("boss", ["leaf"]), LEAF, { ...LEAF, name: "outsider" }],
		entry: "boss",
		replies: [delegatesTo("outsider"), says("被拦了，那我自己做")],
	});

	assert.ok(
		toolResults.some((text) => text.includes("只被允许派生") && text.includes("outsider")),
		`拒绝的理由要回到模型面前，实际拿到的是：${toolResults.join(" | ")}`,
	);
});

// ---------------------------------------------------------------------------
// 自递归：只有派生的那一刻看得见
// ---------------------------------------------------------------------------

/** 直接调 `task` 工具，带一条给定的派生链。 */
async function callTask(chain: string[], wanted: string, agents: AgentDefinition[]) {
	const state = new Map<string, unknown>([
		[AGENTS_KEY, agents],
		[DISPATCH_KEY, { depth: chain.length, chain }],
	]);
	return taskTool.execute({ description: "d", prompt: "p", subagent_type: wanted } as never, {
		state,
		spawnSubAgent: async () => ({ text: "不该走到这里" }),
	} as unknown as ToolContext);
}

test("一条派生链上不能再出现同一个 agent", async () => {
	/*
	 * `explore → reviewer → explore` 是提示词写歪了，而它烧钱的速度足够快，所以大声失败才是
	 * 善意。工具表拦不住这个——链上的名字只有在派生那一刻才知道。
	 */
	// 链长 1，深度还没到顶——否则先撞上的是深度那一条，测不到这一条。
	const result = await callTask(["explore"], "explore", [LEAF, { ...LEAF, name: "explore" }]);
	assert.equal(result.isError, true);
	assert.match(String(result.content[0].type === "text" ? result.content[0].text : ""), /已经在这条派生链上/);
});

test("深度到顶时，即使工具还在也拦得住", async () => {
	// 兜底那一层：万一 `task` 因为别的原因留在了表里。
	const result = await callTask(["a", "b"], "leaf", [LEAF]);
	assert.equal(result.isError, true);
	assert.match(String(result.content[0].type === "text" ? result.content[0].text : ""), /派生已经到了第 2 层/);
});

test("主会话不受影响", async () => {
	const result = await callTask([], "leaf", [LEAF]);
	assert.notEqual(result.isError, true);
});
