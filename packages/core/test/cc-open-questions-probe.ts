/* oxlint-disable no-console -- probe CLI that prints what a real endpoint answered */
/**
 * 把三个「没有证据所以空着」的格子，拿真实端点问出来。
 *
 * 这三条都被判过「学不到」——不是因为不重要，是因为它们**不产生错误串**：端点要么默默接受、要么默默
 * 改变行为。撞一次学一次对它们无效，只能实测。
 *
 *   1. 工具调用轮的 `content` 发 `""` 到底行不行。oh-my-pi 给 DeepSeek V4 Flash 声明了
 *      `requires-assistant-content-for-tool-calls`（`providers/deepseek.kdl:87`），意思是它要一个**非空**
 *      的 content，`""` 也不行、得给 `"."`。我们现在发 `""`。这条要是真的，每个工具调用轮都会被拒。
 *   2. 带推理时发 `tool_choice` 会不会**静默关掉推理**。oh-my-pi 的 `disableReasoningOnToolChoice`
 *      （`catalog/src/compat/resolve.ts:485`）说 DeepSeek 会。没有错误、没有任何提示，只是思考没了——
 *      用户看到的是「这个模型今天不思考了」。
 *   3. 关思考时**什么都不发**能不能真的关掉。我们现在是不发 `reasoning_effort`，等于用服务端默认；
 *      oh-my-pi 对支持该参数的模型发最低档。要是服务端默认就在思考，我们的「关」是假的。
 *
 * 每条都用**同一段历史**发两遍，只改被问的那一处，看差异。
 *
 * 用法：`node --experimental-strip-types packages/core/test/cc-open-questions-probe.ts`
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelConfig, ProviderConfig } from "../src/types.ts";

const HOME = join(homedir(), ".lyra");
const PROVIDER_ID = "provider-mtvmtyj6";
const MODEL_ID = "deepseek-flash";

type Body = Record<string, unknown>;

const TOOLS = [
	{
		type: "function",
		function: {
			name: "calc",
			description: "算一个算术表达式",
			parameters: { type: "object", properties: { expr: { type: "string" } }, required: ["expr"], additionalProperties: false },
		},
	},
];

/** 一轮完整的「想过 → 调了工具 → 拿到结果」，`content` 那一格留给调用方填。 */
const history = (content: string | null) => [
	{ role: "user", content: "用 calc 算 2+2" },
	{
		role: "assistant",
		content,
		reasoning_content: "要算 2+2，调 calc。",
		tool_calls: [{ id: "call_a", type: "function", function: { name: "calc", arguments: '{"expr":"2+2"}' } }],
	},
	{ role: "tool", tool_call_id: "call_a", content: "4" },
];

interface Answer {
	status: string;
	/** 这次回复里有没有推理文本——问题 2 和 3 靠它判断。 */
	reasoning: number;
	text: number;
}

async function ask(url: string, key: string, body: Body): Promise<Answer> {
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
			body: JSON.stringify({ ...body, stream: false }),
		});
		if (!response.ok) {
			const text = await response.text();
			const match = text.match(/"message"\s*:\s*"([^"]{0,140})/);
			return { status: `❌ ${response.status} ${match ? match[1] : text.slice(0, 140)}`, reasoning: 0, text: 0 };
		}
		const json = (await response.json()) as {
			choices?: { message?: { content?: string; reasoning_content?: string; reasoning?: string; reasoning_text?: string } }[];
		};
		const message = json.choices?.[0]?.message ?? {};
		const reasoning = message.reasoning_content ?? message.reasoning ?? message.reasoning_text ?? "";
		return { status: "✅ 200", reasoning: reasoning.length, text: (message.content ?? "").length };
	} catch (error) {
		return { status: `❌ 连不上 ${error instanceof Error ? error.message : String(error)}`, reasoning: 0, text: 0 };
	}
}

