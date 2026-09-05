/**
 * 配合 read 的结构视图后，压缩触发次数下降（13 §9 的验收）。
 *
 * 一次裸 read 长源文件返回的是它的形状——声明在、函数体折成「⋯ N 行」——而不是全部字节。
 * 计划 13 说这是它与 06 最重要的协同：进上下文的东西少了，压缩就来得晚、来得少。这里把它量
 * 出来，而且不用真模型：模型是脚本，逐个读六个文件再收尾；摘要器也是脚本，回一句「摘要」。
 * 变量只有一个——读的时候要不要形状。压缩用的是产品那条 `compactWith`，阈值、剪枝、预算全是
 * 真的，所以两个数字之差就是结构视图省下的压缩次数。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { runAgent } from "../src/agent/loop.ts";
import { compactWith } from "../src/runtime/compaction.ts";
import { readTool } from "../src/tools/read.ts";
import type { AssistantMessage, Message, ModelConfig, ProviderConfig, Tool } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

let cwd: string;
const FILES = 6;

/** A source file with real declarations and bodies the outline can fold: ~640 lines. */
function sourceFile(n: number): string {
	const out: string[] = [`// module ${n}`, ""];
	for (let i = 0; i < 80; i++) {
		out.push(`export function handler${n}_${i}(input: string, count: number): string {`);
		out.push(`\tconst prefix = "m${n}-${i}";`);
		out.push(`\tlet acc = prefix;`);
		out.push(`\tfor (let k = 0; k < count; k++) {`);
		out.push(`\t\tacc += input.charAt(k % input.length);`);
		out.push(`\t}`);
		out.push(`\treturn acc.toUpperCase();`);
		out.push(`}`, "");
	}
	return out.join("\n");
}

before(async () => {
	cwd = await mkdtemp(join(tmpdir(), "ly-compact-outline-"));
	await mkdir(join(cwd, "src"), { recursive: true });
	for (let n = 1; n <= FILES; n++) await writeFile(join(cwd, "src", `mod${n}.ts`), sourceFile(n), "utf8");
});
after(async () => {
	await rm(cwd, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

/** Small enough that six files of this size cannot all fit: that is what makes compaction happen. */
const MODEL: ModelConfig = {
	id: "fake/model",
	providerId: "fake",
	modelId: "model",
	name: "Fake",
	contextWindow: 14_000,
	maxOutputTokens: 1024,
	supportsThinking: false,
	supportsImages: false,
	supportsTools: true,
};
const PROVIDER: ProviderConfig = { id: "fake", name: "Fake", baseUrl: "http://l", api: "openai-responses", apiKey: "x", enabled: true, models: [MODEL] };

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return { role: "assistant", api: "openai-responses", provider: "fake", model: "model", usage: emptyUsage(), stopReason, timestamp: Date.now(), content };
}

/**
 * A model that reads the six files one per turn and then says it is done; `outline` picks the
 * read's shape. `runAgent` takes a plain function returning the message — the generator shape is
 * the summariser's, below.
 */
function scriptedReader(outline: boolean) {
	let calls = 0;
	const stream = async (): Promise<AssistantMessage> => {
		const message =
			calls < FILES
				? assistant(
						[
							{
								type: "toolCall",
								id: `r${calls + 1}`,
								name: "read",
								arguments: outline ? { path: `src/mod${calls + 1}.ts` } : { path: `src/mod${calls + 1}.ts`, offset: 1, limit: 100_000 },
								argumentsText: "{}",
							},
						],
						"toolUse",
					)
				: assistant([{ type: "text", text: "读完了。" }], "stop");
		calls += 1;
		return message;
	};
	return { stream, reads: () => Math.min(calls, FILES) };
}

/** The summariser: whatever it is asked, the summary is one line. */
const summaryStream = ((_p: unknown, _m: unknown, _request: unknown) => {
	const message = assistant([{ type: "text", text: "摘要：前面读了几个模块。" }], "stop");
	return (async function* () {
		yield { type: "text_delta" as const, index: 0, delta: "", partial: message };
		return message;
	})();
}) as never;

async function compactionsWhenReading(outline: boolean): Promise<{ compactions: number; reads: number; resultChars: number }> {
	const reader = scriptedReader(outline);
	let compactions = 0;
	let resultChars = 0;
	const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "把 src 下六个模块都读一遍。" }], timestamp: Date.now() }];
	await runAgent(
		{
			sessionId: `compact-${outline ? "outline" : "full"}`,
			cwd,
			provider: PROVIDER,
			model: MODEL,
			systemPrompt: "你是一个读代码的助手。",
			tools: [readTool as unknown as Tool],
			messages,
			maxTurns: FILES + 2,
			temperature: 0,
			state: new Map(),
			streamFn: reader.stream,
			compact: (history, model) => compactWith(history, model, PROVIDER, summaryStream, 0),
		},
		async (event) => {
			if (event.type === "compacted") compactions += 1;
			if (event.type === "tool_end") resultChars += event.result.content.map((c) => (c.type === "text" ? c.text.length : 0)).reduce((a, b) => a + b, 0);
		},
	);
	return { compactions, reads: reader.reads(), resultChars };
}

test("同样读六个文件，带形状的 read 让压缩来得少", async () => {
	const full = await compactionsWhenReading(false);
	const outlined = await compactionsWhenReading(true);

	assert.equal(full.reads, FILES, "the control read every file");
	assert.equal(outlined.reads, FILES, "so did the treatment");
	assert.ok(outlined.resultChars < full.resultChars, `the outline is the smaller thing to carry: ${outlined.resultChars} vs ${full.resultChars} chars`);
	assert.ok(full.compactions >= 2, `the window is small enough that full reads compact more than once: ${full.compactions}`);
	assert.ok(
		outlined.compactions < full.compactions,
		`fewer compactions with the outline: ${outlined.compactions} vs ${full.compactions}`,
	);
	// The numbers themselves, for the log.
	console.log(`compaction-outline: full=${full.compactions} outline=${outlined.compactions} (chars ${full.resultChars} vs ${outlined.resultChars})`);
});
