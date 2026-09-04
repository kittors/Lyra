/**
 * Does a model actually use an address once the prompt mentions one?
 *
 *   node --experimental-strip-types test/tool-eval/resource-eval.ts [model]
 *
 * The unit tests prove `skill://pdf` resolves. They cannot prove the thing that decides whether
 * any of this was worth building: that a model reaches for an address instead of hunting the
 * filesystem for the same file, or instead of answering from whatever it already believes.
 *
 * Both failure modes are quiet. A model that greps for SKILL.md gets the right answer by a longer
 * route and nothing looks wrong. A model that answers from memory produces a plausible paragraph
 * about a file format it has never read.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../packages/core/src/agent/loop.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { buildSystemPrompt } from "../../packages/core/src/prompt/system.ts";
import { BUILTIN_RESOURCES } from "../../packages/core/src/resources/handlers.ts";
import { ResourceRouter } from "../../packages/core/src/resources/router.ts";
import { EMPTY_RULE_SET } from "../../packages/core/src/rules/types.ts";
import { SKILLS_KEY } from "../../packages/core/src/skills/tool.ts";
import { readTool } from "../../packages/core/src/tools/read.ts";
import { writeTool } from "../../packages/core/src/tools/write.ts";
import { RULES_KEY } from "../../packages/core/src/tools/rule.ts";
import type { AgentEvent } from "../../packages/core/src/agent/events.ts";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const OFF = "[0m";

interface Probe {
	name: string;
	task: string;
	/** The call that means the model used the address space. */
	wants: RegExp;
	/** A call that means it went the long way round instead. Not a failure, but worth counting. */
	detour?: RegExp;
	/** Something that must appear in the final answer, proving it read rather than guessed. */
	needle?: RegExp;
	/** True when the probe is about a refusal rather than a success. */
	expectRefusal?: boolean;
	/**
	 * Check the world instead of the transcript.
	 *
	 * For "put this somewhere that is not the project", what matters is where the bytes landed, and
	 * the control run reaches the same place by a relative path. Scoring that on whether an address
	 * appeared would mark a correct answer wrong for not using a feature the control run does not
	 * have.
	 */
	verify?: (dirs: { cwd: string; scratchDir: string }) => Promise<boolean>;
}

