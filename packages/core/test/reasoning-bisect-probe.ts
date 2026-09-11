/* oxlint-disable no-console -- probe CLI that prints what a real endpoint answered */
/**
 * 二分：`reasoning_text must be passed back` 到底是被哪一项触发的。
 *
 * 形状矩阵（`reasoning-shape-matrix-probe.ts`）跑出一个反直觉的结果：九种变体全 400，**连「整个推理项
 * 都去掉」和「关掉思考」都报同一句话**。推理项都不在了还说推理没带回来，只能说明这句话在这里不是字面
 * 意思——它是端点对别的问题的统一说法。
 *
 * 所以从空请求往上加，一项一项加回去，第一个转红的那项就是真正的触发者。
 *
 * 用法：`node --experimental-strip-types packages/core/test/reasoning-bisect-probe.ts`
 */

import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { streamAssistant } from "../src/ai/index.ts";
import type { Message, ModelConfig, ProviderConfig, ToolSpec } from "../src/types.ts";

const HOME = join(homedir(), ".lyra");
const PROJECT = "63ca3825cb82944e";
const PROVIDER_ID = "provider-mtvmtyj6";
const MODEL_ID = "deepseek-flash";

type Item = Record<string, unknown>;

const TOOLS: ToolSpec[] = [
	{ name: "read", description: "读一个文件", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
	{ name: "ls", description: "列目录", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
	{ name: "glob", description: "按模式找文件", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"], additionalProperties: false } },
];

async function realHistory(): Promise<Message[]> {
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
		if (armed) return out;
	}
	throw new Error("找不到真实历史");
}

async function post(url: string, key: string, body: Item): Promise<string> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
		body: JSON.stringify({ ...body, stream: false }),
	});
	if (response.ok) return "✅ 200";
	const text = await response.text();
	const match = text.match(/"message"\s*:\s*"([^"]{0,200})/);
	return `❌ ${response.status} ${match ? match[1] : text.slice(0, 200)}`;
}

async function main() {
	const { secret } = await import("../src/config/vault.ts");
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));
	const raw = (settings.providers ?? []).find((p: ProviderConfig) => p.id === PROVIDER_ID);
	const key = raw?.apiKey || (await secret(`provider:${raw.id}`)) || (await secret(raw.id));
	const model = (raw?.models ?? []).find((m: ModelConfig) => m.modelId === MODEL_ID);
	if (!raw || !key || !model) throw new Error("取不到供应商/密钥/模型");
	const provider: ProviderConfig = { ...raw, apiKey: key, api: "openai-responses" };
	const url = `${String(raw.baseUrl).replace(/\/$/, "")}/v1/responses`;

	// 抓一份真实请求体当零件库。
	let base: Item | undefined;
	const stream = streamAssistant(provider, model, { systemPrompt: "你是一个助手。", messages: await realHistory(), tools: TOOLS }, {
		thinking: "high",
		maxTokens: 256,
		retryAttempts: 1,
		onPayload: (p) => {
			base = p as Item;
		},
	});
	try {
		while (true) {
			const next = await stream.next();
			if (next.done) break;
		}
	} catch {
		/* 预期失败，只要请求体 */
	}
	if (!base) throw new Error("没抓到请求体");
	const items = base.input as Item[];
	const strip = (body: Item): Item => {
		const copy = JSON.parse(JSON.stringify(body)) as Item;
		delete copy.stream;
		return copy;
	};

	console.log(`端点 ${url} · 模型 ${MODEL_ID}\n`);
	console.log("从空往上加，第一个转红的就是触发者：\n");

	for (let n = 1; n <= items.length; n++) {
		const body = strip(base);
		body.input = items.slice(0, n);
		const head = items[n - 1];
		const label = `${String(head.type)}${head.role ? `/${String(head.role)}` : ""}${head.name ? `:${String(head.name)}` : ""}`;
		console.log(`  前 ${String(n).padStart(2)} 项（新增 ${label}）  ${await post(url, key, body)}`);
	}

	console.log("\n再单独问两个基础问题：");
	const bare = strip(base);
	bare.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "说一个字" }] }];
	console.log(`  只有一条 user 消息            ${await post(url, key, bare)}`);

	const noTools = strip(bare);
	delete noTools.tools;
	delete noTools.tool_choice;
	console.log(`  只有 user 消息、不带 tools    ${await post(url, key, noTools)}`);

	const noReasoning = strip(bare);
	delete noReasoning.reasoning;
	console.log(`  只有 user 消息、不带 reasoning ${await post(url, key, noReasoning)}`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
