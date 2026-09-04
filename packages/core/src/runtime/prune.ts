/**
 * Cutting oversized tool results down before they are sent, without asking a model.
 *
 * A single `grep` can answer with 96,000 characters — its match limit counts matches, and a match
 * in a minified file is one very long line. Two or three of those fill a 200k window on their own,
 * and by the time compaction notices, the thing it has to summarise is mostly the same file read
 * three ways. Summarising is a model call: slow, billed, and fallible exactly when the window is
 * tight. Cutting is neither.
 *
 * So this runs first and costs nothing. What survives is a head, a marker that says what was taken,
 * and a tail — the shape of a tool result being what it is: the beginning carries the answer, the
 * end carries the totals and the error, and the middle is the part you scroll past.
 *
 * Only the copy sent to the model is cut. The session log keeps the complete result, so the card in
 * the transcript still opens to everything the tool actually said, and a later replay of the log is
 * unaffected. This is a view, not an edit.
 *
 * Idempotent by construction: the replacement is strictly shorter than the threshold, so a second
 * pass over the same message finds nothing left to do.
 */

import type { Message, ToolResultMessage } from "../types.ts";

/**
 * Above this, a result is cut. Below it, nothing happens at all.
 *
 * Roughly 2,300 tokens of prose or code. Large enough that ordinary results — a file read, a test
 * run, a directory listing — pass through untouched, and small enough that a handful of the
 * pathological ones cannot spend a window between them.
 */
export const PRUNE_THRESHOLD_CHARS = 8192;
/** Kept from the front, where a tool puts its answer. */
export const PRUNE_HEAD_CHARS = 4096;
/** Kept from the back, where it puts totals, errors and "N more matches". */
export const PRUNE_TAIL_CHARS = 1024;
/**
 * Below this, cutting a result costs more than it saves.
 *
 * The marker itself is prose — it runs to a couple of hundred characters. Cutting a 300-character
 * result to insert it saves nothing at all, and pays for that nothing by rewriting the middle of
 * the conversation, which invalidates the provider's prefix cache from that point on. The next
 * request then re-bills every token above it.
 */
export const PRUNE_FLOOR_CHARS = 200;

/** Says what happened, in the model's own reading order, and how much is missing. */
function marker(omitted: number): string {
	return `\n\n… [${omitted.toLocaleString("en-US")} characters omitted by Lyra to fit the context window; the full result is kept in the session and shown in the transcript. Narrow the search or read a specific file if you need the middle.] …\n\n`;
}

/**
 * The text of a tool result, cut to size, or `null` if it was already small enough.
 *
 * Split on code points rather than UTF-16 units, so a surrogate pair is never left half-written —
 * a lone surrogate is not text any provider will accept. A grapheme cluster can still be split;
 * that costs one malformed emoji at a boundary, where the alternative is a scan of the whole
 * string for a saving nobody can see.
 */
export function pruneText(text: string, threshold = PRUNE_THRESHOLD_CHARS): string | null {
	const points = [...text];
	if (points.length <= threshold) return null;
	/*
	 * A threshold below the marker's own length would make cutting a net loss.
	 *
	 * Reachable only through a caller passing a small threshold, which the recovery path does. The
	 * marker runs to a couple of hundred characters, so cutting a 300-character result to insert
	 * it saves nothing and rewrites the middle of the conversation to do it.
	 */
	if (points.length <= PRUNE_FLOOR_CHARS) return null;

	const head = points.slice(0, PRUNE_HEAD_CHARS).join("");
	const tail = points.slice(points.length - PRUNE_TAIL_CHARS).join("");
	const omitted = points.length - PRUNE_HEAD_CHARS - PRUNE_TAIL_CHARS;
	return `${head}${marker(omitted)}${tail}`;
}

/**
 * One message, with any oversized text cut down. Returns the same object when nothing changed.
 *
 * Identity is the signal callers use to decide whether anything happened, so it matters that an
 * untouched message comes back as itself rather than as an equal copy.
 */
function pruneMessage(message: Message, threshold: number): Message {
	if (message.role !== "toolResult") return message;

	/*
	 * Measured over the text blocks together, cut on the one that is actually big.
	 *
	 * A result is usually one text block, but it does not have to be. Judging each block on its own
	 * would let ten blocks of eight thousand characters through, and cutting every block to a share
	 * of the budget would mangle a small block sitting beside a huge one.
	 */
	const total = message.content.reduce((sum, block) => sum + (block.type === "text" ? [...block.text].length : 0), 0);
	if (total <= threshold) return message;

	let cut = false;
	const content = message.content.map((block) => {
		if (block.type !== "text") return block;
		const pruned = pruneText(block.text, threshold);
		if (pruned === null) return block;
		cut = true;
		return { ...block, text: pruned };
	});
	if (!cut) return message;
	return { ...message, content } as ToolResultMessage;
}

