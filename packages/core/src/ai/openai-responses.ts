/**
 * OpenAI Responses API adapter (`POST /v1/responses`).
 *
 * The Responses format is item-based rather than message-based: assistant text, reasoning
 * and function calls are sibling items in one flat `input` array. Reasoning items carry an
 * opaque `encrypted_content` that must be replayed verbatim for the model to keep its chain
 * of thought across tool calls, which is why `include: ["reasoning.encrypted_content"]` is
 * always requested.
 */

import { toResponsesInput, toResponsesTools } from "./openai-responses-request.ts";
import { sanitizeToolPairing } from "./sanitize-history.ts";
import type {
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
import { argumentFragment, parseToolArguments, readSseWithIdleTimeout, STREAM_IDLE_TIMEOUT_MS } from "../utils/sse.ts";
import { describeFetchError, joinUrl } from "./anthropic-messages.ts";
import { resolveReasoningEffort } from "./thinking-options.ts";
import { reasoningReplay, withReasoningRetry, type ReasoningReplay } from "./reasoning-compat.ts";
import { learnToolPairing, toolPairing } from "./tool-pairing-compat.ts";
import { droppedParams, learnDroppedParam } from "./request-params-compat.ts";

export const openaiResponsesProvider: Provider = {
	api: "openai-responses",
	stream: streamResponses,
};

async function* streamResponses(
	provider: ProviderConfig,
	model: ModelConfig,
	context: LlmContext,
	options: RequestOptions,
): AsyncGenerator<StreamEvent, AssistantMessage> {
	const startTime = Date.now();
	const partial: AssistantMessage = {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: provider.id,
		model: model.modelId,
		usage: emptyUsage(),
		stopReason: "pending",
		timestamp: startTime,
	};

	const reasoningEffort = resolveReasoningEffort(options.thinking, model);
	const thinkingEnabled = reasoningEffort !== undefined;
	const modelId = (model.modelId || model.id || "").toLowerCase();
	const isGemini = modelId.includes("gemini") || modelId.includes("gemma");

	/*
	 * 每次尝试重新编一遍，因为**形状可能在两次之间变掉**。
	 *
	 * 端点的脾气是撞出来的，不是配出来的，而且有两个互不相干的轴：推理怎么还（`reasoning-compat.ts`：
	 * 有的要求必须带、有的一带就 400）、工具调用怎么排（`tool-pairing-compat.ts`：有的要成组、有的要
	 * 交错）。被顶回来的那一次会记下结论、换个形状重发，所以这里必须能重新编一份，而不是把第一次编好
	 * 的那份原样再发一遍。
	 */
	const buildBody = (replay: ReasoningReplay): Record<string, unknown> => {
		/** 这个端点撞过之后要求我们别发的参数，见 `request-params-compat.ts`。 */
		const dropped = droppedParams(provider.id, model.id);
		return {
			model: model.modelId,
			// Told who it is going to, so a handle written by a different model is left behind rather
			// than replayed to one that will reject it. See `fromHome`.
			input: toResponsesInput(
				sanitizeToolPairing(context.messages),
				{ provider: provider.id, model: model.modelId, supportsImages: model.supportsImages },
				replay,
				toolPairing(provider.id, model.modelId),
			),
			stream: true,
			// Sessions live in Lyra's own store, not on the provider.
			store: false,
			max_output_tokens: options.maxTokens ?? model.maxOutputTokens,
			...(context.systemPrompt ? { instructions: context.systemPrompt } : {}),
			/*
			 * `tool_choice: "auto"` 是服务端默认值，发它零收益——但撞过一次的端点上要连它一起省掉。
			 *
			 * 没有直接改成「一律不发」，是因为「省略等于 auto」这句话本身没有实测支撑：作者手上两个端点带不带
			 * 都是 200（`~/.lyra/scratch/responses-params.txt`），证明不了别家也一样。默认维持原样，撞了再撤。
			 */
			...(context.tools.length > 0
				? {
						tools: toResponsesTools(context.tools),
						...(dropped.has("tool-choice") ? {} : { tool_choice: "auto" }),
					}
				: {}),
			// Omitting `reasoning` does not disable thinking — several providers still reason by
			// default, so "off" has to say so explicitly. `effort: "none"` is the documented way.
			// Google Gemini/Vertex API rejects `effort: "none"` with HTTP 400 (none is not a valid
			// ThinkingLevel enum value); Gemini models omit the property when thinking is off.
			// 别的端点也可能不认 `none`——那条实测记录就是 `request-params-compat.ts` 认得的第一条信号，
			// 撞上之后走的是和 Gemini 同一条路：整个 `reasoning` 不发。
			...(model.supportsThinking
				? thinkingEnabled && reasoningEffort
					? {
							reasoning: {
								effort: reasoningEffort,
								summary: "auto",
							},
							...(dropped.has("include-encrypted") ? {} : { include: ["reasoning.encrypted_content"] }),
						}
					: isGemini || dropped.has("reasoning-off")
						? {}
						: { reasoning: { effort: "none" } }
				: {}),
			...(options.temperature !== undefined && !thinkingEnabled && !dropped.has("sampling")
				? { temperature: options.temperature }
				: {}),
			/*
			 * 采样参数最后展开——它们是用户自己配的，覆盖上面算出来的值是有意为之。
			 *
			 * 但撞过「这个模型不接受采样参数」的端点上要整组撤掉：用户在设置里填了 `temperature`，而 o 系列和
			 * gpt-5.x 对显式采样参数一律 400（oh-my-pi 的结论是这跟主机无关、只跟模型有关）。用户配出来的东西
			 * 让整个会话发不出请求，拦一下比原样转发更有用。
			 */
			...(dropped.has("sampling") ? {} : { ...model.samplingParams, ...options.samplingParams }),
		};
	};
	let body = buildBody(reasoningReplay(provider.id, model.id));

	options.onPayload?.(body);

	const doFetch = options.fetch ?? globalThis.fetch;

	let firstTokenTime: number | null = null;
	/** output_index -> position in partial.content, so deltas can find their block. */
	const items = new Map<
		number,
		{
			kind: "text" | "thinking" | "toolCall";
			contentIndex: number;
			raw: string;
		}
	>();
	/** Stand-in ids for calls the provider did not name, keyed by output index. */
	const inventedIds = new Map<number, string>();
	let incompleteReason: string | undefined;
	/** 这次尝试收到过几个能看懂的事件——用来分辨「模型没话说」和「中转发来一团别的东西」。 */
	let framesSeen = 0;
	/** 收到过收尾事件（`response.completed` / `.incomplete`）——没有它就说明流是断的，不是说完了。 */
	let settled = false;
	/** 前几次失败的尝试各自花掉的 token，攒着，最后加进这条消息的用量里。见 `reset`。 */
	let spentOnRetries = emptyUsage();

	const retryBudget = new RetryBudget(options.retryPolicy, options.retryAttempts);
	try {
		/*
		 * The whole exchange, not just the connection.
		 *
		 * A socket that dies while the reply is streaming used to end the turn outright — and the
		 * longer the reply, the wider that window, so it fell hardest on exactly the long pieces
		 * of work where losing a turn costs the most. Nothing has happened yet when it dies:
		 * tools run after a complete reply arrives, so the reply can simply be asked for again.
		 */
		yield* withReasoningRetry(provider.id, model.id, () => {
			spentOnRetries = addUsage(spentOnRetries, partial.usage);
			partial.content = [];
			partial.usage = emptyUsage();
			items.clear();
			inventedIds.clear();
			framesSeen = 0;
			settled = false;
			firstTokenTime = null;
			incompleteReason = undefined;
		}, (providerId, modelId, said) => learnToolPairing(providerId, modelId, said) || learnDroppedParam(providerId, modelId, said), async function* (replay) {
			body = buildBody(replay);
			options.onPayload?.(body);
			yield* retryStream(
			async function* attempt() {
				const response = await fetchWithRetry(
					doFetch,
					joinUrl(provider.baseUrl, "/v1/responses"),
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
					// 走到这里说明 `fetchWithRetry` 已经判过并且决定不再重试；带着结论抛，别让上面
					// 那层拿一个 `HTTP 401: ...` 字符串重新猜。
					const detail = await response.text().catch(() => "");
					throw new FailureError(classifyFailure({ from: "status", status: response.status, body: detail }));
				}

				yield { type: "start", partial: { ...partial } } as StreamEvent;

				/** 这次尝试里没能解析的帧，留一份原文，空回答时用来说明收到的到底是什么。 */
				let unparsable = "";
				/** 这条流被空闲闸掉了吗。见 `readSseWithIdleTimeout`。 */
				const idle = { tripped: false };
				for await (const frame of readSseWithIdleTimeout(response, options.signal, STREAM_IDLE_TIMEOUT_MS, idle)) {
					if (frame.data === "[DONE]") break;
					let event: Record<string, any>;
					try {
						event = JSON.parse(frame.data);
					} catch {
						if (!unparsable) unparsable = frame.data.slice(0, 500);
						continue;
					}
					framesSeen += 1;

					const type: string = event.type ?? frame.event ?? "";
					const outputIndex: number = event.output_index ?? 0;

					switch (type) {
						case "response.output_item.added": {
							const item = event.item ?? {};
							if (item.type === "message") {
								partial.content.push({
									type: "text",
									text: "",
									signature: item.id,
								});
								items.set(outputIndex, {
									kind: "text",
									contentIndex: partial.content.length - 1,
									raw: "",
								});
								yield { type: "text_start", index: outputIndex };
							} else if (item.type === "reasoning") {
								partial.content.push({
									type: "thinking",
									thinking: "",
									signature: item.id,
									encrypted: item.encrypted_content || undefined,
								});
								items.set(outputIndex, {
									kind: "thinking",
									contentIndex: partial.content.length - 1,
									raw: "",
								});
								yield { type: "thinking_start", index: outputIndex };
							} else if (item.type === "function_call") {
								partial.content.push({
									type: "toolCall",
									// call_id is the handle the API expects back on function_call_output.
									id: toolCallId(item.call_id ?? item.id, outputIndex, inventedIds),
									name: String(item.name ?? ""),
									arguments: {},
									argumentsText: "",
									signature: item.id,
								});
								items.set(outputIndex, {
									kind: "toolCall",
									contentIndex: partial.content.length - 1,
									raw: "",
								});
								yield {
									type: "toolcall_start",
									index: outputIndex,
									id: toolCallId(item.call_id ?? item.id, outputIndex, inventedIds),
									name: String(item.name ?? ""),
								};
							}
							break;
						}

						case "response.output_text.delta": {
							if (firstTokenTime === null) firstTokenTime = Date.now();
							const tracked = items.get(outputIndex);
							const target = tracked ? partial.content[tracked.contentIndex] : undefined;
							if (target?.type === "text") {
								target.text += event.delta ?? "";
								yield {
									type: "text_delta",
									index: outputIndex,
									delta: event.delta ?? "",
									partial: { ...partial },
								};
							}
							break;
						}

						// Providers differ: some stream a reasoning summary, some stream raw reasoning text.
						case "response.reasoning_summary_text.delta":
						case "response.reasoning_text.delta": {
							if (firstTokenTime === null) firstTokenTime = Date.now();
							const tracked = items.get(outputIndex);
							const target = tracked ? partial.content[tracked.contentIndex] : undefined;
							if (target?.type === "thinking") {
								target.thinking += event.delta ?? "";
								yield {
									type: "thinking_delta",
									index: outputIndex,
									delta: event.delta ?? "",
									partial: { ...partial },
								};
							}
							break;
						}

						case "response.function_call_arguments.delta": {
							if (firstTokenTime === null) firstTokenTime = Date.now();
							const tracked = items.get(outputIndex);
							if (!tracked) break;
							// 协议说 delta 是字符串分片，但转译层不一定守；对象接上去会变成 `"[object Object]"`。
							tracked.raw += argumentFragment(event.delta);
							const target = partial.content[tracked.contentIndex];
							if (target?.type === "toolCall") target.argumentsText = tracked.raw;
							yield {
								type: "toolcall_delta",
								index: outputIndex,
								delta: event.delta ?? "",
								partial: { ...partial },
							};
							break;
						}

						case "response.output_item.done": {
							const item = event.item ?? {};
							/*
							 * 没见过 `added` 就来了 `done`——现补一个块，不要把这一项扔掉。
							 *
							 * 这里原本是 `if (!tracked) break;`：没有开过的块就整项丢弃，文本、推理、工具调用
							 * 一视同仁。对守规矩的端点那行永远不会触发，所以它一直看起来没问题；对**只发
							 * `done` 不发 `added`** 的中转（把 Responses 翻译成别的协议时很常见，oh-my-pi 管
							 * 这类叫 lossy proxy），它意味着整个回复静默消失。
							 *
							 * 文本和推理丢了还看得见——界面空白，用户会来报。工具调用丢了最阴险：`agent/loop.ts`
							 * 按 content 里的 toolCall 决定执行什么，item 没了工具就**静默不跑**，而模型下一轮
							 * 以为自己调过了，于是原地打转。
							 *
							 * `done` 事件里带着这一项的全部内容，补一个块出来所需的东西它都有。
							 */
							let tracked = items.get(outputIndex);
							if (!tracked) {
								const kind =
									item.type === "function_call" ? "toolCall" : item.type === "reasoning" ? "thinking" : item.type === "message" ? "text" : undefined;
								if (!kind) break;
								if (kind === "toolCall") {
									partial.content.push({
										type: "toolCall",
										id: toolCallId(item.call_id ?? item.id, outputIndex, inventedIds),
										name: item.name ?? "",
										arguments: {},
									});
								} else if (kind === "thinking") {
									partial.content.push({ type: "thinking", thinking: "", signature: item.id, encrypted: item.encrypted_content || undefined });
								} else {
									partial.content.push({ type: "text", text: "" });
								}
								tracked = { kind, contentIndex: partial.content.length - 1, raw: "" };
								items.set(outputIndex, tracked);
								framesSeen++;
							}
							const target = partial.content[tracked.contentIndex];

							if (tracked.kind === "toolCall" && target?.type === "toolCall") {
								/*
							 * 收尾的那个 item 里带的参数说了算，字符串还是对象都认。
							 *
							 * 原本只认字符串，非字符串一律退回流里攒的 `tracked.raw`。对于一次性给完整对象、
							 * 一个 delta 都不发的宿主，那个缓冲区是空的——参数就这么没了，还不报错。
							 */
							const complete = argumentFragment(item.arguments);
							const raw = complete || tracked.raw;
								target.argumentsText = raw;
								target.arguments = parseToolArguments(raw) ?? {};
								yield {
									type: "toolcall_end",
									index: outputIndex,
									partial: { ...partial },
								};
							} else if (tracked.kind === "thinking" && target?.type === "thinking") {
								if (item.encrypted_content) target.encrypted = item.encrypted_content;
								// Non-streaming summaries only arrive on the completed item.
								if (!target.thinking && Array.isArray(item.summary)) {
									target.thinking = item.summary.map((s: { text?: string }) => s.text ?? "").join("\n");
								}
								yield { type: "thinking_end", index: outputIndex };
							} else if (tracked.kind === "text" && target?.type === "text") {
								if (!target.text && Array.isArray(item.content)) {
									target.text = item.content.map((c: { text?: string }) => c.text ?? "").join("");
								}
								yield { type: "text_end", index: outputIndex };
							}
							break;
						}

						case "response.completed":
						case "response.incomplete": {
							applyUsage(partial.usage, event.response?.usage);
							partial.responseId = event.response?.id;
							incompleteReason = event.response?.incomplete_details?.reason;
							settled = true;
							break;
						}

						case "response.failed":
						case "error": {
							/*
							 * 从前这里直接放弃，理由写在一行注释里：「服务商自己拒绝了，再问也是同样
							 * 答复」。对官方直连大致成立，对中转完全不成立——中转把上游的过载、限流、
							 * 断流全塞进这个事件里，而且经常连 message 都不给，于是只能显示成
							 * `Unknown provider error`，三层重试全部绕过，设置页上的「无限重试」形同
							 * 虚设。
							 *
							 * 现在它抛出去，由 `retryStream` 按分类决定。真正该拒绝的（内容策略、
							 * 额度）会被判成 `fatal` 原样抛到最外面，和从前的行为一模一样——区别只是
							 * 这个结论现在来自事件的内容，而不是来自「它出现在流里」这个位置。
							 */
							const said = event.response?.error?.message ?? event.message;
							throw new FailureError(
								classifyFailure({
									from: "stream",
									message: typeof said === "string" ? said : undefined,
									raw: JSON.stringify(event).slice(0, 4000),
									// 流已经吐过字，这次的 token 服务商已经收过钱了。
									spent: partial.usage.output > 0 || partial.content.length > 0,
								}),
							);
						}
					}
				}

				/*
				 * 被空闲闸掉的，按连接问题抛，排在这三条判定之前。
				 *
				 * 挂死时内容常常正好是空的，也正好没有收尾事件——三条判定都会认领它，而它们说出来的原因
				 * 都不对。放在最前面是因为它知道得最确切：计时器响了，不是推断出来的。见 Anthropic 链上
				 * 同一段。
				 */
				if (idle.tripped) {
					throw new FailureError(
						classifyFailure({ from: "transport", error: new Error(`流空闲超过 ${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)} 秒`) }),
					);
				}

				/*
				 * 空回答也是失败，不是「模型没话说」。
				 *
				 * 从前流正常结束而一个字都没有时，这里什么都不做，最后以 `stopReason: "stop"` 收场
				 * ——屏幕上是一条空白的回答，既不报错也不重试。故障真值表里有三种故障长这样：一个
				 * 把错误写成 JSON 却回 200 的中转、一个空流、一串非法 JSON。它们和真正的空回答在结局
				 * 上完全无法区分，而后者本来就不该发生：模型即使无话可说也会给出 `response.completed`
				 * 和至少一个 item。
				 */
				if (partial.content.length === 0 && !incompleteReason) {
					throw new FailureError(
						classifyFailure({
							from: "empty",
							why: unparsable ? "unparsable" : framesSeen === 0 ? "no-frames" : "no-content",
							body: unparsable || undefined,
						}),
					);
				}

				/*
				 * 吐了一半就断掉，也是失败，不是「说完了」。
				 *
				 * 上面那条只管一个字都没有的情况。真正难发现的是另一种：模型吐了半段回答，连接断了，而
				 * `response.completed` / `response.incomplete` 从来没来过。流循环正常退出，这条半截消息被
				 * 标成 `stop` 交给 `agent/loop.ts` 继续往下跑——用户看到一个无声截断的回答，没有错误、没有
				 * 重试、没有任何迹象说这里少了东西。中间设备在长回答上掐断连接时就是这个形状。
				 *
				 * oh-my-pi 在 Chat Completions 侧做的是同一件事：有内容但既没 `finish_reason` 也没 `[DONE]`
				 * 就抛 `incomplete-stream`（`packages/ai/src/providers/openai-completions.ts:1417-1422`）。
				 * Responses 这边的收尾信号是那两个事件。
				 *
				 * 判成可重试：什么都还没发生——工具要等一条完整回复到手才跑，所以重新问一遍就行。`spent`
				 * 如实填，那半段的 token 服务商已经收过钱了，用量要算进去。
				 */
				if (!settled) {
					throw new FailureError(
						classifyFailure({
							from: "stream",
							message: "回复没有收尾就断了（没有收到 response.completed）",
							spent: partial.usage.output > 0 || partial.content.length > 0,
						}),
					);
				}

				/*
				 * 被内容策略拦下，不是「说完了」。
				 *
				 * `incomplete_details.reason` 除了 `max_output_tokens` 还有别的值，而我们原先只认那一个：
				 * 其余一律落进下面的 `stopReason: "stop"`，于是被策略拦掉的一轮在界面上是一条**正常结束的
				 * 空回答**，既不说明原因也不重试。`content_filter` 是其中最要紧的一个——它该让用户知道，
				 * 而不是装作模型无话可说。
				 *
				 * 判成 `blocked`（不可重试）：同样的输入再发一遍还是同样的结果，重试只是多烧一次钱。
				 */
				if (incompleteReason && incompleteReason !== "max_output_tokens") {
					throw new FailureError(
						classifyFailure({
							from: "stream",
							message:
								incompleteReason === "content_filter"
									? "这次回复被内容策略拦下了（content_filter）"
									: `回复没有正常结束：${incompleteReason}`,
							spent: partial.usage.output > 0 || partial.content.length > 0,
						}),
					);
				}
			},
			{
				budget: retryBudget,
				signal: options.signal,
				onRetry: options.onRetry,
				/*
				 * Everything the last attempt accumulated, cleared.
				 *
				 * The message is rebuilt from scratch by the retry, and the window replaces rather
				 * than appends — each update carries the whole message — so the abandoned half
				 * disappears the moment the new one starts arriving.
				 */
				reset: () => {
					/*
					 * 已经花掉的不清零。
					 *
					 * 内容要清——重试会把整条回答重新写一遍，留着上一半就成了两半拼在一起。可 token
					 * 是另一回事：上一次尝试吐到一半才失败，那些 token 服务商已经收过钱了，清零只是
					 * 让账面上看不见。开着无限重试的窗口于是可以安静地烧穿账单，而界面上的用量始终
					 * 只显示最后成功那一次。
					 */
					spentOnRetries = addUsage(spentOnRetries, partial.usage);
					partial.content = [];
					partial.usage = emptyUsage();
					partial.responseId = undefined;
					items.clear();
					inventedIds.clear();
					incompleteReason = undefined;
					framesSeen = 0;
					firstTokenTime = null;
				},
			},
			);
		});
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
	partial.stopReason =
		incompleteReason === "max_output_tokens"
			? "length"
			: partial.content.some((c) => c.type === "toolCall")
				? "toolUse"
				: "stop";
	partial.usage.total = partial.usage.input + partial.usage.output + partial.usage.cacheRead + partial.usage.cacheWrite;
	// 成功了，但失败的那几次也是花过钱的——账上要有。
	partial.usage = addUsage(partial.usage, spentOnRetries);
	partial.usage = computeCost(partial.usage, model);
	yield { type: "done", message: { ...partial } };
	return partial;
}

function applyUsage(usage: Usage, raw: Record<string, any> | undefined): void {
	if (!raw) return;
	if (typeof raw.input_tokens === "number") usage.input = raw.input_tokens;
	if (typeof raw.output_tokens === "number") usage.output = raw.output_tokens;
	if (typeof raw.input_tokens_details?.cached_tokens === "number") {
		usage.cacheRead = raw.input_tokens_details.cached_tokens;
		// Cached tokens are reported inside input_tokens; keep the two buckets disjoint.
		usage.input = Math.max(0, usage.input - usage.cacheRead);
	}
	if (typeof raw.output_tokens_details?.reasoning_tokens === "number") {
		usage.reasoning = raw.output_tokens_details.reasoning_tokens;
	}
}

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------
