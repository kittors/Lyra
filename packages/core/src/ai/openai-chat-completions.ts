/**
 * OpenAI Chat Completions API adapter (`POST /v1/chat/completions`).
 */

import { toChatCompletionsMessages, toChatCompletionsTools } from "./openai-chat-completions-request.ts";
import { sanitizeToolPairing } from "./sanitize-history.ts";
import type {
	AssistantMessage,
	LlmContext,
	ModelConfig,
	Provider,
	ProviderConfig,
	RequestOptions,
	StreamEvent,
	ToolCallContent,
} from "../types.ts";
import { addUsage, emptyUsage } from "../types.ts";
import { computeCost } from "../utils/pricing.ts";
import { classifyFailure, FailureError, failureOf, worthRetrying } from "./failure.ts";
import { RetryBudget, fetchWithRetry, retryStream, toolCallId } from "./retry.ts";
import { parseToolArguments, readSse } from "../utils/sse.ts";
import { describeFetchError, joinUrl } from "./anthropic-messages.ts";
import { resolveReasoningEffort } from "./thinking-options.ts";

export const openaiChatCompletionsProvider: Provider = {
	api: "openai-chat-completions",
	stream: streamChatCompletions,
};

async function* streamChatCompletions(
	provider: ProviderConfig,
	model: ModelConfig,
	context: LlmContext,
	options: RequestOptions,
): AsyncGenerator<StreamEvent, AssistantMessage> {
	const startTime = Date.now();
	const partial: AssistantMessage = {
		role: "assistant",
		content: [],
		api: "openai-chat-completions",
		provider: provider.id,
		model: model.modelId,
		usage: emptyUsage(),
		stopReason: "pending",
		timestamp: startTime,
	};

	const reasoningEffort = resolveReasoningEffort(options.thinking, model);
	const thinkingEnabled = reasoningEffort !== undefined;

	const body: Record<string, unknown> = {
		model: model.modelId,
		messages: toChatCompletionsMessages(context.systemPrompt ?? "", sanitizeToolPairing(context.messages)),
		stream: true,
		stream_options: { include_usage: true },
		max_tokens: options.maxTokens ?? model.maxOutputTokens,
		...(context.tools.length > 0 ? { tools: toChatCompletionsTools(context.tools), tool_choice: "auto" } : {}),
		...(model.supportsThinking && thinkingEnabled && reasoningEffort
			? {
					reasoning_effort: reasoningEffort,
				}
			: {}),
		...(options.temperature !== undefined && !thinkingEnabled ? { temperature: options.temperature } : {}),
		...model.samplingParams,
		...options.samplingParams,
	};

	options.onPayload?.(body);

	const doFetch = options.fetch ?? globalThis.fetch;
	let firstTokenTime: number | null = null;
	const inventedIds = new Map<number, string>();
	/** 收到过几个能看懂的事件——用来分辨「模型没话说」和「中转发来一团别的东西」。 */
	let framesSeen = 0;
	/** 前几次失败的尝试各自花掉的 token，攒着，最后加进这条消息的用量里。见 `reset`。 */
	let spentOnRetries = emptyUsage();

	const retryBudget = new RetryBudget(options.retryPolicy, options.retryAttempts);
	try {
		yield* retryStream(
			async function* attempt() {
				const response = await fetchWithRetry(
					doFetch,
					joinUrl(provider.baseUrl, "/chat/completions"),
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							authorization: `Bearer ${provider.apiKey}`,
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

				let currentTextIndex = -1;
				let currentThinkingIndex = -1;
				/** 这次尝试里没能解析的帧，留一份原文，空回答时用来说明收到的到底是什么。 */
				let unparsable = "";

				for await (const frame of readSse(response, options.signal)) {
					if (frame.data === "[DONE]") break;
					let event: Record<string, any>;
					try {
						event = JSON.parse(frame.data);
					} catch {
						if (!unparsable) unparsable = frame.data.slice(0, 500);
						continue;
					}
					framesSeen += 1;

					/*
					 * 错误也可能写在帧里，而不是状态码上。
					 *
					 * 这个适配器面对的多半是中转，而中转最爱的一种答法就是 200 加一个 `{"error":{…}}`
					 * 帧。从前没有任何一处认这种形状：`choices` 是空的，于是 `continue`，流结束时留下
					 * 一条空回答——不报错，不重试，屏幕上什么都没有。
					 */
					if (event.error && !event.choices) {
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

					if (event.usage) {
						partial.usage.input = event.usage.prompt_tokens ?? 0;
						partial.usage.output = event.usage.completion_tokens ?? 0;
						partial.usage.cacheRead = event.usage.prompt_tokens_details?.cached_tokens ?? 0;
						// OpenAI-compatible APIs report cached tokens inside prompt_tokens. Keep the
						// buckets disjoint or both the usage page and the price calculator count them twice.
						partial.usage.input = Math.max(0, partial.usage.input - partial.usage.cacheRead);
						partial.usage.cacheWrite = 0;
						if (typeof event.usage.completion_tokens_details?.reasoning_tokens === "number") {
							partial.usage.reasoning = event.usage.completion_tokens_details.reasoning_tokens;
						}
						partial.usage.total = partial.usage.input + partial.usage.output + partial.usage.cacheRead + partial.usage.cacheWrite;
						partial.usage = computeCost(partial.usage, model);
					}

					const choice = event.choices?.[0];
					if (!choice) continue;

					const delta = choice.delta;
					if (delta) {
						if (delta.content || delta.reasoning_content || delta.tool_calls) {
							if (firstTokenTime === null) firstTokenTime = Date.now();
						}
						// Handle reasoning_content if emitted (e.g. DeepSeek/Ollama/relay APIs)
						if (delta.reasoning_content) {
							if (currentThinkingIndex === -1) {
								currentThinkingIndex = partial.content.length;
								partial.content.push({ type: "thinking", thinking: "" });
								yield { type: "thinking_start", index: currentThinkingIndex };
							}
							const thinkingBlock = partial.content[currentThinkingIndex];
							if (thinkingBlock && thinkingBlock.type === "thinking") {
								thinkingBlock.thinking += delta.reasoning_content;
								yield {
									type: "thinking_delta",
									index: currentThinkingIndex,
									delta: delta.reasoning_content,
									partial: { ...partial },
								};
							}
						}

						if (delta.content) {
							if (currentThinkingIndex !== -1) {
								yield { type: "thinking_end", index: currentThinkingIndex };
								currentThinkingIndex = -1;
							}
							if (currentTextIndex === -1) {
								currentTextIndex = partial.content.length;
								partial.content.push({ type: "text", text: "" });
								yield { type: "text_start", index: currentTextIndex };
							}
							const textBlock = partial.content[currentTextIndex];
							if (textBlock && textBlock.type === "text") {
								textBlock.text += delta.content;
								yield {
									type: "text_delta",
									index: currentTextIndex,
									delta: delta.content,
									partial: { ...partial },
								};
							}
						}

						if (delta.tool_calls) {
							if (currentThinkingIndex !== -1) {
								yield { type: "thinking_end", index: currentThinkingIndex };
								currentThinkingIndex = -1;
							}
							if (currentTextIndex !== -1) {
								yield { type: "text_end", index: currentTextIndex };
								currentTextIndex = -1;
							}

							for (const tc of delta.tool_calls) {
								const tcIndex = tc.index ?? 0;
								let block = partial.content.find(
									(c): c is ToolCallContent => c.type === "toolCall" && (c as any)._tcIndex === tcIndex,
								);

								if (!block) {
									const id = toolCallId(tc.id, tcIndex, inventedIds);
									const name = tc.function?.name || "";
									const toolCallIndex = partial.content.length;
									const newBlock: ToolCallContent = {
										type: "toolCall",
										id,
										name,
										arguments: {},
										argumentsText: "",
										...({ _tcIndex: tcIndex } as any),
									};
									partial.content.push(newBlock);
									block = newBlock;
									yield { type: "toolcall_start", index: toolCallIndex, id, name };
								}

								if (tc.function?.name && !block.name) {
									block.name = tc.function.name;
								}

								if (tc.function?.arguments) {
									block.argumentsText = (block.argumentsText || "") + tc.function.arguments;
									const blockIndex = partial.content.indexOf(block);
									yield {
										type: "toolcall_delta",
										index: blockIndex >= 0 ? blockIndex : tcIndex,
										delta: tc.function.arguments,
										partial: { ...partial },
									};
								}
							}
						}
					}

					if (choice.finish_reason) {
						if (choice.finish_reason === "stop") {
							partial.stopReason = "stop";
						} else if (choice.finish_reason === "tool_calls") {
							partial.stopReason = "toolUse";
						} else if (choice.finish_reason === "length") {
							partial.stopReason = "length";
						}
					}
				}

				if (currentThinkingIndex !== -1) {
					yield { type: "thinking_end", index: currentThinkingIndex };
				}
				if (currentTextIndex !== -1) {
					yield { type: "text_end", index: currentTextIndex };
				}

				// Parse JSON args for all tool calls
				for (let i = 0; i < partial.content.length; i++) {
					const c = partial.content[i];
					if (c.type === "toolCall") {
						c.arguments = parseToolArguments(c.argumentsText || "{}") ?? {};
						delete (c as any)._tcIndex;
						yield { type: "toolcall_end", index: i, partial: { ...partial } };
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
					inventedIds.clear();
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
	if (partial.stopReason === "pending") {
		const hasToolCalls = partial.content.some((c) => c.type === "toolCall");
		partial.stopReason = hasToolCalls ? "toolUse" : "stop";
	}
	// 成功了，但失败的那几次也是花过钱的——账上要有。
	partial.usage = computeCost(addUsage(partial.usage, spentOnRetries), model);

	yield { type: "done", message: partial };
	return partial;
}
