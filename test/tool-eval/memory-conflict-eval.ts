/**
 * 记忆与代码冲突时，模型选代码（12 §验收）。
 *
 *   node --experimental-strip-types test/tool-eval/memory-conflict-eval.ts [model]
 *
 * 记忆会过期：三个月前记下「这个仓库用 npm」，后来换成了 pnpm——lockfile 和 package.json 里
 * 的 packageManager 都说明了这一点。一条过期的记忆比没有这条更糟，因为模型会照着它做决定。
 * 这里放一条明确过期的项目记忆，让模型去装依赖跑测试，看它第一个包管理器命令用的是哪个。
 *
 * 对照组没有那条记忆——如果连对照组都用 npm，那问题不在记忆，而在模型不看 lockfile。
 */

import { execSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../packages/core/src/agent/loop.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { buildSystemPrompt } from "../../packages/core/src/prompt/system.ts";
import { formatProjectMemory } from "../../packages/core/src/runtime/project-memory.ts";
import { readTool } from "../../packages/core/src/tools/read.ts";
import type { AgentEvent } from "../../packages/core/src/agent/events.ts";
import type { Message, Tool } from "../../packages/core/src/types.ts";

const say = (line = "") => process.stderr.write(`${line}\n`);
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

async function fixture(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-memconf-"));
	await mkdir(join(dir, "src"), { recursive: true });
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({ name: "probe", version: "1.0.0", packageManager: "pnpm@9.12.0", scripts: { test: "node --test" }, devDependencies: { "some-lib": "^1.0.0" } }, null, 2),
	);
	await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n\nimporters:\n  .:\n    devDependencies:\n      some-lib:\n        specifier: ^1.0.0\n        version: 1.0.0\n");
	await writeFile(join(dir, "src", "index.ts"), "export const answer = 42;\n");
	await writeFile(join(dir, "README.md"), "# probe\n\n跑 `pnpm test` 即可。\n");
	return dir;
}

/** 只读命令真的跑，包管理器命令只记录——评测不该真的装东西。 */
function recordingBash(cwd: string, commands: string[]): Tool {
	return {
		name: "bash",
		snippet: "跑命令",
		description: "Run a shell command in the project directory.",
		parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
		execute: async (args: Record<string, unknown>) => {
			const command = String(args.command ?? "");
			commands.push(command);
			if (/^\s*(ls|cat|head|find|grep|pwd|wc)\b/.test(command) && !/[|;&`$]/.test(command)) {
				try {
					return { content: [{ type: "text", text: execSync(command, { cwd, encoding: "utf8", timeout: 5000 }) || "(空)" }] };
				} catch (error) {
					return { content: [{ type: "text", text: `exit 1\n${error instanceof Error ? error.message : String(error)}` }] };
				}
			}
			return { content: [{ type: "text", text: "ok\n（评测环境：这条命令已记录，没有真的执行）" }] };
		},
	} as unknown as Tool;
}

const STALE = [{ text: "这个仓库用 npm 装依赖和跑测试（npm install / npm test）。", at: Date.now() - 90 * 86400000 }];

async function runOnce(modelId: string, withMemory: boolean): Promise<{ first: string | null; commands: string[] }> {
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);
	const cwd = await fixture();
	const commands: string[] = [];
	const tools = [readTool as unknown as Tool, recordingBash(cwd, commands)];
	const systemPrompt = await buildSystemPrompt({
		cwd,
		tools,
		skills: [],
		agents: [],
		projectInstructions: [],
		projectMemory: withMemory ? formatProjectMemory(STALE, "") : "",
		platform: "darwin",
		modelName: resolved.model.name,
		isGitRepo: true,
		today: new Date().toISOString().slice(0, 10),
	});
	const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "把依赖装上，然后跑一遍测试。" }], timestamp: Date.now() }];
	const tools_used: string[] = [];
	const result = await runAgent(
		{ sessionId: `memconf-${withMemory ? "stale" : "clean"}`, cwd, provider: resolved.provider, model: resolved.model, systemPrompt, tools, messages, maxTurns: 6, temperature: 0, state: new Map() },
		async (event: AgentEvent) => {
			if (event.type === "tool_start") tools_used.push(event.toolName);
		},
	);
	await rm(cwd, { recursive: true, force: true }).catch(() => {});
	const first = commands.find((c) => /\b(npm|pnpm|yarn|bun)\b/.test(c)) ?? null;
	const answer = result.messages
		.filter((m) => m.role === "assistant")
		.flatMap((m) => m.content)
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join(" ")
		.replace(/\s+/g, " ");
	return { first, commands, answer, tools: tools_used };
}

function verdict(first: string | null): "code" | "memory" | "none" {
	if (!first) return "none";
	if (/\bpnpm\b/.test(first)) return "code";
	if (/\bnpm\b/.test(first)) return "memory";
	return "none";
}

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	const REPS = Number(process.env.MEMCONF_REPS ?? 2);
	say(`\n记忆与代码冲突时选谁 · ${modelId}\n`);
	say(`${"组".padEnd(10)} ${"第一个包管理器命令".padEnd(36)} 判定`);
	say("-".repeat(70));
	const tally = { stale: { code: 0, memory: 0, none: 0 }, clean: { code: 0, memory: 0, none: 0 } };
	for (const withMemory of [true, false]) {
		for (let rep = 1; rep <= REPS; rep++) {
			const { first, commands, answer, tools } = await runOnce(modelId, withMemory);
			const v = verdict(first);
			tally[withMemory ? "stale" : "clean"][v] += 1;
			const word = v === "code" ? `${GREEN}选了代码（pnpm）${OFF}` : v === "memory" ? `${RED}跟了过期记忆（npm）${OFF}` : `${DIM}没跑包管理器${OFF}`;
			say(`${(withMemory ? "有过期记忆" : "对照·无记忆").padEnd(8)} ${(first ?? "—").slice(0, 36).padEnd(36)} ${word}`);
			say(`${DIM}     工具：${tools.join(" → ") || "(无)"}   命令：${commands.join(" ; ").slice(0, 80) || "(无)"}${OFF}`);
			if (!first) say(`${DIM}     模型说：${answer.slice(0, 200)}${OFF}`);
		}
	}
	say("-".repeat(70));
	say(`有过期记忆：选代码 ${tally.stale.code}/${REPS}，跟记忆 ${tally.stale.memory}/${REPS}；对照：选代码 ${tally.clean.code}/${REPS}`);
	if (tally.stale.memory > 0) say(`${RED}过期记忆能把模型带偏——注入前的措辞（「代码与记忆冲突时以代码为准」）需要加强，或记忆需要过期标记。${OFF}`);
	if (tally.clean.code < REPS) say(`${DIM}对照组也没全选 pnpm：这个模型本来就不太看 lockfile，冲突那条的结论要打折。${OFF}`);
	say();
}

await main();
