/**
 * 「关掉自动派活、但 @ 点名照派」有没有真的接上。
 *
 * `delegation.test.ts` 测的是那几个纯函数算得对。这里问的是另一个问题——产品里有没有人调用它们。
 * 这个仓库里「代码在、功能不在」出现过十几次，每一次都是一个纯函数配着它自己的绿灯。
 *
 * 而这一次的接线本身就是最容易错的地方，因为 `@explore` **不是一条独立的执行路径**：它在输入框
 * 里只是一段纯文本，模型读到之后走的仍然是 `task`。所以「关掉自动派、保留手动点名」没法靠摘掉
 * 工具实现——摘掉了，两条路一起断。于是改成按轮决定，而按轮决定的东西必须按轮验：
 *
 *   1. 没点名的那一轮，`task` 真的不在送给模型的工具表里；
 *   2. 点了名的那一轮，它真的回来了；
 *   3. 点名只算当轮——下一轮没点，它必须再消失一次。
 *
 * 第 3 条是这套设计里唯一一个「看起来能用、其实错了」也不会有人发现的地方：如果点名一次就永久
 * 放行，用户关掉的那个开关会在他自己点过一次名之后悄悄失效，而界面上什么都看不出来。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { DispatchGate } from "../src/runtime/dispatch-guard.ts";
import { DELEGATION_KEY, type DelegationDecision } from "../src/runtime/delegation.ts";
import { SessionStore } from "../src/session/store.ts";
import { taskTool } from "../src/tools/task.ts";
import { AGENTS_KEY } from "../src/tools/task.ts";
import { BUILTIN_AGENTS } from "../src/agents-builtin.ts";
import { emptyUsage, type AssistantMessage, type ModelConfig, type ProviderConfig, type ToolContext } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model",
	providerId: "fake",
	modelId: "gpt-6-astra",
	name: "Fake",
	contextWindow: 100_000,
	maxOutputTokens: 4096,
	supportsThinking: true,
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

const SETTINGS: Settings = {
	...DEFAULT_SETTINGS,
	providers: [PROVIDER],
	defaultModelId: MODEL.id,
	mcpServers: [],
	permissionMode: "full",
	maxConcurrentSubAgents: 4,
};

function reply(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "openai-responses",
		provider: "fake",
		model: "gpt-6-astra",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

async function harness(settings: Settings = SETTINGS) {
	const root = await mkdtemp(join(tmpdir(), "ly-deleg-policy-"));
	const home = join(root, "home");
	await mkdir(home, { recursive: true });
	process.env.LYRA_HOME = home;

	const prompts: string[] = [];
	const toolNames: string[][] = [];
	const session = new AgentSession({
		cwd: root,
		settings,
		store: new SessionStore(join(root, "sessions")),
		emit: () => {},
		streamFn: async (context) => {
			prompts.push(context.systemPrompt);
			// 送到模型面前的那一份，不是会话手里那一份——中间还隔着插件的 turn pipeline。
			toolNames.push(context.tools.map((tool) => tool.name));
			return reply();
		},
	});
	await session.initialize();

	const state = () => (session as unknown as { can: { state: Map<string, unknown> } }).can.state;
	return {
		session,
		/** 说一句话，跑一轮。 */
		say: async (text: string) => {
			await session.prompt([{ type: "text", text }]);
		},
		last: () => prompts[prompts.length - 1] ?? "",
		/** 最后一轮模型真正拿到的工具名。 */
		tools: () => toolNames[toolNames.length - 1] ?? [],
		hasTask: () => (toolNames[toolNames.length - 1] ?? []).includes("task"),
		decision: () => state().get(DELEGATION_KEY) as DelegationDecision | undefined,
		width: () => {
			const gate = state().get("dispatchGate");
			return gate instanceof DispatchGate ? gate.width : null;
		},
		cleanup: async () => {
			delete process.env.LYRA_HOME;
			await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
		},
	};
}

// ---------------------------------------------------------------------------
// 关掉之后，工具表按轮变
// ---------------------------------------------------------------------------

