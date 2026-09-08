import { translate } from "../../i18n/translate.ts";
import type { Message } from "@lyra/core";
import { isNudge } from "./grouping.ts";

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
