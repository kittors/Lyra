/**
 * Our messages, in the shape the OpenAI Chat Completions API wants (`POST /v1/chat/completions`).
 */

import type { Message, ToolResultMessage, ToolSpec } from "../types.ts";
import type { ReasoningReplay } from "./reasoning-compat.ts";

/**
 * 模型看不了图时，图片位置上留下的那句话。
 *
 * 抄 oh-my-pi 的原话（`packages/ai/src/providers/vision-guard.ts:4`，`NON_VISION_IMAGE_PLACEHOLDER`），
 * 那边的 `partitionVisionContent`（同文件 `:39-43`）在 `supportsImages` 为假时把图片整组丢掉，再由
 * `joinTextWithImagePlaceholder` 把这句话接在文本后面。用英文是因为它进的是提示词，读它的是模型。
 */
const NO_VISION_PLACEHOLDER = "[image omitted: model does not support vision]";

/** 编码时需要知道的模型能力。只取用得到的那一项，免得一个纯翻译函数被整个 `ModelConfig` 绑住。 */
export interface ChatCompletionsModelCapabilities {
	supportsImages: boolean;
}

export function toChatCompletionsTools(tools: ToolSpec[]): unknown[] {
	return tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	}));
}

function toolResultMessage(result: ToolResultMessage): unknown {
	const content = result.content
		.map((c) => (c.type === "text" ? c.text : `[image ${c.mimeType}, ${c.data.length} base64 chars]`))
		.join("\n");
	return {
		role: "tool",
		tool_call_id: result.toolCallId,
		content,
	};
}

/**
 * Cleans conversation history for the OpenAI Chat Completions wire protocol.
 *
 * Chat Completions enforces strict invariants:
 * 1. An assistant message must have either non-empty content or tool_calls. Empty content ("")
 *    without tool_calls causes HTTP 400 (e.g. Gemini/relays returning INVALID_ARGUMENT).
 *    When a model spends its turn thinking and emits no text/tools, that turn is a no-op;
 *    we prune it along with any synthetic nudge following it.
 * 2. Tool results must correspond to an assistant tool call. Orphan tool results that have no
 *    prior assistant call are dropped or sanitized to avoid 400 errors.
 */
export function sanitizeChatCompletionsHistory(messages: Message[]): Message[] {
	const out: Message[] = [];
	const droppedEmptyAssistantIndices = new Set<number>();

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];

		if (message.role === "assistant") {
			const hasText = message.content.some((c) => c.type === "text" && c.text.trim().length > 0);
			const hasToolCalls = message.content.some((c) => c.type === "toolCall");

			if (!hasText && !hasToolCalls) {
				droppedEmptyAssistantIndices.add(i);
				continue;
			}
		} else if (message.role === "user") {
			if (droppedEmptyAssistantIndices.has(i - 1) && message.synthetic) {
				continue;
			}
		}

		out.push(message);
	}

	return out;
}