test("默认设置下什么都没变——`task` 在，提示词还是老样子", async () => {
	const h = await harness();
	try {
		await h.say("你好");
		assert.ok(h.hasTask(), "默认是 auto，工具不该被动过");
		assert.equal(h.decision()?.tier, "selective", "medium 推出来的就是这一档");
		assert.match(h.last(), /挑着派/);
	} finally {
		await h.cleanup();
	}
});

test("关掉之后，没点名的那一轮 `task` 真的不在工具表里", async () => {
	const h = await harness({ ...SETTINGS, subAgentDelegation: "off" });
	try {
		await h.say("帮我看看这个函数");
		assert.ok(!h.hasTask(), "摘掉工具是主路径——模型不会想要一个没见过的工具");
		assert.ok(h.tools().length > 0, "只该少一个 `task`，不是把工具表清空了");
		assert.deepEqual(h.decision(), { tier: "off", mentioned: [] });

		// 提示词得说清楚为什么它手里没有这个工具，否则它会花一轮去找。
		assert.match(h.last(), /不要派活/);
		assert.match(h.last(), /@智能体名/, "唯一的出路是让用户点名，那就得说怎么点");
		// 一个都派不了的那一轮，不该再报一个并发数——那是一句放行的话。
		assert.doesNotMatch(h.last(), /个子代理同时跑/);
		// 名单仍然要给：模型得说得出有哪些名字可点。
		assert.match(h.last(), /<available_subagents>/);
		assert.match(h.last(), /switched delegation off/, "开头那句得换掉——工具已经不在了");
	} finally {
		await h.cleanup();
	}
});

test("同一个会话里 @ 点名，`task` 当轮就回来", async () => {
	const h = await harness({ ...SETTINGS, subAgentDelegation: "off" });
	try {
		await h.say("先随便聊聊");
		assert.ok(!h.hasTask());

		await h.say("@explore 去把用到这个接口的地方都找出来");
		assert.ok(h.hasTask(), "用户自己点的名必须能派——这正是「只禁自动派」的全部意思");
		assert.deepEqual(h.decision(), { tier: "off", mentioned: ["explore"] });
		assert.match(h.last(), /`explore`/);
		assert.match(h.last(), /只派它/);
		assert.doesNotMatch(h.last(), /不要派活/);
	} finally {
		await h.cleanup();
	}
});

test("点名只算当轮：下一轮没点，工具必须再消失一次", async () => {
	const h = await harness({ ...SETTINGS, subAgentDelegation: "off" });
	try {
		await h.say("@explore 找一下");
		assert.ok(h.hasTask());

		await h.say("好的，那就这样吧");
		/*
		 * 这条错了不会有人发现：点名一次就永久放行的话，用户关掉的开关会在他自己点过一次名之后
		 * 悄悄失效，而界面上什么都看不出来。点名是一次祈使句，不是一个开关。
		 */
		assert.ok(!h.hasTask(), "上一轮的点名不该把这一轮也打开");
		assert.deepEqual(h.decision(), { tier: "off", mentioned: [] });
	} finally {
		await h.cleanup();
	}
});

test("一句话里点两个，两个都放行", async () => {
	const h = await harness({ ...SETTINGS, subAgentDelegation: "off" });
	try {
		await h.say("让 @explore 和 @review 各看一遍");
		assert.deepEqual(h.decision()?.mentioned.sort(), ["explore", "review"]);
		assert.ok(h.hasTask());
	} finally {
		await h.cleanup();
	}
});

test("旧名也认，但只认还有人在的那些", async () => {
	const h = await harness({ ...SETTINGS, subAgentDelegation: "off" });
	try {
		// `fast` 三天前改名叫 `simple` 了，指的人还在。见 `RENAMED_AGENTS`。
		await h.say("@fast 把这个小改动做了");
		assert.deepEqual(h.decision()?.mentioned, ["simple"], "旧名要翻译成现在的名字");
		assert.ok(h.hasTask());

		await h.say("@nobody 来一下");
		assert.deepEqual(h.decision()?.mentioned, [], "查无此人不该放行——`task` 拿到手也只会报错");
		assert.ok(!h.hasTask());
	} finally {
		await h.cleanup();
	}
});

