/**
 * Turning "no, we don't do that here" into a rule.
 *
 * The plan lists "nobody writes rules" as one of the three most fragile assumptions in the whole
 * design, and this is its second answer. The first is shipping useful built-ins; the third is
 * reading `.cursor/rules` so that rules written elsewhere already apply. This one is different in
 * kind: it catches the moment a rule *would have been* written, which is the moment a person is
 * correcting the model and is thinking about the convention rather than about the rule system.
 *
 * The scenario is small and extremely common. The model writes `: any`, the user says "this
 * repository doesn't use any", the model fixes it — and next session it writes `: any` again.
 *
 * Two things decide whether this is a feature or an annoyance:
 *
 *   What counts as a correction. A classifier that fires on ordinary instructions ("now add a
 *   test") produces a card after every message, and a person learns to dismiss it without reading.
 *
 *   How often it may ask. Three per session, and it stops entirely after two refusals — somebody
 *   who has said no twice has answered the question.
 */

import type { AssistantMessage, Message, ModelConfig, ProviderConfig } from "../types.ts";
import type { streamAssistant } from "../ai/index.ts";

/** How many times one session may offer. */
export const MAX_OFFERS_PER_SESSION = 3;
/** Consecutive refusals after which a session stops offering. */
export const REFUSALS_BEFORE_SILENCE = 2;

export interface CorrectionSuggestion {
	/** Whether this exchange was a correction at all. */
	isCorrection: boolean;
	/** A regular expression that would catch the same mistake next time. */
	condition?: string;
	/** Where to watch, in the rule system's own syntax. */
	scope?: string;
	/** A name for the file: lowercase, hyphenated. */
	name?: string;
	/** The rule body, in the user's own words where possible. */
	body?: string;
}

/** Per-session accounting, so the offer cannot become a nag. */
export class OfferBudget {
	private offered = 0;
	private refusedInARow = 0;

	get exhausted(): boolean {
		return this.offered >= MAX_OFFERS_PER_SESSION || this.refusedInARow >= REFUSALS_BEFORE_SILENCE;
	}

	recordOffer(): void {
		this.offered += 1;
	}

	recordRefusal(): void {
		this.refusedInARow += 1;
	}

	/** Accepting resets the streak: they want these, they just did not want those two. */
	recordAcceptance(): void {
		this.refusedInARow = 0;
	}
}

/**
 * 值不值得花一次模型调用去判断。
 *
 * 分类器本身很便宜，但它跑在**每一轮**结束时，而绝大多数轮次跟纠正毫无关系——「查一下构建为
 * 什么慢」不需要问任何模型就知道不是。每轮一次调用，在没配 `@fast`、退回主力模型的机器上，
 * 是一笔按天累积的钱，而且是花在一个明知答案的问题上。
 *
 * 所以这里刻意**宽松**：它只负责把明显无关的挡掉，真正的判断仍然归模型。宁可多放过几次
 * （代价是一次便宜调用），也不能因为措辞不在表里就漏掉一次真的纠正——漏掉的代价是这个功能
 * 对那个人来说根本不存在。
 */
