/**
 * Anthropic Messages API adapter.
 *
 * Maps the neutral Lyra message model onto `/v1/messages` with `stream: true`,
 * including extended thinking and its signature round-trip.
 */

import { toAnthropicMessages, toAnthropicTools, type ThinkingReplay } from "./anthropic-messages-request.ts";
import { sanitizeToolPairing } from "./sanitize-history.ts";
import { withReasoningRetry } from "./reasoning-compat.ts";
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
import { parseToolArguments, readSse, type SseFrame } from "../utils/sse.ts";
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

// ---------------------------------------------------------------------------
// 无签名思考块：这个端点接哪一档
// ---------------------------------------------------------------------------

/*
 * 「思考块回放时要不要带一个能验的签名」这件事，各家的答案互相矛盾——所以是一个问出来记住的轴，不是
 * 一个常量。
 *
 *   - 官方 `api.anthropic.com` 会**验签**。签不上的（换过模型、被剥过句柄、流断在半路）送过去就是
 *     `400 Invalid \`signature\` in \`thinking\` block`。它要的是「只发带签名的」。
 *   - DeepSeek / Z.AI / Moonshot 的 Anthropic 兼容端点**不签名**，但推理模型要求把推理带回来。它们
 *     要的是「连没签名的也发，signature 给空串」。
 *
 * 默认值按端点算：认得出来的签名端点上保持「只发带签名的」——那也正是这条链一直以来的行为，所以官方
 * 端点上什么都没变。别的端点上，推理模型默认回放（跟着 oh-my-pi `resolve.ts:861` 的同一条规则：
 * `!signingEndpoint && Boolean(spec.reasoning)`）。
 *
 * 撞了就往下走一格：`unsigned → signed-only → none`。往下走是安全方向——少发一点推理最多让模型接不回
 * 自己那条思维链，多发一格是整个请求被拒。
 *
 * 记在内存里，不落盘，理由和 `reasoning-compat.ts` 里那一段一样。
 */

/** 学到的结论：`${providerId} ${modelId}` → 无签名思考块该怎么发。 */
const learnedThinkingReplay = new Map<string, ThinkingReplay>();
/** 梯子，从发得最多到发得最少。 */
const THINKING_LADDER: ThinkingReplay[] = ["unsigned", "signed-only", "none"];

const replayKey = (providerId: string, modelId: string) => `${providerId} ${modelId}`;

const OFFICIAL_ANTHROPIC = "https://api.anthropic.com";

/**
 * 这个地址上的端点会验思考签名吗。
 *
 * 官方那条必须**精确**匹配 origin 或者后面紧跟一个 `/`——前缀匹配会把
 * `https://api.anthropic.com.evil.com` 当成官方。空地址按官方算：那是配置没填好，而按官方算等于保持
 * 现状，是两个方向里安全的那个。
 *
 * 其余几个是把 Claude 转在自己身份后面、但照样执行 Anthropic 签名协议的网关（出处：oh-my-pi
 * `catalog/src/compat/anthropic.ts:25-48`，它把这几条正则和这个判断放在一起）。
 */
export function signsThinkingSignatures(baseUrl: string | undefined): boolean {
	if (!baseUrl) return true;
	const lower = baseUrl.toLowerCase();
	if (lower === OFFICIAL_ANTHROPIC || lower.startsWith(`${OFFICIAL_ANTHROPIC}/`)) return true;
	return SIGNING_GATEWAYS.some((pattern) => pattern.test(lower));
}

const SIGNING_GATEWAYS = [
	/gateway\.ai\.cloudflare\.com\/.+\/anthropic(?:\/|$)/i,
	/aiplatform\.googleapis\.com\/.+\/publishers\/anthropic\//i,
	/(?:^|\/\/|\.)bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com/i,
	/(?:^|\/\/|\.)[a-z0-9-]+\.(?:inference|services)\.ai\.azure\.com/i,
];

/** 没撞过之前该发哪一档。 */
function defaultThinkingReplay(provider: ProviderConfig, model: ModelConfig): ThinkingReplay {
	if (signsThinkingSignatures(provider.baseUrl)) return "signed-only";
	// 不推理的模型手上没有思考块可发，这一档发什么都一样——留在保守的那一格。
	return model.supportsThinking ? "unsigned" : "signed-only";
}

/** 这个模型现在该发哪一档。 */
export function thinkingReplay(provider: ProviderConfig, model: ModelConfig): ThinkingReplay {
	return learnedThinkingReplay.get(replayKey(provider.id, model.id)) ?? defaultThinkingReplay(provider, model);
}

