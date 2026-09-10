/**
 * Our messages, in the shape the Responses API wants.
 *
 * Purely a translation: no network, no state, no decisions beyond how each kind of content maps.
 * Separated from the streaming half because the two are read for different reasons — this one when
 * a message is not being sent correctly, the other when a reply is not being read correctly.
 */

import type { AssistantMessage, Message, ToolResultMessage, ToolSpec } from "../types.ts";
import type { ReasoningReplay } from "./reasoning-compat.ts";

/**
 * Who this request is going to, so a handle from someone else can be told apart from our own.
 *
 * Every assistant message records the provider and model that produced it. A reasoning item id is
 * that provider's private handle on its own chain of thought — it means nothing to anyone else, and
 * is rejected rather than ignored when replayed to them.
 */
export interface ResponsesHome {
	provider: string;
	model: string;
}

/**
 * Whether this turn was written by the model the request is going to.
 *
 * Missing provenance counts as ours: logs written before those fields existed have no opinion, and
 * dropping a handle we cannot prove is foreign would break the upstreams that require their own
 * reasoning back (see the `reasoning_text` note below).
 */
function fromHome(message: AssistantMessage, home: ResponsesHome | undefined): boolean {
	if (!home || !message.provider || !message.model) return true;
	return message.provider === home.provider && message.model === home.model;
}

/**
 * One tool result, in the shape Responses wants.
 *
 * Responses only accepts a string output, so images are described rather than attached.
 */
function functionCallOutput(message: ToolResultMessage): unknown {
	const text = message.content
		.map((c) => (c.type === "text" ? c.text : `[image ${c.mimeType}, ${c.data.length} base64 chars]`))
		.join("\n");
	return { type: "function_call_output", call_id: message.toolCallId, output: text };
}

/**
 * 一个句柄能不能当 API 的 item id 用。
 *
 * Responses 只接受字母、数字、下划线和短横。中转自己生成的 id 不一定守这条——客户报过一次
 * `Invalid 'input[14].id' … this value contained additional characters`，而那串东西里混着一个
 * 肉眼看不出来的字符。
 *
 * 不合规的句柄**丢掉**，不是原样发出去：它按定义就是不可用的，发过去只有一个结果——整个请求被拒，
 * 而那段历史每一轮都会被重新编码一次，于是那个对话再也说不了话。丢掉它只损失「供应商接回自己那条
 * 思维链」的能力，那本来就不是可移植的东西。
 */
function usableId(handle: string | undefined): string | undefined {
	return handle !== undefined && /^[A-Za-z0-9_-]+$/.test(handle) ? handle : undefined;
}

/**
 * Every call answered where it was made: `function_call`, then its own `function_call_output`.
 *
 * The obvious arrangement is the one the model produced — all of a turn's calls, then all of their
 * results — and against OpenAI's own endpoint it is fine, since a result finds its call by
 * `call_id` rather than by position. It is not fine against the relays that translate Responses
 * into Chat Completions, which is what most non-OpenAI models are reached through: several of them
 * turn each `function_call` item into an assistant message of its own, and Chat Completions
 * requires the message after one carrying `tool_calls` to be the tool message answering it. Two
 * calls in a row therefore produce two assistant messages back to back, and the upstream rejects
 * the whole request:
 *
 *     an assistant message with 'tool_calls' must be followed by tool messages responding to
 *     each 'tool_call_id'. The following tool_call_ids did not have response messages: bash:0
 *
 * Which makes every turn that asks for two tools at once — the normal case for any capable model —
 * fail with a 400 that no retry can clear, because the history it is retrying is the problem.
 * Interleaving costs nothing on the endpoints that do not care, and is the only shape that works on
 * the ones that do.
 *
 * It also settles an ordering question that would otherwise be left to chance. Results are recorded
 * as each tool finishes, so a history rebuilt from the log has them in completion order rather than
 * in call order; pairing them up here means what is sent does not depend on which tool was quicker.
 *
 * A result whose call is not in the assistant message before it — the log truncated, an edit that
 * removed the call — keeps its place in the list rather than being dropped: it is history, and
 * inventing a call to hang it on would be worse than passing it through.
 */
