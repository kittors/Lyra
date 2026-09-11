/* oxlint-disable no-console -- probe CLI that prints what a real endpoint answered */
/**
 * 在**真实形状**上做减法，问出这个端点到底要什么。
 *
 * 前提：`reasoning-encrypted-probe.ts` 已经证明「把 `content.reasoning_text` 带上」是必要的（不带必
 * 400），但**不充分**——带上之后同一句话照旧。所以还有别的条件没满足，而错误原文只说了推理那一句。
 *
 * 手搓请求体在这里是合理的，和上一轮审计踩的坑不同：那次是凭空拼一个我们根本不会发的形状，据此下
 * 结论；这次的基线是 `onPayload` 抓下来的、我们真实发出去的那一份，每个变体只在它上面动一处。改一处、
 * 发一次、记一次，哪一处让它转绿就是答案。
 *
 * 用法：`node --experimental-strip-types packages/core/test/reasoning-shape-matrix-probe.ts`
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { streamAssistant } from "../src/ai/index.ts";
import type { LlmContext, Message, ModelConfig, ProviderConfig, ToolSpec } from "../src/types.ts";

const HOME = join(homedir(), ".lyra");
const PROJECT = "63ca3825cb82944e";
const PROVIDER_ID = "provider-mtvmtyj6";
const MODEL_ID = "deepseek-flash";

type Item = Record<string, unknown>;

/** 真实历史，取自报废的那两个会话之一。 */
async function realHistory(): Promise<{ messages: Message[]; source: string }> {
	const dir = join(HOME, "sessions", PROJECT);
	const all = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
	const ordered = [...all.filter((f) => /^(2cce521c|1eb0699f)/.test(f)), ...all.filter((f) => !/^(2cce521c|1eb0699f)/.test(f))];
	for (const log of ordered) {
		const out: Message[] = [];
		let armed = false;
		for (const line of (await readFile(join(dir, log), "utf8")).split("\n")) {
			if (!line.trim()) continue;
			let row: { type?: string; message?: Message };
			try {
				row = JSON.parse(line);
			} catch {
				continue;
			}
			const message = row.type === "message" ? row.message : undefined;
			if (!message) continue;
			if (message.role === "assistant" && message.stopReason === "error") break;
			out.push(message);
			if (message.role === "assistant" && message.content.some((c) => c.type === "thinking") && message.content.some((c) => c.type === "toolCall")) armed = true;
		}
		if (armed) return { messages: out, source: log };
	}
	throw new Error("找不到带思考+工具调用的真实历史");
}

const TOOLS: ToolSpec[] = [
	{ name: "read", description: "读一个文件", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
	{ name: "ls", description: "列目录", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
	{ name: "glob", description: "按模式找文件", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"], additionalProperties: false } },
];

/** 抓一份我们真实发出去的请求体当基线。 */
async function baseline(provider: ProviderConfig, model: ModelConfig, context: LlmContext): Promise<Item> {
	let sent: Item | undefined;
	const stream = streamAssistant(provider, model, context, {
		thinking: "high",
		maxTokens: 256,
		retryAttempts: 1,
		onPayload: (p) => {
			sent = p as Item;
		},
	});
	try {
		while (true) {
			const next = await stream.next();
			if (next.done) break;
		}
	} catch {
		// 基线这一发本来就预期失败，要的只是请求体。
	}
	if (!sent) throw new Error("没抓到请求体");
	return sent;
}

/** 直接把一个请求体发出去，返回端点的原话。 */
async function post(url: string, key: string, body: Item): Promise<string> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
		body: JSON.stringify({ ...body, stream: false }),
	});
	if (response.ok) return "✅ 200";
	const text = await response.text();
	const match = text.match(/"message"\s*:\s*"([^"]{0,160})/);
	return `❌ ${response.status} ${match ? match[1] : text.slice(0, 160)}`;
}

const clone = (body: Item): Item => JSON.parse(JSON.stringify(body));

