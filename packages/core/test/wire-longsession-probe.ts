/* oxlint-disable no-console -- probe CLI that prints what real endpoints answered */
/**
 * 一段**长**会话，走我们自己的适配器，一轮一轮真的跑下去。
 *
 * 两轮能过说明形状对；长会话才是那条线上报错的现场——客户那条 400 点名的是 `input[14]`，第 14 个 item，
 * 那得攒好几轮工具调用才数得到。历史本身就是请求，坏形状每多一轮就多复制一份，所以「第二轮过了」和
 * 「第八轮还过」是两个不同的结论。
 *
 * 中途换一次模型：那是最容易出事的一步——`stripStaleHandles` 会把上一家的句柄剥掉，剥完之后的历史
 * 还得能发给新的那一家。
 *
 * 用法：`node --import tsx packages/core/test/wire-longsession-probe.ts [轮数]`
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { streamAssistant } from "../src/ai/index.ts";
import { stripStaleHandles } from "../src/runtime/model-switch.ts";
import type { AssistantMessage, LlmContext, Message, ModelConfig, ProviderConfig, ToolSpec } from "../src/types.ts";

const HOME = join(homedir(), ".lyra");
const ROUNDS = Number(process.argv[2] ?? 6);

const TOOLS: ToolSpec[] = [{
	name: "calc",
	description: "算一个算术表达式，返回结果",
	parameters: { type: "object", properties: { expr: { type: "string" } }, required: ["expr"], additionalProperties: false },
}];

/** 每一轮都要求它再调一次工具，好让 item 数量真的涨起来。 */
const ASK = (n: number) => `用 calc 算 ${n}*${n + 7}，拿到结果后只回一个数字。`;

async function turn(provider: ProviderConfig, model: ModelConfig, context: LlmContext): Promise<AssistantMessage> {
	const stream = streamAssistant(provider, model, context, { thinking: "low", maxTokens: 2048, retryAttempts: 4 });
	let last: AssistantMessage | null = null;
	while (true) {
		const next = await stream.next();
		if (next.done) { last = next.value; break; }
		// `event.error` 是给人看的那一行摘要，供应商原话在消息的 `failure.detail` 里。
		if (next.value.type === "error") throw new Error(next.value.message.failure?.detail || next.value.error);
	}
	if (!last) throw new Error("没有拿到消息");
	// `summary` 是给人看的一行，会截断；查协议问题要的是供应商原话，那在 `detail` 里。
	if (last.stopReason === "error") throw new Error(last.failure?.detail || last.errorMessage || "stopReason=error");
	return last;
}

async function main() {
	const { secret } = await import("../src/config/vault.ts");
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));
	const configs: Array<{ provider: ProviderConfig; model: ModelConfig }> = [];

	for (const raw of settings.providers ?? []) {
		const key = raw.apiKey || (await secret(`provider:${raw.id}`)) || (await secret(raw.id));
		if (!key) continue;
		for (const model of (raw.models ?? []) as ModelConfig[]) {
			if (!model.supportsThinking || /gemini|gemma/i.test(model.modelId)) continue;
			if (process.env.ONLY && !model.modelId.includes(process.env.ONLY)) continue;
			configs.push({ provider: { ...raw, apiKey: key }, model });
		}
	}

	const results: Array<{ tag: string; rounds: number; items: number; note: string }> = [];
	for (const { provider, model } of configs) {
		const tag = `${provider.id.slice(-8)}/${model.modelId}`;
		let messages: Message[] = [];
		let done = 0;
		let note = "";
		try {
			for (let n = 1; n <= ROUNDS; n++) {
				messages.push({ role: "user", content: [{ type: "text", text: ASK(n) }], timestamp: Date.now() });
				// 一轮里可能连着「调工具 → 拿结果 → 再说话」，跟真实的 agent 循环一样跑到它不再要工具为止。
				for (let step = 0; step < 4; step++) {
					const reply = await turn(provider, model, { systemPrompt: "你是一个测试助手。", messages, tools: TOOLS });
					messages.push(reply);
					const calls = reply.content.filter((c) => c.type === "toolCall");
					if (calls.length === 0) break;
					for (const call of calls) {
						messages.push({
							role: "toolResult", toolCallId: call.id, toolName: call.name,
							content: [{ type: "text", text: "42" }], isError: false, timestamp: Date.now(),
						});
					}
				}
				done = n;
				// 一半的时候换模型：剥句柄之后的历史还得能发出去。
				if (n === Math.ceil(ROUNDS / 2)) {
					messages = stripStaleHandles(messages, messages.length);
					note = "（中途剥过句柄）";
				}
			}
		} catch (e) {
			// 全文，不截断——中转会把上游的话包好几层，砍到 160 字正好砍在最要紧的那半句上。
			note = String(e).replace(/\s+/g, " ");
		}
		const ok = done === ROUNDS;
		console.log(`${ok ? "✅" : "❌"} ${tag}  跑完 ${done}/${ROUNDS} 轮，历史 ${messages.length} 条消息${note ? `\n     ${note}` : ""}`);
		results.push({ tag, rounds: done, items: messages.length, note });
	}

	const good = results.filter((r) => r.rounds === ROUNDS);
	console.log(`\n${"═".repeat(64)}\n${good.length}/${results.length} 个模型跑满了 ${ROUNDS} 轮`);
	for (const r of results) if (r.rounds !== ROUNDS) console.log(`  ❌ ${r.tag} 停在第 ${r.rounds} 轮：${r.note}`);
}

await main();