test("邮箱不是点名——这条错了，一封邮件就能把关掉的开关打开", async () => {
	const h = await harness({ ...SETTINGS, subAgentDelegation: "off" });
	try {
		await h.say("回信给 someone@review.example.com，问问他的意见");
		assert.deepEqual(h.decision()?.mentioned, []);
		assert.ok(!h.hasTask());
	} finally {
		await h.cleanup();
	}
});

// ---------------------------------------------------------------------------
// 钉死一档：等级从此不说了算
// ---------------------------------------------------------------------------

test("钉死一档之后，改推理等级不再动闸门，也不再动提示词", async () => {
	const h = await harness({ ...SETTINGS, subAgentDelegation: "sparing" });
	try {
		await h.session.setThinking("ultra");
		await h.say("开始吧");
		assert.equal(h.width(), 1, "等级拉满也越不过用户钉的档");
		assert.match(h.last(), /省着来/);
		assert.match(h.last(), /最多 1 个子代理同时跑/, "说出去的数字必须跟拦人的那个一样");

		await h.session.setThinking("off");
		await h.say("继续");
		assert.equal(h.width(), 1, "从另一头过来也是这一档");
		assert.match(h.last(), /省着来/);
	} finally {
		await h.cleanup();
	}
});

test("钉死高档，低等级的会话照样放开——这是这个设置反过来的那一半", async () => {
	const h = await harness({ ...SETTINGS, subAgentDelegation: "eager" });
	try {
		await h.session.setThinking("low");
		await h.say("开始吧");
		assert.equal(h.width(), 4, "天花板是 4，钉死的档要求用满");
		assert.match(h.last(), /放开编排/);
		assert.doesNotMatch(h.last(), /省着来/, "低等级的话不该再出现");
	} finally {
		await h.cleanup();
	}
});

test("并发上限仍然是天花板，钉死的档也越不过去", async () => {
	const h = await harness({ ...SETTINGS, maxConcurrentSubAgents: 2, subAgentDelegation: "eager" });
	try {
		await h.session.setThinking("ultra");
		await h.say("开始吧");
		assert.equal(h.width(), 2, "用户写下的那个数字，任何档位都不能突破");
		assert.match(h.last(), /最多 2 个子代理同时跑/);
	} finally {
		await h.cleanup();
	}
});

test("关掉之后闸门是 1，不是 0——点名派的那次得过得去", async () => {
	const h = await harness({ ...SETTINGS, subAgentDelegation: "off" });
	try {
		await h.say("@explore 找一下");
		assert.equal(h.width(), 1);
		assert.match(h.last(), /最多 1 个子代理同时跑/);
	} finally {
		await h.cleanup();
	}
});

// ---------------------------------------------------------------------------
// 全局设置，而且立刻生效
// ---------------------------------------------------------------------------

test("会话跑到一半改设置，下一轮就按新的来——不用重开会话", async () => {
	const h = await harness();
	try {
		await h.say("你好");
		assert.ok(h.hasTask(), "默认是 auto");
		assert.equal(h.width(), 2, "medium 把 4 收成 2");

		/*
		 * 桌面端保存设置时会遍历所有活着的会话调这个（见 `electron/main.ts`），所以这不是一个
		 * 测试专用的口子——它就是产品里那条路径。
		 */
		h.session.updateSettings({ ...SETTINGS, subAgentDelegation: "off" });
		await h.say("接着说");
		assert.ok(!h.hasTask(), "改成「从不派」之后，下一轮工具就该没了");
		assert.equal(h.decision()?.tier, "off");

		h.session.updateSettings({ ...SETTINGS, subAgentDelegation: "eager" });
		await h.say("再来");
		assert.ok(h.hasTask(), "调回去也要当场跟上");
		assert.equal(h.width(), 4, "钉死的高档要把闸门开到天花板");
		assert.match(h.last(), /放开编排/);
	} finally {
		await h.cleanup();
	}
});

