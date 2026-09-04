/**
 * The neutral message shape, and what a reply costs.
 *
 * One shape flows through the whole system. Provider adapters translate it into their wire format
 * on the way out and back on the way in, so the agent loop, the session store, the desktop UI and
 * the mobile app never see provider-specific JSON.
 */

// A reply records which wire format produced it, so it can be replayed to the right adapter.
import type { ApiFormat } from "./provider.ts";

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

export interface TextContent {
	type: "text";
	text: string;
	/** Opaque provider handle (Responses item id, etc.) needed to replay this block. */
	signature?: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	/** Opaque provider handle: Anthropic thinking signature or Responses reasoning item id. */
	signature?: string;
	/** Provider-encrypted reasoning payload, replayed verbatim on the next turn. */
	encrypted?: string;
	/** Safety filters removed the visible text but the encrypted payload is still replayable. */
	redacted?: boolean;
}

export interface ImageContent {
	type: "image";
	/** base64, no data: prefix */
	data: string;
	mimeType: string;
}

export interface ToolCallContent {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	/** Raw argument text as streamed; kept for salvage when JSON is truncated. */
	argumentsText?: string;
	/** Provider item id (Responses `item.id`), distinct from the `call_id` in `id`. */
	signature?: string;
}

export type AssistantContent = TextContent | ThinkingContent | ToolCallContent;
export type UserContent = TextContent | ImageContent;

// ---------------------------------------------------------------------------
// Usage & stop reasons
// ---------------------------------------------------------------------------

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
	total: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function addUsage(a: Usage, b: Usage): Usage {
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		cacheRead: a.cacheRead + b.cacheRead,
		cacheWrite: a.cacheWrite + b.cacheWrite,
		reasoning: (a.reasoning ?? 0) + (b.reasoning ?? 0),
		total: a.total + b.total,
		cost: {
			input: a.cost.input + b.cost.input,
			output: a.cost.output + b.cost.output,
			cacheRead: a.cost.cacheRead + b.cost.cacheRead,
			cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
			total: a.cost.total + b.cost.total,
		},
	};
}

export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted";

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface UserMessage {
	role: "user";
	content: UserContent[];
	timestamp: number;
	/** Set when the message was injected by the runtime rather than typed by a human. */
	synthetic?: boolean;
	/**
	 * Who sent this, when it was not the person looking at the transcript.
	 *
	 * A task dispatched from the side chat lands in the main conversation as an ordinary user
	 * message. Without this you would scroll back and find an instruction you have no memory
	 * of writing, in your own voice, with no way to tell where it came from.
	 */
	origin?: "side-chat";
	/**
	 * What a rule matched, when this message is a rule correction.
	 *
	 * Carried as data rather than left for the renderer to pull out of the injected text. The text
	 * is written for the model and is deliberately blunt XML; a UI that parsed it would break the
	 * next time that wording is improved, and every consumer would have to parse it separately.
	 *
	 * Without this the correction is invisible: synthetic messages render as nothing, so a rule
	 * that stopped the model mid-sentence shows up as the model simply having said something
	 * different — which is the one thing a person needs explained.
	 */
	ruleMatch?: {
		/** One entry per rule that fired on the same stream position. */
		rules: { name: string; path: string; excerpt: string; source: string; toolName?: string }[];
		/** False when the turn was allowed to finish and this rode the next one. */
		interrupted: boolean;
	};
}

export interface AssistantMessage {
	role: "assistant";
	content: AssistantContent[];
	api: ApiFormat;
	provider: string;
	model: string;
	usage: Usage;
	stopReason: StopReason;
	errorMessage?: string;
	/**
	 * Whether what ended this was the connection rather than the request.
	 *
	 * A dropped socket and a rejected API key both arrive as `stopReason: "error"`, and only one of
	 * them is worth going back for. Which it was is known exactly once — where the error is caught,
	 * with the cause still attached — and by the time it has been flattened into a message string
	 * telling them apart is pattern-matching on prose. So it is written down while it is still a
	 * fact.
	 */
	errorRetryable?: boolean;
	/** Provider response id, used for Responses-API conversation chaining. */
	responseId?: string;
	/** Latency in milliseconds from request start to completion */
	durationMs?: number;
	/** Latency in milliseconds of actual streaming token generation (from first token chunk to completion) */
	sseDurationMs?: number;
	timestamp: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: UserContent[];
	/** Structured payload for rich UI rendering; never sent to the model. */
	details?: unknown;
	isError: boolean;
	timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;