/**
 * 「你这个签名我不认」的两种说法——往下走一格。返回「结论变了，值得换个形状重发」。
 *
 * 两条都来自 oh-my-pi `anthropic.ts:1862-1863`，它注明了各自的出处：第一条是官方 Anthropic 和挡在它
 * 前面的中转的原话（`400 Invalid \`signature\` in \`thinking\` block`）；第二条是 Bedrock 系中转的
 * ——空串在它那边先过不了 schema 校验，于是报成
 * `messages.N.content.M.thinking.signature: Field required`。
 *
 * `[^"\n]{0,32}` 这一段是刻意收紧的：这样它只匹配同一条错误信息里紧挨着的那句，不会跨过一个引号或者
 * 换行去捞另一件事的 `required`。
 *
 * 只认这两条。多认一条的代价是把别的原因造成的 400 误判成签名问题，然后拿一个改坏了的请求去重发。
 */
export function learnThinkingReplay(providerId: string, modelId: string, error: string, from: ThinkingReplay = "unsigned"): boolean {
	if (!INVALID_THINKING_SIGNATURE.test(error) && !MISSING_THINKING_SIGNATURE.test(error)) return false;
	const id = replayKey(providerId, modelId);
	const now = learnedThinkingReplay.get(id) ?? from;
	const next = THINKING_LADDER[THINKING_LADDER.indexOf(now) + 1];
	if (!next) return false;
	learnedThinkingReplay.set(id, next);
	return true;
}

