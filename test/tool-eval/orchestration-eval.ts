/**
 * Is a structured sub-agent answer actually better than a paragraph?
 *
 *   node --experimental-strip-types test/tool-eval/orchestration-eval.ts [model]
 *
 * The claim being tested is specific and falsifiable: **the parent can act on the result without
 * re-reading anything.** So the measurement is not "did the sub-agent do the work" — both versions
 * do — but whether what came back is usable as data.
 *
 * Both arms run the same dispatch against the same real repository with the same model. One has an
 * `output:` schema, the other does not. What differs is what the parent is holding afterwards.
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { runSubAgent } from "../../packages/core/src/runtime/sub-agent.ts";
import { globTool } from "../../packages/core/src/tools/glob.ts";
import { grepTool } from "../../packages/core/src/tools/grep.ts";
import { lsTool } from "../../packages/core/src/tools/ls.ts";
import { readTool } from "../../packages/core/src/tools/read.ts";
import { BUILTIN_AGENTS, type AgentDefinition } from "../../packages/core/src/tools/task.ts";
import { DEFAULT_SETTINGS } from "../../packages/core/src/config/settings.ts";
import type { Tool } from "../../packages/core/src/types.ts";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const BOLD = "[1m";
const OFF = "[0m";

/** A small but real codebase to search: a copy of a few of our own files. */
async function fixture(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-orch-"));
	await mkdir(join(dir, "src", "auth"), { recursive: true });
	await mkdir(join(dir, "src", "db"), { recursive: true });

	await writeFile(
		join(dir, "src", "auth", "login.ts"),
		[
			"import { verifyPassword } from './hash.ts';",
			"import { findUser } from '../db/users.ts';",
			"",
			"export async function login(email: string, password: string) {",
			"\tconst user = await findUser(email);",
			"\tif (!user) return null;",
			"\tif (!(await verifyPassword(password, user.hash))) return null;",
			"\treturn issueSession(user.id);",
			"}",
			"",
			"function issueSession(userId: string) {",
			"\treturn { token: `sess_${userId}_${Date.now()}`, expires: Date.now() + 86400000 };",
			"}",
		].join("\n"),
		"utf8",
	);
	await writeFile(
		join(dir, "src", "auth", "hash.ts"),
		["export async function verifyPassword(plain: string, hash: string) {", "\treturn plain === hash;", "}"].join("\n"),
		"utf8",
	);
	await writeFile(
		join(dir, "src", "db", "users.ts"),
		["export async function findUser(email: string) {", "\treturn { id: '1', email, hash: 'x' };", "}"].join("\n"),
		"utf8",
	);
	return dir;
}

const TASK = "找出登录流程涉及哪些文件，每个文件为什么相关，并给出一句话的结论。";

/** What the parent needs to be able to do with the answer, without reading anything again. */
interface Extraction {
	/** File paths the parent could act on. */
	paths: string[];
	/** A short conclusion it could quote. */
	summary: string;
	/** How it had to be obtained. */
	how: "结构化字段" | "解析散文" | "没拿到";
}

