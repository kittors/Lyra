/* oxlint-disable no-console -- probe CLI that prints what real endpoints answered */
/**
 * Responses 链上那些**请求参数**的问题，挨个端点问一遍真话。
 *
 * 要问的四件事，每件都对应一处我们现在写死、而各家未必一致的东西：
 *
 *   1. 关思考时发 `reasoning: {effort: "none"}` —— `none` 是 GPT-5.1 之后才有的枚举值，更早的推理模型
 *      （o3 / o4-mini）会拒。而完全省略 `reasoning` 又不等于关掉思考：有些供应商默认就会想。两种都有
 *      代价，所以得问出来哪种能过。
 *   2. `tool_choice: "auto"` —— 它本来就是服务端默认值，发它零收益。有没有端点因此拒？
 *   3. `include: ["reasoning.encrypted_content"]` —— 我们无条件要求上游回密文。有没有端点因此拒？
 *   4. `temperature` 在开思考时一起发 —— Anthropic 系明确不许，Responses 这边各家如何？
 *
 * 每问一件事发两次：带上和不带。只改一处，其余保持在已知能过的形状上。
 *
 * 用法：`node --experimental-strip-types packages/core/test/responses-params-probe.ts [模型名过滤]`
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelConfig, ProviderConfig } from "../src/types.ts";

const HOME = join(homedir(), ".lyra");
const FILTER = process.argv[2] ?? "";

type Item = Record<string, unknown>;

const TOOLS = [
	{
		type: "function",
		name: "calc",
		description: "算一个算术表达式",
		parameters: { type: "object", properties: { expr: { type: "string" } }, required: ["expr"], additionalProperties: false },
		strict: false,
	},
];

const INPUT: Item[] = [{ type: "message", role: "user", content: [{ type: "input_text", text: "说一个字" }] }];

async function post(url: string, key: string, body: Item): Promise<string> {
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
			body: JSON.stringify(body),
		});
		if (response.ok) return "✅ 200";
		const text = await response.text();
		const match = text.match(/"message"\s*:\s*"([^"]{0,140})/);
		return `❌ ${response.status} ${match ? match[1] : text.slice(0, 140)}`;
	} catch (error) {
		return `❌ 连不上 ${error instanceof Error ? error.message : String(error)}`;
	}
}

const joinUrl = (base: string, path: string) => `${base.replace(/\/$/, "").replace(/\/v1$/, "")}${path}`;

async function main() {
	const { secret } = await import("../src/config/vault.ts");
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));
	const report: string[] = [];

	for (const raw of (settings.providers ?? []) as ProviderConfig[]) {
		const key = raw.apiKey || (await secret(`provider:${raw.id}`)) || (await secret(raw.id));
		if (!key || !raw.baseUrl) continue;
		const models = (raw.models ?? []).filter((m: ModelConfig) => (FILTER ? m.modelId.includes(FILTER) : true));
		const model = models.find((m: ModelConfig) => m.supportsThinking) ?? models[0];
		if (!model) continue;
		const url = joinUrl(String(raw.baseUrl), "/v1/responses");
		const base: Item = { model: model.modelId, input: INPUT, stream: false, store: false, max_output_tokens: 32 };

		const cases: { name: string; body: Item }[] = [
			{ name: "裸请求（对照）", body: { ...base } },
			{ name: "关思考：reasoning.effort=none", body: { ...base, reasoning: { effort: "none" } } },
			{ name: "关思考：整个 reasoning 不发", body: { ...base } },
			{ name: "开思考：effort=low + summary=auto", body: { ...base, reasoning: { effort: "low", summary: "auto" } } },
			{ name: "开思考 + include 密文", body: { ...base, reasoning: { effort: "low", summary: "auto" }, include: ["reasoning.encrypted_content"] } },
			{ name: "开思考 + temperature", body: { ...base, reasoning: { effort: "low", summary: "auto" }, temperature: 0.7 } },
			{ name: "带工具 + tool_choice=auto", body: { ...base, tools: TOOLS, tool_choice: "auto" } },
			{ name: "带工具 + 不发 tool_choice", body: { ...base, tools: TOOLS } },
		];

		console.log(`\n──── ${raw.id} · ${model.modelId}\n     ${String(raw.baseUrl)}`);
		report.push(`${raw.id} · ${model.modelId} · ${String(raw.baseUrl)}`);
		for (const one of cases) {
			const result = await post(url, key, one.body);
			console.log(`     ${one.name.padEnd(34)} ${result}`);
			report.push(`  ${one.name.padEnd(34)} ${result}`);
		}
		report.push("");
	}

	await writeFile(join(HOME, "scratch", "responses-params.txt"), `${new Date().toISOString()}\n\n${report.join("\n")}`, "utf8");
	console.log(`\n落盘：~/.lyra/scratch/responses-params.txt`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
