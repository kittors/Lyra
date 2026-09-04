/**
 * Does a stream rule actually change what the model writes?
 *
 * The unit tests prove the plumbing: a pattern matches, a stream aborts, a message is injected.
 * None of that is the question. The question is whether a model, interrupted mid-sentence and
 * handed a rule, produces something different — and whether it produces something *correct*,
 * rather than a second violation with different words.
 *
 * So each probe is run twice against the same model and the same task: once with the rule
 * loaded, once without. The rule earns its place only if the pair differs.
 *
 *   node --experimental-strip-types test/tool-eval/rule-eval.ts [model]
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../packages/core/src/agent/loop.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { loadRules } from "../../packages/core/src/rules/loader.ts";
import { ruleHooks } from "../../packages/core/src/rules/session.ts";
import { StreamRuleMonitor } from "../../packages/core/src/rules/stream.ts";
import type { AgentEvent } from "../../packages/core/src/agent/events.ts";
import type { Message } from "../../packages/core/src/types.ts";

interface Probe {
	id: string;
	/** The rule file, as the user would write it. */
	rule: string;
	task: string;
	/** Present in the answer means the rule was violated. */
	violation: RegExp;
}

const PROBES: Probe[] = [
	{
		id: "no-any",
		rule: [
			"---",
			"condition: ':\\s*any\\b'",
			"scope: text",
			"---",
			"这个仓库不用 `any`。需要逃生舱时用 `unknown` 再显式收窄，或者把类型参数提上去。",
		].join("\n"),
		task: "写一个 TypeScript 函数 parseConfig，接受一段 JSON 字符串，解析后返回。直接给代码，不要解释。",
		violation: /:\s*any\b/,
	},
	{
		id: "no-console",
		rule: [
			"---",
			"condition: 'console\\.(log|debug)'",
			"scope: text",
			"---",
			"不要用 console.log 或 console.debug。这个仓库的日志走 `logger`，导入自 `./logger.ts`。",
		].join("\n"),
		task: "写一个 TypeScript 函数 fetchUser(id)，取回用户后把结果打印出来看看。直接给代码，不要解释。",
		violation: /console\.(log|debug)/,
	},
	{
		id: "no-var",
		rule: ["---", "condition: '\\bvar\\s+\\w'", "scope: text", "---", "不要用 `var`。用 `const`，需要重新赋值时用 `let`。"].join("\n"),
		task: "用 JavaScript 写一个循环，累加 1 到 10 并输出和。用最传统的老式写法。直接给代码。",
		violation: /\bvar\s+\w/,
	},
];

async function runOnce(probe: Probe, withRule: boolean, modelId: string): Promise<{ answer: string; triggered: number }> {
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	const cwd = await mkdtemp(join(tmpdir(), "lyra-rule-"));
	let monitor = new StreamRuleMonitor([]);
	if (withRule) {
		const dir = join(cwd, ".lyra", "rules");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, `${probe.id}.md`), probe.rule, "utf8");
		const set = await loadRules([{ dir, source: "workspace" }]);
		if (set.stream.length === 0) throw new Error(`probe ${probe.id}: the rule did not load as a stream rule — ${JSON.stringify(set.diagnostics)}`);
		monitor = new StreamRuleMonitor(set.stream);
	}

	let triggered = 0;
	const messages: Message[] = [{ role: "user", content: [{ type: "text", text: probe.task }], timestamp: Date.now() }];

	const result = await runAgent(
		{
			sessionId: "rule-eval",
			cwd,
			provider: resolved.provider,
			model: resolved.model,
			systemPrompt: "You are a coding assistant. Answer with code only.",
			tools: [],
			messages,
			maxTurns: 4,
			temperature: 0,
			rules: monitor.active ? ruleHooks(monitor) : undefined,
		},
		async (event: AgentEvent) => {
			if (event.type === "rule_triggered") triggered += event.rules.length;
		},
	);

	const answer = result.messages
		.filter((m) => m.role === "assistant")
		.flatMap((m) => m.content)
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return { answer, triggered };
}

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	console.log(`模型 ${modelId}\n`);
	console.log(`${"规则".padEnd(14)} ${"无规则时违规".padEnd(14)} ${"有规则时违规".padEnd(14)} ${"触发次数".padEnd(10)} 判定`);
	console.log("-".repeat(76));

	let effective = 0;
	let counted = 0;

	for (const probe of PROBES) {
		const without = await runOnce(probe, false, modelId);
		const withRule = await runOnce(probe, true, modelId);

		const brokeWithout = probe.violation.test(without.answer);
		const brokeWith = probe.violation.test(withRule.answer);

		// The probe only says anything when the model would have violated the rule unprompted.
		let verdict: string;
		if (!brokeWithout) {
			verdict = "— 基线就没违规，这条测不出东西";
		} else {
			counted += 1;
			if (!brokeWith) {
				effective += 1;
				verdict = "✓ 规则纠正了它";
			} else {
				verdict = "✗ 规则没能纠正";
			}
		}

		console.log(
			`${probe.id.padEnd(14)} ${(brokeWithout ? "是" : "否").padEnd(14)} ${(brokeWith ? "是" : "否").padEnd(14)} ${String(withRule.triggered).padEnd(10)} ${verdict}`,
		);
	}

	console.log("-".repeat(76));
	console.log(counted === 0 ? "没有一条探针在基线上违规——需要更容易触发的任务" : `有效探针 ${counted} 条，规则纠正了 ${effective} 条`);
}

await main();
