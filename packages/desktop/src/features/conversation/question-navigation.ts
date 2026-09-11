import { translate } from "../../i18n/translate.ts";
import type { Message } from "@lyra/core";
import { stripPlaceholders } from "../../lib/attachment-placeholders.ts";
import { isNudge } from "./grouping.ts";

/** 人说过的一句话，连同它当初那条消息。 */
export interface Spoken {
	/** 人打的那些字：附件正文和旧记号都已经剥掉。 */
	text: string;
	/** 原消息。附件要还原回输入框，得从这里取，见 `composer/attachments/restore.ts`。 */
	message: Message;
}

/**
 * 人真正打进去过的那些话，最近的排在最前。
 *
 * 和 `questionsIn` 同住一个文件，是因为两者靠的是同一条判断：`synthetic`、`ruleMatch` 和 nudge 都
 * 挂在 user 名下，却没有一个是人敲出来的。分在两处写，迟早有一处会漏掉其中一种——而漏掉的后果是
 * 把一句人从没说过的话摆到他面前，还让他以为是自己说的。
 *
 * `text` 取 `displayText`（没有才退回正文），和气泡里显示的是同一份：附件正文不跟着回输入框，那是
 * 上千行的东西。`message` 原样交出去，因为「附件本身」得跟着回去——只给字的那一版，等于把当初那条
 * 「这张图里有什么」还原成一个没有指代对象的问题。
 *
 * 没打字但附了文件的那条也算数：它同样是人发出去的一条消息，翻回来是一袋文件加一个空输入框。
 *
 * 给输入框的方向键用，见 `composer/useInputHistory.ts`。
 */
export function spokenByPerson(messages: readonly Message[]): Spoken[] {
	const said: Spoken[] = [];
	for (const message of messages) {
		if (message.role !== "user" || message.synthetic || message.ruleMatch || isNudge(message)) continue;
		const body = message.content
			.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
			.map((block) => block.text)
			.join("\n\n");
		const text = stripPlaceholders(message.displayText ?? body, message.attachments ?? []).trim();
		if (text || message.attachments?.length) said.push({ text, message });
	}
	return said.reverse();
}

/** Message indices preserve distinct targets for identical questions and attachment-only turns. */
export function questionsIn(messages: readonly Message[]) {
	const questions: { index: number; text: string; answer: string }[] = [];
	for (const [index, message] of messages.entries()) {
		if (message.role === "assistant") {
			const question = questions.at(-1);
			const answer = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n\n").trim();
			if (question && answer) question.answer = answer.slice(0, 600);
			continue;
		}
		if (message.role !== "user" || message.synthetic || message.ruleMatch || isNudge(message)) continue;
		const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join(" ").trim();
		questions.push({ index, text: text || translate("questionNav.imageMessage"), answer: "" });
	}
	return questions;
}

export const QUESTION_LIMIT = 15;

/** A fixed-size neighbourhood, including both ends without stretching short conversations. */
export function questionWindow(total: number, position: number) {
	const size = Math.min(QUESTION_LIMIT, total);
	const start = Math.max(0, Math.min(total - size, position - Math.floor(size / 2)));
	return { start, end: start + size };
}

export function timeSeparators(messages: readonly Message[]) {
	const result = new Set<number>();
	let previous: number | undefined;
	for (const [index, message] of messages.entries()) {
		if (message.role === "user" && !message.synthetic && !message.ruleMatch && !isNudge(message)) {
			if (previous === undefined || message.timestamp - previous >= 30 * 60_000 || new Date(previous).toDateString() !== new Date(message.timestamp).toDateString()) result.add(index);
		}
		if (!('synthetic' in message && message.synthetic)) previous = message.timestamp;
	}
	return result;
}

export function conversationTime(timestamp: number, now = Date.now()) {
	const date = new Date(timestamp);
	const today = new Date(now);
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	const day = date.toDateString() === today.toDateString() ? translate("recency.today") : date.toDateString() === yesterday.toDateString() ? translate("recency.yesterday") : date.toLocaleDateString("zh-CN", { month: "long", day: "numeric", ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
	return `${day} ${date.toLocaleTimeString("zh-CN", { hour: "numeric", minute: "2-digit", hour12: false })}`;
}
