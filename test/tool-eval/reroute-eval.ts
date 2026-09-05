/**
 * 改道之后，模型会不会真的换工具？
 *
 *   node --experimental-strip-types test/tool-eval/reroute-eval.ts [model]
 *
 * 一个错误结果比一句劝告有效——这是计划 06 §4.2 的论断，也是改道存在的理由。这里验它：
 * 同一个诱人 `cat` 的任务，对照组只有提示词里那句劝告，实验组多一道改道。看两件事：
 * 模型第一反应是不是 `cat`（劝告有没有用），以及被改道之后有没有换成 `read`（改道有没有用）。
 *
 * 命令不真跑。`bash` 是个记录器，回什么由脚本决定。
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../packages/core/src/agent/loop.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { buildSystemPrompt } from "../../packages/core/src/prompt/system.ts";
import { rerouteShellCommand } from "../../packages/core/src/tools/reroute.ts";
import type { Message, Tool } from "../../packages/core/src/types.ts";

const say = (line = "") => process.stderr.write(`${line}\n`);
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

const TASKS = [
	"看一下 src/parser.ts 的内容，告诉我它导出了什么。",
	"src/ 目录下有哪些文件？列出来。",
	"在 src/ 里找一下哪里用到了 parseSettings。",
];

async function runOnce(task: string, withReroute: boolean, modelId: string) {
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	const cwd = await mkdtemp(join(tmpdir(), "lyra-reroute-"));
	await mkdir(join(cwd, "src"), { recursive: true });
	await writeFile(join(cwd, "src", "parser.ts"), "export function parseSettings(raw: string) { return JSON.parse(raw); }\n");
	await writeFile(join(cwd, "src", "loader.ts"), "import { parseSettings as pc } from './parser.ts';\nexport const load = (s: string) => pc(s);\n");

	const calls: { name: string; args: Record<string, unknown> }[] = [];
	const available = new Set(["read", "grep", "glob", "ls", "bash"]);
	const mk = (name: string, snippet: string, params: Record<string, unknown>, reply: (a: Record<string, unknown>) => string): Tool =>
		({
			name,
			snippet,
			description: snippet,
			parameters: { type: "object", properties: params, required: Object.keys(params) },
			run: async (args: Record<string, unknown>) => {
				calls.push({ name, args });
				return { content: [{ type: "text", text: reply(args) }] };
			},
		}) as unknown as Tool;

	const tools: Tool[] = [
		mk("read", "Read a file with line numbers", { path: { type: "string" } }, () => "1\texport function parseSettings(raw: string) { return JSON.parse(raw); }"),
		mk("grep", "Search file contents", { pattern: { type: "string" } }, () => "src/parser.ts:1:export function parseSettings\nsrc/loader.ts:1:import { parseSettings as pc }"),
		mk("glob", "Find files by pattern", { pattern: { type: "string" } }, () => "src/parser.ts\nsrc/loader.ts"),
		mk("ls", "List a directory", { path: { type: "string" } }, () => "parser.ts\nloader.ts"),
		mk("bash", "Run shell commands", { command: { type: "string" } }, (args) => {
			/*
			 * 实验组：跟产品一样，先过改道。对照组：命令「跑了」，回一个像样的输出。
			 * 两组的 bash 都不真跑——差别只在有没有那道改道。
			 */
			const command = String(args.command ?? "");
			if (withReroute) {
				const r = rerouteShellCommand(command, available);
				if (r) return `Error: ${r.message}`;
			}
			if (/^\s*cat\b/.test(command)) return "export function parseSettings(raw: string) { return JSON.parse(raw); }";
			if (/^\s*ls\b/.test(command)) return "parser.ts\nloader.ts";
			if (/^\s*(grep|rg)\b/.test(command)) return "src/parser.ts:1:export function parseSettings\nsrc/loader.ts:1:import";
			return "";
		}),
	];
	// bash 的 guidelines 里那句劝告两组都有——它是提示词的一部分，对照的是改道不是劝告。
	(tools[4] as unknown as { guidelines: string[] }).guidelines = [
		"Use the dedicated tools instead of their shell equivalents: read over `cat`, glob over `find`, grep over shell `grep`.",
	];

	const systemPrompt = await buildSystemPrompt({ cwd, tools, skills: [], projectInstructions: [], platform: "darwin", modelName: resolved.model.name, isGitRepo: false });
	const messages: Message[] = [{ role: "user", content: [{ type: "text", text: task }], timestamp: Date.now() }];
	await runAgent(
		{ sessionId: "reroute-eval", cwd, provider: resolved.provider, model: resolved.model, systemPrompt, tools, messages, maxTurns: 6, temperature: 0 },
		async () => {},
	);

	const bare = calls.filter((c) => c.name === "bash" && rerouteShellCommand(String(c.args.command ?? ""), available) !== null);
	const dedicated = calls.filter((c) => c.name !== "bash");
	const firstBare = calls.findIndex((c) => c.name === "bash" && rerouteShellCommand(String(c.args.command ?? ""), available) !== null);
	const switchedAfter = firstBare >= 0 && calls.slice(firstBare + 1).some((c) => c.name !== "bash");
	return { bare: bare.length, dedicated: dedicated.length, firstBare: firstBare >= 0, switchedAfter, total: calls.length };
}

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	say(`\n改道之后，模型会不会换工具 · ${modelId}\n`);
	say(`${"任务".padEnd(28)} ${"对照：裸调用".padEnd(14)} ${"实验：裸调用→换了".padEnd(20)}`);
	say("-".repeat(70));

	let baselineBare = 0;
	let rerouteBare = 0;
	let switched = 0;
	for (const task of TASKS) {
		const control = await runOnce(task, false, modelId);
		const treated = await runOnce(task, true, modelId);
		baselineBare += control.bare;
		rerouteBare += treated.bare;
		if (treated.firstBare && treated.switchedAfter) switched += 1;

		const ctl = control.bare > 0 ? `${RED}${control.bare} 次${OFF}` : `${GREEN}0${OFF}`;
		const trt = treated.firstBare ? (treated.switchedAfter ? `${GREEN}拦了→换了${OFF}` : `${RED}拦了→没换${OFF}`) : `${DIM}没碰 bash${OFF}`;
		say(`${task.slice(0, 26).padEnd(28)} ${ctl.padEnd(23)} ${trt}`);
	}

	say("-".repeat(70));
	say(`对照组（只有提示词劝告）：${baselineBare} 次裸调用 · 实验组：${rerouteBare} 次被拦，其中 ${switched} 次之后换成了专用工具`);
	if (baselineBare === 0) say(`${DIM}对照组一次裸调用都没有——这个模型光看提示词就够了，改道在它身上量不出差别。${OFF}`);
	say();
}

await main();
