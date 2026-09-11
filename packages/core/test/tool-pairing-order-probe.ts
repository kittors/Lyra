/* oxlint-disable no-console -- probe CLI that prints what a real endpoint answered */
/**
 * 一个助手轮里有多个工具调用时，`function_call` 和 `function_call_output` 该怎么排。
 *
 * 二分（`reasoning-bisect-probe.ts`）的结果：一对调用/结果能过，第二对一加就 400，而报的是
 * `The reasoning_text in the thinking mode must be passed back to the API.`——推理项明明在，而且整个
 * 去掉它报的还是这句。所以这句话是端点对工具配对问题的统一说法，不是字面意思。
 *
 * 我们现在是**交错**排：call, output, call, output。那是为中转改的，`openai-responses-request.ts` 的
 * 注释记着理由：有些中转把每个 `function_call` 翻译成一条独立的助手消息，而 Chat Completions 要求带
 * `tool_calls` 的消息后面紧跟回答它的 tool 消息，两个调用连排就会被拒。
 *
 * 问题是 Responses 协议原本的排法是**成组**：一轮的所有 call，然后所有 output。这个探针就问这一件事，
 * 两种排法在同一个端点上各发一次。
 *
 * 用法：`node --experimental-strip-types packages/core/test/tool-pairing-order-probe.ts`
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
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

	let base: Item | undefined;
	let endToEnd = "没跑到";
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
			if (next.done) {
				const message = next.value;
				endToEnd =
					message.stopReason === "error"
						? `❌ ${message.errorMessage ?? "stopReason=error"}`
						: `✅ 成功（${message.content.map((c) => c.type).join("+") || "空"}）`;
				break;
			}
			if (next.value.type === "error") {
				endToEnd = `❌ ${next.value.error}`;
				break;
			}
		}
	} catch (error) {
		endToEnd = `❌ ${error instanceof Error ? error.message : String(error)}`;
	}
	if (!base) throw new Error("没抓到请求体");

	// 最要紧的一行：拿用户那个报废会话的真实历史，走真实适配器，现在到底过不过。
	console.log(`\n▸ 端到端（真实历史 + 真实适配器 + 当前代码）\n    ${endToEnd}\n`);
	console.log(`  我们现在真实发出去的排列：${((base.input as Item[]) ?? []).map((i) => String(i.type)).join(" → ")}\n`);

	const clone = (): Item => {
		const copy = JSON.parse(JSON.stringify(base)) as Item;
		delete copy.stream;
		return copy;
	};
	const items = (base.input as Item[]) ?? [];
	const calls = items.filter((i) => i.type === "function_call");
	const outputs = items.filter((i) => i.type === "function_call_output");
	const others = items.filter((i) => i.type !== "function_call" && i.type !== "function_call_output");

	console.log(`端点 ${url} · 模型 ${MODEL_ID}`);
	console.log(`一轮里 ${calls.length} 个工具调用、${outputs.length} 个结果\n`);

	/*
	 * 两种排法都在这里**重新拼**，不拿 `base.input` 当其中之一。
	 *
	 * 第一版把 `base.input` 直接当交错组，那在编码器改成默认成组之后就成了拿成组冒充交错——两行都绿，
	 * 看着像「两种都收」。基线是会变的，对照的两组必须各自显式构造。
	 */
	const interleavedInput: Item[] = [...others];
	for (const call of calls) {
		interleavedInput.push(call);
		const answer = outputs.find((o) => o.call_id === call.call_id);
		if (answer) interleavedInput.push(answer);
	}
	const interleaved = clone();
	interleaved.input = interleavedInput;
	console.log(`▸ 交错排（call,output,call,output…）\n    ${await post(url, key, interleaved)}\n`);

	const grouped = clone();
	grouped.input = [...others, ...calls, ...outputs];
	console.log(`▸ 成组排（所有 call，然后所有 output —— 现在的默认）\n    ${await post(url, key, grouped)}\n`);

	// 成组排 + 完全不发推理项，判断推理这条线到底还有没有份。
	const groupedNoReasoning = clone();
	groupedNoReasoning.input = [...others.filter((i) => i.type !== "reasoning"), ...calls, ...outputs];
	console.log(`▸ 成组排 + 整个推理项都不发\n    ${await post(url, key, groupedNoReasoning)}\n`);

	// 成组排 + 推理项只留 summary（没有 content.reasoning_text），验「推理文本」这条是否真的被要求。
	const groupedNoText = clone();
	groupedNoText.input = [
		...others.map((item) => {
			if (item.type !== "reasoning") return item;
			const copy = { ...item };
			delete copy.content;
			return copy;
		}),
		...calls,
		...outputs,
	];
	const noTextResult = await post(url, key, groupedNoText);
	console.log(`▸ 成组排 + 推理项去掉 content.reasoning_text\n    ${noTextResult}`);

	/*
	 * 落盘。
	 *
	 * 这四行是「排列才是根因、推理无关」那个结论的全部依据。上一轮审查里，唯一能被独立核验的结论恰好是
	 * 唯一落了盘的那个（九格矩阵），其余只能信转述——而这次的教训就是转述会走样。
	 */
	await writeFile(
		join(HOME, "scratch", "tool-pairing-order.txt"),
		[
			new Date().toISOString(),
			`端点 ${url} · 模型 ${MODEL_ID} · 一轮 ${calls.length} 个工具调用`,
			`端到端（真实历史 + 真实适配器 + 当前代码）  ${endToEnd}`,
			`真实发出的排列  ${items.map((i) => String(i.type)).join(" → ")}`,
			"",
			`交错排                              ${await post(url, key, interleaved)}`,
			`成组排（当前默认）                  ${await post(url, key, grouped)}`,
			`成组排 + 整个推理项都不发           ${await post(url, key, groupedNoReasoning)}`,
			`成组排 + 推理项去掉 reasoning_text  ${noTextResult}`,
		].join("\n"),
		"utf8",
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