const INVALID_THINKING_SIGNATURE = /invalid\s+`?signature`?\s+in\s+`?thinking`?(?:\s+block)?/i;
const MISSING_THINKING_SIGNATURE = /thinking\.signature\b[^"\n]{0,32}\brequired\b/i;

/** 测试用：把学到的都忘掉。 */
export function resetThinkingReplay(): void {
	learnedThinkingReplay.clear();
}

/**
 * 开着思考时发不出去的采样参数。
 *
 * `options.temperature` 本来就被挡在思考关闭那条分支里，但紧接着两个 `...samplingParams` 又把它放了
 * 回来——用户在模型上配一个 `samplingParams: {temperature: 0.3}` 再开思考，每一轮都 400。
 *
 * 只摘这三个键，而不是像 oh-my-pi（`anthropic.ts:4088-4095`）那样整个 `samplingParams` 都不发：Lyra
 * 的 `samplingParams` 是个「原样合并进请求体」的口子（`types/provider.ts:79`），里面放的不一定是采样
 * 参数，整块扣掉会顺手扣掉别的东西，而没有证据说别的键在开思考时发不出去。
 *
 * 证据：Opus 4.7 起这三个键**无论思考开不开**都是 400（官方迁移文档：`The temperature, top_p, and
 * top_k parameters are no longer accepted on Claude Opus 4.7`），所以摘掉它们只会少 400 不会多。至于
 * 「更早的模型上开了思考就不能改温度」这一条，官方文档里没找到现行原文（**推断**，与 oh-my-pi 的同
 * 一条判断一致，也与这个文件原本就有的 `:87-94` 那段判断一致）。
 */
const THINKING_FORBIDS_SAMPLING = ["temperature", "top_p", "top_k"];

/**
 * 一条流安静多久算它已经死了。
 *
 * `readSse` 只认 AbortSignal，没有计时器：上游把连接挂住不再发帧时，那个 `await reader.read()` 就一直
 * 等下去，界面上是一个永远转着的圈，用户只能按停。
 *
 * 十分钟，不是一个延迟指标而是一个死锁闸：Anthropic 在生成期间会周期性地发 `ping` 帧，兼容端点多数
 * 也会，任何一帧都把计时重新拨回去。所以走到这个阈值意味着**一帧都没有**，那不是「在想」。
 *
 * 数字跟 oh-my-pi 给推理流留的 `BEDROCK_REASONING_STREAM_IDLE_TIMEOUT_MS = 600_000` 一致。
 */
const STREAM_IDLE_TIMEOUT_MS = 600_000;

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

	/*
	 * 每次尝试重新编一遍，因为**形状可能在两次之间变掉**：无签名的思考块该怎么发是撞出来的，不是配出
	 * 来的（见上面 `thinkingReplay`）。被顶回来的那一次会记下结论、换一档重发，所以这里必须能重新编
	 * 一份，而不是把第一次编好的那份原样再发一遍。
	 */
	const buildBody = (replay: ThinkingReplay): Record<string, unknown> => ({
		model: model.modelId,
		max_tokens: maxTokens,
		stream: true,
		messages: toAnthropicMessages(sanitizeToolPairing(context.messages), {
			thinkingReplay: replay,
			supportsImages: model.supportsImages,
			// 四个断点：system 一个、工具列表一个，剩下两个在消息尾部滚动。
			cacheBreakpoints: 2,
		}),
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
			: {}),
		...samplingFor(thinkingEnabled, model, options),
	});

	let body = buildBody(thinkingReplay(provider, model));

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
		/*
		 * 两层重试，管的是两件不同的事。
		 *
		 * 外层（`withReasoningRetry`）重发的是一个**不同的**请求：端点说「你这个签名我不认」，我们换一档
		 * 再来。它必须套在外面，因为 `retryStream` 按定义不会重试一个 400——同一个请求再发一遍还是同一个
		 * 400，它拒绝得对。
		 *
		 * 这条链从前根本没接自愈：`withReasoningRetry` 只套在两条 OpenAI 链上，所以 Anthropic 这边一旦
		 * 撞上形状问题就是死路。`learnThinkingReplay` 作为 `alsoLearn` 排在推理那条梯子前面看——指向明
		 * 确的轴先看，误判的机会小得多（见 `reasoning-compat.ts` 里 `alsoLearn` 那段说明）。
		 */
		yield* withReasoningRetry(
			provider.id,
			model.id,
			() => {
				// 已经花掉的 token 不清零，见下面 `retryStream` 的 `reset`。
				spentOnRetries = addUsage(spentOnRetries, partial.usage);
				partial.content = [];
				partial.usage = emptyUsage();
				blocks.clear();
				inventedIds.clear();
				stopReason = undefined;
				framesSeen = 0;
				firstTokenTime = null;
			},
			(providerId, modelId, said) => learnThinkingReplay(providerId, modelId, said, defaultThinkingReplay(provider, model)),
			async function* () {
				body = buildBody(thinkingReplay(provider, model));
				options.onPayload?.(body);
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
				/** 这条流被空闲闸掉了吗。见 `readSseWithIdleTimeout`。 */
				const idle = { tripped: false };
				for await (const frame of readSseWithIdleTimeout(response, options.signal, STREAM_IDLE_TIMEOUT_MS, idle)) {
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

				/*
				 * 被空闲闸掉的，按连接问题抛，不按「空回答」。
				 *
				 * 分类成 `network`（`from: "transport"` 认不出名字时的兜底）是因为它就是连接问题，而且那
				 * 一类是可重试的——下面那层会 `reset()` 清掉半截内容再要一遍，这正是一条挂死的流该得到的
				 * 待遇。放在空回答检查**之前**：挂死时内容常常正好是空的，让空回答那条先认领会把原因说错。
				 */
				if (idle.tripped) {
					throw new FailureError(
						classifyFailure({ from: "transport", error: new Error(`流空闲超过 ${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)} 秒`) }),
					);
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

/**
 * 同一条 SSE 流，加一个空闲闸。
 *
 * `readSse` 只接一个 AbortSignal，没有计时器。它被三条链共用，所以计时加在这一侧而不是改那个文件：另
 * 起一个控制器，和调用方那个信号并起来交给它，每收到一帧把计时拨回去。**默认行为一个字节都不变**——
 * 正常流里唯一多出来的事是一次 `clearTimeout` + 一次 `setTimeout`。
 *
 * 取舍两点，都记在这里：
 *
 *   - 计时是**帧级**的，不是字节级的。一个把半个帧挂在那里的上游要等到下一帧才算超时，多等一个阈值。
 *     真正的死连接两者没有区别。
 *   - `readSse` 收到 abort 之后走的是 `reader.cancel()`，那个生成器会**正常结束**而不是抛。所以闸掉
 *     这件事得另外写在 `state.tripped` 上让调用方看——不看的话，一条挂死的流会被当成「模型没话说」，
 *     或者更糟：一个截断了的回答被当成完整的。
 */
export async function* readSseWithIdleTimeout(
	response: Response,
	signal: AbortSignal | undefined,
	idleMs: number,
	state: { tripped: boolean },
): AsyncGenerator<SseFrame> {
	const idle = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const bump = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => {
			state.tripped = true;
			idle.abort();
		}, idleMs);
		// 挂死的流那一侧本来就把事件循环撑着，这里不该再多撑一个 10 分钟的计时器。
		(timer as { unref?: () => void }).unref?.();
	};
	try {
		bump();
		for await (const frame of readSse(response, signal ? AbortSignal.any([signal, idle.signal]) : idle.signal)) {
			bump();
			yield frame;
		}
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/** 这一份请求该带哪些采样参数。见 `THINKING_FORBIDS_SAMPLING`。 */
export function samplingFor(thinkingEnabled: boolean, model: Pick<ModelConfig, "samplingParams">, options: Pick<RequestOptions, "temperature" | "samplingParams">): Record<string, unknown> {
	const merged: Record<string, unknown> = {
		// 顺序和从前一样：显式配在 `samplingParams` 里的压过 `options.temperature`。
		...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
		...model.samplingParams,
		...options.samplingParams,
	};
	if (!thinkingEnabled) return merged;
	for (const key of THINKING_FORBIDS_SAMPLING) delete merged[key];
	return merged;
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