/**
 * The conversation as it should be sent: every oversized tool result cut, everything else as it was.
 *
 * Returns the same array when nothing needed cutting, so the common case allocates nothing and a
 * caller can tell at a glance whether this pass did anything.
 */
export function pruneToolResults(messages: Message[], threshold = PRUNE_THRESHOLD_CHARS): Message[] {
	let changed = false;
	const next = messages.map((message) => {
		const pruned = pruneMessage(message, threshold);
		if (pruned !== message) changed = true;
		return pruned;
	});
	return changed ? next : messages;
}

/**
 * The same cut, taken all the way: an oversized result becomes one line saying it was there.
 *
 * The last resort, and only reached after a provider has already refused the request — see
 * `recoverFromRejection` in the loop. Cutting to a head and a tail is the right trade almost
 * always, because the head is where the answer is. It is the wrong trade in one case: when the
 * *content* is what the far end cannot handle, a head of it is still that content.
 *
 * That case is real. A 60,000-character JSON body from `gh api` made one relay's Gemini
 * translation emit a malformed request — `Unknown name "safetySettings" at 'request.contents[42]'`
 * — on every attempt, so the conversation could not be continued, retried, or escaped from. The
 * same history with that one result replaced went through immediately; the same history with an
 * equally long *plain text* result also went through, which is how we know it was never the size.
 *
 * We cannot know what any given gateway chokes on, and guessing would be a list that goes stale.
 * What we can do is stop sending the thing it choked on, and say so where the model can read it.
 */
export function stripOversizedToolResults(messages: Message[], threshold = PRUNE_THRESHOLD_CHARS): Message[] {
	let changed = false;
	const next = messages.map((message) => {
		if (message.role !== "toolResult") return message;
		const size = message.content.reduce((sum, block) => sum + (block.type === "text" ? [...block.text].length : 0), 0);
		if (size <= threshold) return message;
		changed = true;
		return {
			...message,
			content: [
				{
					type: "text" as const,
					text:
						`[${size.toLocaleString("en-US")} characters of output withheld: the provider rejected the request ` +
						`while it was included. The full result is in the session and visible in the transcript — ` +
						`run the tool again more narrowly if you need it.]`,
				},
			],
		} as ToolResultMessage;
	});
	return changed ? next : messages;
}

/**
 * How long a conversation must have been idle before rewriting its middle is free.
 *
 * Editing history invalidates a provider's prefix cache from the edit onwards, so a prune that
 * saves tokens this turn can cost more than it saved on the next one. Once the cache has expired
 * on its own there is nothing left to invalidate.
 *
 * Five minutes is the conservative reading: Anthropic's default TTL is five minutes and OpenAI's
 * automatic caching is a few. A session using a longer TTL loses nothing by this — it only means
 * the other condition (a small suffix) is what lets a prune through.
 */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * How much may sit below a prune before the lost cache outweighs it.
 *
 * Everything after the edit has to be re-sent uncached. A short tail is cheap to re-send; a long
 * one is the whole saving handed back.
 */
export const CHEAP_SUFFIX_CHARS = 32_000;

export interface PruneTiming {
	/** When the last request went out, for judging whether the cache is still warm. */
	lastRequestAt?: number;
	/** Now, injectable for tests. */
	now?: number;
}

/**
 * Whether rewriting history at `index` is worth what it breaks.
 *
 * Two ways to say yes, and they are the same reason twice: either the cache below the edit is
 * small, or it is already gone.
 */
export function worthPruning(messages: Message[], index: number, timing: PruneTiming = {}): boolean {
	const now = timing.now ?? Date.now();
	if (timing.lastRequestAt !== undefined && now - timing.lastRequestAt >= CACHE_TTL_MS) return true;

	let suffix = 0;
	for (let at = index + 1; at < messages.length; at += 1) {
		for (const block of messages[at].content) {
			if (block.type === "text") suffix += block.text.length;
			if (suffix > CHEAP_SUFFIX_CHARS) return false;
		}
	}
	return true;
}

/**
 * Empty out the results that were never going to be read again.
 *
 * Emptied in place, never removed. A `tool_use` whose `tool_result` is missing makes Anthropic
 * reject the request — and not just that request: every later one carrying the same history, which
 * includes the one sent to recover from it. One orphan does not spoil a turn, it spoils the
 * conversation.
 */
export function dropUneventful(messages: Message[], timing: PruneTiming = {}): Message[] {
	let changed = false;
	const next = messages.map((message, index) => {
		if (message.role !== "toolResult" || !message.uneventful) return message;
		const size = message.content.reduce((sum, block) => sum + (block.type === "text" ? block.text.length : 0), 0);
		if (size <= PRUNE_FLOOR_CHARS) return message;
		if (!worthPruning(messages, index, timing)) return message;
		changed = true;
		return { ...message, content: [{ type: "text" as const, text: "[无结果]" }] } as ToolResultMessage;
	});
	return changed ? next : messages;
}
