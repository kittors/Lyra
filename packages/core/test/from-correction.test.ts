/**
 * Turning a correction into a rule: what counts as one, and how often it may ask.
 *
 * Both halves decide whether this is a feature or an annoyance. A classifier that fires on
 * ordinary instructions puts a card after every message, and a person learns to dismiss it without
 * reading — at which point the real ones are dismissed too.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
	classifyCorrection,
	lastUserText,
	looksLikeCorrection,
	MAX_OFFERS_PER_SESSION,
	OfferBudget,
	parseSuggestion,
	REFUSALS_BEFORE_SILENCE,
	renderExchange,
	renderRuleFile,
} from "../src/rules/from-correction.ts";
import { saveRule } from "../src/rules/save.ts";
import type { AssistantMessage, Message } from "../src/types.ts";

let root: string;
let home: string;

function assistant(text: string, calls: { name: string; args: Record<string, unknown> }[] = []): AssistantMessage {
	return {
		role: "assistant",
		content: [
			...(text ? [{ type: "text" as const, text }] : []),
			...calls.map((c, i) => ({ type: "toolCall" as const, id: `c${i}`, name: c.name, arguments: c.args, argumentsText: "{}" })),
		],
		api: "openai-responses",
		provider: "p",
		model: "m",
		usage: {},
		stopReason: "stop",
		timestamp: 0,
	} as AssistantMessage;
}

function user(text: string, synthetic = false): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0, synthetic };
}

function scripted(text: string, stopReason: AssistantMessage["stopReason"] = "stop") {
	const message = { ...assistant(text), stopReason } as AssistantMessage;
	return async function* () {
		yield { type: "text_delta" as const, index: 0, delta: text, partial: message };
		return message;
	} as never;
}

const DEPS = {
	provider: { id: "p", name: "P", baseUrl: "x", api: "openai-responses", apiKey: "k", enabled: true, models: [] } as never,
	model: { id: "m", providerId: "p", modelId: "m", name: "M", contextWindow: 100_000, maxOutputTokens: 4096, supportsThinking: false, supportsImages: false, supportsTools: false } as never,
};

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-corr-"));
	home = await mkdtemp(join(tmpdir(), "ly-corr-home-"));
	process.env.LYRA_HOME = home;
});

after(async () => {
	delete process.env.LYRA_HOME;
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

// ---------------------------------------------------------------------------
// What the classifier is shown
// ---------------------------------------------------------------------------

test("the exchange carries the tool calls, not just the words", () => {
	/*
	 * "别用 var" after an `edit` that wrote `var` is a correction about code. The same words with
	 * nothing behind them may be a general remark, and the classifier needs to be able to tell.
	 */
	const rendered = renderExchange([
		assistant("写好了", [{ name: "edit", args: { path: "a.ts", patch: "+var x = 1;" } }]),
		user("别用 var"),
	]);
	assert.match(rendered, /别用 var/);
	assert.match(rendered, /edit\(/);
	assert.match(rendered, /var x = 1/);
});

test("the runtime's own messages are not read as the user speaking", () => {
	const rendered = renderExchange([assistant("好"), user("规则注入", true), user("真正的话")]);
	assert.match(rendered, /真正的话/);
	assert.ok(!rendered.includes("规则注入"));
});

test("with nothing the user said, there is nothing to classify", async () => {
	let called = false;
	const result = await classifyCorrection({
		messages: [assistant("只有助手说话")],
		stream: (() => {
			called = true;
			return scripted("{}");
		}) as never,
		...DEPS,
	});
	assert.equal(result.isCorrection, false);
	assert.equal(called, false, "no request is made at all");
});

// ---------------------------------------------------------------------------
// 值不值得问模型
// ---------------------------------------------------------------------------

test("明显无关的一轮不问模型", async () => {
	/*
	 * 这道闸门是这个功能的成本本身。它跑在**每一轮**结束时，而绝大多数轮次跟纠正毫无关系——
	 * 在没配 `@fast`、退回主力模型的机器上，每轮一次调用是一笔按天累积的钱，花在一个不用问就
	 * 知道答案的问题上。
	 */
	let called = false;
	const result = await classifyCorrection({
		messages: [assistant("好的"), user("查一下构建为什么慢")],
		stream: (() => {
			called = true;
			return scripted("{}");
		}) as never,
		...DEPS,
	});
	assert.equal(result.isCorrection, false);
	assert.equal(called, false);
});

test("「别的」不是「别用」", () => {
	/*
	 * 中文没有词边界。「干点别的」「特别慢」「这两个没区别」每一句都含「别」，而这些是对话里
	 * 极常见的说法——不挡掉，这道闸门就基本不省钱。
	 */
	assert.equal(looksLikeCorrection("干点别的"), false);
	assert.equal(looksLikeCorrection("这个特别慢"), false);
	assert.equal(looksLikeCorrection("两种写法没区别"), false);
	assert.equal(looksLikeCorrection("别用 var"), true);
	assert.equal(looksLikeCorrection("别这样写"), true);
});

test("闸门是宽松的，宁可多问一次", () => {
	/*
	 * 漏判的代价是这个功能对那个人来说根本不存在；误判的代价是一次便宜调用，而且模型是第二道
	 * 闸门。所以这些一律放过去，哪怕其中一半最后会被判成「不是纠正」。
	 */
	for (const said of [
		"这个仓库不用 any",
		"以后提交信息都用中文",
		"我们统一走 pnpm",
		"说过多少次了，缩进用 tab",
		"don't use npm here",
		"always run the formatter first",
		"use pnpm instead",
	]) {
		assert.equal(looksLikeCorrection(said), true, said);
	}
});

