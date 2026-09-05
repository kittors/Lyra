/**
 * `verify` 跑一个失败的测试，父代理拿到的是失败摘要，不是完整日志——计划 09 §11 的原话。
 *
 * 这个 agent 存在的全部理由是**上下文隔离**：一整段测试日志放在主会话里会挤掉别的东西。
 * 所以这里断言的核心是一个不等式——父代理拿到的文本长度，远小于日志长度。日志是假的、
 * 模型是脚本化的，而那个不等式是真的。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { runSubAgent } from "../src/runtime/sub-agent.ts";
import { SubAgentRegistry } from "../src/runtime/sub-agents.ts";
import { BUILTIN_AGENTS } from "../src/tools/task.ts";
import { YIELD_TOOL_NAME } from "../src/runtime/yield-tool.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig, Settings, Tool } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

const MODEL: ModelConfig = { id: "fake/model", providerId: "fake", modelId: "model", name: "Fake", contextWindow: 100_000, maxOutputTokens: 4096, supportsThinking: false, supportsImages: false, supportsTools: true };
const PROVIDER: ProviderConfig = { id: "fake", name: "Fake", baseUrl: "http://l", api: "openai-responses", apiKey: "x", enabled: true, models: [MODEL] };

/** 一段像样的失败日志：41 条过、2 条挂、每条挂的都有一屏堆栈。二十来 KB。 */
const LOG = [
	...Array.from({ length: 41 }, (_, i) => `✔ case ${i} passes (${(i * 1.3).toFixed(1)}ms)`),
	"✖ parses a nested config (12.4ms)",
	"  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:",
	"  + actual - expected",
	"  + { a: 1 }",
	"  - { a: 1, b: 2 }",
	...Array.from({ length: 60 }, (_, i) => `      at Module._compile (node:internal/modules/cjs/loader:${1200 + i}:14)`),
	"✖ rejects an empty key (3.1ms)",
	"  TypeError: Cannot read properties of undefined (reading 'trim')",
	"      at parseSettings (src/parser.ts:18:22)",
	...Array.from({ length: 60 }, (_, i) => `      at async Test.run (node:internal/test_runner/test:${900 + i}:9)`),
	"ℹ tests 43", "ℹ pass 41", "ℹ fail 2",
].join("\n");

function bashReturning(text: string): Tool {
	return {
		name: "bash",
		snippet: "Run shell commands",
		description: "Run shell commands",
		parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false },
		async execute() {
			return { content: [{ type: "text", text }] };
		},
	} as unknown as Tool;
}

const say = (text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({
	role: "assistant", api: "openai-responses", provider: "fake", model: "model", usage: emptyUsage(), stopReason, timestamp: Date.now(), content: [{ type: "text", text }],
});
const call = (name: string, args: Record<string, unknown>): AssistantMessage => ({
	...say("", "toolUse"),
	content: [{ type: "toolCall", id: `c-${name}`, name, arguments: args, argumentsText: JSON.stringify(args) }],
});

test("父代理拿到的是失败摘要，不是完整日志", async () => {
	const registry = new SubAgentRegistry();
	const replies = [
		call("bash", { command: "node --test" }),
		call(YIELD_TOOL_NAME, {
			passed: false,
			summary: "node --test: 41 passed, 2 failed",
			command: "node --test",
			failures: [
				{ name: "parses a nested config", message: "Expected values to be strictly deep-equal: missing b: 2" },
				{ name: "rejects an empty key", location: "src/parser.ts:18", message: "Cannot read properties of undefined (reading 'trim')" },
			],
		}),
		say("done"),
	];
	let turn = 0;

	const answer = await runSubAgent(
		{
			sessionId: "s1",
			cwd: "/tmp",
			settings: { thinking: "off", retryAttempts: 0 } as unknown as Settings,
			tools: [bashReturning(LOG)],
			skills: [],
			agents: BUILTIN_AGENTS,
			registry,
			requestApproval: async () => "allow",
			emit: async () => {},
			streamFn: async () => replies[Math.min(turn++, replies.length - 1)],
		},
		{ description: "跑测试", prompt: "跑一遍测试，告诉我结果。", agentType: "verify" },
		PROVIDER,
		MODEL,
		"",
	);

	assert.ok(LOG.length > 5_000, `日志得够大才有意义：${LOG.length}`);
	assert.equal(answer.output?.passed, false);
	assert.equal((answer.output?.failures as unknown[])?.length, 2, "两条失败各一条");
	/*
	 * 不等式本身。父代理读的是 `text`——它得远小于日志，否则委派出去等于没委派。
	 * 十分之一是个宽松的线：真实情况差得更远。
	 */
	assert.ok(answer.text.length < LOG.length / 10, `父代理拿到 ${answer.text.length} 字符，日志 ${LOG.length} 字符——摘要没起作用`);
	assert.ok(!answer.text.includes("node:internal/modules/cjs/loader"), "堆栈不该漏到父代理那里");
});

test("verify 只有 read 和 bash——一个会修东西的验证者会在报告之前顺手修掉", () => {
	const verify = BUILTIN_AGENTS.find((a) => a.name === "verify");
	assert.deepEqual(verify?.tools, ["read", "bash"]);
	assert.equal(verify?.model, "@fast", "验证是扇出型工作，便宜的模型就够");
});

test("plan 没有任何写工具", () => {
	/*
	 * 不给写工具，所以它没法「顺手先改一点」。规划和执行分开的意义就在这儿：一个能改文件的
	 * 规划者，交回来的计划里有一半已经做了。
	 */
	const plan = BUILTIN_AGENTS.find((a) => a.name === "plan");
	assert.ok(plan, "plan 该是内置的");
	assert.ok(Array.isArray(plan.tools) && !plan.tools.some((t) => ["edit", "write", "bash"].includes(t)), `不该有写工具：${JSON.stringify(plan.tools)}`);
	assert.equal(plan.model, "@deep", "规划错了后面每一步都在错的方向上花钱——这是唯一一个贵一点值得的场合");
});

test("两个都声明了 output schema，父代理拿到的是结构化的", () => {
	for (const name of ["verify", "plan"]) {
		const def = BUILTIN_AGENTS.find((a) => a.name === name);
		assert.ok(def?.output, `${name} 该有 schema`);
		assert.ok(Array.isArray((def.output as { required?: string[] }).required), `${name} 的 schema 该有 required`);
	}
});
