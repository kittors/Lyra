/**
 * `verify` 委派出去，父代理省了多少上下文？
 *
 *   node --experimental-strip-types test/tool-eval/verify-eval.ts [model]
 *
 * 计划 09 §11：「verify agent 跑一个失败的测试，父代理拿到的是失败摘要不是完整日志」。
 * 这里用真的：一个临时项目、一条真会失败的 `node --test`、一个真的模型、真的 bash。
 * 量两个数——完整日志多少字符，父代理最后拿到多少字符——以及摘要里有没有说对是哪条挂了。
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { runSubAgent } from "../../packages/core/src/runtime/sub-agent.ts";
import { SubAgentRegistry } from "../../packages/core/src/runtime/sub-agents.ts";
import { BUILTIN_AGENTS } from "../../packages/core/src/tools/task.ts";
import { builtinTools } from "../../packages/core/src/tools/index.ts";

const say = (line = "") => process.stderr.write(`${line}\n`);
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

async function fixture(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), "lyra-verify-"));
	await mkdir(join(cwd, "test"), { recursive: true });
	await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "fixture", type: "module", scripts: { test: "node --test test/" } }));
	await writeFile(join(cwd, "parser.js"), "export function parseSettings(raw) { return JSON.parse(raw); }\n");
	/*
	 * 三十条过、一条挂。第一版只有四条，日志 988 字符——那个量级上「省了 77%」说明不了什么。
	 * 挂的那条名字很具体，好看摘要有没有说对是哪条。
	 */
	const passing = Array.from({ length: 30 }, (_, i) => `test("parses case ${i} correctly", () => assert.deepEqual(parseSettings('{"k":${i}}'), { k: ${i} }));`);
	await writeFile(
		join(cwd, "test", "parser.test.js"),
		[
			'import assert from "node:assert/strict";',
			'import { test } from "node:test";',
			'import { parseSettings } from "../parser.js";',
			...passing,
			'test("rejects a trailing comma with a clear message", () => {',
			'  assert.throws(() => parseSettings(\'{"a":1,}\'), /trailing comma/);',
			"});",
		].join("\n"),
	);
	return cwd;
}

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	const cwd = await fixture();
	// 完整日志：父代理自己跑的话会拿到的东西
	let fullLog = "";
	try {
		execSync("node --test test/", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (error) {
		const e = error as { stdout?: string; stderr?: string };
		fullLog = `${e.stdout ?? ""}${e.stderr ?? ""}`;
	}

	say(`\nverify 委派出去，父代理省了多少 · ${modelId}\n`);
	const registry = new SubAgentRegistry();
	const started = Date.now();
	const answer = await runSubAgent(
		{
			sessionId: "verify-eval",
			cwd,
			settings: { ...settings, permissionMode: "full" },
			tools: builtinTools(),
			skills: [],
			agents: BUILTIN_AGENTS,
			registry,
			requestApproval: async () => "allow",
			emit: async () => {},
		},
		{ description: "跑测试", prompt: "跑一遍这个项目的测试，报告结果。", agentType: "verify" },
		resolved.provider,
		resolved.model,
		`# Environment\ncwd: ${cwd}\n`,
	);
	const elapsed = ((Date.now() - started) / 1000).toFixed(1);

	const out = answer.output as { passed?: boolean; summary?: string; failures?: { name?: string; message?: string }[] } | undefined;
	const named = out?.failures?.some((f) => /trailing comma/i.test(`${f.name} ${f.message}`)) ?? false;
	const ratio = fullLog.length > 0 ? ((answer.text.length / fullLog.length) * 100).toFixed(0) : "?";

	say(`完整日志        ${fullLog.length} 字符`);
	say(`父代理拿到      ${answer.text.length} 字符  ${DIM}(${ratio}%)${OFF}`);
	say(`passed          ${out?.passed === false ? `${GREEN}false ✓${OFF}` : `${RED}${String(out?.passed)} ✗${OFF}`}`);
	say(`failures        ${out?.failures?.length ?? 0} 条  ${named ? `${GREEN}说对了是哪条${OFF}` : `${RED}没说对是哪条${OFF}`}`);
	for (const f of out?.failures ?? []) say(`${DIM}                  · ${f.name ?? "?"}${f.location ? ` @ ${f.location}` : ""}: ${(f.message ?? "").slice(0, 80)}${OFF}`);
	/*
	 * 摘要里的计数对不对。第一次跑，模型报了「0 passed, 1 failed」而实际 3 过 1 挂——一个
	 * 说错的摘要比完整日志更糟，父代理会照着它做决定。
	 */
	const countsRight = /\b30\b/.test(out?.summary ?? "") && /\b1\b/.test(out?.summary ?? "");
	say(`summary         ${DIM}${out?.summary ?? "（没有）"}${OFF}  ${countsRight ? `${GREEN}计数对${OFF}` : `${RED}计数错（该是 30 过 1 挂）${OFF}`}`);
	say(`耗时            ${elapsed}s`);
	say();
	const ok = out?.passed === false && named && countsRight && answer.text.length < fullLog.length / 3;
	say(ok ? `${GREEN}✓ 父代理拿到的是摘要，不是日志${OFF}` : `${RED}✗ 委派没省下东西，或者摘要说错了${OFF}`);
	say();
}

await main();