test("运行时自己塞进去的话不算这个人说的", () => {
	/*
	 * 规则注入的正文里全是「别」「不要」。把它当成用户说的话，等于每注入一条规则就触发一次
	 * 分类——而那句话根本不是人说的。
	 */
	assert.equal(lastUserText([assistant("好"), user("【规则】别用 var", true)]), "");
	assert.equal(lastUserText([assistant("好"), user("别用 var", true), user("知道了")]), "知道了");
});

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

test("a fenced JSON answer is read", () => {
	const parsed = parseSuggestion('好的：\n```json\n{"isCorrection": true, "condition": ":\\\\s*any\\\\b", "scope": "tool:edit", "name": "no-any", "body": "不用 any。"}\n```');
	assert.equal(parsed.isCorrection, true);
	assert.equal(parsed.name, "no-any");
	assert.equal(parsed.scope, "tool:edit");
});

test("anything that is not an object reads as «not a correction»", () => {
	/*
	 * The safe direction. A missing offer costs nothing visible; a card about nothing teaches
	 * people to ignore the ones that matter.
	 */
	assert.equal(parseSuggestion("我觉得不是纠正").isCorrection, false);
	assert.equal(parseSuggestion("{ 坏掉的 json").isCorrection, false);
	assert.equal(parseSuggestion("").isCorrection, false);
});

test("isCorrection must be literally true", () => {
	assert.equal(parseSuggestion('{"isCorrection": "yes"}').isCorrection, false);
	assert.equal(parseSuggestion('{"isCorrection": 1}').isCorrection, false);
});

test("a condition that does not compile is dropped, not carried through", () => {
	/*
	 * An invalid regex in a rule file makes a rule that silently never fires — the worst of the
	 * three outcomes, because it looks like it is working.
	 */
	const parsed = parseSuggestion('{"isCorrection": true, "condition": "([unclosed", "name": "x", "body": "y"}');
	assert.equal(parsed.isCorrection, true, "the correction is still real");
	assert.equal(parsed.condition, undefined, "but the broken pattern does not survive");
});

test("a name is normalised into something that can be a filename", () => {
	assert.equal(parseSuggestion('{"isCorrection": true, "name": "No Any Type!", "body": "x"}').name, "no-any-type");
	assert.equal(parseSuggestion('{"isCorrection": true, "name": "", "body": "x"}').name, "from-correction");
});

test("a provider failure answers no", async () => {
	const result = await classifyCorrection({ messages: [assistant("a"), user("b")], stream: scripted("x", "error"), ...DEPS });
	assert.equal(result.isCorrection, false);
});

// ---------------------------------------------------------------------------
// The file it becomes
// ---------------------------------------------------------------------------

test("a condition makes a stream rule", () => {
	const file = renderRuleFile({ isCorrection: true, condition: ":\\s*any\\b", scope: "tool:edit", name: "no-any", body: "这个仓库不用 any。" });
	assert.match(file, /condition: ":\\\\s\*any\\\\b"/);
	assert.match(file, /scope: tool:edit/);
	assert.match(file, /这个仓库不用 any。/);
	assert.ok(!file.includes("description:"), "a stream rule does not need one");
});

test("no condition makes a rulebook entry, which does need a description", () => {
	/*
	 * Without a condition the rule is listed by name and description, and the description is how
	 * the model decides whether to read the body. A rulebook entry without one is invisible.
	 */
	const file = renderRuleFile({ isCorrection: true, name: "commit-style", body: "提交信息用中文。别写 chore: 之类的英文前缀。" });
	assert.match(file, /description: "提交信息用中文"/);
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

test("a project rule and a user rule go to different places", async () => {
	const project = await saveRule("project", root, "no-any", "---\n---\n不用 any。\n");
	const personal = await saveRule("user", root, "no-any", "---\n---\n不用 any。\n");

	assert.match(project.path, /\.lyra\/rules\/no-any\.md$/);
	assert.ok(personal.path.startsWith(home), "the user one lands in the home directory, not the project");
});

test("an existing rule is not overwritten", async () => {
	/*
	 * A collision means somebody already wrote a rule with this name. Replacing it silently loses
	 * something they meant; failing would leave them with a suggestion they liked and no way to
	 * keep it.
	 */
	await saveRule("project", root, "dup", "---\n---\n第一条。\n");
	const second = await saveRule("project", root, "dup", "---\n---\n第二条。\n");

	assert.equal(second.renamed, "dup-2");
	assert.match(await readFile(join(root, ".lyra", "rules", "dup.md"), "utf8"), /第一条/, "the original is untouched");
	assert.match(await readFile(second.path, "utf8"), /第二条/);
});

// ---------------------------------------------------------------------------
// How often it may ask
// ---------------------------------------------------------------------------

test("a session offers a bounded number of times", () => {
	const budget = new OfferBudget();
	for (let i = 0; i < MAX_OFFERS_PER_SESSION; i += 1) {
		assert.equal(budget.exhausted, false);
		budget.recordOffer();
	}
	assert.equal(budget.exhausted, true);
});

test("two refusals end it for the session", () => {
	/*
	 * Somebody who has said no twice has answered the question. Asking a third time is the
	 * difference between a feature and a nag.
	 */
	const budget = new OfferBudget();
	for (let i = 0; i < REFUSALS_BEFORE_SILENCE; i += 1) budget.recordRefusal();
	assert.equal(budget.exhausted, true);
});

test("accepting one resets the refusal streak", () => {
	/*
	 * They want these; they just did not want those two. Counting a refusal after an acceptance
	 * toward the same total would silence somebody who is actively using the feature.
	 */
	const budget = new OfferBudget();
	budget.recordRefusal();
	budget.recordAcceptance();
	budget.recordRefusal();
	assert.equal(budget.exhausted, false);
});
