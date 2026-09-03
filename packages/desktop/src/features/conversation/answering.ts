/**
 * Whether the answer is arriving *right now*, which is the only reason to take the running line away.
 *
 * The line folds while prose streams in, and that is right: words landing on screen are a better
 * report of progress than a phrase about progress. But "the answer is arriving" is a statement about
 * this moment, and it used to be answered with a question about the whole message — does it contain
 * any text at all. Those come apart in the most ordinary shape there is:
 *
 *     content: [ {text: "先看看这个文件"}, {toolCall: read …} ]
 *
 * One assistant message, still `pending`, holding a sentence *and* a call. Every turn where the
 * model says what it is about to do looks like this, and under the old reading the line folded at
 * the first word and stayed folded for the whole of the work that followed — a minute, five minutes,
 * however long the tools took. Meanwhile the composer went on showing 停止. Two halves of one window
 * disagreeing about whether anything was happening, and the quiet half was the one being believed:
 * people concluded the turn had finished and started typing again.
 *
 * So the question is asked of the tail, and asked again over time:
 *
 *   - The last block is what is being written. A call appended after the prose means the writing is
 *     over and the work has started, whatever came before it in the same message.
 *   - Prose that stops growing has stopped arriving. A stalled stream, a long pause between
 *     paragraphs, a provider that has gone quiet — all of them leave text as the last block forever,
 *     and none of them are the answer still coming in.
 */

import type { Message } from "@lyra/core";

/**
 * How long prose may sit unchanged before the line comes back.
 *
 * Chunks land tens of milliseconds apart while a model is actually writing, so this is never
 * reached mid-sentence and the line does not flicker during an ordinary reply. It is short enough
 * that a stall is admitted while someone is still looking at the screen rather than after they have
 * given up on it.
 */
export const STALL_MS = 2_500;

/**
 * The length of the prose being written at the tail of the transcript, or `null` if nothing is.
 *
 * A length rather than a boolean because the caller needs to know when it *changes* — that is what
 * says the stream is still alive. Growing text is a new value; a stalled stream is the same value
 * for as long as the stall lasts.
 *
 * `null` covers every way of not currently writing: no messages, the last one is not a reply, the
 * reply has settled (`pending` is the only unfinished state), or its last block is a call or
 * reasoning rather than text.
 */
export function proseLength(messages: Message[]): number | null {
	const last = messages[messages.length - 1];
	if (last?.role !== "assistant" || last.stopReason !== "pending") return null;
	const block = last.content[last.content.length - 1];
	if (block?.type !== "text") return null;
	/*
	 * Whitespace is not the answer starting.
	 *
	 * A text block is opened empty and filled by the deltas that follow, so treating its arrival as
	 * prose would fold the line away a beat early and — the turn still being unfinished — flap it
	 * back a moment later.
	 */
	const text = block.text.trim();
	return text.length > 0 ? text.length : null;
}