async function main() {
	const { secret } = await import("../src/config/vault.ts");
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));
	const raw = (settings.providers ?? []).find((p: ProviderConfig) => p.id === PROVIDER_ID);
	const key = raw?.apiKey || (await secret(`provider:${raw.id}`)) || (await secret(raw.id));
	const model = (raw?.models ?? []).find((m: ModelConfig) => m.modelId === MODEL_ID);
	if (!raw || !key || !model) throw new Error("取不到供应商/密钥/模型");
	const url = `${String(raw.baseUrl).replace(/\/$/, "")}/v1/chat/completions`;
	const base: Body = { model: MODEL_ID, max_tokens: 64 };

	const report: string[] = [`端点 ${url} · 模型 ${MODEL_ID}`, ""];
	const say = (line: string) => {
		console.log(line);
		report.push(line);
	};

	say("【问题 1】工具调用轮的 content 发什么");
	for (const [label, content] of [
		['""（我们现在这样）', ""],
		['"."（oh-my-pi 说 DeepSeek 要这个）', "."],
		["null（我们改之前那样）", null],
	] as const) {
		const answer = await ask(url, key, { ...base, messages: history(content), tools: TOOLS });
		say(`  ${label.padEnd(34)} ${answer.status}`);
	}

	say("");
	say("【问题 2】带推理时发 tool_choice 会不会静默关掉推理");
	/*
	 * 第一版用的历史是「工具已经调完、结果已经拿到」，模型只要念一个数字，本轮压根不需要想——两边推理
	 * 都是 0，对照什么都说明不了。换成一个**必须想一下**才能决定调不调工具的问题。
	 */
	const thinky = [{ role: "user", content: "先想清楚再答：123456 乘以 789 是多少？需要的话用 calc 工具。" }];
	const withChoice = await ask(url, key, { ...base, max_tokens: 512, messages: thinky, tools: TOOLS, tool_choice: "auto", reasoning_effort: "high" });
	const noChoice = await ask(url, key, { ...base, max_tokens: 512, messages: thinky, tools: TOOLS, reasoning_effort: "high" });
	say(`  带 tool_choice:auto   ${withChoice.status}  推理 ${withChoice.reasoning} 字，正文 ${withChoice.text} 字`);
	say(`  不带 tool_choice      ${noChoice.status}  推理 ${noChoice.reasoning} 字，正文 ${noChoice.text} 字`);
	say(
		withChoice.reasoning === 0 && noChoice.reasoning > 0
			? "  → 会静默关掉推理 ← 这一格要填"
			: withChoice.reasoning > 0 && noChoice.reasoning > 0
				? "  → 不会，两边都有推理"
				: "  → 两边都没有推理，这个对照说明不了问题（可能模型本轮就没想）",
	);

	say("");
	say("【问题 3】关思考：哪种写法能真的关掉");
	/*
	 * 第一轮量到：什么都不发时仍有 40 字推理，`effort: "low"` 也有 39 字——也就是说我们现在的「关」是假的，
	 * 用户关了思考还在为推理 token 付钱。所以这一轮把 oh-my-pi `reasoning-disable-mode` 那张枚举表里对
	 * OpenAI 兼容面适用的写法挨个试一遍，找出这个端点上真正管用的那个。
	 */
	const ask3 = [{ role: "user", content: "简短回答：1+1 等于几" }];
	const ways: { name: string; body: Body }[] = [
		{ name: "什么都不发（现在这样）", body: {} },
		{ name: 'reasoning_effort: "low"（最低档）', body: { reasoning_effort: "low" } },
		{ name: 'reasoning_effort: "none"', body: { reasoning_effort: "none" } },
		{ name: 'reasoning_effort: "minimal"', body: { reasoning_effort: "minimal" } },
		{ name: "thinking: { type: 'disabled' }", body: { thinking: { type: "disabled" } } },
		{ name: "enable_thinking: false", body: { enable_thinking: false } },
		{ name: "reasoning: { enabled: false }", body: { reasoning: { enabled: false } } },
	];
	let quiet: string | undefined;
	for (const way of ways) {
		const answer = await ask(url, key, { ...base, messages: ask3, ...way.body });
		say(`  ${way.name.padEnd(38)} ${answer.status}  推理 ${answer.reasoning} 字`);
		if (!quiet && answer.status.startsWith("✅") && answer.reasoning === 0) quiet = way.name;
	}
	say(quiet ? `  → 真正能关掉的是：${quiet}` : "  → 没有一种写法能关掉思考 ← 这个端点上「关思考」做不到，界面不该说能关");

	await writeFile(join(HOME, "scratch", "cc-open-questions.txt"), `${new Date().toISOString()}\n\n${report.join("\n")}`, "utf8");
	console.log("\n落盘：~/.lyra/scratch/cc-open-questions.txt");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