/** What a parent has to do with prose: guess at it with a regular expression. */
function parseProse(text: string): Extraction {
	const paths = [...text.matchAll(/[`'"]?((?:src|packages|test)\/[\w./-]+\.\w+)(?::\d+(?:-\d+)?)?[`'"]?/g)].map((m) => m[1]);
	const firstSentence = text.split(/\n\n|。/)[0]?.trim() ?? "";
	return { paths: [...new Set(paths)], summary: firstSentence, how: paths.length > 0 ? "解析散文" : "没拿到" };
}

function fromOutput(output: Record<string, unknown> | undefined): Extraction | null {
	if (!output) return null;
	const files = Array.isArray(output.files) ? output.files : [];
	const paths = files
		.map((f) => (typeof f === "object" && f !== null ? String((f as Record<string, unknown>).path ?? "") : ""))
		.filter(Boolean)
		.map((p) => p.split(":")[0]);
	return { paths: [...new Set(paths)], summary: typeof output.summary === "string" ? output.summary : "", how: "结构化字段" };
}

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	const cwd = await fixture();
	const tools = [readTool, grepTool, globTool, lsTool] as unknown as Tool[];
	const explore = BUILTIN_AGENTS.find((a) => a.name === "explore")!;
	/** The same agent with its schema removed — the state of the world before this change. */
	const proseOnly: AgentDefinition = {
		...explore,
		output: undefined,
		systemPrompt: `${explore.systemPrompt} Reply with the file paths and line numbers that answer the question, plus a two-sentence summary.`,
	};

	console.log(`\n${BOLD}子代理结构化输出 · ${modelId}${OFF}\n`);

	const arms: { label: string; definition: AgentDefinition }[] = [
		{ label: "散文（改造前）", definition: proseOnly },
		{ label: "结构化（现在）", definition: explore },
	];

	const runs = Number(process.argv[3] ?? 3);
	for (const arm of arms) {
		const tally = { pathsOk: 0, summaryOk: 0, ms: 0, chars: 0 };
		for (let run = 0; run < runs; run += 1) {
		const started = Date.now();
		const answer = await runSubAgent(
			{
				sessionId: "orch-eval",
				cwd,
				settings: { ...DEFAULT_SETTINGS, providers: [resolved.provider], defaultModelId: resolved.model.id, mcpServers: [], permissionMode: "full" },
				tools,
				skills: [],
				agents: [arm.definition],
				requestApproval: async () => "always",
				emit: async () => {},
			},
			{ description: "找登录流程", prompt: TASK, agentType: arm.definition.name },
			resolved.provider,
			resolved.model,
			"",
		);

		const extracted = fromOutput(answer.output) ?? parseProse(answer.text);
		const found = new Set(extracted.paths.map((p) => p.replace(/^\.?\//, "")));
		const wanted = ["src/auth/login.ts", "src/auth/hash.ts", "src/db/users.ts"];
		const hits = wanted.filter((w) => [...found].some((f) => f.endsWith(w) || w.endsWith(f)));

		/*
		 * A summary is only usable if it is a conclusion. Prose extraction "succeeds" at finding a
		 * first sentence every time, and that sentence is regularly something like
		 * "登录流程共涉及以下 3 个文件：" — a lead-in, not an answer. Requiring more than one clause
		 * and no trailing colon is a crude test, and it is the one that separates the two arms.
		 */
		const summaryUsable = extracted.summary.length > 12 && !/[:：]$/.test(extracted.summary);
		if (hits.length === 3) tally.pathsOk += 1;
		if (summaryUsable) tally.summaryOk += 1;
		tally.ms += Date.now() - started;
		tally.chars += answer.text.length;

		if (run === 0) {
			console.log(`${BOLD}${arm.label}${OFF}`);
			console.log(`  取到路径的方式  ${extracted.how === "结构化字段" ? GREEN : RED}${extracted.how}${OFF}`);
			console.log(`  第一次的结论    ${DIM}${extracted.summary.slice(0, 56) || "(空)"}${OFF}`);
			if (answer.warnings?.length) console.log(`  ${RED}schema 问题     ${answer.warnings.join("; ")}${OFF}`);
		}
		}
		const rate = (n: number) => `${n}/${runs}`;
		console.log(`  三个文件都找到  ${tally.pathsOk === runs ? GREEN : RED}${rate(tally.pathsOk)}${OFF}`);
		console.log(`  结论可直接引用  ${tally.summaryOk === runs ? GREEN : RED}${rate(tally.summaryOk)}${OFF}`);
		console.log(`  平均耗时        ${DIM}${(tally.ms / runs / 1000).toFixed(1)}s，${Math.round(tally.chars / runs)} 字符${OFF}\n`);
	}

	console.log(
		`${DIM}判读：两边都能把活干完。差别在父代理拿到手的是什么——一边是可以直接索引的字段，\n` +
			`另一边是一段要用正则去猜的文字，而那段正则是这个脚本替父代理写的。${OFF}\n`,
	);
}

await main();
