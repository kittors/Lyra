/**
 * 一轮里只有 todo 调用的比例 ≤ 5%（06 §6.3 的验收）。
 *
 *   node --experimental-strip-types test/tool-eval/todo-only-eval.ts [model]
 *
 * todo 是执行状态机，不是记事本；一轮只调 todo 等于白白多一次往返。产品的 todo 工具描述里写着
 * 「绝不让 todo 成为一轮里唯一的工具调用」。这里用三个天然会列清单的多步任务，数每一条助手消息
 * 里的工具调用：全是 todo_write 的那一轮算「solo」。比例 = solo 轮 / 有工具调用的轮。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../packages/core/src/agent/loop.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { buildSystemPrompt } from "../../packages/core/src/prompt/system.ts";
import { editTool } from "../../packages/core/src/tools/edit.ts";
import { readTool } from "../../packages/core/src/tools/read.ts";
import { todoTool } from "../../packages/core/src/tools/todo.ts";
import type { AgentEvent } from "../../packages/core/src/agent/events.ts";
import type { Message, Tool } from "../../packages/core/src/types.ts";

const say = (line = "") => process.stderr.write(`${line}\n`);
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

async function fixture(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-todo-"));
	await mkdir(join(dir, "src"), { recursive: true });
	await mkdir(join(dir, "test"), { recursive: true });
	await writeFile(join(dir, "package.json"), JSON.stringify({ name: "probe", type: "module", scripts: { test: "node --test" } }, null, 2));
	await writeFile(join(dir, "src", "util.ts"), "// TODO: add is too permissive, reject NaN\nexport function add(a: number, b: number): number {\n\treturn a + b;\n}\n");
	await writeFile(join(dir, "src", "a.ts"), 'import { add } from "./util.ts";\n\n// TODO: total should skip undefined entries\nexport function total(xs: number[]): number {\n\treturn xs.reduce((s, x) => add(s, x), 0);\n}\n');
	await writeFile(join(dir, "src", "b.ts"), 'import { add } from "./util.ts";\n\n// TODO: step should default to 1\nexport function step(n: number, step: number): number {\n\treturn add(n, step);\n}\n');
	await writeFile(join(dir, "test", "util.test.ts"), 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/util.ts";\n\ntest("add", () => assert.equal(add(1, 2), 3));\n');
	return dir;
}

function recordingBash(commands: string[]): Tool {
	return {
		name: "bash",
		snippet: "跑命令",
		description: "Run a shell command in the project directory.",
		parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
		execute: async (args: Record<string, unknown>) => {
			commands.push(String(args.command ?? ""));
			return { content: [{ type: "text", text: "ok\n（评测环境：已记录，未执行；测试视为通过）" }] };
		},
	} as unknown as Tool;
}

const TASKS = [
	"把 src/util.ts 里的 add 函数改名为 sum，并把 src/a.ts、src/b.ts 和 test/util.test.ts 里的调用点都改过来，最后跑一下测试。",
	"给 src/util.ts 加 clamp(x, lo, hi) 和 lerp(a, b, t) 两个函数，各写一条简单的测试到 test/util.test.ts，然后跑测试。",
	"src/a.ts、src/b.ts、src/util.ts 里各有一个 TODO 注释，逐个把它们处理掉（改代码、删掉注释），处理完跑测试。",
];

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	say(`\n一轮里只有 todo 的比例 · ${modelId}\n`);
	let toolTurns = 0;
	let soloTurns = 0;
	let todoTurns = 0;
	for (const [i, task] of TASKS.entries()) {
		const cwd = await fixture();
		const commands: string[] = [];
		const tools = [todoTool, readTool, editTool, recordingBash(commands)] as unknown as Tool[];
		const systemPrompt = await buildSystemPrompt({
			cwd,
			tools,
			skills: [],
			agents: [],
			projectInstructions: [],
			platform: "darwin",
			modelName: resolved.model.name,
			isGitRepo: false,
			today: new Date().toISOString().slice(0, 10),
		});
		const messages: Message[] = [{ role: "user", content: [{ type: "text", text: task }], timestamp: Date.now() }];
		const result = await runAgent(
			{ sessionId: `todo-only-${i}`, cwd, provider: resolved.provider, model: resolved.model, systemPrompt, tools, messages, maxTurns: 14, temperature: 0, state: new Map() },
			async (_event: AgentEvent) => {},
		);
		let turns = 0;
		let solo = 0;
		let withTodo = 0;
		const shapes: string[] = [];
		for (const message of result.messages) {
			if (message.role !== "assistant") continue;
			const names = message.content.filter((c) => c.type === "toolCall").map((c) => (c as { name: string }).name);
			if (names.length === 0) continue;
			turns += 1;
			const onlyTodo = names.every((n) => n === "todo_write");
			if (names.includes("todo_write")) withTodo += 1;
			if (onlyTodo) solo += 1;
			shapes.push(onlyTodo ? `${RED}[todo]${OFF}` : names.includes("todo_write") ? `${GREEN}[todo+${names.length - 1}]${OFF}` : `[${names.length}]`);
		}
		toolTurns += turns;
		soloTurns += solo;
		todoTurns += withTodo;
		say(`任务 ${i + 1}：${turns} 轮有工具调用，其中 ${solo} 轮只有 todo，${withTodo} 轮带 todo   ${DIM}${shapes.join(" ")}${OFF}`);
		await rm(cwd, { recursive: true, force: true }).catch(() => {});
	}
	const ratio = toolTurns === 0 ? 0 : soloTurns / toolTurns;
	say("");
	say(`合计：${toolTurns} 轮里 ${soloTurns} 轮只有 todo —— ${(ratio * 100).toFixed(1)}%${ratio <= 0.05 ? ` ${GREEN}≤ 5% ✓${OFF}` : ` ${RED}> 5% ✗${OFF}`}`);
	if (todoTurns === 0) say(`${DIM}模型一次都没用 todo：比例是 0，但那是「没用」不是「用得好」——这个任务集或这个模型量不出这条。${OFF}`);
	say();
}

await main();