const CORRECTION_HINTS =
	/*
	 * 「别」是这里唯一需要额外约束的字：它在「别的」「特别」「区别」里是词的一部分，而中文没有
	 * 词边界可以依靠。「干点别的」本来每次都会白花一次调用。其余的词组本身已经够窄。
	 */
	/(?<![特区级分性告识差个类])别(?!的|人|名|字)|不要|不用|不该|不能|不许|勿用|禁止|避免|应该|应当|得用|要用|改用|换成|记住|以后|下次|每次|始终|一律|统一|只用|必须|规范|约定|说过|说了|不对|错了|又用|又写|明明|一直|从来|d(?:on'?t|o not)|never|always|stop\b|instead|should|must|remember/i;

export function looksLikeCorrection(text: string): boolean {
	return CORRECTION_HINTS.test(text);
}

const SYSTEM = [
	"你在判断一段对话里，用户最后那句话是不是在**纠正**助手的做法，以及这个纠正能不能变成一条以后自动生效的规则。",
	"",
	"算纠正的：",
	"- 「别用 X，用 Y」「这个仓库不用 X」「不要那样写」",
	"- 指出助手违反了某个约定，而这个约定以后还会适用",
	"",
	"**不算**纠正的：",
	"- 新的任务或需求（「现在加个测试」「再写一个函数」）",
	"- 只针对这一次的调整（「这里改成 3」「把这个变量名换成 total」）",
	"- 提问、闲聊、确认",
	"- 助手做错了但用户只是指出事实，没有表达「以后也别这样」",
	"",
	"最后一条最要紧：**一条只在这次成立的意见不该变成永久规则**。拿不准就判否。",
	"",
	"如果是纠正，再给出：",
	"- `condition`：一个 JavaScript 正则（字符串，不要带斜杠），能匹配到助手**下次犯同样错误时会写出的文本**。",
	"  例如禁止 `any` 类型 → `:\\\\s*any\\\\b`。匹配不到具体文本的就留空。",
	"- `scope`：`text`、`thinking`、`tool:<工具名>` 之一。改代码的约定通常是 `tool:edit` 或 `tool:write`。",
	"- `name`：小写连字符，三到四个词，像 `no-any-type`。",
	"- `body`：规则正文，一两句，尽量用用户自己的话。",
	"",
	"只输出 JSON，不要别的：",
	'{"isCorrection": true, "condition": "...", "scope": "tool:edit", "name": "...", "body": "..."}',
].join("\n");

/**
 * 这个人最后说的那句话，去掉运行时自己塞进去的那些。
 *
 * `synthetic` 是应用替人写的消息——规则注入、「继续」——把它们当成人说的话，会让每一条注入的
 * 规则正文都成为一次「纠正」的候选，而那正文里满是「别」「不要」。
 */
export function lastUserText(messages: Message[]): string {
	const last = [...messages].reverse().find((m) => m.role === "user" && !m.synthetic);
	return (
		last?.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim() ?? ""
	);
}

/** The exchange the classifier looks at: what the model did, and what the person said about it. */
export function renderExchange(messages: Message[]): string {
	const lastUser = [...messages].reverse().find((m) => m.role === "user" && !m.synthetic);
	const beforeIt = messages.slice(0, lastUser ? messages.indexOf(lastUser) : messages.length);
	const lastAssistant = [...beforeIt].reverse().find((m): m is AssistantMessage => m.role === "assistant");

	const said = (message: Message | undefined) =>
		message?.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.slice(0, 1500) ?? "";

	/*
	 * The tool calls matter as much as the prose. "别用 var" after an `edit` that wrote `var` is a
	 * correction about code; the same words with no edit behind them may be a general remark.
	 */
	const calls = lastAssistant?.content
		.filter((block): block is { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> } => block.type === "toolCall")
		.map((block) => `${block.name}(${JSON.stringify(block.arguments).slice(0, 300)})`)
		.join("\n");

	return [
		`助手上一轮说：${said(lastAssistant) || "（没有文字）"}`,
		calls ? `助手上一轮的工具调用：\n${calls}` : "",
		`用户接着说：${said(lastUser)}`,
	]
		.filter(Boolean)
		.join("\n\n");
}

export interface ClassifyOptions {
	messages: Message[];
	provider: ProviderConfig;
	model: ModelConfig;
	stream: typeof streamAssistant;
	signal?: AbortSignal;
}

/**
 * Ask whether the last exchange was a correction worth keeping.
 *
 * Any failure answers "no". This runs after a turn nobody is waiting on, and the cost of a wrong
 * "no" is an offer that does not appear — while the cost of raising is an error attached to a turn
 * that had already finished successfully.
 */
export async function classifyCorrection(options: ClassifyOptions): Promise<CorrectionSuggestion> {
	/*
	 * Nothing to classify without something the person said. Checked on the messages rather than on
	 * the rendered text: the renderer emits the "用户接着说：" label whether or not there is anything
	 * after it, so looking for the label found one every time.
	 */
	const said = lastUserText(options.messages);
	if (!said) return { isCorrection: false };
	// 明显无关的轮次连问都不问——见 `looksLikeCorrection`，那是这个功能的成本闸门。
	if (!looksLikeCorrection(said)) return { isCorrection: false };

	const exchange = renderExchange(options.messages);

	const stream = options.stream(
		options.provider,
		options.model,
		{ systemPrompt: SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: exchange }], timestamp: Date.now() }], tools: [] },
		{ signal: options.signal, thinking: "off" },
	);

	let final: Awaited<ReturnType<typeof stream.next>>;
	try {
		do {
			final = await stream.next();
		} while (!final.done);
	} catch {
		return { isCorrection: false };
	}

	const reply = final.value;
	if (reply.stopReason === "error" || reply.stopReason === "aborted") return { isCorrection: false };

	const text = reply.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("");

	return parseSuggestion(text);
}

