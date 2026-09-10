/**
 * Our messages, in the shape the OpenAI Chat Completions API wants (`POST /v1/chat/completions`).
 */

import type { Message, ToolResultMessage, ToolSpec } from "../types.ts";
import type { ReasoningReplay } from "./reasoning-compat.ts";

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

export function toChatCompletionsMessages(systemPrompt: string, messages: Message[], reasoning: ReasoningReplay = "replay"): unknown[] {
	const sanitized = sanitizeChatCompletionsHistory(messages);
	const out: unknown[] = [];
	if (systemPrompt) {
		out.push({ role: "system", content: systemPrompt });
	}

	for (let index = 0; index < sanitized.length; index++) {
		const message = sanitized[index];
		if (message.role === "user") {
			const hasImages = message.content.some((c) => c.type === "image");
			if (!hasImages) {
				let text = message.content
					.filter((c) => c.type === "text")
					.map((c) => (c.type === "text" ? c.text : ""))
					.join("\n");
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
				msg.content = null;
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
			 */
			if (thought && reasoning !== "omit") msg.reasoning_content = thought;

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