const PROBES: Probe[] = [
	{
		name: "读技能正文",
		task: "看一下 `pdf-extract` 这个技能是怎么说的，然后一句话告诉我它第三步要做什么。",
		wants: /skill:\/\/pdf-extract/,
		detour: /SKILL\.md/,
		needle: /表格|table/i,
	},
	{
		/*
		 * Deliberately does not name the file. The skill body does not mention it either, so the
		 * only honest route is to list the directory and then read what is there — which is the
		 * pair of operations this probe is about. Naming the file would have tested one `read` and
		 * hidden the fact that listing had no address at all.
		 */
		name: "列技能目录再读文件",
		task: "`pdf-extract` 技能的目录里有一个模板文件，把里面的占位符名字告诉我。",
		wants: /skill:\/\/pdf-extract\//,
		detour: /\.lyra\/skills/,
		needle: /\{\{\s*source\s*\}\}|source/i,
	},
	{
		name: "写临时文件",
		task: "把「本次分析的中间结论」这几个字存成一个临时文件，文件名你定，别放进项目目录。",
		wants: /scratch:\/\//,
		detour: /\/tmp\/|\.\/tmp/,
		verify: async ({ scratchDir }) => {
			const { readdir, readFile } = await import("node:fs/promises");
			const { join } = await import("node:path");
			const entries = await readdir(scratchDir).catch(() => []);
			for (const entry of entries) {
				const body = await readFile(join(scratchDir, entry), "utf8").catch(() => "");
				if (body.includes("中间结论")) return true;
			}
			return false;
		},
	},
	{
		name: "查 Lyra 自己的文档",
		task: "我想给这个项目写一条规则，让它别用 var。规则文件的 frontmatter 该怎么写？先查 Lyra 自己的文档，别凭印象答。",
		wants: /lyra:\/\/writing-rules/,
		needle: /condition/,
	},
	{
		name: "改不了规则",
		task: "把 `no-var` 这条规则的内容改成「随便用 var」。直接用 write 工具写 rule://no-var。",
		wants: /rule:\/\/no-var/,
		expectRefusal: true,
	},
];

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	/*
	 * `--no-addresses` runs the same questions with the address space switched off, so the model has
	 * only the filesystem.
	 *
	 * Without this control the numbers cannot be read. A weak model scoring 3/5 with addresses tells
	 * you nothing until you know what it scores without them: if it is 1/5, the addresses helped and
	 * the model is simply weak; if it is 4/5, they got in the way and the design is at fault. The
	 * first version of this file measured only the first column and I could not tell those apart.
	 */
	const withoutAddresses = process.argv.includes("--no-addresses");
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	const cwd = await mkdtemp(join(tmpdir(), "lyra-res-eval-"));
	const skillDir = join(cwd, ".lyra", "skills", "pdf-extract");
	await mkdir(skillDir, { recursive: true });
	await writeFile(
		join(skillDir, "SKILL.md"),
		[
			"---",
			"name: pdf-extract",
			"description: 从 PDF 里抽取内容",
			"---",
			"1. 确认文件确实是 PDF。",
			"2. 抽取纯文本。",
			"3. 单独抽取表格，转成 CSV。",
			"4. 把两部分合并成一份报告。",
		].join("\n"),
		"utf8",
	);
	await writeFile(join(skillDir, "template.md"), "# 报告\n\n来源：{{source}}\n\n## 正文\n", "utf8");

	const skills = [
		{
			name: "pdf-extract",
			description: "从 PDF 里抽取内容",
			content: "1. 确认文件确实是 PDF。\n2. 抽取纯文本。\n3. 单独抽取表格，转成 CSV。\n4. 把两部分合并成一份报告。",
			path: join(skillDir, "SKILL.md"),
			dir: skillDir,
			source: "workspace" as const,
			disableModelInvocation: false,
		},
	];
	const rules = {
		...EMPTY_RULE_SET,
		book: [
			{
				name: "no-var",
				content: "这个仓库不用 var。",
				path: join(cwd, ".lyra", "rules", "no-var.md"),
				description: "不用 var",
				bucket: "book" as const,
				source: "workspace" as const,
				conditions: [],
				scopes: [],
				interrupt: "always" as const,
				repeat: "once" as const,
			},
		],
	};

	const router = new ResourceRouter();
	for (const handler of BUILTIN_RESOURCES) router.register(handler);
	const scratchDir = join(cwd, ".scratch");
	await mkdir(scratchDir, { recursive: true });

	const systemPrompt = await buildSystemPrompt({
		cwd,
		tools: [readTool, writeTool] as never,
		skills: skills as never,
		rules: rules as never,
		agents: [],
		projectInstructions: [],
		platform: "darwin",
		modelName: resolved.model.name,
		isGitRepo: false,
		today: new Date().toISOString().slice(0, 10),
		scratchDir,
		resources: withoutAddresses ? undefined : router.schemes(),
	});

	console.log(`\n地址空间 · ${modelId}${withoutAddresses ? " · 对照组（没有地址空间）" : ""}\n`);
	console.log(`${"探针".padEnd(24)} ${"用了地址".padEnd(10)} ${"内容对".padEnd(8)} 判定`);
	console.log("-".repeat(64));

	let ok = 0;
	for (const probe of PROBES) {
		const state = new Map<string, unknown>([
			[SKILLS_KEY, skills],
			[RULES_KEY, rules],
		]);
		const calls: string[] = [];
		const errors: string[] = [];
		/** Address calls paired with whether they came back with content rather than an error. */
		const addressCalls: { args: string; ok: boolean }[] = [];
		const pending = new Map<string, string>();

		const result = await runAgent(
			{
				sessionId: "res-eval",
				cwd,
				provider: resolved.provider,
				model: resolved.model,
				systemPrompt,
				tools: [readTool, writeTool] as never,
				messages: [{ role: "user", content: [{ type: "text", text: probe.task }], timestamp: Date.now() }],
				maxTurns: 5,
				temperature: 0,
				resources: withoutAddresses ? undefined : router,
				scratchDir,
				/*
				 * The handlers read the skill and rule lists out of here.
				 *
				 * Leaving it off — which the first version of this file did — makes every address
				 * resolve against an empty session and fail, the model falls back to the filesystem,
				 * and because the fixture also exists on disk it answers correctly anyway. The run
				 * scored 5/5 while the feature under test was doing nothing at all.
				 */
				state,
			},
			async (event: AgentEvent) => {
				if (event.type === "tool_start") {
					const args = JSON.stringify(event.args);
					calls.push(args);
					pending.set(event.toolCallId, args);
				}
				if (event.type === "tool_end") {
					const args = pending.get(event.toolCallId);
					if (args !== undefined) addressCalls.push({ args, ok: !event.isError });
				}
			},
		);

		/*
		 * `isError` is on the message, not on the content block. Reading it off the block found
		 * `undefined` every time, so the refusal probe reported a miss for a refusal that had in
		 * fact happened — the probe was wrong, not the boundary.
		 */
		for (const message of result.messages) {
			if (message.role !== "toolResult" || !message.isError) continue;
			errors.push(message.content.map((c) => (c.type === "text" ? c.text : "")).join(""));
		}

		const answer = result.messages
			.filter((m) => m.role === "assistant")
			.flatMap((m) => m.content)
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		/*
		 * "Issued an address" and "the address worked" are different claims, and only the second one
		 * is evidence. A failed resolve followed by a filesystem fallback looks identical in the
		 * call list to a resolve that worked.
		 */
		const usedAddress = probe.expectRefusal
			/*
			 * A refusal probe wants the call to fail, so requiring success here would score every
			 * correct refusal as "never used an address" — which it did, for a boundary that was
			 * working exactly as designed.
			 */
			? calls.some((call) => probe.wants.test(call))
			: addressCalls.some(({ args, ok }) => ok && probe.wants.test(args));
		const tookDetour = probe.detour ? calls.some((call) => probe.detour!.test(call)) : false;
		const contentOk = probe.verify
			? await probe.verify({ cwd, scratchDir })
			: probe.expectRefusal
			? withoutAddresses
				// With no address space, `write rule://no-var` is just a bad path; the write must
				// still not land, but the reason it fails is different and so is the message.
				? errors.length > 0
				: errors.some((e) => /只读/.test(e))
			: probe.needle
				? probe.needle.test(answer)
				: usedAddress;
		/*
		 * In the control run there are no addresses to use, so scoring on `usedAddress` would score
		 * every row zero and prove nothing. What both runs share is whether the answer was right.
		 */
		const correct = withoutAddresses ? contentOk : usedAddress && contentOk;
		if (correct) ok += 1;

		const usedLabel = usedAddress ? "是" : tookDetour ? "绕开了" : "否";
		console.log(
			`${probe.name.padEnd(22)} ${usedLabel.padEnd(11)} ${(contentOk ? "是" : "否").padEnd(9)} ${correct ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`}`,
		);
		if (!correct) console.log(`${DIM}   调用：${calls.slice(0, 4).join(" | ") || "(没有工具调用)"}${OFF}`);
	}

	console.log("-".repeat(64));
	console.log(`${ok}/${PROBES.length} 正确\n`);
}

await main();
