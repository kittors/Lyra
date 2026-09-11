/**
 * The neutral message shape, and what a reply costs.
 *
 * One shape flows through the whole system. Provider adapters translate it into their wire format
 * on the way out and back on the way in, so the agent loop, the session store, the desktop UI and
 * the mobile app never see provider-specific JSON.
 */

// A reply records which wire format produced it, so it can be replayed to the right adapter.
import type { ApiFormat } from "./provider.ts";
import type { Failure } from "../ai/failure.ts";

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
	/**
	 * 入站时这段推理挂在哪个键上——原样记下，下一轮用同一个键还回去。
	 *
	 * Chat Completions 上同一件事有三个字段名：`reasoning_content`（DeepSeek、llama.cpp）、`reasoning`
	 * （OpenRouter）、`reasoning_text`。证据是 oh-my-pi 三个都读、取第一个非空
	 * （`packages/ai/src/providers/openai-completions.ts:1206-1217`），并把命中的那个字段名一路带到回发
	 * 时用（同文件 `:1219-1224`）。一个只认自己那个键的端点，收到另一个键就当没收到。
	 *
	 * 只有 Chat Completions 这一条链写和读它；缺省（旧会话、Anthropic 和 Responses 产生的块）一律按
	 * `reasoning_content` 处理，也就是这条链从前唯一发过的那个键——所以加这个字段不改变任何既有语义。
	 */
	reasoningField?: string;
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
		/** How these dollar values were obtained. Absent on logs written before this field existed. */
		source?: "manual" | "catalog" | "provider" | "mixed";
		catalogVersion?: string;
		/** The selected rates are stored so later catalogue updates cannot rewrite history. */
		rates?: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
		};
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

function isEmptyUsage(usage: Usage): boolean {
	return usage.input === 0 && usage.output === 0 && usage.cacheRead === 0 &&
		usage.cacheWrite === 0 && (usage.reasoning ?? 0) === 0 && usage.total === 0 &&
		usage.cost.input === 0 && usage.cost.output === 0 && usage.cost.cacheRead === 0 &&
		usage.cost.cacheWrite === 0 && usage.cost.total === 0;
}

export function addUsage(a: Usage, b: Usage): Usage {
	// Empty accumulators contribute no pricing provenance; every billed request does.
	const first = isEmptyUsage(a) ? b.cost : a.cost;
	const second = isEmptyUsage(b) ? a.cost : b.cost;
	const source = first.source === second.source ? first.source : "mixed";
	const catalogVersion = first.catalogVersion === second.catalogVersion ? first.catalogVersion : undefined;
	const sameRates =
		first.rates !== undefined &&
		second.rates !== undefined &&
		first.rates.input === second.rates.input &&
		first.rates.output === second.rates.output &&
		first.rates.cacheRead === second.rates.cacheRead &&
		first.rates.cacheWrite === second.rates.cacheWrite;
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
			...(source !== undefined ? { source } : {}),
			...(catalogVersion !== undefined ? { catalogVersion } : {}),
			...(sameRates ? { rates: first.rates } : {}),
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
	/** Clean user input text for UI display, excluding injected skill or session instructions. */
	displayText?: string;
	/** Skill triggered by this prompt, along with its filesystem path for viewing. */
	skillRef?: {
		name: string;
		path?: string;
		pluginId?: string;
	};
	/** Historical sessions referenced by @ in this prompt. */
	sessionRefs?: Array<{
		id: string;
		title: string;
	}>;
	/**
	 * The files that were attached, by name and kind — never their contents.
	 *
	 * A text attachment's body is expanded into the prompt, which is what the model needs and the
	 * last thing a reader wants to scroll past: a thousand-line document arrived as a thousand lines
	 * inside the message bubble, and getting back above it was a chore. `displayText` keeps the
	 * bubble to what was actually typed, and this is what lets it still say which files went with it.
	 *
	 * Metadata only, deliberately. The contents are already in `content`; a second copy here would
	 * double the size of every session log for something no reader ever looks at.
	 */
	attachments?: Array<{
		name: string;
		/** `fileKind` on the desktop side — image, document, archive, text. Purely for the icon. */
		kind?: string;
		mimeType?: string;
	}>;
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
	/**
	 * 这次失败是什么——分类的结果，不是一串给人猜的字符串。
	 *
	 * `errorMessage` 留着是为了读得懂旧会话，但它把一次失败压成了一行字，之后每个想知道「这该不该
	 * 重试」「这句话该怎么说给人听」「有没有下一步可给」的地方，都只能对着那行字做模式匹配。结论
	 * 在 `failure.ts` 里只产生一次，然后一路带着走。
	 */
	failure?: Failure;
	/** Provider response id, used for Responses-API conversation chaining. */
	responseId?: string;
	/** Latency in milliseconds from request start to completion */
	durationMs?: number;
	/** Latency in milliseconds of actual streaming token generation (from first token chunk to completion) */
	sseDurationMs?: number;
	timestamp: number;
}

export interface ToolResultMessage {
	/** Actual execution boundary; absent in historical messages. */
	startedAt?: number;
	durationMs?: number;
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: UserContent[];
	/** Structured payload for rich UI rendering; never sent to the model. */
	details?: unknown;
	isError: boolean;
	/** See `ToolResult.uneventful`. Carried on the message so compaction can see it. */
	uneventful?: boolean;
	timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;
