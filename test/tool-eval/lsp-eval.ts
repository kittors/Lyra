/**
 * Does the language server find what a text search cannot, and does the agent use it?
 *
 *   node --experimental-strip-types test/tool-eval/lsp-eval.ts [model]
 *
 * The whole premise is one specific silent failure. `grep parseConfig` cannot see this:
 *
 *     import { parseConfig as pc } from "./core.ts";
 *     return pc(text);                                 // ← no occurrence of "parseConfig"
 *
 * A rename driven by that grep edits every line it found, looks complete, and leaves `pc` pointing
 * at a function that no longer exists. Nothing errors at edit time.
 *
 * So there are two things to measure and they are separate: whether the tool finds the aliased
 * callsite (mechanism), and whether a model asked to rename something actually reaches for it
 * rather than for grep (behaviour). The second is the one that decides whether any of this helps.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../packages/core/src/agent/loop.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { buildSystemPrompt } from "../../packages/core/src/prompt/system.ts";
import { CODE_INTEL_KEY, CodeIntelManager } from "../../packages/core/src/lsp/manager.ts";
import { globTool } from "../../packages/core/src/tools/glob.ts";
import { grepTool } from "../../packages/core/src/tools/grep.ts";
import { lspTool } from "../../packages/core/src/tools/lsp.ts";
import { readTool } from "../../packages/core/src/tools/read.ts";
import type { AgentEvent } from "../../packages/core/src/agent/events.ts";
import type { Tool, ToolContext } from "../../packages/core/src/types.ts";

/*
 * stderr, not stdout.
 *
 * The mechanism half of this file finishes in under a second and the behaviour half waits on a
 * model. Piped stdout buffers, so the fast results stayed invisible for as long as the slow one
 * took — which reads as the whole script hanging rather than as one part of it being slow.
 */
const say = (line = "") => process.stderr.write(`${line}\n`);

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const BOLD = "[1m";
const OFF = "[0m";

