/**
 * Does the outline make the agent guess?
 *
 * Folding a file's bodies saves context, and that saving is worthless — worse than worthless — if
 * the model then writes confidently about code it has not seen. So the thing to measure is not the
 * token count (that is arithmetic) but the behaviour at the boundary: asked about something that
 * was folded away, does the model go and read it, or does it invent an answer?
 *
 *   node --experimental-strip-types test/tool-eval/outline-eval.ts
 */

import { readFile } from "node:fs/promises";
import { streamAssistant } from "../../packages/core/src/ai/index.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { snapshotTag } from "../../packages/core/src/tools/hunk.ts";
import { outline, outlineFooter } from "../../packages/core/src/tools/outline.ts";
import type { AssistantMessage, Message, ToolSpec } from "../../packages/core/src/types.ts";

const READ_TOOL: ToolSpec = {
	name: "read",
	description: "Read a file, or a range of it. Use offset/limit to fetch specific lines.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string" },
			offset: { type: "number", description: "1-indexed line to start from." },
			limit: { type: "number", description: "How many lines." },
		},
		required: ["path"],
		additionalProperties: false,
	},
};

const ANSWER_TOOL: ToolSpec = {
	name: "answer",
	description: "Give your final answer once you are sure of it.",
	parameters: {
		type: "object",
		properties: { text: { type: "string" } },
		required: ["text"],
		additionalProperties: false,
	},
};

interface Probe {
	id: string;
	file: string;
	question: string;
	/** `structure` is answerable from the outline; `body` needs a folded region. */
	kind: "structure" | "body";
	/** For body probes: a phrase that only appears in the folded implementation. */
	needle?: string;
}

const PROBES: Probe[] = [
	{
		id: "structure-exports",
		file: "packages/core/src/tools/hunk.ts",
		kind: "structure",
		question: "这个文件导出了哪些函数？只列名字。",
	},
	{
		id: "structure-purpose",
		file: "packages/core/src/runtime/sub-agents.ts",
		kind: "structure",
		question: "SubAgentRegistry 的 dismiss 方法有几种返回值？",
	},
	/*
	 * The body probes must ask about something the outline actually folded.
	 *
	 * The first draft asked for the value of two top-level constants — which the outline shows,
	 * so "answered without reading" was correct behaviour and the probe measured nothing. These
	 * ask about expressions inside function bodies instead, and the needles are identifiers or
	 * numbers rather than English words, because the model answers in the user's language.
	 */
	{
		id: "body-sort-key",
		file: "packages/core/src/tools/hunk.ts",
		kind: "body",
		question: "applyHunks 里排序用的 anchorOf，对 insert 操作返回的表达式里加了一个什么数？只回答那个数。",
		needle: "0.5",
	},
	{
		id: "body-counter",
		file: "packages/core/src/tools/outline.ts",
		kind: "body",
		question: "keepMask 之后的 outline 函数里，把显示过的行号合并成区间时用的那个局部数组叫什么名字？",
		needle: "displayed",
	},
	{
		id: "body-guard",
		file: "packages/core/src/tools/read.ts",
		kind: "body",
		question: "readTool 的 execute 里，判断图片体积是否超限时和哪个常量比较？只回答常量名。",
		needle: "MAX_IMAGE_BYTES",
	},
];

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);
	const { provider, model } = resolved;

	console.log(`模型 ${modelId}\n`);
	console.log(`${"探针".padEnd(20)} ${"类型".padEnd(10)} ${"读了折叠区".padEnd(12)} 结果`);
	console.log("-".repeat(72));

	let guessed = 0;
	let fetched = 0;
	let bodyProbes = 0;

	for (const probe of PROBES) {
		const content = await readFile(probe.file, "utf8");
		const lines = content.split("\n");
		if (lines.at(-1) === "") lines.pop();
		const shape = outline(probe.file, content, lines);
		if (!shape) {
			console.log(`${probe.id.padEnd(20)} ${"—".padEnd(10)} 文件不折叠，跳过`);
			continue;
		}

		const rendered = `[${probe.file}#${snapshotTag(content)}]\n${shape.text}${outlineFooter(probe.file, shape, lines.length)}`;
		const messages: Message[] = [
			{ role: "user", content: [{ type: "text", text: `${rendered}\n\n${probe.question}` }], timestamp: Date.now() },
		];

		let didRead = false;
		let answer = "";

		// Up to three steps: the model may read once, then answer.
		for (let step = 0; step < 3 && !answer; step++) {
			const stream = streamAssistant(
				provider,
				model,
				{
					systemPrompt:
						"You are answering a question about a file. You have been shown a structural outline: " +
						"declarations are visible, bodies are folded and marked with ⋯. " +
						"If the answer is in a folded region, call `read` with offset/limit to fetch it. " +
						"Never guess at folded content. Call `answer` when you are sure.",
					messages,
					tools: [READ_TOOL, ANSWER_TOOL],
				},
				{ maxTokens: 2048, temperature: 0, retryAttempts: 2 },
			);
			let final: AssistantMessage | undefined;
			while (true) {
				const next = await stream.next();
				if (next.done) {
					final = next.value;
					break;
				}
			}
			if (!final) break;
			messages.push(final);

			const calls = final.content.filter((c) => c.type === "toolCall");
			if (calls.length === 0) {
				answer = final.content.find((c) => c.type === "text")?.text ?? "";
				break;
			}

			for (const call of calls) {
				if (call.type !== "toolCall") continue;
				if (call.name === "answer") {
					answer = String((call.arguments as { text?: string }).text ?? "");
					messages.push({ role: "toolResult", toolCallId: call.id, toolName: "answer", content: [{ type: "text", text: "ok" }], isError: false, timestamp: Date.now() });
				} else if (call.name === "read") {
					didRead = true;
					const a = call.arguments as { offset?: number; limit?: number };
					const from = Math.max(1, a.offset ?? 1);
					const slice = lines.slice(from - 1, from - 1 + (a.limit ?? 100));
					const body = slice.map((l, i) => `${from + i}→${l}`).join("\n");
					messages.push({ role: "toolResult", toolCallId: call.id, toolName: "read", content: [{ type: "text", text: body }], isError: false, timestamp: Date.now() });
				}
			}
		}

		const correct = probe.needle ? answer.toLowerCase().includes(probe.needle.toLowerCase()) : answer.trim().length > 0;
		if (probe.kind === "body") {
			bodyProbes += 1;
			if (didRead) fetched += 1;
			else if (correct) guessed += 1; // Right answer without reading = recited or lucky.
		}

		const mark = correct ? "✓" : "✗";
		const readMark = probe.kind === "body" ? (didRead ? "读了" : "没读 ⚠") : "—";
		console.log(`${probe.id.padEnd(20)} ${probe.kind.padEnd(10)} ${readMark.padEnd(12)} ${mark} ${answer.slice(0, 40).replace(/\n/g, " ")}`);
	}

	console.log("-".repeat(72));
	console.log(`需要看实现的探针 ${bodyProbes} 个：主动去读 ${fetched}，没读就答 ${guessed}`);
	console.log(fetched === bodyProbes ? "✓ 没有一次凭空作答" : `⚠ 有 ${bodyProbes - fetched} 次没有去读折叠区`);
}

await main();
