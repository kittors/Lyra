/**
 * 子代理卡在重连上的时候，界面上说得出话。
 *
 * 之前说不出。子代理的 `retry` 只进了转录：主对话的抖动提示不解包 `subagent_event`（见
 * `apply-event.ts`），面板也不认识它。于是一个反复重连的子代理和一个安静干活的子代理长得一模
 * 一样——派它来的人只看见一个一直转的 task，没有任何线索说明它在等什么、等了多久。真实日志里
 * 有过一次同一个请求重发 222 次、34 分钟，全程界面上一片安静。
 *
 * 所以这条测试走的是真的那条路：真的适配器、真的 SSE、真的重试等待。`streamFn` 那个脚手架在这
 * 里没用——它替换掉整个 provider 调用，而 `retry` 恰恰是在它替换掉的那一段里发生的。
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { runSubAgent } from "../src/runtime/sub-agent.ts";
import { SubAgentRegistry } from "../src/runtime/sub-agents.ts";
import type { AgentDefinition } from "../src/agents-builtin.ts";
import type { ModelConfig, ProviderConfig, Settings } from "../src/types.ts";

let server: Server;
let base = "";
/** 这一次该怎么答——按测试逐次设定。 */
let answers: string[] = [];
let hits = 0;

/** 有帧、有 finish_reason、没有任何内容：日志里那 222 次拿到的正是这个形状。 */
const EMPTY = [
	`data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}`,
	`data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
	"data: [DONE]",
].join("\n\n");

const SPEAKS = [
	`data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"看完了"},"finish_reason":null}]}`,
	`data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
	"data: [DONE]",
].join("\n\n");

before(async () => {
	server = createServer((_req, res) => {
		const body = answers[hits] ?? SPEAKS;
		hits += 1;
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.end(`${body}\n\n`);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const MODEL: ModelConfig = {
	id: "t/m", providerId: "t", modelId: "m", name: "T", contextWindow: 100_000,
	maxOutputTokens: 1024, supportsThinking: false, supportsImages: false, supportsTools: true,
};

/** 一秒是 `normalizeRule` 允许的最小间隔——测试要等真的那一下，所以要它最短的那个。 */
const SETTINGS = {
	thinking: "off",
	retryPolicy: {
		network: { retries: null, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 },
		upstream: { retries: 2, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 },
	},
} as unknown as Settings;

/** 不声明 output：这条测试问的是重连看不看得见，跟交付没关系。 */
const PLAIN: AgentDefinition = {
	name: "explore", description: "只读", systemPrompt: "read-only", tools: [], source: "builtin",
};

test("正在重连的子代理，面板上说得出它在等什么", async () => {
	answers = [EMPTY, SPEAKS];
	hits = 0;
	const provider: ProviderConfig = {
		id: "t", name: "T", baseUrl: base, api: "openai-chat-completions", apiKey: "x", enabled: true, models: [MODEL],
	};
	const registry = new SubAgentRegistry();
	/* 记下 relay 到底把什么交给了注册表——这根线断掉时，界面重新变回一片安静。 */
	const handed: ({ attempt: number; reason: string } | undefined)[] = [];
	const real = registry.retrying.bind(registry);
	registry.retrying = (id, info) => { handed.push(info); real(id, info); };

	const answer = await runSubAgent(
		{
			sessionId: "s1", cwd: "/tmp", settings: SETTINGS, tools: [], skills: [], agents: [PLAIN],
			registry, requestApproval: async () => "allow", emit: async () => {},
		},
		{ description: "看一眼", prompt: "去看", agentType: "explore" },
		provider,
		MODEL,
		"",
	);

	assert.equal(hits, 2, "第一次空回答，重试一次之后拿到了正常的回答");
	assert.deepEqual(
		handed.map((info) => info && { attempt: info.attempt, reason: info.reason }),
		[{ attempt: 1, reason: "服务商返回了空回答" }, undefined],
		"先说清在等第几次、等的是什么，接上之后把它撤掉",
	);

	const record = registry.list()[0];
	assert.equal(record.retrying, undefined, "跑完了就不该还挂着「正在重连」");
	assert.equal(record.toolCalls, 0, "重连不是它做的事——记成工具调用，等于把一次故障说成工作量");
	assert.ok(answer.text.includes("看完了"), `重连之后拿到的答案照常回来：${answer.text}`);
});
