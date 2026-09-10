/* oxlint-disable no-console -- probe CLI that prints what real endpoints answered */
/**
 * 两轮真对话，走**我们自己的适配器**，不是手搓的请求体。
 *
 * 前面几个探针是手写 JSON 去问端点「这个形状你收不收」，那能定规矩，但定不了「我们发出去的到底是
 * 哪个形状」。这一个把 `streamAssistant` 原样跑一遍：第一轮让模型调工具，把它真实返回的思考块和
 * 工具调用接住，原样喂回去跑第二轮。第二轮过不去，就是客户端里那条 400 的现场复现。
 *
 * 顺手把第二轮真正发出去的请求体存下来（`onPayload`），出问题时能直接看到是哪个字段。
 *
 * 同一批模型跑两遍：一遍按配置的协议（这里都是 Responses），一遍**强行按 Chat Completions**。后者是
 * 因为那条链的问题只有真发出去才看得见——它一直只读不还，把解码接住的思考整段丢掉。
 *
 * 用法：`node --import tsx packages/core/test/wire-roundtrip-probe.ts [模型名过滤]`
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { streamAssistant } from "../src/ai/index.ts";
import type { AssistantMessage, LlmContext, Message, ModelConfig, ProviderConfig, ToolSpec } from "../src/types.ts";

const HOME = join(homedir(), ".lyra");
const FILTER = process.argv[2] ?? "";

const TOOLS: ToolSpec[] = [{
	name: "calc",
	description: "算一个算术表达式，返回结果",
	parameters: { type: "object", properties: { expr: { type: "string", description: "比如 1+1" } }, required: ["expr"], additionalProperties: false },
}];

const ASK = "用 calc 工具算 137*24，拿到结果后只回一个数字。";

interface Row { model: string; first: string; second: string; blocks: string }
const rows: Row[] = [];

/** 跑一轮，把最终消息拿回来；失败就把错误当成异常抛。 */
async function turn(provider: ProviderConfig, model: ModelConfig, context: LlmContext, onPayload?: (p: unknown) => void): Promise<AssistantMessage> {
	const stream = streamAssistant(provider, model, context, {
		thinking: "low",
		maxTokens: 2048,
		retryAttempts: 1,
		...(onPayload ? { onPayload } : {}),
	});
	let last: AssistantMessage | null = null;
	while (true) {
		const next = await stream.next();
		if (next.done) { last = next.value; break; }
		if (next.value.type === "error") throw new Error(next.value.error);
	}
	if (!last) throw new Error("没有拿到消息");
	if (last.stopReason === "error") throw new Error(last.errorMessage ?? "stopReason=error");
	return last;
}

/** 一句话说清这条助手消息里有什么——判断「思考块到底有没有被接住」靠它。 */
function describe(message: AssistantMessage): string {
	return message.content.map((c) =>
		c.type === "thinking"
			? `思考(${c.thinking.length}字${c.signature ? ",有签名" : ",无签名"}${c.encrypted ? ",有密文" : ""})`
			: c.type === "toolCall" ? `工具:${c.name}` : `文本(${c.text.length}字)`,
	).join(" + ") || "（空）";
}

async function main() {
	const { secret } = await import("../src/config/vault.ts");
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));

	for (const raw of settings.providers ?? []) {
		const key = raw.apiKey || (await secret(`provider:${raw.id}`)) || (await secret(raw.id));
		if (!key) continue;
		// 中转站的 gemini 全线在冷却（429），那是额度不是协议，跑了只会污染结论。
		const models = (raw.models ?? []).filter((m: ModelConfig) =>
			m.supportsThinking && !/gemini|gemma/i.test(m.modelId) && (!FILTER || m.modelId.includes(FILTER)));

		for (const api of ["openai-responses", "openai-chat-completions"] as const) {
		const provider: ProviderConfig = { ...raw, apiKey: key, api };
		console.log(`\n──── ${raw.id.slice(-8)} · ${api} ────`);
		for (const model of models) {
			const tag = `${raw.id.slice(-8)}/${model.modelId}·${api === "openai-responses" ? "resp" : "chat"}`;
			let first = "—";
			let second = "—";
			let blocks = "—";
			let payload: unknown = null;
			try {
				const one = await turn(provider, model, { systemPrompt: "你是一个测试助手。", messages: [
					{ role: "user", content: [{ type: "text", text: ASK }], timestamp: Date.now() },
				], tools: TOOLS });
				blocks = describe(one);
				const toolCall = one.content.find((c) => c.type === "toolCall");
				if (!toolCall) { first = "没调工具"; rows.push({ model: tag, first, second: "跳过", blocks }); console.log(`⚠️  ${tag}\n     第一轮：${blocks}（模型没调工具，测不到回放）`); continue; }
				first = "ok";

				// 第二轮：把第一轮原样喂回去——这正是客户端每一轮都在做的事。
				const history: Message[] = [
					{ role: "user", content: [{ type: "text", text: ASK }], timestamp: Date.now() },
					one,
					{ role: "toolResult", toolCallId: toolCall.id, toolName: toolCall.name, content: [{ type: "text", text: "3288" }], isError: false, timestamp: Date.now() },
				];
				const two = await turn(provider, model, { systemPrompt: "你是一个测试助手。", messages: history, tools: TOOLS }, (p) => { payload = p; });
				second = "ok";
				console.log(`✅ ${tag}\n     第一轮：${blocks}\n     第二轮：${describe(two)}`);
			} catch (e) {
				const text = String(e).slice(0, 300).replace(/\s+/g, " ");
				if (first === "ok") {
					second = text;
					console.log(`❌ ${tag}  第二轮挂了\n     第一轮：${blocks}\n     端点说：${text}`);
					if (payload) {
						const path = `/tmp/payload-${model.modelId.replace(/[^\w.-]/g, "_")}.json`;
						await writeFile(path, JSON.stringify(payload, null, 2));
						console.log(`     发出去的请求体：${path}`);
					}
				} else {
					first = text;
					console.log(`❌ ${tag}  第一轮就挂了\n     端点说：${text}`);
				}
			}
			rows.push({ model: tag, first, second, blocks });
		}
		}
	}

	console.log(`\n${"═".repeat(72)}`);
	const tested = rows.filter((r) => r.first === "ok" && r.second !== "跳过");
	const good = tested.filter((r) => r.second === "ok");
	console.log(`真跑了两轮的模型 ${tested.length} 个，第二轮能过的 ${good.length} 个`);
	for (const r of rows) {
		const state = r.second === "ok" ? "✅ 两轮都过" : r.first !== "ok" ? `❌ 第一轮：${r.first.slice(0, 90)}` : `❌ 第二轮：${r.second.slice(0, 90)}`;
		console.log(`  ${r.model.padEnd(44)} ${state}`);
	}
}

await main();
