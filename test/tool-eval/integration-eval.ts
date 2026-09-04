/**
 * The three changes working together, on a real file, through the real tools.
 *
 * Each was measured on its own. That is not enough: the outline folds bodies away, and editing a
 * folded body is refused by design — so the obvious risk is that the two features that each look
 * good alone cost an extra round trip every time they meet.
 *
 * This runs the actual agent loop with the actual `read` and `edit`, on a copy of a real file
 * from this repository, and counts what it took.
 *
 *   node --experimental-strip-types test/tool-eval/integration-eval.ts [model]
 */

import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runAgent } from "../../packages/core/src/agent/loop.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { editTool } from "../../packages/core/src/tools/edit.ts";
import { readTool } from "../../packages/core/src/tools/read.ts";
import type { AgentEvent } from "../../packages/core/src/agent/events.ts";
import type { Message } from "../../packages/core/src/types.ts";

interface Task {
	id: string;
	/** Copied into a scratch directory so the repository is never touched. */
	source: string;
	instruction: string;
	/** The file must satisfy this afterwards. */
	expect: (content: string) => boolean;
	/** …and must still satisfy this, so a task cannot be "passed" by wrecking the file. */
	intact: (content: string) => boolean;
}

const TASKS: Task[] = [
	{
		id: "top-level-const",
		source: "packages/core/src/tools/read.ts",
		instruction: "把 DEFAULT_LIMIT 从 2000 改成 1500，其他都别动。",
		expect: (c) => /const DEFAULT_LIMIT = 1500;/.test(c),
		intact: (c) => /const MAX_LINE_LENGTH = 2000;/.test(c) && c.includes("export const readTool"),
	},
	{
		// The target sits inside a folded body: this is the case that costs an extra read.
		id: "inside-folded-body",
		source: "packages/core/src/tools/hunk.ts",
		instruction: "在 applyHunks 里，把 `Range ${hunk.start}-${hunk.end} is inverted.` 这条错误信息改成 `Range ${hunk.start}-${hunk.end} is inverted: start must not be greater than end.`",
		expect: (c) => c.includes("start must not be greater than end"),
		intact: (c) => c.includes("export function applyHunks") && c.includes("export function parsePatch"),
	},
	{
		id: "two-places",
		source: "packages/core/src/rules/stream.ts",
		instruction: "两处改动：MAX_BUFFER 从 64 * 1024 改成 32 * 1024；MAX_PER_TURN 从 2 改成 3。",
		expect: (c) => /MAX_BUFFER = 32 \* 1024/.test(c) && /MAX_PER_TURN = 3/.test(c),
		intact: (c) => c.includes("export class StreamRuleMonitor") && /MATCH_WINDOW = 4096/.test(c),
	},
];

async function runTask(task: Task, modelId: string): Promise<{ passed: boolean; intact: boolean; reads: number; edits: number; failedEdits: number; turns: number }> {
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	const cwd = await mkdtemp(join(tmpdir(), "lyra-integration-"));
	const name = basename(task.source);
	await copyFile(task.source, join(cwd, name));

	let reads = 0;
	let edits = 0;
	let failedEdits = 0;
	let turns = 0;

	const messages: Message[] = [
		{ role: "user", content: [{ type: "text", text: `文件 ${name}。${task.instruction}` }], timestamp: Date.now() },
	];

	await runAgent(
		{
			sessionId: "integration",
			cwd,
			provider: resolved.provider,
			model: resolved.model,
			systemPrompt:
				"You are a coding assistant working in a workspace. Read a file before editing it. " +
				"Make exactly the change requested and nothing else. Stop when the change is made.",
			tools: [readTool, editTool],
			messages,
			maxTurns: 8,
			temperature: 0,
		},
		async (event: AgentEvent) => {
			if (event.type === "turn_start") turns += 1;
			if (event.type === "tool_end") {
				if (event.toolName === "read") reads += 1;
				if (event.toolName === "edit") {
					edits += 1;
					if (event.isError) failedEdits += 1;
				}
			}
		},
	);

	const content = await readFile(join(cwd, name), "utf8");
	return { passed: task.expect(content), intact: task.intact(content), reads, edits, failedEdits, turns };
}

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	console.log(`模型 ${modelId} · 真实文件 · 真实 read/edit\n`);
	console.log(`${"任务".padEnd(22)} ${"结果".padEnd(8)} ${"read".padStart(5)} ${"edit".padStart(5)} ${"失败".padStart(5)} ${"轮次".padStart(5)}`);
	console.log("-".repeat(62));

	let passed = 0;
	for (const task of TASKS) {
		const r = await runTask(task, modelId);
		const ok = r.passed && r.intact;
		if (ok) passed += 1;
		const verdict = r.passed ? (r.intact ? "✓" : "✗ 改坏了文件") : "✗ 没改对";
		console.log(
			`${task.id.padEnd(22)} ${verdict.padEnd(8)} ${String(r.reads).padStart(5)} ${String(r.edits).padStart(5)} ${String(r.failedEdits).padStart(5)} ${String(r.turns).padStart(5)}`,
		);
	}

	console.log("-".repeat(62));
	console.log(`${passed}/${TASKS.length} 通过`);
	console.log("\nread 次数 > 1 说明结构视图折叠了目标，agent 补读了一次——这是设计意图，代价是一个来回。");
}

await main();
