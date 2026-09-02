/**
 * Our messages, in the shape the Responses API wants.
 *
 * Purely a translation: no network, no state, no decisions beyond how each kind of content maps.
 * Separated from the streaming half because the two are read for different reasons — this one when
 * a message is not being sent correctly, the other when a reply is not being read correctly.
 */

import type { Message, ToolResultMessage, ToolSpec } from "../types.ts";

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
export function toResponsesInput(messages: Message[]): unknown[] {
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

			for (const c of message.content) {
				if (c.type === "thinking") {
					/*
					 * With the provider's own item id, replayed exactly as it arrived. That id is what
					 * lets the provider pick its own chain of thought back up, and a summary offered in
					 * its place is not accepted as a substitute for it.
					 */
					if (c.signature) {
						input.push({
							type: "reasoning",
							id: c.signature,
							summary: c.thinking ? [{ type: "summary_text", text: c.thinking }] : [],
							...(c.encrypted ? { encrypted_content: c.encrypted } : {}),
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
					input.push({
						type: "reasoning",
						summary: [],
						...(c.thinking ? { content: [{ type: "reasoning_text", text: c.thinking }] } : {}),
						...(c.encrypted ? { encrypted_content: c.encrypted } : {}),
					});
				} else if (c.type === "text") {
					if (!c.text) continue;
					input.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: c.text }],
						...(c.signature ? { id: c.signature } : {}),
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
