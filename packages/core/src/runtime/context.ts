/**
 * Where the context window actually goes.
 *
 * A single "12.5k / 128k" is enough to notice you are filling up and useless for doing anything
 * about it — the answer to "why is this so expensive?" is nearly always one segment, and which
 * one decides what you would do: prune the conversation, drop an MCP server, or trim a CLAUDE.md
 * that grew without anyone reading it again. So the number is broken down by what put it there.
 *
 * Measured on the strings that are actually sent. Tool schemas go up as JSON on every request,
 * so they are measured as JSON; the prompt's own sections are measured as text. Nothing is
 * counted twice: the skill catalogue and the project instructions are carved out of the system
 * prompt rather than added to it, which is why the segments sum to the total.
 */

import type { Message, ModelConfig, Tool } from "../types.ts";
import { estimateTokens } from "../tokens.ts";

export type ContextSegmentKey = "messages" | "systemTools" | "mcpTools" | "skills" | "systemPrompt" | "memory";

export interface ContextSegment {
	key: ContextSegmentKey;
	tokens: number;
}

export interface MemoryFileItem {
	path: string;
	tokens: number;
}

export interface ContextBreakdown {
	/** The model's window, so the caller does not have to look it up again to compute a share. */
	limit: number;
	/** Everything that will be sent, in descending order of size. */
	segments: ContextSegment[];
	used: number;
	/** True once the numbers come from the provider rather than from a characters-per-token guess. */
	measured: boolean;
	/** Individual memory / instruction files making up the 'memory' segment. */
	memoryFiles?: MemoryFileItem[];
}

/** What a tool costs on the wire: the schema the provider is given, every single request. */
export function toolTokens(tools: Tool[]): number {
	if (tools.length === 0) return 0;
	const text = tools
		.map((tool) => `${tool.name}${tool.description}${JSON.stringify(tool.parameters)}`)
		.join("");
	return Math.ceil(text.length / 3.5);
}

export function textTokens(text: string): number {
	return text ? Math.ceil(text.length / 3.5) : 0;
}

export function buildContextBreakdown(input: {
	model: ModelConfig;
	messages: Message[];
	systemPrompt: string;
	builtinTools: Tool[];
	mcpTools: Tool[];
	skillCatalogue: string;
	/** As `buildSystemPrompt` receives them, so the same text is measured that gets embedded. */
	projectInstructions: { path: string; content: string }[];
}): ContextBreakdown {
	const skills = textTokens(input.skillCatalogue);
	const memoryFiles: MemoryFileItem[] = input.projectInstructions.map((file) => ({
		path: file.path,
		tokens: textTokens(file.content),
	}));
	const memory = memoryFiles.reduce((acc, f) => acc + f.tokens, 0);
	/*
	 * The prompt minus the two parts listed separately.
	 *
	 * Both are embedded in the prompt string, so counting them as their own segments and leaving
	 * the prompt whole would report a total larger than anything that gets sent.
	 */
	const systemPrompt = Math.max(0, textTokens(input.systemPrompt) - skills - memory);

	const systemTools = toolTokens(input.builtinTools);
	const mcpTools = toolTokens(input.mcpTools);
	const overhead = systemTools + mcpTools + skills + systemPrompt + memory;

	/*
	 * The provider's number is the total, not the conversation's share.
	 *
	 * `usage.input` covers everything that went up — prompt, tool schemas and history together.
	 * Treating it as the message segment and then adding the others alongside would report a
	 * context far larger than anything actually sent. So the measured figure anchors the total
	 * and the conversation is what is left after the fixed overhead, which also parks the
	 * estimator's error on the one segment that is too big to be sensitive to it.
	 */
	const total = measureTotal(input.messages);
	const messages = total.measured ? Math.max(0, total.tokens - overhead) : estimateTokens(input.messages);

	const segments = ([
		{ key: "messages", tokens: messages },
		{ key: "systemTools", tokens: systemTools },
		{ key: "mcpTools", tokens: mcpTools },
		{ key: "skills", tokens: skills },
		{ key: "systemPrompt", tokens: systemPrompt },
		{ key: "memory", tokens: memory },
	] satisfies ContextSegment[])
		.filter((segment) => segment.tokens > 0)
		.sort((a, b) => b.tokens - a.tokens);

	return {
		limit: input.model.contextWindow,
		segments,
		used: messages + overhead,
		measured: total.measured,
		memoryFiles: memoryFiles.length > 0 ? memoryFiles : undefined,
	};
}

/**
 * What the whole next request will carry.
 *
 * Taken from the last settled reply when there is one: what that turn sent, read from cache and
 * wrote is exactly the context the next question inherits, and it comes from the provider rather
 * than from a guess. Anything said since has never been in a request, so only that tail is
 * estimated. Before the first reply there is nothing to measure and the estimate stands alone.
 */
/**
 * What the conversation actually weighs, preferring the provider's own count.
 *
 * Exported because compaction needs the same number this reports. It used to decide on
 * `estimateTokens` alone — characters over 3.5 — which is a guess that runs low on CJK and on
 * dense JSON, and which counts only the messages while the request also carries the system prompt
 * and every tool schema. Between the two, a conversation that had filled its window read as barely
 * two thirds full, so the one mechanism for staying inside the window never ran.
 *
 * `usage.input + cacheRead` is the whole request as the provider measured it, overhead included,
 * so anything after the last settled reply is estimated and added on top.
 */
export function measureTotal(messages: Message[]): { measured: boolean; tokens: number } {
	/*
	 * Nothing measured before the last compaction counts.
	 *
	 * A reply's `usage` records the request that produced it — the conversation as it was at that
	 * moment. Compaction then rewrites that conversation, and the replies kept in the tail carry on
	 * reporting the size of a history that no longer exists. Reading the newest of them gives the
	 * pre-compaction total for a post-compaction conversation.
	 *
	 * That is not merely stale, it is self-sustaining: compaction returns something well inside the
	 * window, the next check reads the old number, decides the window is still full, and compacts
	 * again. Every turn, with a summary request each time, on a conversation that had already been
	 * cut to a third of the limit.
	 *
	 * So a reply older than the newest summary is not evidence about the present. There is no new
	 * measurement to replace it with — nothing has been sent since — and the estimate is what is
	 * left, which is exactly what it is for.
	 */
	const compactedAt = lastCompactionAt(messages);
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant" || message.stopReason === "pending") continue;
		if (compactedAt !== null && message.timestamp < compactedAt) break;
		const total = message.usage.input + message.usage.cacheRead + message.usage.output;
		if (total <= 0) break;
		return { measured: true, tokens: total + estimateTokens(messages.slice(i + 1)) };
	}
	return { measured: false, tokens: estimateTokens(messages) };
}

/**
 * When the conversation was last rewritten by compaction, or null if it never was.
 *
 * Recognised by the summary the head carries. It is written by `runtime/compaction`, is always
 * synthetic, and is the only message in a conversation that is a rewrite of everything before it.
 */
function lastCompactionAt(messages: Message[]): number | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "user" || !message.synthetic) continue;
		const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
		if (text.includes("<session-summary>")) return message.timestamp;
	}
	return null;
}
