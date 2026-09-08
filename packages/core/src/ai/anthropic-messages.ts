/**
 * Anthropic Messages API adapter.
 *
 * Maps the neutral Lyra message model onto `/v1/messages` with `stream: true`,
 * including extended thinking and its signature round-trip.
 */

import { toAnthropicMessages, toAnthropicTools } from "./anthropic-messages-request.ts";
import { sanitizeToolPairing } from "./sanitize-history.ts";
import type {
	AssistantContent,
	AssistantMessage,
	LlmContext,
	ModelConfig,
	Provider,
	ProviderConfig,
	RequestOptions,
	StreamEvent,
	Usage,
} from "../types.ts";
import { addUsage, emptyUsage } from "../types.ts";
import { computeCost } from "../utils/pricing.ts";
import { classifyFailure, FailureError, failureOf, worthRetrying } from "./failure.ts";
import { RetryBudget, fetchWithRetry, retryStream, toolCallId } from "./retry.ts";
import { parseToolArguments, readSse } from "../utils/sse.ts";
import { resolveReasoningEffort } from "./thinking-options.ts";

const THINKING_BUDGET: Record<string, number> = {
	minimal: 1024,
	low: 4096,
	medium: 12288,
	high: 24576,
	xhigh: 49152,
	max: 63999,
	ultra: 63999,
};

export const anthropicMessagesProvider: Provider = {
	api: "anthropic-messages",
	stream: streamAnthropic,
};