export function toChatCompletionsMessages(
	systemPrompt: string,
	messages: Message[],
	reasoning: ReasoningReplay = "replay",
	model?: ChatCompletionsModelCapabilities,
): unknown[] {
	const sanitized = sanitizeChatCompletionsHistory(messages);
	const out: unknown[] = [];
	/*
	 * 没告诉我们能力的，按「能看图」编——那是这个函数一直以来的行为，缺省不该悄悄变严。
	 *
	 * 真正的调用方（`openai-chat-completions.ts`）总是把模型传进来，所以这个缺省只兜住直接调它的
	 * 测试和别处的旧调用。
	 */
	const supportsImages = model?.supportsImages !== false;
	if (systemPrompt) {
		out.push({ role: "system", content: systemPrompt });
	}

	for (let index = 0; index < sanitized.length; index++) {
		const message = sanitized[index];
		if (message.role === "user") {
			const hasImages = message.content.some((c) => c.type === "image");
			/*
			 * 纯文本模型上，图片必须在这里换成一句话，不能原样发出去。
			 *
			 * 从前这里只看「这条消息里有没有图」，不看「这个模型看不看得了图」。一个 `supportsImages:
			 * false` 的模型收到 `image_url` 会 400，而图片一旦进了历史，**之后每一轮都带着它**——会话
			 * 从此永久报废，裁史也救不回来（裁到图片那一条之前才行）。
			 *
			 * oh-my-pi 在同一个位置做同一件事：`openai-completions.ts:2061` 先问
			 * `isOpenAICompletionsVisionSupported(model)`，不支持就走 `vision-guard.ts:39-43` 把图片整组
			 * 丢掉、接一句 `NON_VISION_IMAGE_PLACEHOLDER`。
			 *
			 * 工具结果那一路不用管：`toolResultMessage` 早就把图片降级成一行说明，所以 `read` 读一张 png
			 * 不会走到这里来。会走到这里的是人手动贴进对话的图。
			 */
			if (!hasImages || !supportsImages) {
				let text = message.content
					.filter((c) => c.type === "text")
					.map((c) => (c.type === "text" ? c.text : ""))
					.join("\n");
				if (hasImages) {
					text = text ? `${text}\n${NO_VISION_PLACEHOLDER}` : NO_VISION_PLACEHOLDER;
				}
				const prevMsg = index > 0 ? sanitized[index - 1] : undefined;
				if (prevMsg?.role === "assistant" && prevMsg.stopReason === "aborted" && !message.synthetic) {
					text = `[System note: Your previous response was interrupted by the user to provide new instructions. Abandon the interrupted thought and focus entirely on the latest user request below.]\n\n${text}`;
				}
				out.push({ role: "user", content: text });
			} else {
				out.push({
					role: "user",
					content: message.content.map((c) =>
						c.type === "text"
							? { type: "text", text: c.text }
							: {
									type: "image_url",
									image_url: { url: `data:${c.mimeType};base64,${c.data}` },
								},
					),
				});
			}
			continue;
		}

		if (message.role === "assistant") {
			const answers = new Map<string, ToolResultMessage>();
			let after = index + 1;
			for (; after < sanitized.length; after++) {
				const next = sanitized[after];
				if (next.role !== "toolResult") break;
				if (!answers.has(next.toolCallId)) answers.set(next.toolCallId, next);
			}

			const toolCalls: unknown[] = [];
			let text = "";
			let thought = "";
			/** 这段思考进来时挂在哪个键上。见下面 `msg[thoughtField]` 那一段。 */
			let thoughtField: string | undefined;

			for (const c of message.content) {
				if (c.type === "text") {
					text += c.text;
				} else if (c.type === "thinking") {
					/*
					 * 只收带得动句柄的那一档：没有句柄的这一块跳过。
					 *
					 * 「句柄」在这条链上就是 `signature`——那是别的协议留下的。撞上这一档说明对面（多半是
					 * 一个把请求再翻译成 Anthropic 的中转）要求推理带着签名回来，而剥过句柄的思考块拿不出来。
					 */
					if (reasoning === "handled" && !c.signature) continue;
					thought += c.thinking;
					thoughtField ??= c.reasoningField;
				} else if (c.type === "toolCall") {
					toolCalls.push({
						id: c.id,
						type: "function",
						function: {
							name: c.name,
							arguments: c.argumentsText ?? JSON.stringify(c.arguments),
						},
					});
				}
			}

			const msg: Record<string, unknown> = { role: "assistant" };
			if (text) {
				msg.content = text;
			} else if (toolCalls.length > 0) {
				/*
				 * 空字符串，不是 `null`。
				 *
				 * 协议上两者等价——带 `tool_calls` 的助手消息不需要文本。但 `null` 会绊倒一部分实现，而
				 * `""` 不会：oh-my-pi 在同一个位置做同一件事，注释的原话是「OpenAI accepts an empty string
				 * here; null trips strict/proxy implementations before the tool result is read」
				 * （`packages/ai/src/providers/openai-completions.ts:2320-2324`，有 reasoning 或 tool_calls
				 * 时把 `null` 换成 `""`）。
				 *
				 * 这一步是普适安全的，所以直接改默认：能收 `null` 的端点一样收 `""`（`""` 是 OpenAI 官方
				 * 文档里 `content` 的合法值），而挑剔的那些只收后者。
				 *
				 * 还有一档没做：oh-my-pi 在端点声明 `requires-assistant-content-for-tool-calls` 时发的是
				 * `"."`（同文件 `:2333-2335`，轴在 `packages/catalog/src/compat/axes.ts:131`，整个规则库里唯
				 * 一一处声明是 `compat/rules/providers/deepseek.kdl:87`）。不做的理由是**拿不到它的错误串**
				 * ——oh-my-pi 那边是一张普查表的结论，没有记下 DeepSeek 被 `""` 顶回来时说的是什么，所以
				 * 这一档既没法按默认发（往每条工具调用消息里塞一个凭空的句号，对别的端点是污染），也没法
				 * 「撞一次学一次」（不知道该认哪句话）。等真撞上了再补，那时会有错误串。
				 */
				msg.content = "";
			} else if (message.stopReason === "aborted") {
				msg.content = "[Turn interrupted by user]";
			} else {
				const hasThinking = message.content.some((c) => c.type === "thinking");
				msg.content = hasThinking ? "[Thought without final response]" : "[Empty response]";
			}
			if (toolCalls.length > 0) msg.tool_calls = toolCalls;
			/*
			 * 模型想过的话，原样还回去。
			 *
			 * 这条链一直是只读不还：解码那边把 `delta.reasoning_content` 接进思考块
			 * （`openai-chat-completions.ts`），界面上也画出来，然后编码这边把它整段丢掉——上面那个循环
			 * 原本只有 `text` 和 `toolCall` 两个分支。对多数宿主这只是浪费；对 DeepSeek 系的推理模型这是
			 * 致命的，它要求自己产出的思考跟着下一轮回来：
			 *
			 *     The `reasoning_content` in the thinking mode must be passed back to the API.
			 *
			 * 于是模型只要调过一次工具，第二轮必 400，而且没有任何一条代码路径能满足它——不是配错了，是
			 * 这段逻辑不存在。唯一的出路是把思考关掉。
			 *
			 * 只在真有思考文本时发。历史里没有的时候不去编一段：那是「端点要求而我们手上没有」的另一个
			 * 问题，属于失败重试那一层，不该在一个纯翻译函数里替它做主。
			 *
			 * **用它进来时那个键还回去**，而不是永远写 `reasoning_content`。同一件事在这条链上有三个字段
			 * 名（见 `openai-chat-completions.ts` 的 `REASONING_FIELDS`），OpenRouter 用的是 `reasoning`。
			 * 一个只认自己那个键的端点，收到另一个键等于没收到——而我们刚刚还因为只读一个键而在界面上丢
			 * 掉了整段思考。缺省仍是 `reasoning_content`：旧会话和别的协议产生的思考块没有这个标记，它们
			 * 的行为一字不变。
			 */
			if (thought && reasoning !== "omit") msg[thoughtField ?? "reasoning_content"] = thought;

			out.push(msg);

			// Interleave / follow directly with tool messages responding to tool calls
			for (const tc of toolCalls as { id: string }[]) {
				const answer = answers.get(tc.id);
				if (answer) {
					out.push(toolResultMessage(answer));
				}
			}
			index = after - 1;
			continue;
		}

		if (message.role === "toolResult") {
			// A standalone tool result with no prior assistant message (e.g. truncated history head)
			out.push(toolResultMessage(message));
		}
	}

	return out;
}
