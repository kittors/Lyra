/**
 * Does the model call `learn` for the right things, and leave it alone for the wrong ones?
 *
 *   node --experimental-strip-types test/tool-eval/memory-eval.ts [model]
 *
 * Two failure modes, and the second is the dangerous one:
 *
 *   Never calling it. The feature does nothing; the user notices only by continuing to repeat
 *   themselves, which they will attribute to the model rather than to a missing tool call.
 *
 *   Calling it for facts that expire. "`parseFrontmatter` is in skills/loader.ts" is true today,
 *   gets injected into every prompt in this project from now on, and is quietly wrong after the
 *   next refactor. A stale entry is worse than a missing one because it will be believed — so the
 *   negative probes here carry as much weight as the positive ones.
 *
 * Also measured: whether the lesson, once recorded, actually changes the next session's behaviour.
 * That is the whole promise, and it is the part a unit test cannot reach.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../packages/core/src/agent/loop.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { buildSystemPrompt } from "../../packages/core/src/prompt/system.ts";
import { formatProjectMemory, readLessons } from "../../packages/core/src/runtime/project-memory.ts";
import { bashTool } from "../../packages/core/src/tools/bash.ts";
import { learnTool } from "../../packages/core/src/tools/learn.ts";
import { readTool } from "../../packages/core/src/tools/read.ts";
import type { AgentEvent } from "../../packages/core/src/agent/events.ts";
import type { Tool } from "../../packages/core/src/types.ts";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const BOLD = "[1m";
const OFF = "[0m";

interface Probe {
	name: string;
	task: string;
	/** Whether a well-behaved model records something here. */
	shouldLearn: boolean;
	/** Why, in one phrase, for the report. */
	because: string;
}

const PROBES: Probe[] = [
	{
		name: "用户纠正了做法",
		task: "别用 npm，这个仓库一律用 pnpm，npm 会把 lockfile 搞坏。记住这一点，以后都这样。",
		shouldLearn: true,
		because: "会反复适用的纠正",
	},
	{
		name: "代码里看不出的约定",
		task: "提醒你一下：跑 e2e 之前必须先 `pnpm build:contract`，否则会报一堆看不懂的类型错。这个在 README 里没写。",
		shouldLearn: true,
		because: "从代码看不出来",
	},
	{
		name: "读一个文件回答问题",
		task: "看一下 src/app.ts，告诉我 total 函数是怎么实现的。",
		shouldLearn: false,
		because: "代码结构，读代码就知道，记下来会过期",
	},
	{
		name: "一次性的任务状态",
		task: "我现在在调试一个登录的问题，先帮我看看 src/app.ts 有没有语法错误。",
		shouldLearn: false,
		because: "这一次任务的临时状态",
	},
];

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	const home = await mkdtemp(join(tmpdir(), "lyra-mem-home-"));
	process.env.LYRA_HOME = home;

	console.log(`\n${BOLD}项目记忆 · ${modelId}${OFF}\n`);
	console.log(`${"探针".padEnd(22)} ${"该记".padEnd(6)} ${"记了".padEnd(6)} 判定`);
	console.log("-".repeat(64));

	let ok = 0;
	for (const probe of PROBES) {
		const cwd = await mkdtemp(join(tmpdir(), "lyra-mem-proj-"));
		await mkdir(join(cwd, "src"), { recursive: true });
		await writeFile(join(cwd, "src", "app.ts"), "export function total(items: number[]) {\n\treturn items.reduce((a, b) => a + b, 0);\n}\n", "utf8");

		const tools = [readTool, bashTool, learnTool] as unknown as Tool[];
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

		let learned = false;
		await runAgent(
			{
				sessionId: "mem-eval",
				cwd,
				provider: resolved.provider,
				model: resolved.model,
				systemPrompt,
				tools,
				messages: [{ role: "user", content: [{ type: "text", text: probe.task }], timestamp: Date.now() }],
				maxTurns: 4,
				temperature: 0,
			},
			async (event: AgentEvent) => {
				if (event.type === "tool_start" && event.toolName === "learn") learned = true;
			},
		);

		const correct = learned === probe.shouldLearn;
		if (correct) ok += 1;
		console.log(
			`${probe.name.padEnd(20)} ${(probe.shouldLearn ? "是" : "否").padEnd(7)} ${(learned ? "是" : "否").padEnd(7)} ` +
				`${correct ? `${GREEN}✓${OFF}` : probe.shouldLearn ? `${RED}✗ 漏了${OFF}` : `${RED}✗ 记了不该记的${OFF}`}  ${DIM}${probe.because}${OFF}`,
		);
		await rm(cwd, { recursive: true, force: true }).catch(() => {});
	}
	console.log("-".repeat(64));
	console.log(`${ok}/${PROBES.length} 正确\n`);

	// -------------------------------------------------------------------------
	// The promise: does a recorded lesson change the next session?
	// -------------------------------------------------------------------------
	console.log(`${BOLD}下一个会话会不会照做${OFF}\n`);

	const cwd = await mkdtemp(join(tmpdir(), "lyra-mem-carry-"));
	await mkdir(join(cwd, "src"), { recursive: true });
	await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "vitest" } }, null, 2), "utf8");

	const question = "这个项目要装依赖，我该跑哪条命令？只回答命令，不要执行。";
	/*
	 * No `bash` in this arm, on purpose.
	 *
	 * With it, the model answered by running the install rather than by saying anything — the reply
	 * was empty and the comparison measured nothing. What is being compared here is what it *says*
	 * the command is, so the only way to say it has to be words.
	 */
	const tools = [readTool] as unknown as Tool[];

	for (const withMemory of [false, true]) {
		if (withMemory) {
			const { recordLesson } = await import("../../packages/core/src/runtime/project-memory.ts");
			await recordLesson(cwd, { text: "这个仓库一律用 pnpm，绝对不要用 npm——npm 会把 lockfile 搞坏。" });
		}

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
			projectMemory: formatProjectMemory(await readLessons(cwd)),
		});

		const result = await runAgent(
			{
				sessionId: "mem-carry",
				cwd,
				provider: resolved.provider,
				model: resolved.model,
				systemPrompt,
				tools,
				messages: [{ role: "user", content: [{ type: "text", text: question }], timestamp: Date.now() }],
				maxTurns: 3,
				temperature: 0,
			},
			async () => {},
		);

		const answer = result.messages
			.filter((m) => m.role === "assistant")
			.flatMap((m) => m.content)
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		if (!answer.trim()) {
			console.log(`  ${DIM}诊断：reason=${result.reason} 消息数=${result.messages.length} 角色=${result.messages.map((m) => m.role).join(",")}${OFF}`);
		}
		const usedPnpm = /pnpm i(nstall)?\b|pnpm\b/.test(answer);
		const usedNpm = /\bnpm i(nstall)?\b/.test(answer);
		const line = answer.split("\n").find((l) => /npm|pnpm|yarn/.test(l))?.trim() ?? `(没提到包管理器) ${answer.slice(0, 80).replace(/\n/g, " ")}`;

		console.log(`  ${withMemory ? `${GREEN}记过之后${OFF}` : `${RED}没有记忆${OFF}`}  ${DIM}${line.slice(0, 60)}${OFF}`);
		console.log(`    ${usedPnpm && !usedNpm ? `${GREEN}✓ pnpm${OFF}` : usedNpm ? `${RED}✗ 用了 npm${OFF}` : `${DIM}? 说不清${OFF}`}\n`);
	}

	await rm(home, { recursive: true, force: true }).catch(() => {});
	await rm(cwd, { recursive: true, force: true }).catch(() => {});
}

await main();
