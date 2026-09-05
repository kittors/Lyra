/**
 * "拿最近的对话试一下": one pattern against the last few assistant messages.
 *
 * A stream rule's `condition` is the easiest thing in this system to write wrong, and the two
 * ways of writing it wrong are opposites. Too narrow and the rule never fires — which on screen is
 * indistinguishable from a rule that does not exist. Too wide and it fires on everything, which
 * is discovered one interruption at a time. Neither is visible from the pattern; both are visible
 * the moment the pattern meets real output. So: the same compile the loader does, then a run over
 * what the model actually said recently, with a snippet for every place it would have hit.
 *
 * Three sources, each labelled, because a rule's `scope` decides which of them it watches and
 * the person trying a pattern has not written the scope yet. A hit in a tool's arguments and a hit
 * in prose are different answers to "would this fire?".
 */

import type { Message } from "@lyra/core";
import { compileCondition } from "@lyra/core/rules-condition";

/** How far back the run looks. Recent enough to be this conversation, few enough to read the hits. */
export const RECENT_LIMIT = 20;
/** Characters shown either side of a hit. */
const CONTEXT = 30;

export type TrySource = "text" | "thinking" | "tool";

export interface TryHit {
	/** 1 is the newest assistant message. */
	nth: number;
	source: TrySource;
	toolName?: string;
	/** The match with a little of what surrounds it, whitespace collapsed. */
	snippet: string;
}

export interface TryOutcome {
	pattern: string;
	/** Why the loader would refuse this pattern — in the loader's own words. */
	reason?: string;
	hits: TryHit[];
	/** How many assistant messages were looked at. 0 means there was nothing to try against. */
	checked: number;
}

interface Haystack {
	source: TrySource;
	toolName?: string;
	text: string;
}

function haystacks(message: Message): Haystack[] {
	if (message.role !== "assistant") return [];
	const out: Haystack[] = [];
	for (const block of message.content) {
		if (block.type === "text") out.push({ source: "text", text: block.text });
		else if (block.type === "thinking") out.push({ source: "thinking", text: block.thinking });
		else if (block.type === "toolCall") {
			out.push({ source: "tool", toolName: block.name, text: block.argumentsText ?? JSON.stringify(block.arguments) });
		}
	}
	return out;
}

export function snippetAround(text: string, index: number, length: number): string {
	const start = Math.max(0, index - CONTEXT);
	const end = Math.min(text.length, index + length + CONTEXT);
	const middle = text.slice(start, end).replace(/\s+/g, " ");
	return `${start > 0 ? "…" : ""}${middle}${end < text.length ? "…" : ""}`;
}

export function tryCondition(pattern: string, messages: Message[], limit = RECENT_LIMIT): TryOutcome {
	// Newest first: 「倒数第 1 条」 is the reply still on screen, which is the one being reasoned about.
	const recent = messages.filter((m) => m.role === "assistant").slice(-limit).reverse();
	const outcome: TryOutcome = { pattern, hits: [], checked: recent.length };
	if (pattern.trim() === "") return outcome;

	const compiled = compileCondition(pattern);
	if (!compiled.ok) return { ...outcome, reason: compiled.reason };

	recent.forEach((message, i) => {
		for (const hay of haystacks(message)) {
			// One hit per place, as the monitor fires once — a pattern that matches thrice in one
			// reply would otherwise look three times as wide as it is.
			const found = compiled.regex.exec(hay.text);
			if (!found) continue;
			outcome.hits.push({ nth: i + 1, source: hay.source, toolName: hay.toolName, snippet: snippetAround(hay.text, found.index, found[0].length) });
		}
	});
	return outcome;
}
