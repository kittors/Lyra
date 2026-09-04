/**
 * A side-by-side of what changed, on real files, with a real model.
 *
 *   node --experimental-strip-types test/tool-eval/demo.ts [model]
 *
 * Everything here runs the shipping code paths — the same `read`, `edit` and rule engine a
 * session uses. Nothing is staged.
 */

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../packages/core/src/agent/loop.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { loadRules } from "../../packages/core/src/rules/loader.ts";
import { ruleHooks } from "../../packages/core/src/rules/session.ts";
import { StreamRuleMonitor } from "../../packages/core/src/rules/stream.ts";
import { editTool } from "../../packages/core/src/tools/edit.ts";
import { snapshotTag } from "../../packages/core/src/tools/hunk.ts";
import { outline } from "../../packages/core/src/tools/outline.ts";
import { readTool } from "../../packages/core/src/tools/read.ts";
import type { AgentEvent } from "../../packages/core/src/agent/events.ts";
import type { ToolContext } from "../../packages/core/src/types.ts";

const DIM = "[2m";
const BOLD = "[1m";
const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const OFF = "[0m";

function heading(n: number, title: string): void {
	console.log(`\n${BOLD}${"─".repeat(74)}${OFF}`);
	console.log(`${BOLD} ${n}. ${title}${OFF}`);
	console.log(`${BOLD}${"─".repeat(74)}${OFF}\n`);
}

// ---------------------------------------------------------------------------
// 1 · read returns a shape, not a wall of bytes
// ---------------------------------------------------------------------------

async function demoOutline(): Promise<void> {
	heading(1, "read：长文件返回结构，不是一堵字节墙");

	const target = "packages/core/src/runtime/sub-agents.ts";
	const content = await readFile(target, "utf8");
	const lines = content.split("\n");
	if (lines.at(-1) === "") lines.pop();

	const shape = outline(target, content, lines)!;
	console.log(`${DIM}文件${OFF} ${target}  ${DIM}${lines.length} 行${OFF}\n`);

	// A window onto the middle of the outline, so the folding is visible.
	const preview = shape.text.split("\n").slice(33, 46);
	for (const line of preview) {
		console.log(line.includes("⋯") ? `  ${YELLOW}${line}${OFF}` : `  ${DIM}${line}${OFF}`);
	}

	console.log(
		`\n  ${DIM}改前${OFF}  ${lines.length} 行全部进上下文\n` +
			`  ${GREEN}改后${OFF}  ${shape.shownLines} 行 ${DIM}(声明与注释)${OFF} + ${shape.foldedLines} 行折叠  ` +
			`${GREEN}省 ${((shape.foldedLines / lines.length) * 100).toFixed(0)}%${OFF}`,
	);
}

// ---------------------------------------------------------------------------
// 2 · edit: what the two formats cost for the same change
// ---------------------------------------------------------------------------

async function demoEdit(): Promise<void> {
	heading(2, "edit：同一处改动，两种格式的成本");

	const before = [
		"const DEFAULT_LIMIT = 2000;",
		"const MAX_LINE_LENGTH = 2000;",
		"const MAX_IMAGE_BYTES = 5 * 1024 * 1024;",
	].join("\n") + "\n";

	console.log(`${DIM}目标：把 MAX_LINE_LENGTH 从 2000 改成 4000，DEFAULT_LIMIT 不动${OFF}\n`);
	console.log(`  ${DIM}1→const DEFAULT_LIMIT = 2000;${OFF}`);
	console.log(`  ${DIM}2→const MAX_LINE_LENGTH = 2000;   ← 两行都有 2000${OFF}`);
	console.log(`  ${DIM}3→const MAX_IMAGE_BYTES = 5 * 1024 * 1024;${OFF}\n`);

	console.log(`  ${RED}str_replace${OFF}  锚点必须唯一，所以要连上下文一起复现：`);
	console.log(`  ${DIM}  old_string: "const DEFAULT_LIMIT = 2000;\\nconst MAX_LINE_LENGTH = 2000;"${OFF}`);
	console.log(`  ${DIM}  new_string: "const DEFAULT_LIMIT = 2000;\\nconst MAX_LINE_LENGTH = 4000;"${OFF}`);
	console.log(`  ${DIM}  —— 保留的那一行被逐字重打了一遍；打错一个字符就静默改坏它${OFF}\n`);

	console.log(`  ${GREEN}patch${OFF}        点名行号，只写新内容：`);
	console.log(`  ${DIM}  tag: ${snapshotTag(before)}${OFF}`);
	console.log(`  ${DIM}  patch: "REPLACE 2-2\\n+const MAX_LINE_LENGTH = 4000;"${OFF}\n`);

	// Actually apply it, so this is not a mock-up.
	const dir = await mkdtemp(join(tmpdir(), "lyra-demo-"));
	const file = join(dir, "limits.ts");
	await writeFile(file, before, "utf8");
	const ctx: ToolContext = { cwd: dir, sessionId: "demo", state: new Map() };
	await readTool.execute({ path: file } as never, ctx);
	const res = await editTool.execute({ path: file, tag: snapshotTag(before), patch: "REPLACE 2-2\n+const MAX_LINE_LENGTH = 4000;" }, ctx);
	const after = await readFile(file, "utf8");
	console.log(`  ${GREEN}结果${OFF} ${res.content[0].type === "text" ? res.content[0].text : ""}`);
	console.log(`  ${DIM}${after.trimEnd().split("\n").join("\n  ")}${OFF}`);

	// And the guard: an edit written against a file that has since moved.
	await writeFile(file, `${after}const EXTRA = 1;\n`, "utf8");
	const stale = await editTool.execute({ path: file, tag: snapshotTag(before), patch: "REPLACE 1-1\n+const DEFAULT_LIMIT = 99;" }, ctx);
	console.log(`\n  ${DIM}有人在这中间改了这个文件，再用旧 tag 编辑：${OFF}`);
	console.log(`  ${GREEN}被拒绝${OFF} ${DIM}${stale.content[0].type === "text" ? stale.content[0].text : ""}${OFF}`);
}