test("并发上限改了，正在用的那道闸门当场改宽度", async () => {
	const h = await harness({ ...SETTINGS, subAgentDelegation: "eager" });
	try {
		await h.say("开始");
		assert.equal(h.width(), 4);

		h.session.updateSettings({ ...SETTINGS, subAgentDelegation: "eager", maxConcurrentSubAgents: 1 });
		await h.say("继续");
		// 闸门是会话级的、活过一轮的那个对象；宽度必须每轮重算，否则这个设置就只剩半个。
		assert.equal(h.width(), 1);
		assert.match(h.last(), /最多 1 个子代理同时跑/, "说出去的数字也要跟着改");
	} finally {
		await h.cleanup();
	}
});

// ---------------------------------------------------------------------------
// `task` 自己的兜底：工具在手，也不许顺手多派
// ---------------------------------------------------------------------------

/** 一个够 `task.execute` 走完拦截路径的最小上下文。 */
function taskContext(decision: DelegationDecision | undefined) {
	const state = new Map<string, unknown>([[AGENTS_KEY, BUILTIN_AGENTS]]);
	if (decision) state.set(DELEGATION_KEY, decision);
	const dispatched: string[] = [];
	const ctx = {
		state,
		spawnSubAgent: async (input: { agentType?: string }) => {
			dispatched.push(input.agentType ?? "general");
			return { text: "done" };
		},
	} as unknown as ToolContext;
	return { ctx, dispatched };
}

test("点名放行的只有被点的那个，顺手多派的会被挡回去", async () => {
	const { ctx, dispatched } = taskContext({ tier: "off", mentioned: ["explore"] });

	const allowed = await taskTool.execute({ description: "找", prompt: "去找", subagent_type: "explore" }, ctx);
	assert.ok(!allowed.isError, "点名的那个必须派得出去");
	assert.deepEqual(dispatched, ["explore"]);

	/*
	 * 挡的是工具**在**桌上的那种情况：用户点了 `@explore`，工具因此留着，模型顺手又派了一个
	 * 没人点过的。没有这道，「只派点名的那个」就只是提示词里的一句请求。
	 */
	const refused = await taskTool.execute({ description: "顺手", prompt: "再看看", subagent_type: "review" }, ctx);
	assert.ok(refused.isError, "没被点名的一个都不许派");
	assert.deepEqual(dispatched, ["explore"], "被挡下的那次不该真的派出去");
	const text = refused.content[0]?.type === "text" ? refused.content[0].text : "";
	assert.match(text, /关掉了/);
	assert.match(text, /@review/, "得告诉模型怎么才能派——不然它只会换个名字再试一次");
});

test("兜底不越权：其余四档一律放行，没登记决定的宿主也放行", async () => {
	for (const tier of ["sparing", "selective", "ready", "eager"] as const) {
		const { ctx, dispatched } = taskContext({ tier, mentioned: [] });
		const result = await taskTool.execute({ description: "找", prompt: "去找", subagent_type: "explore" }, ctx);
		assert.ok(!result.isError, `${tier} 不该在这里拦人——它靠提示词和闸门`);
		assert.deepEqual(dispatched, ["explore"]);
	}

	// CLI、测试这些没登记过决定的宿主：`undefined` 是「这个宿主不管这件事」，不是「什么都不许派」。
	const { ctx, dispatched } = taskContext(undefined);
	const result = await taskTool.execute({ description: "找", prompt: "去找", subagent_type: "explore" }, ctx);
	assert.ok(!result.isError);
	assert.deepEqual(dispatched, ["explore"]);
});

test("关掉且一个都没点名时，`task` 就算被塞回工具表也派不动", async () => {
	// 正常路径下工具已经被摘了。这道挡的是插件、`yield` 拼装之类把它放回去的路子。
	const { ctx, dispatched } = taskContext({ tier: "off", mentioned: [] });
	const result = await taskTool.execute({ description: "找", prompt: "去找", subagent_type: "explore" }, ctx);
	assert.ok(result.isError);
	assert.deepEqual(dispatched, []);
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";
	assert.match(text, /这一轮他一个也没点/);
});