async function* streamAnthropic(
	provider: ProviderConfig,
	model: ModelConfig,
	context: LlmContext,
	options: RequestOptions,
): AsyncGenerator<StreamEvent, AssistantMessage> {
	const startTime = Date.now();
	const partial: AssistantMessage = {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: provider.id,
		model: model.modelId,
		usage: emptyUsage(),
		stopReason: "pending",
		timestamp: startTime,
	};

	const effort = resolveReasoningEffort(options.thinking, model);
	const thinkingEnabled = effort !== undefined;
	const maxTokens = options.maxTokens ?? model.maxOutputTokens;
	const budget = effort ? model.thinkingOptions?.find((option) => option.id === effort)?.budgetTokens ?? THINKING_BUDGET[effort] : undefined;
	if (thinkingEnabled && (!Number.isInteger(budget) || budget === undefined || budget < 1024 || maxTokens <= 1024)) {
		throw new Error(`Model ${model.modelId}: thinking level "${effort}" requires budgetTokens >= 1024 and maxOutputTokens > 1024.`);
	}

	const body: Record<string, unknown> = {
		model: model.modelId,
		max_tokens: maxTokens,
		stream: true,
		messages: toAnthropicMessages(sanitizeToolPairing(context.messages)),
		...(context.systemPrompt
			? {
					system: [
						{
							type: "text",
							text: context.systemPrompt,
							// Cache the system prompt: it is identical across every turn of a session.
							cache_control: { type: "ephemeral" },
						},
					],
				}
			: {}),
		...(context.tools.length > 0 ? { tools: toAnthropicTools(context.tools) } : {}),
		...(thinkingEnabled
			? {
					thinking: {
						type: "enabled",
						budget_tokens: budget === undefined ? undefined : Math.min(budget, maxTokens - 1),
					},
				}
			: (options.temperature !== undefined ? { temperature: options.temperature } : {})),
		...model.samplingParams,
		...options.samplingParams,
	};

	options.onPayload?.(body);

	/** Stand-in ids for calls the provider did not name, keyed by block index. */
	const inventedIds = new Map<number, string>();

	const doFetch = options.fetch ?? globalThis.fetch;

	let firstTokenTime: number | null = null;
	const blocks = new Map<
		number,
		{
			kind: "text" | "thinking" | "toolCall";
			contentIndex: number;
			raw: string;
		}
	>();
	let stopReason: string | undefined;
	/** 收到过几个能看懂的事件——用来分辨「模型没话说」和「中转发来一团别的东西」。见空回答那一段。 */
	let framesSeen = 0;
	/** 前几次失败的尝试各自花掉的 token，攒着，最后加进这条消息的用量里。见 `reset`。 */
	let spentOnRetries = emptyUsage();

	const retryBudget = new RetryBudget(options.retryPolicy, options.retryAttempts);
	try {
		// The whole exchange, not just the connection — see the same wrapper in the Responses
		// adapter for why a stream that dies part way through is worth asking for again.
		yield* retryStream(
			async function* attempt() {
				const response = await fetchWithRetry(
					doFetch,
					joinUrl(provider.baseUrl, "/v1/messages"),
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							"x-api-key": provider.apiKey,
							"anthropic-version": "2023-06-01",
							"anthropic-beta": "prompt-caching-2024-07-31",
							...provider.headers,
						},
						body: JSON.stringify(body),
						signal: options.signal,
					},
					{
						budget: retryBudget,
						signal: options.signal,
						onRetry: options.onRetry,
					},
				);

				if (!response.ok) {
					// 带着结论抛：`fetchWithRetry` 已经判过了，上面那层不该拿一个字符串重新猜。
					const detail = await response.text().catch(() => "");
					throw new FailureError(classifyFailure({ from: "status", status: response.status, body: detail }));
				}

				yield { type: "start", partial: { ...partial } } as StreamEvent;

				/** 这次尝试里没能解析的帧，留一份原文，空回答时用来说明收到的到底是什么。 */
				let unparsable = "";
				for await (const frame of readSse(response, options.signal)) {
					let event: Record<string, any>;
					try {
						event = JSON.parse(frame.data);
					} catch {
						if (!unparsable) unparsable = frame.data.slice(0, 500);
						continue;
					}
					framesSeen += 1;

					switch (event.type) {
						case "message_start": {
							applyUsage(partial.usage, event.message?.usage);
							break;
						}

						case "content_block_start": {
							const idx: number = event.index;
							const block = event.content_block ?? {};
							if (block.type === "text") {
								partial.content.push({ type: "text", text: "" });
								blocks.set(idx, {
									kind: "text",
									contentIndex: partial.content.length - 1,
									raw: "",
								});
								yield { type: "text_start", index: idx };
							} else if (block.type === "thinking" || block.type === "redacted_thinking") {
								partial.content.push({
									type: "thinking",
									thinking: "",
									redacted: block.type === "redacted_thinking" || undefined,
									encrypted: typeof block.data === "string" ? block.data : undefined,
								});
								blocks.set(idx, {
									kind: "thinking",
									contentIndex: partial.content.length - 1,
									raw: "",
								});
								yield { type: "thinking_start", index: idx };
							} else if (block.type === "tool_use") {
								partial.content.push({
									type: "toolCall",
									id: toolCallId(block.id, idx, inventedIds),
									name: String(block.name ?? ""),
									arguments: {},
									argumentsText: "",
								});
								blocks.set(idx, {
									kind: "toolCall",
									contentIndex: partial.content.length - 1,
									raw: "",
								});
								yield {
									type: "toolcall_start",
									index: idx,
									id: toolCallId(block.id, idx, inventedIds),
									name: String(block.name ?? ""),
								};
							}
							break;
						}

						case "content_block_delta": {
							if (firstTokenTime === null) firstTokenTime = Date.now();
							const idx: number = event.index;
							const tracked = blocks.get(idx);
							if (!tracked) break;
							const delta = event.delta ?? {};
							const target = partial.content[tracked.contentIndex];

							if (delta.type === "text_delta" && target?.type === "text") {
								target.text += delta.text ?? "";
								yield {
									type: "text_delta",
									index: idx,
									delta: delta.text ?? "",
									partial: { ...partial },
								};
							} else if (delta.type === "thinking_delta" && target?.type === "thinking") {
								target.thinking += delta.thinking ?? "";
								yield {
									type: "thinking_delta",
									index: idx,
									delta: delta.thinking ?? "",
									partial: { ...partial },
								};
							} else if (delta.type === "signature_delta" && target?.type === "thinking") {
								target.signature = (target.signature ?? "") + (delta.signature ?? "");
							} else if (delta.type === "input_json_delta" && target?.type === "toolCall") {
								tracked.raw += delta.partial_json ?? "";
								target.argumentsText = tracked.raw;
								yield {
									type: "toolcall_delta",
									index: idx,
									delta: delta.partial_json ?? "",
									partial: { ...partial },
								};
							}
							break;
						}

						case "content_block_stop": {
							const idx: number = event.index;
							const tracked = blocks.get(idx);
							if (!tracked) break;
							if (tracked.kind === "toolCall") {
								const target = partial.content[tracked.contentIndex];
								if (target?.type === "toolCall") {
									target.arguments = parseToolArguments(tracked.raw) ?? {};
								}
								yield {
									type: "toolcall_end",
									index: idx,
									partial: { ...partial },
								};
							} else if (tracked.kind === "text") {
								yield { type: "text_end", index: idx };
							} else {
								yield { type: "thinking_end", index: idx };
							}
							break;
						}

						case "message_delta": {
							applyUsage(partial.usage, event.usage);
							if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
							break;
						}

						case "error": {
							/*
							 * 抛出去，由分类器决定，而不是当场放弃。
							 *
							 * 和 Responses 适配器里那一处是同一个毛病、同一个修法：中转把上游的临时
							 * 故障塞进这个事件，从前一律按「服务商本人拒绝」处理，绕过全部三层重试。
							 */
							const said = event.error?.message;
							throw new FailureError(
								classifyFailure({
									from: "stream",
									message: typeof said === "string" ? said : undefined,
									raw: JSON.stringify(event).slice(0, 4000),
									spent: partial.usage.output > 0 || partial.content.length > 0,
								}),
							);
						}
					}
				}

				// 空回答也是失败，不是「模型没话说」——见 Responses 适配器里同一段的说明。
				if (partial.content.length === 0) {
					throw new FailureError(
						classifyFailure({
							from: "empty",
							why: unparsable ? "unparsable" : framesSeen === 0 ? "no-frames" : "no-content",
							body: unparsable || undefined,
						}),
					);
				}
			},
			{
				budget: retryBudget,
				signal: options.signal,
				onRetry: options.onRetry,
				reset: () => {
					// 已经花掉的 token 不清零，见 Responses 适配器里同一段。
					spentOnRetries = addUsage(spentOnRetries, partial.usage);
					partial.content = [];
					partial.usage = emptyUsage();
					blocks.clear();
					stopReason = undefined;
					framesSeen = 0;
					firstTokenTime = null;
				},
			},
		);
	} catch (error) {
		const aborted = options.signal?.aborted;
		const failure = aborted ? undefined : failureOf(error);
		partial.stopReason = aborted ? "aborted" : "error";
		partial.errorMessage = aborted ? "Aborted by user" : (failure?.summary ?? describeFetchError(error, options.signal));
		// Recorded here because here is the last place it is knowable; see `errorRetryable`.
		partial.errorRetryable = failure ? worthRetrying(failure) : false;
		partial.failure = failure;
		partial.usage = addUsage(partial.usage, spentOnRetries);
		partial.usage = computeCost(partial.usage, model);
		partial.durationMs = Math.max(1, Date.now() - startTime);
		if (firstTokenTime !== null) {
			partial.sseDurationMs = Math.max(1, Date.now() - firstTokenTime);
		}
		yield {
			type: "error",
			error: partial.errorMessage,
			message: { ...partial },
		};
		return partial;
	}

	partial.durationMs = Math.max(1, Date.now() - startTime);
	if (firstTokenTime !== null) {
		partial.sseDurationMs = Math.max(1, Date.now() - firstTokenTime);
	}
	partial.stopReason = mapStopReason(stopReason, partial.content);
	partial.usage.total = partial.usage.input + partial.usage.output + partial.usage.cacheRead + partial.usage.cacheWrite;
	// 成功了，但失败的那几次也是花过钱的——账上要有。
	partial.usage = addUsage(partial.usage, spentOnRetries);
	partial.usage = computeCost(partial.usage, model);
	yield { type: "done", message: { ...partial } };
	return partial;
}