export function toResponsesInput(messages: Message[], home?: ResponsesHome, reasoning: ReasoningReplay = "replay"): unknown[] {
	const input: unknown[] = [];

	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message.role === "user") {
			input.push({
				type: "message",
				role: "user",
				content: message.content.map((c) =>
					c.type === "text"
						? { type: "input_text", text: c.text }
						: {
								type: "input_image",
								image_url: `data:${c.mimeType};base64,${c.data}`,
							},
				),
			});
			continue;
		}

		if (message.role === "assistant") {
			/*
			 * The results answering this turn: the run of tool messages directly after it.
			 *
			 * Bounded by the run rather than searched for across the whole history, because a call id
			 * is only unique within the provider that issued it — relays that name calls after the
			 * tool (`bash:0`) repeat themselves every turn, and a lookup by id alone would answer this
			 * turn's call with a result from three turns ago.
			 */
			const answers = new Map<string, ToolResultMessage>();
			let after = index + 1;
			for (; after < messages.length; after++) {
				const next = messages[after];
				if (next.role !== "toolResult") break;
				// First one wins, so a repeated id leaves the later copy where it was rather than
				// silently replacing the answer this call already had.
				if (!answers.has(next.toolCallId)) answers.set(next.toolCallId, next);
			}
			const paired = new Set<ToolResultMessage>();
			const own = fromHome(message, home);

			for (const c of message.content) {
				if (c.type === "thinking") {
					/*
					 * 这个端点已经说过它不收推理项——那就一个都不发。
					 *
					 * 不是形状不对，是它那边根本没有能放下这个东西的位置：四种写法（带 id、带 content、
					 * 带 summary、两个都带）全试过，全 400；删掉整项之后，同一段工具历史照样 200。
					 * 这个结论是撞出来的，怎么撞的见 `reasoning-compat.ts`。
					 */
					if (reasoning === "omit") continue;
					/*
					 * Someone else's reasoning does not go back at all.
					 *
					 * Not the id — the whole block. The id is unusable by definition, and the text is a
					 * different model's chain of thought, which this one has no business resuming. Both
					 * halves used to go anyway, and both were rejected: the id as
					 * `Invalid 'input[14].id' … invalid_value`, and the text — once the id had been
					 * stripped for being stale — as
					 * `Invalid 'input[32].content': array too long. Expected an array with maximum
					 * length 0`, because a reasoning item may only carry `content` on the endpoint that
					 * wrote it. Neither is retryable: the history is the request, so every turn after a
					 * model change failed the same way and the conversation could not be continued at
					 * all.
					 *
					 * The transcript still holds the text and still shows it; this is only about what
					 * crosses the wire. The Anthropic encoder has always done exactly this with a
					 * thinking block it cannot replay.
					 */
					if (!own) continue;
					/*
					 * With the provider's own item id, replayed exactly as it arrived. That id is what
					 * lets the provider pick its own chain of thought back up, and a summary offered in
					 * its place is not accepted as a substitute for it.
					 */
					const handle = usableId(c.signature);
					if (handle) {
						input.push({
							type: "reasoning",
							id: handle,
							summary: c.thinking ? [{ type: "summary_text", text: c.thinking }] : [],
							...(c.encrypted ? { encrypted_content: c.encrypted } : {}),
							/*
							 * 没有密文时，思考本身也要进 `content`。
							 *
							 * 一个推理项能拿回去的东西有三样：item id（供应商自己的句柄）、`encrypted_content`
							 * （原样可回放的那份）、和 `content` 里的 `reasoning_text`（文本本身）。`summary`
							 * 不算——它按定义是**对**推理的概括，要求原样回放的上游不接受它顶替：
							 *
							 *     The `reasoning_text` in the thinking mode must be passed back to the API.
							 *
							 * 有密文的时候端点认密文，这条分支一直没炸，所以这个缺口一直看不见；上游只给签名
							 * 不给密文时（中转把 Responses 转译成别的协议时很常见）就露出来了。实测同时给
							 * `content` 和 `summary` 不会被拒，所以这里补的是缺的那一半，不动本来就好的那条路。
							 */
							...(!c.encrypted && c.thinking ? { content: [{ type: "reasoning_text", text: c.thinking }] } : {}),
						});
						continue;
					}
					/*
					 * No id — and the block still has to go back.
					 *
					 * This used to `continue`, on the reasoning that a reasoning item without the
					 * provider's handle cannot be replayed. True of OpenAI's own endpoint, which always
					 * names its items, so the branch never fired there. It fires on the relays that
					 * translate Responses into Chat Completions, and several of them stream reasoning
					 * without ever sending an `item.id` — dropping the block there does not degrade the
					 * request, it breaks it outright:
					 *
					 *     The `reasoning_text` in the thinking mode must be passed back to the API.
					 *
					 * Upstreams like DeepSeek require the thinking they produced to come back with the
					 * turn that followed it. With the block dropped there is nothing to send, so every
					 * turn after the first fails with a 400 that no retry can clear, and the only way
					 * out was to turn thinking off.
					 *
					 * So the text goes back without an id, as `reasoning_text` — `content` is where the
					 * model's actual reasoning lives (`summary` is a summary of it, which is not what is
					 * being asked for). Nothing is claimed about resuming a chain of thought; this is
					 * the transcript, in the field that holds it.
					 */
					if (!c.thinking && !c.encrypted) continue;
					/*
					 * 这个端点说过它只收带得动句柄的推理——这一块没有句柄，跳过。
					 *
					 * 中转把 Responses 翻译成 Anthropic 时会撞上这条：那边的 thinking 块要文本也要签名，
					 * 而换过模型之后 `stripStaleHandles` 把签名剥了，两样都拿不出来。发过去只会 400，
					 * 而且是 `signature: Field required` 和 `thinking: Field required` 轮流报——补哪个都
					 * 补不齐，因为缺的那样东西我们真的没有。
					 */
					if (reasoning === "handled") continue;
					input.push({
						type: "reasoning",
						/*
						 * `summary` 也给一份。
						 *
						 * 这里原本是空数组，只往 `content` 里放。两个字段读起来像是同一句话的两种说法，实际
						 * 哪个被读走取决于对面：要求原样回放的上游读 `content`（`summary` 是概括，顶不了），
						 * 而把 Responses 翻译成别的协议的中转往往只认 `summary`——只给 `content` 时它翻译出来
						 * 的是一个没有文本的思考块，报 `thinking.thinking: Field required`。
						 *
						 * 两个都给不会被拒（实测过），那就都给。
						 */
						summary: c.thinking ? [{ type: "summary_text", text: c.thinking }] : [],
						...(c.thinking ? { content: [{ type: "reasoning_text", text: c.thinking }] } : {}),
						...(c.encrypted ? { encrypted_content: c.encrypted } : {}),
					});
				} else if (c.type === "text") {
					if (!c.text) continue;
					/*
					 * No `id`, deliberately.
					 *
					 * The provider's own item id was replayed here, and it bought nothing: on an input
					 * item of type `message` the id is optional, exists only to reference an item the
					 * provider is storing, and we store our own sessions (`store: false`). What it cost
					 * was every request that reached a different endpoint than the one that issued it —
					 * a relay routed to another upstream, a model changed mid-conversation — coming back
					 * as `Invalid 'input[14].id' … Expected an ID that contains letters, numbers,
					 * underscores, or dashes`. The text is what matters and the text is all that goes.
					 */
					input.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: c.text }],
					});
				} else {
					input.push({
						type: "function_call",
						call_id: c.id,
						name: c.name,
						arguments: c.argumentsText ?? JSON.stringify(c.arguments),
					});
					const answer = answers.get(c.id);
					if (answer) {
						input.push(functionCallOutput(answer));
						paired.add(answer);
					}
				}
			}

			// Anything in that run which answered no call here, in the order it was recorded.
			for (let at = index + 1; at < after; at++) {
				const result = messages[at] as ToolResultMessage;
				if (!paired.has(result)) input.push(functionCallOutput(result));
			}
			index = after - 1;
			continue;
		}

		// A result with no assistant message before it — the head of a truncated history.
		input.push(functionCallOutput(message));
	}

	return input;
}

export function toResponsesTools(tools: ToolSpec[]): unknown[] {
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		strict: false,
	}));
}
