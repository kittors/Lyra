/**
 * Making a transcript safe to hand to a different model than the one that wrote it.
 *
 * Every kind of assistant block carries an opaque handle from whichever provider produced it: an
 * Anthropic thinking signature, a Responses reasoning item id, the item id of a paragraph or of a
 * tool call, an encrypted payload replayed verbatim. All of them land in one `signature` field,
 * because from the outside they play the same role — and that is exactly what makes them dangerous
 * to replay after a switch. The encoders each check that a handle is *present*; none of them can
 * tell whose it is. So an Anthropic signature handed to the Responses API goes out as
 * `id: "ErUBCkYIBRgCKkA..."`, and the request is rejected outright rather than degraded.
 *
 * This used to clean reasoning blocks only, which left `id: "msg-2026…"` on every assistant
 * paragraph — and since that id lives in the stored history, the rejection came back on every
 * subsequent turn and no retry could clear it.
 *
 * Dropping the handle leaves the text in place, so the transcript reads the same on screen. What
 * the *model* sees of another model's reasoning is decided further down, by the encoder: see
 * `fromHome` in `openai-responses-request.ts`, which leaves a foreign reasoning block out of the
 * request entirely rather than sending text that upstream will not accept without its id.
 */

import type { Message } from "../types.ts";

/**
 * The transcript with pre-switch provider handles removed.
 *
 * Returns the original array when there is nothing to do, so the ordinary case — a session whose
 * model never changed — costs one comparison and allocates nothing.
 */
export function stripStaleHandles(messages: Message[], switchedAt: number | undefined): Message[] {
	if (!switchedAt || switchedAt <= 0) return messages;

	let changed = false;
	const out = messages.map((message, index) => {
		if (index >= switchedAt || message.role !== "assistant" || !Array.isArray(message.content)) {
			return message;
		}
		let touched = false;
		const content = message.content.map((block) => {
			if (block.type === "thinking") {
				if (block.signature === undefined && block.encrypted === undefined) return block;
				touched = true;
				/*
				 * `redacted` goes too. It means "the text was filtered out but the payload is still
				 * replayable" — and once the payload is gone it is a block with nothing in it at all,
				 * which the Anthropic encoder would drop anyway and the others would send empty.
				 */
				const { signature: _signature, encrypted: _encrypted, redacted: _redacted, ...rest } = block;
				return rest;
			}
			/*
			 * Text and tool calls carry a handle too, and it was being missed.
			 *
			 * `openai-responses.ts` stores the provider's item id on all three kinds of block, not
			 * just on reasoning — so a transcript cleaned of its thinking handles still went out with
			 * `id: "msg-2026…"` on every assistant paragraph, and the request was rejected outright
			 * with `Invalid 'input[14].id'`. Because that id lives in the stored history, no retry
			 * and no switching back could clear it; the conversation simply stopped working.
			 *
			 * A tool call's `id` is *not* a provider handle in the same sense — it is the `call_id`
			 * that its result is paired by, on the wire and in our own log — so that one stays. Only
			 * `signature`, the item id, is dropped.
			 */
			if (block.signature === undefined) return block;
			touched = true;
			const { signature: _signature, ...rest } = block;
			return rest;
		});
		if (!touched) return message;
		changed = true;
		return { ...message, content };
	});

	return changed ? out : messages;
}