function mapStopReason(raw: string | undefined, content: AssistantContent[]): AssistantMessage["stopReason"] {
	if (raw === "max_tokens") return "length";
	if (raw === "tool_use") return "toolUse";
	if (content.some((c) => c.type === "toolCall")) return "toolUse";
	return "stop";
}

function applyUsage(usage: Usage, raw: Record<string, any> | undefined): void {
	if (!raw) return;
	if (typeof raw.input_tokens === "number") usage.input = raw.input_tokens;
	if (typeof raw.output_tokens === "number") usage.output = raw.output_tokens;
	if (typeof raw.cache_read_input_tokens === "number") usage.cacheRead = raw.cache_read_input_tokens;
	if (typeof raw.cache_creation_input_tokens === "number") usage.cacheWrite = raw.cache_creation_input_tokens;
}

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

export function joinUrl(base: string, path: string): string {
	const trimmedBase = base.replace(/\/+$/, "");
	// A base URL that already ends in the version segment must not get a second one.
	if (trimmedBase.endsWith("/v1") && path.startsWith("/v1/")) return trimmedBase + path.slice(3);
	return trimmedBase + path;
}

export function describeFetchError(error: unknown, signal?: AbortSignal): string {
	if (signal?.aborted) return "Aborted by user";
	if (error instanceof Error) {
		const cause = (error as { cause?: { code?: string } }).cause;
		if (cause?.code) return `${error.message} (${cause.code})`;
		return error.message;
	}
	return String(error);
}

export function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more chars)`;
}
