/* oxlint-disable no-console -- probe CLI that prints what real endpoints answered */
/**
 * 交错排到底还被谁需要——挨个 Responses 端点问一遍。
 *
 * 背景：一轮里多个工具调用，`function_call` 和结果有两种排法。我们写死交错，理由是某些把 Responses
 * 翻译成 Chat Completions 的中转需要它（`an assistant message with 'tool_calls' must be followed by
 * tool messages…`）。而 `api.deepseek.com` 的 Responses 要成组，交错一律 400。
 *
 * 改默认值之前必须知道这件事：那个需要交错的端点**现在还在吗**，那句话还复现得出来吗。如果它也成了历史
 * 伤疤，默认就该是成组；如果还活着，默认不能动，只能对撞过的端点学。拿一个没验证的假设换掉另一个不算修。
 *
 * 每个端点两发：同一段历史，一次交错、一次成组。历史是合成的，但形状取自真实故障——一轮里两个工具调用，
 * 各自带结果。这里**不能**用真实会话日志，因为要问的是所有端点，而那段历史只属于其中一个。
 *
 * 用法：`node --experimental-strip-types packages/core/test/tool-pairing-survey-probe.ts [模型名过滤]`
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelConfig, ProviderConfig } from "../src/types.ts";

const HOME = join(homedir(), ".lyra");
const FILTER = process.argv[2] ?? "";

type Item = Record<string, unknown>;

const TOOLS = [
	{ type: "function", name: "calc", description: "算一个算术表达式", parameters: { type: "object", properties: { expr: { type: "string" } }, required: ["expr"], additionalProperties: false }, strict: false },
];

/*
 * 一轮完整的历史，形状照着我们真实发出去的那份来：user → 推理项 → 助手文本 → 两个调用 → 两个结果。
 *
 * 前面缺了推理项和助手文本的版本在 DeepSeek 上两种排法都被拒——拒的理由跟排列无关，于是这个对照什么
 * 都问不出来。要比较两种排法，其余部分必须是它能接受的。
 */
const USER: Item = { type: "message", role: "user", content: [{ type: "input_text", text: "用 calc 分别算 2+2 和 3+3" }] };
const REASONING: Item = {
	type: "reasoning",
	summary: [{ type: "summary_text", text: "两个都要算，一次并行调两次 calc。" }],
	content: [{ type: "reasoning_text", text: "两个都要算，一次并行调两次 calc。" }],
};
const SAID: Item = { type: "message", role: "assistant", content: [{ type: "output_text", text: "我来算这两个。" }] };
const CALL_A: Item = { type: "function_call", call_id: "call_a", name: "calc", arguments: '{"expr":"2+2"}' };
const CALL_B: Item = { type: "function_call", call_id: "call_b", name: "calc", arguments: '{"expr":"3+3"}' };
const OUT_A: Item = { type: "function_call_output", call_id: "call_a", output: "4" };
const OUT_B: Item = { type: "function_call_output", call_id: "call_b", output: "6" };

const HEAD = [USER, REASONING, SAID];
const INTERLEAVED = [...HEAD, CALL_A, OUT_A, CALL_B, OUT_B];
const GROUPED = [...HEAD, CALL_A, CALL_B, OUT_A, OUT_B];
/** 对照：只有一个调用。两对才挂、一对能过的话，这一格应当两边都绿。 */
const SINGLE = [...HEAD, CALL_A, OUT_A];

async function post(url: string, key: string, model: string, input: Item[]): Promise<string> {
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
			body: JSON.stringify({ model, input, tools: TOOLS, stream: false, store: false, max_output_tokens: 64 }),
		});
		if (response.ok) return "✅ 200";
		const text = await response.text();
		const match = text.match(/"message"\s*:\s*"([^"]{0,120})/);
		return `❌ ${response.status} ${match ? match[1] : text.slice(0, 120)}`;
	} catch (error) {
		return `❌ 连不上 ${error instanceof Error ? error.message : String(error)}`;
	}
}

const joinUrl = (base: string, path: string) => `${base.replace(/\/$/, "").replace(/\/v1$/, "")}${path}`;

async function main() {
	const { secret } = await import("../src/config/vault.ts");
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));

	console.log("每个端点两发：同一段历史，一次交错、一次成组。\n");
	const verdicts: string[] = [];
	const report: string[] = [];

	for (const raw of (settings.providers ?? []) as ProviderConfig[]) {
		const key = raw.apiKey || (await secret(`provider:${raw.id}`)) || (await secret(raw.id));
		if (!key || !raw.baseUrl) continue;
		const models = (raw.models ?? []).filter((m: ModelConfig) => (FILTER ? m.modelId.includes(FILTER) : true));
		if (models.length === 0) continue;
		// 一个供应商只问一个模型：要问的是端点的脾气，不是模型的。
		const model = models.find((m: ModelConfig) => m.supportsThinking) ?? models[0];
		const url = joinUrl(String(raw.baseUrl), "/v1/responses");

		const single = await post(url, key, model.modelId, SINGLE);
		const interleaved = await post(url, key, model.modelId, INTERLEAVED);
		const grouped = await post(url, key, model.modelId, GROUPED);
		const verdict = !single.startsWith("✅")
			? "连单个调用都拒 ← 这个对照作废，问题在别处"
			: interleaved.startsWith("✅") && grouped.startsWith("✅")
				? "两种都收"
				: interleaved.startsWith("✅")
					? "只收交错 ← 默认不能动"
					: grouped.startsWith("✅")
						? "只收成组"
						: "两种都拒";
		console.log(`──── ${raw.id} · ${model.modelId}\n     ${String(raw.baseUrl)}`);
		console.log(`     单个调用（对照） ${single}`);
		console.log(`     交错             ${interleaved}`);
		console.log(`     成组             ${grouped}`);
		console.log(`     → ${verdict}\n`);
		verdicts.push(`${raw.id}/${model.modelId}: ${verdict}`);
		report.push(`${raw.id} · ${model.modelId} · ${String(raw.baseUrl)}\n  单个调用 ${single}\n  交错     ${interleaved}\n  成组     ${grouped}\n  → ${verdict}\n`);
	}

	console.log("汇总：");
	for (const line of verdicts) console.log(`  ${line}`);

	// 落盘：这是「默认成组」那个决定的依据，别人要核验它得能读到原文，而不是只能信转述。
	await writeFile(join(HOME, "scratch", "tool-pairing-survey.txt"), `${new Date().toISOString()}\n\n${report.join("\n")}`, "utf8");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