async function main() {
	const { secret } = await import("../src/config/vault.ts");
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));
	const raw = (settings.providers ?? []).find((p: ProviderConfig) => p.id === PROVIDER_ID);
	if (!raw) throw new Error(`设置里没有 ${PROVIDER_ID}`);
	const key = raw.apiKey || (await secret(`provider:${raw.id}`)) || (await secret(raw.id));
	const model = (raw.models ?? []).find((m: ModelConfig) => m.modelId === MODEL_ID);
	if (!key || !model) throw new Error("取不到密钥或模型");
	const provider: ProviderConfig = { ...raw, apiKey: key, api: "openai-responses" };

	const { messages, source } = await realHistory();
	const base = await baseline(provider, model, { systemPrompt: "你是一个助手。", messages, tools: TOOLS });
	const url = `${String(raw.baseUrl).replace(/\/$/, "")}/v1/responses`;
	const input = (base.input as Item[]) ?? [];

	console.log(`历史取自 ${source}；基线 input ${input.length} 项：`);
	for (const [i, item] of input.entries()) console.log(`  [${i}] ${String(item.type)} {${Object.keys(item).join(",")}}`);
	console.log(`\n端点 ${url}\n模型 ${MODEL_ID}\n`);

	const reasoningAt = input.findIndex((i) => i.type === "reasoning");
	const variants: { name: string; build: () => Item }[] = [
		{ name: "基线（我们真实发的那一份）", build: () => clone(base) },
		{
			name: "去掉 encrypted_content（只留 id + summary + content）",
			build: () => {
				const body = clone(base);
				for (const item of body.input as Item[]) if (item.type === "reasoning") delete item.encrypted_content;
				return body;
			},
		},
		{
			name: "去掉 id（只留 summary + content + 密文）",
			build: () => {
				const body = clone(base);
				for (const item of body.input as Item[]) if (item.type === "reasoning") delete item.id;
				return body;
			},
		},
		{
			name: "去掉 summary（只留 id + content + 密文）",
			build: () => {
				const body = clone(base);
				for (const item of body.input as Item[]) if (item.type === "reasoning") delete item.summary;
				return body;
			},
		},
		{
			name: "整个推理项都去掉",
			build: () => {
				const body = clone(base);
				body.input = (body.input as Item[]).filter((i) => i.type !== "reasoning");
				return body;
			},
		},
		{
			name: "推理项挪到紧邻第一个 function_call 之前",
			build: () => {
				const body = clone(base);
				const items = body.input as Item[];
				const [reasoning] = items.splice(items.findIndex((i) => i.type === "reasoning"), 1);
				const callAt = items.findIndex((i) => i.type === "function_call");
				items.splice(callAt, 0, reasoning);
				return body;
			},
		},
		{
			name: "去掉助手的文本项（reasoning 与 function_call 之间那条 message）",
			build: () => {
				const body = clone(base);
				const items = body.input as Item[];
				body.input = items.filter((item, i) => !(i > reasoningAt && item.type === "message" && item.role === "assistant"));
				return body;
			},
		},
		{
			name: "每个 function_call 前面都放一份推理项",
			build: () => {
				const body = clone(base);
				const items = body.input as Item[];
				const reasoning = items.find((i) => i.type === "reasoning") as Item;
				const out: Item[] = [];
				for (const item of items) {
					if (item.type === "function_call") out.push(clone(reasoning));
					if (item.type !== "reasoning") out.push(item);
				}
				body.input = out;
				return body;
			},
		},
		{
			name: "关掉思考（reasoning 参数整个不发，历史里的推理项也去掉）",
			build: () => {
				const body = clone(base);
				delete body.reasoning;
				body.input = (body.input as Item[]).filter((i) => i.type !== "reasoning");
				return body;
			},
		},
	];

	const report: string[] = [];
	for (const variant of variants) {
		let line: string;
		try {
			line = `${variant.name}\n    ${await post(url, key, variant.build())}`;
		} catch (error) {
			line = `${variant.name}\n    ❌ 本地异常 ${error instanceof Error ? error.message : String(error)}`;
		}
		console.log(`▸ ${line}\n`);
		report.push(line);
	}

	await writeFile(join(HOME, "scratch", "reasoning-shape-matrix.txt"), report.join("\n\n"), "utf8");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
