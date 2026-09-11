/* oxlint-disable no-console -- probe CLI that prints what real endpoints answered */
/**
 * 今天所有改动的真实端点复测。
 *
 * 单测证明的是「这个函数按我想的那样编码」，不是「端点收」。而今天有三条改动是在最后一次真实验证**之后**
 * 做的（子 Agent 容错、末项防护、CC 链关思考），外加 Anthropic 那条链的 12 项改动**一条真实请求都没发过**。
 * 这个探针把它们一次问完。
 *
 * 每条链都走**真实适配器**（`streamAssistant`），不手搓请求体——手搓能问出端点的规矩，问不出「我们真实
 * 发的是哪个形状」，这两件事今天差过一次。
 *
 * 用法：`node --experimental-strip-types packages/core/test/final-recheck-probe.ts`
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { streamAssistant } from "../src/ai/index.ts";
import type { AssistantMessage, LlmContext, Message, ModelConfig, ProviderConfig, ToolSpec } from "../src/types.ts";

const HOME = join(homedir(), ".lyra");

/** 一把带「刁钻 schema」的工具：`minItems`、`pattern`、`format` 都是 Anthropic 白名单会处理的。 */
const TOOLS: ToolSpec[] = [
	{
		name: "calc",
		description: "算一个算术表达式",
		parameters: {
			type: "object",
			properties: {
				expr: { type: "string", pattern: "^[0-9+\\-*/ ()]+$" },
				tags: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
			},
			required: ["expr"],
			additionalProperties: false,
		},
	},
];

/** 一段带思考、工具调用、孤立代理项的历史——今天改过的路径尽量都踩到。 */
function history(api: string, provider: string, model: string): Message[] {
	return [
		{ role: "user", content: [{ type: "text", text: "用 calc 算 2+2，然后说结果。" }], timestamp: 1 },
		{
			role: "assistant",
			content: [
				// 无签名的思考块：Anthropic 链从前会把它整块丢掉（缺口 1）。
				{ type: "thinking", thinking: "先算一下 2+2。" },
				// 参数里藏一个孤立代理项：不清洗的话 Anthropic 会用严格 UTF-8 拒掉（缺口 9）。
				{ type: "toolCall", id: "call_1", name: "calc", arguments: { expr: "2+2", note: "\ud800" } },
			],
			api,
			provider,
			model,
			usage: { input: 0, output: 0 },
			stopReason: "toolUse",
			timestamp: 2,
		},
		{ role: "toolResult", toolCallId: "call_1", toolName: "calc", content: [{ type: "text", text: "4" }], isError: false, timestamp: 3 },
	] as Message[];
}

async function attempt(
	provider: ProviderConfig,
	model: ModelConfig,
	context: LlmContext,
	options: Record<string, unknown>,
): Promise<string> {
	try {
		// Anthropic 的思考要求 budget >= 1024 且 maxOutputTokens > 1024，给够，否则测到的是参数校验不是编码器。
		const stream = streamAssistant(provider, model, context, { maxTokens: 2048, retryAttempts: 1, ...options } as never);
		let last: AssistantMessage | undefined;
		while (true) {
			const next = await stream.next();
			if (next.done) {
				last = next.value;
				break;
			}
		}
		if (!last) return "❌ 没拿到消息";
		if (last.stopReason === "error") return `❌ ${last.errorMessage ?? "stopReason=error"}`;
		const kinds = last.content.map((c) => c.type).join("+") || "空";
		const think = last.content.find((c) => c.type === "thinking");
		const thought = think && "thinking" in think ? think.thinking.length : 0;
		return `✅ 成功（${kinds}${thought ? `，思考 ${thought} 字` : ""}）`;
	} catch (error) {
		return `❌ ${error instanceof Error ? error.message : String(error)}`;
	}
}

async function main() {
	const { secret } = await import("../src/config/vault.ts");
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));
	const providers = (settings.providers ?? []) as ProviderConfig[];

	for (const raw of providers) {
		const key = raw.apiKey || (await secret(`provider:${raw.id}`)) || (await secret(raw.id));
		if (!key || !raw.baseUrl) continue;
		const thinkingModel = (raw.models ?? []).find((m: ModelConfig) => m.supportsThinking) ?? (raw.models ?? [])[0];
		if (!thinkingModel) continue;

		console.log(`\n──── ${raw.id} · ${thinkingModel.modelId}\n     ${String(raw.baseUrl)}`);

		/*
		 * 三条链各走一遍。`api` 是覆盖上去的：同一个端点多半三条都能通，而我们要问的是**我们的编码器**在
		 * 每条链上编出来的东西收不收，不是这个端点原本配的是哪条。
		 */
		for (const api of ["openai-responses", "openai-chat-completions", "anthropic-messages"] as const) {
			const provider: ProviderConfig = { ...raw, apiKey: key, api };
			const context: LlmContext = { systemPrompt: "你是一个助手。", messages: history(api, raw.id, thinkingModel.modelId), tools: TOOLS };
			const on = await attempt(provider, thinkingModel, context, { thinking: "low" });
			const off = await attempt(provider, thinkingModel, context, { thinking: "off" });
			console.log(`     ${api.padEnd(24)} 开思考 ${on}`);
			console.log(`     ${"".padEnd(24)} 关思考 ${off}`);
		}
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