/** A project where the dangerous callsite does not contain the symbol's name. */
async function fixture(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-lsp-"));
	await mkdir(join(dir, "src"), { recursive: true });
	await writeFile(join(dir, "package.json"), JSON.stringify({ name: "probe", type: "module" }), "utf8");
	await writeFile(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, allowImportingTsExtensions: true, noEmit: true },
			include: ["src"],
		}),
		"utf8",
	);
	await writeFile(join(dir, "src", "core.ts"), "export function parseConfig(text: string): object {\n\treturn JSON.parse(text);\n}\n", "utf8");
	await writeFile(join(dir, "src", "index.ts"), 'export { parseConfig } from "./core.ts";\n', "utf8");
	// The aliased callsite: `pc(text)` contains no occurrence of `parseConfig`.
	await writeFile(
		join(dir, "src", "aliased.ts"),
		'import { parseConfig as pc } from "./core.ts";\n\nexport function load(text: string) {\n\treturn pc(text);\n}\n',
		"utf8",
	);
	await writeFile(
		join(dir, "src", "via-reexport.ts"),
		'import { parseConfig } from "./index.ts";\n\nexport function boot(text: string) {\n\treturn parseConfig(text);\n}\n',
		"utf8",
	);
	return dir;
}

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	const cwd = await fixture();

	// -------------------------------------------------------------------------
	// Mechanism: does the tool see the aliased callsite?
	// -------------------------------------------------------------------------
	say(`\n${BOLD}机制：别名调用点找不找得到${OFF}\n`);

	const state = new Map<string, unknown>();
	const ctx = { cwd, sessionId: "lsp-eval", state } as unknown as ToolContext;

	const started = Date.now();
	const viaLsp = await lspTool.execute({ operation: "references", path: "src/core.ts", symbol: "parseConfig" } as never, ctx);
	const lspText = viaLsp.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	const lspFoundAlias = /aliased\.ts:4/.test(lspText);
	const lspConfidence = (viaLsp.details as { confidence?: string } | undefined)?.confidence ?? "?";

	const viaGrep = await grepTool.execute({ pattern: "parseConfig", path: "." } as never, ctx);
	const grepText = viaGrep.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	const grepFoundAlias = /aliased\.ts:4/.test(grepText);

	say(`  ${"grep parseConfig".padEnd(24)} ${grepFoundAlias ? `${GREEN}找到了${OFF}` : `${RED}漏了 pc(text)${OFF}`}`);
	say(`  ${"lsp references".padEnd(24)} ${lspFoundAlias ? `${GREEN}找到了 pc(text)${OFF}` : `${RED}也漏了${OFF}`}  ${DIM}${lspConfidence} · ${Date.now() - started}ms${OFF}`);

	// -------------------------------------------------------------------------
	// The fallback: no server, and it has to say so.
	// -------------------------------------------------------------------------
	say(`\n${BOLD}降级：没有语言服务器时${OFF}\n`);
	const noServer = new Map<string, unknown>([[CODE_INTEL_KEY, new CodeIntelManager([])]]);
	const degraded = await lspTool.execute(
		{ operation: "references", path: "src/core.ts", symbol: "parseConfig" } as never,
		{ cwd, sessionId: "x", state: noServer } as unknown as ToolContext,
	);
	const degradedText = degraded.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	say(`  ${"仍然给出答案".padEnd(24)} ${/找到 \d+ 处|文本搜索找到/.test(degradedText) ? `${GREEN}是${OFF}` : `${RED}否${OFF}`}`);
	say(`  ${"说明了这是文本搜索".padEnd(23)} ${/别名导入/.test(degradedText) ? `${GREEN}是${OFF}` : `${RED}否——这是最危险的情况${OFF}`}`);

	const refusedRename = await lspTool.execute(
		{ operation: "rename", path: "src/core.ts", symbol: "parseConfig", newName: "parseSettings" } as never,
		{ cwd, sessionId: "x", state: new Map([[CODE_INTEL_KEY, new CodeIntelManager([])]]) } as unknown as ToolContext,
	);
	say(`  ${"拒绝无服务器的重命名".padEnd(22)} ${refusedRename.isError ? `${GREEN}是${OFF}` : `${RED}否——文本重命名正是要防的那件事${OFF}`}`);

	// -------------------------------------------------------------------------
	// Behaviour: given both tools, which does a model reach for?
	// -------------------------------------------------------------------------
	say(`\n${BOLD}行为：模型会不会去用它——以及没有它时会不会漏${OFF}\n`);

	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	/*
	 * 对照：同一个任务、同一个仓库，一组有 lsp 工具、一组没有，各跑三次。
	 *
	 * 「成功率提升」是相对的说法，只有对照能给出。没有 lsp 时模型只能 grep，而 grep 找不到
	 * 别名导入 `pc(text)`——那正是这个工具存在的理由。三次而不是一次，是因为单次的对错说不清
	 * 是工具的功劳还是模型那天的心情。
	 */
	const task = "我要把 src/core.ts 里导出的 parseConfig 改个名字。先告诉我一共有哪些地方在用它，一个都不能漏。";
	const REPS = 3;
	const tally = { with: { alias: 0, usedLsp: 0 }, without: { alias: 0, usedLsp: 0 } };
	for (const withLsp of [true, false]) {
		const tools = (withLsp ? [readTool, grepTool, globTool, lspTool] : [readTool, grepTool, globTool]) as unknown as Tool[];
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
		for (let rep = 1; rep <= REPS; rep++) {
			const calls: string[] = [];
			const runState = new Map<string, unknown>();
			const result = await runAgent(
				{
					sessionId: `lsp-behaviour-${withLsp ? "with" : "without"}-${rep}`,
					cwd,
					provider: resolved.provider,
					model: resolved.model,
					systemPrompt,
					tools,
					messages: [{ role: "user", content: [{ type: "text", text: task }], timestamp: Date.now() }],
					maxTurns: 6,
					temperature: 0,
					state: runState,
				},
				async (event: AgentEvent) => {
					if (event.type === "tool_start") calls.push(event.toolName);
				},
			);
			const answer = result.messages
				.filter((m) => m.role === "assistant")
				.flatMap((m) => m.content)
				.filter((c) => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			const usedLsp = calls.includes("lsp");
			const mentionedAlias = /aliased\.ts|\bpc\b/.test(answer);
			const arm = withLsp ? tally.with : tally.without;
			if (usedLsp) arm.usedLsp += 1;
			if (mentionedAlias) arm.alias += 1;
			say(
				`  ${(withLsp ? "有 lsp" : "无 lsp").padEnd(8)} #${rep}  ${(mentionedAlias ? `${GREEN}找到别名调用点${OFF}` : `${RED}漏了 pc(text)${OFF}`).padEnd(28)} ${DIM}${calls.join(" → ") || "(无)"}${OFF}`,
			);
			const manager = runState.get(CODE_INTEL_KEY);
			if (manager instanceof CodeIntelManager) await manager.dispose();
		}
	}
	say("");
	say(`  有 lsp：${tally.with.alias}/${REPS} 次找到别名调用点（${tally.with.usedLsp} 次真的调了 lsp）`);
	say(`  无 lsp：${tally.without.alias}/${REPS} 次找到别名调用点`);
	if (tally.with.alias <= tally.without.alias) say(`  ${DIM}这个模型不用 lsp 也能找到，或者有了也没用——工具带来的提升在这里量不出来。${OFF}`);
	say("");

	const manager = state.get(CODE_INTEL_KEY);
	if (manager instanceof CodeIntelManager) await manager.dispose();
	await rm(cwd, { recursive: true, force: true }).catch(() => {});
}

await main();