// ---------------------------------------------------------------------------
// 3 · a rule catching the model mid-sentence
// ---------------------------------------------------------------------------

async function demoRule(modelId: string): Promise<void> {
	heading(3, "规则：模型说到一半被拦下，重新作答");

	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	const cwd = await mkdtemp(join(tmpdir(), "lyra-demo-rule-"));
	const rulesDir = join(cwd, ".lyra", "rules");
	await mkdir(rulesDir, { recursive: true });
	const ruleText = ["---", "condition: '\\bvar\\s+\\w'", "scope: text", "---", "这个仓库不用 `var`。用 `const`，需要重新赋值时用 `let`。"].join("\n");
	await writeFile(join(rulesDir, "no-var.md"), ruleText, "utf8");

	console.log(`${DIM}.lyra/rules/no-var.md${OFF}`);
	for (const line of ruleText.split("\n")) console.log(`  ${DIM}${line}${OFF}`);

	const set = await loadRules([{ dir: rulesDir, source: "workspace", dialect: "lyra" }], { builtin: false });
	const task = "用 JavaScript 写一个循环，累加 1 到 10。用最传统的老式写法。直接给代码。";
	console.log(`\n${DIM}问：${OFF}${task}\n`);

	for (const withRule of [false, true]) {
		const monitor = new StreamRuleMonitor(withRule ? set.stream : []);
		let triggered: { name: string; excerpt: string }[] = [];
		const result = await runAgent(
			{
				sessionId: "demo",
				cwd,
				provider: resolved.provider,
				model: resolved.model,
				systemPrompt: "You are a coding assistant. Answer with code only.",
				tools: [],
				messages: [{ role: "user", content: [{ type: "text", text: task }], timestamp: Date.now() }],
				maxTurns: 4,
				temperature: 0,
				rules: monitor.active ? ruleHooks(monitor) : undefined,
			},
			async (event: AgentEvent) => {
				if (event.type === "rule_triggered") triggered = event.rules.map((r) => ({ name: r.name, excerpt: r.excerpt }));
			},
		);

		const answer = result.messages
			.filter((m) => m.role === "assistant")
			.flatMap((m) => m.content)
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		const code = answer.replace(/```\w*\n?/g, "").trim().split("\n").slice(0, 5);
		const broke = /\bvar\s+\w/.test(answer);

		console.log(`  ${withRule ? `${GREEN}加载规则后${OFF}` : `${RED}没有规则${OFF}`}`);
		if (triggered.length > 0) {
			for (const hit of triggered) {
				console.log(`    ${YELLOW}⚠ 命中 ${hit.name}${OFF} ${DIM}— 它正要写 ${JSON.stringify(hit.excerpt)}，流被中止，规则注入后重来${OFF}`);
			}
		}
		for (const line of code) console.log(`    ${DIM}${line}${OFF}`);
		console.log(`    ${broke ? `${RED}✗ 用了 var${OFF}` : `${GREEN}✓ 没有 var${OFF}`}\n`);
	}
}

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	console.log(`\n${BOLD}Lyra · feat/tool-quality 的实际效果${OFF}  ${DIM}模型 ${modelId}${OFF}`);
	await demoOutline();
	await demoEdit();
	await demoRule(modelId);
	console.log(`\n${DIM}${"─".repeat(74)}${OFF}\n`);
}

await main();
