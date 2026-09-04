/**
 * Does the classifier tell a correction from an ordinary instruction?
 *
 *   node --experimental-strip-types test/tool-eval/correction-eval.ts [model]
 *
 * The plan sets the bar in terms of false positives: "≤ 3 misfires on 20 samples". That framing is
 * right, because the two errors are not symmetric. A missed correction costs a card that never
 * appeared and nobody notices. A card after every ordinary message teaches people to dismiss it
 * without reading — and then the real ones get dismissed too.
 *
 * So the negatives here outnumber the positives, and they are the ones that look most like
 * corrections: "这里改成 3" is a rejection of what the model did, and is still not a rule.
 */

import { classifyCorrection, lastUserText, looksLikeCorrection } from "../../packages/core/src/rules/from-correction.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { streamAssistant } from "../../packages/core/src/ai/index.ts";
import type { AssistantMessage, Message } from "../../packages/core/src/types.ts";

const say = (line = "") => process.stderr.write(`${line}\n`);
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

function exchange(assistantText: string, calls: { name: string; args: Record<string, unknown> }[], userText: string): Message[] {
	return [
		{
			role: "assistant",
			content: [
				...(assistantText ? [{ type: "text" as const, text: assistantText }] : []),
				...calls.map((c, i) => ({ type: "toolCall" as const, id: `c${i}`, name: c.name, arguments: c.args, argumentsText: "{}" })),
			],
			api: "openai-responses", provider: "p", model: "m", usage: {}, stopReason: "stop", timestamp: 0,
		} as AssistantMessage,
		{ role: "user", content: [{ type: "text", text: userText }], timestamp: 0 },
	];
}

interface Probe {
	label: string;
	messages: Message[];
	shouldOffer: boolean;
}

const PROBES: Probe[] = [
	// --- real corrections -----------------------------------------------------
	{
		label: "别用 any",
		messages: exchange("加好了。", [{ name: "edit", args: { path: "a.ts", patch: "+function f(x: any) {}" } }], "这个仓库不用 any，该写具体类型。"),
		shouldOffer: true,
	},
	{
		label: "包管理器约定",
		messages: exchange("跑 npm install 装一下。", [], "别用 npm，这仓库一律 pnpm。"),
		shouldOffer: true,
	},
	{
		label: "提交信息约定",
		messages: exchange("提交好了。", [{ name: "bash", args: { command: "git commit -m 'chore: tidy'" } }], "提交信息写中文，别用 chore: 这种英文前缀。"),
		shouldOffer: true,
	},
	{
		label: "不要写注释掉的代码",
		messages: exchange("改完了，旧的那段我注释起来了。", [{ name: "edit", args: { path: "a.ts", patch: "+// const old = 1;" } }], "别留注释掉的代码，直接删，git 里有。"),
		shouldOffer: true,
	},
	// --- things that must NOT trigger ----------------------------------------
	{
		label: "新任务",
		messages: exchange("函数写好了。", [{ name: "write", args: { path: "a.ts" } }], "现在给它加个测试。"),
		shouldOffer: false,
	},
	{
		label: "只针对这次的调整",
		messages: exchange("默认值设成 5 了。", [{ name: "edit", args: { path: "a.ts", patch: "+const LIMIT = 5;" } }], "这里改成 3。"),
		shouldOffer: false,
	},
	{
		label: "改个变量名",
		messages: exchange("写好了。", [{ name: "edit", args: { path: "a.ts", patch: "+const s = sum(xs);" } }], "把 s 改成 total 吧。"),
		shouldOffer: false,
	},
	{
		label: "提问",
		messages: exchange("用了 reduce。", [], "reduce 和 for 循环哪个快？"),
		shouldOffer: false,
	},
	{
		label: "确认",
		messages: exchange("三个文件都改好了。", [], "好的，谢谢。"),
		shouldOffer: false,
	},
	{
		label: "指出这次的错但没说以后",
		messages: exchange("跑完了，测试都过。", [{ name: "bash", args: { command: "pnpm test" } }], "你漏了一个文件没改。"),
		shouldOffer: false,
	},
];

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	say(`\n从纠正长出规则 · ${modelId}\n`);
	say(`${"探针".padEnd(26)} ${"该提议".padEnd(7)} ${"问了模型".padEnd(9)} ${"提议了".padEnd(7)} 判定`);
	say("-".repeat(76));

	let ok = 0;
	let falsePositives = 0;
	/*
	 * 闸门单独统计，因为它有两种完全不同的作用。
	 *
	 * 挡掉一条无关消息，省下的是一次调用；挡掉一条真纠正，毁掉的是这个功能——那个人永远不会
	 * 知道有这回事，而且不会有任何迹象。所以「省了几次」和「漏了几次」要分开看，后者必须是 0。
	 */
	let asked = 0;
	let gateMissed = 0;
	for (const probe of PROBES) {
		const gate = looksLikeCorrection(lastUserText(probe.messages));
		if (gate) asked += 1;
		if (!gate && probe.shouldOffer) gateMissed += 1;

		const result = await classifyCorrection({ messages: probe.messages, provider: resolved.provider, model: resolved.model, stream: streamAssistant });
		const correct = result.isCorrection === probe.shouldOffer;
		if (correct) ok += 1;
		else if (result.isCorrection) falsePositives += 1;

		say(
			`${probe.label.padEnd(24)} ${(probe.shouldOffer ? "是" : "否").padEnd(8)} ` +
				`${(gate ? "问了" : `${DIM}没问${OFF}`).padEnd(gate ? 10 : 18)} ${(result.isCorrection ? "是" : "否").padEnd(8)} ` +
				`${correct ? `${GREEN}✓${OFF}` : probe.shouldOffer ? `${RED}✗ 漏了${OFF}` : `${RED}✗ 误报${OFF}`}`,
		);
		if (result.isCorrection && result.condition) say(`${DIM}     condition: ${result.condition}   scope: ${result.scope}   name: ${result.name}${OFF}`);
	}

	say("-".repeat(76));
	say(`${ok}/${PROBES.length} 正确，误报 ${falsePositives} 次`);
	say(
		`本地闸门：${PROBES.length} 轮里只问了 ${asked} 次模型，省下 ${PROBES.length - asked} 次；` +
			`${gateMissed === 0 ? `${GREEN}没漏掉任何一条真纠正${OFF}` : `${RED}漏掉 ${gateMissed} 条真纠正${OFF}`}`,
	);
	say(`${DIM}计划的门槛是误报率——一张关于无关消息的卡片，会让人学会不看它。${OFF}\n`);
}

await main();