/**
 * Read the classifier's answer, tolerating the wrapping models add.
 *
 * A fenced block, a sentence before the JSON, a trailing explanation — all common, none worth
 * failing over. Anything that does not yield an object is read as "not a correction", which is the
 * safe direction: the cost is a missing offer rather than a card about nothing.
 */
export function parseSuggestion(text: string): CorrectionSuggestion {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return { isCorrection: false };

	let parsed: unknown;
	try {
		parsed = JSON.parse(text.slice(start, end + 1));
	} catch {
		return { isCorrection: false };
	}
	if (typeof parsed !== "object" || parsed === null) return { isCorrection: false };

	const record = parsed as Record<string, unknown>;
	if (record.isCorrection !== true) return { isCorrection: false };

	const condition = typeof record.condition === "string" && record.condition.trim() ? record.condition.trim() : undefined;
	/*
	 * A condition that does not compile is dropped rather than carried through to the file.
	 *
	 * Writing an invalid regex into a rule makes a rule that silently never fires — the worst of
	 * the three outcomes, because it looks like it is working.
	 */
	if (condition !== undefined && !compiles(condition)) {
		return { ...suggestionFields(record), condition: undefined };
	}

	return { ...suggestionFields(record), condition };
}

/** Whether a pattern is a regular expression at all. */
function compiles(pattern: string): boolean {
	try {
		return Boolean(new RegExp(pattern));
	} catch {
		return false;
	}
}

function suggestionFields(record: Record<string, unknown>): CorrectionSuggestion {
	const name = typeof record.name === "string" ? record.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "";
	return {
		isCorrection: true,
		name: name || "from-correction",
		body: typeof record.body === "string" ? record.body.trim() : "",
		scope: typeof record.scope === "string" && record.scope.trim() ? record.scope.trim() : "text",
	};
}

/** The markdown a suggestion becomes. What the user sees before saving, and what lands on disk. */
export function renderRuleFile(suggestion: CorrectionSuggestion): string {
	const front: string[] = ["---"];
	if (suggestion.condition) front.push(`condition: ${JSON.stringify(suggestion.condition)}`);
	if (suggestion.scope) front.push(`scope: ${suggestion.scope}`);
	/*
	 * A rule with no condition is a rulebook entry, and those need a description — it is how the
	 * model decides whether to read the body. Taking the first sentence of the body is better than
	 * asking the classifier for a second string that would say the same thing.
	 */
	if (!suggestion.condition) front.push(`description: ${JSON.stringify(firstSentence(suggestion.body ?? ""))}`);
	front.push("---", "");
	return `${front.join("\n")}${suggestion.body ?? ""}\n`;
}

function firstSentence(text: string): string {
	const match = /^[^。.！!？?\n]+/.exec(text.trim());
	return (match?.[0] ?? text).slice(0, 120);
}
