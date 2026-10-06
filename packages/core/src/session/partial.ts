/**
 * A reply that is still being written, kept on disk while it streams.
 *
 * `message_end` is the only point where a reply enters the transcript, so a process that died
 * mid-stream used to leave the prompt with no answer at all — minutes of output gone. Now the
 * stream is written as it arrives, and a stream whose writer is gone is turned into the message the
 * user would have got by pressing stop (see `SessionStore.settlePartial`).
 *
 * Only the new tail of each block is written, never the whole reply again: `message_update` carries
 * the full partial every time, and rewriting a 100KB reply every 80ms for the minutes it takes to
 * stream writes hundreds of megabytes. Appending tails keeps the total at the size of the reply.
 * Maka's `runtime_partial_segments` makes the same choice for the same reason.
 *
 * Text and thinking only. A tool call cut off mid-arguments never ran, and replaying it without a
 * result would make the next request fail, so recovery drops it anyway.
 */

import { randomUUID } from "node:crypto";
import type { AssistantContent, AssistantMessage } from "../types.ts";

/** How long streamed text may sit in memory before it is written. Bounds what a crash loses. */
const PARTIAL_FLUSH_MS = 80;
/** Written early once this many characters are waiting, so a fast stream does not batch up megabytes. */
const PARTIAL_BATCH_CHARS = 8 * 1024;

/** New text for block `i`. `reset` replaces what the block held instead of extending it. */
export interface PartialPiece {
	i: number;
	type: "text" | "thinking";
	text: string;
	reset?: true;
}

/**
 * Where a stream is kept. `token` names one `beginPartial`: a later begin for the same session takes
 * the place over, and from then on appends and drops carrying the old token change nothing.
 */
export interface PartialSink {
	beginPartial(sessionId: string, token: string, head: AssistantMessage): Promise<void>;
	appendPartial(sessionId: string, token: string, pieces: PartialPiece[]): Promise<void>;
	dropPartial(sessionId: string, token: string): Promise<void>;
}

function textOf(block: AssistantContent): string | null {
	if (block.type === "text") return block.text;
	if (block.type === "thinking") return block.thinking;
	return null;
}

/** How much of the end of a block is compared to tell growth from a rewrite. */
const GROWTH_TAIL = 64;

/** Remembers how much of each block has been handed out, so the next call returns only what is new. */
export class PartialDiff {
	/*
	 * A length and the tail it ended on, not the whole text. Comparing the whole prefix on every
	 * delta (`startsWith`) is quadratic in the reply: measured, a 100K-character block took 2.5s of
	 * main-process time to stream and 300K took 30s. The tail check takes 33ms for 100K, and adds
	 * nothing measurable to what sending each update to the window already costs.
	 *
	 * A length alone is not enough: a block rewritten to the same length is not a block that grew.
	 * The rewrites that happen — a retried block starting over, a leading tag reclassified, text
	 * trimmed — change the characters at the old end or make the block shorter, and both are caught.
	 * What would be missed is a same-offset edit further back that leaves the last 64 characters
	 * exactly in place; no provider here does that.
	 */
	private readonly taken = new Map<number, { type: PartialPiece["type"]; length: number; tail: string }>();

	take(message: AssistantMessage): PartialPiece[] {
		const out: PartialPiece[] = [];
		message.content.forEach((block, i) => {
			const text = textOf(block);
			if (text === null) return;
			const type = block.type as PartialPiece["type"];
			const known = this.taken.get(i);
			if (known && known.type === type && grewFrom(text, known)) {
				if (text.length > known.length) out.push({ i, type, text: text.slice(known.length) });
			} else if (known || text.length > 0) {
				// First sight of the block, or it changed under us rather than growing: say it whole.
				out.push({ i, type, text, reset: true });
			}
			this.taken.set(i, { type, length: text.length, tail: text.slice(-GROWTH_TAIL) });
		});
		return out;
	}
}

function grewFrom(text: string, known: { length: number; tail: string }): boolean {
	return text.length >= known.length && text.slice(known.length - known.tail.length, known.length) === known.tail;
}

/** Adjacent tails of the same block become one, so a batch of single-token deltas is one piece. */
export function mergePieces(pieces: PartialPiece[]): PartialPiece[] {
	const out: PartialPiece[] = [];
	for (const piece of pieces) {
		const last = out.at(-1);
		if (last && !piece.reset && last.i === piece.i && last.type === piece.type) last.text += piece.text;
		else out.push({ ...piece });
	}
	return out;
}

/**
 * The reply as far as it got, or null when nothing was said.
 *
 * Shaped like the reply a stop produces — `stopReason: "aborted"` — so every rule about what the
 * model is shown already covers it.
 */
export function assemblePartial(head: AssistantMessage, chunks: PartialPiece[][]): AssistantMessage | null {
	const blocks = new Map<number, { type: PartialPiece["type"]; text: string }>();
	for (const piece of chunks.flat()) {
		const known = blocks.get(piece.i);
		if (piece.reset || !known || known.type !== piece.type) blocks.set(piece.i, { type: piece.type, text: piece.text });
		else known.text += piece.text;
	}
	const content: AssistantContent[] = [...blocks]
		.sort(([a], [b]) => a - b)
		.filter(([, block]) => block.text.length > 0)
		.map(([, block]) => (block.type === "text" ? { type: "text", text: block.text } : { type: "thinking", thinking: block.text }));
	if (content.length === 0) return null;
	return { ...head, content, stopReason: "aborted" };
}

const pendingWriters = new Set<PartialWriter>();

/**
 * Streams one session's reply into a `PartialSink`.
 *
 * The first text of a stream is written straight away — it bounds what a crash loses to nothing
 * rather than one batch — and the rest every `PARTIAL_FLUSH_MS` or `PARTIAL_BATCH_CHARS`,
 * whichever comes first.
 */
export class PartialWriter {
	private readonly sink: PartialSink;
	private readonly sessionId: () => string;
	private diff: PartialDiff | null = null;
	/** This stream's name in the sink; null when no reply is streaming. */
	private token: string | null = null;
	private pending: PartialPiece[] = [];
	private pendingChars = 0;
	private first = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	/** The last write failed and has not succeeded since: said once, not once per retry. */
	private failing = false;
	/** The reply as last seen, for `stopped`. */
	private last: AssistantMessage | null = null;

	constructor(sink: PartialSink, sessionId: () => string) {
		this.sink = sink;
		this.sessionId = sessionId;
	}

	async begin(head: AssistantMessage): Promise<void> {
		this.settle();
		this.diff = new PartialDiff();
		// Made here, not by the sink, so it exists before the first update can arrive.
		this.token = randomUUID();
		this.first = true;
		this.last = head;
		await this.sink.beginPartial(this.sessionId(), this.token, { ...head, content: [] });
	}

	/** A reply has begun and has been neither committed nor thrown away. */
	get streaming(): boolean {
		return this.diff !== null;
	}

	/** The stream a reply committed now settles; the store drops that copy and no other. */
	get stream(): string | null {
		return this.token;
	}

	async update(message: AssistantMessage): Promise<void> {
		if (!this.diff) return;
		this.last = message;
		const pieces = this.diff.take(message);
		if (pieces.length === 0) return;
		this.pending.push(...pieces);
		for (const piece of pieces) this.pendingChars += piece.text.length;
		pendingWriters.add(this);
		if (this.first || this.pendingChars >= PARTIAL_BATCH_CHARS) {
			this.first = false;
			await this.write();
			return;
		}
		this.schedule();
	}

	/**
	 * Write what is waiting. A batch that fails stays waiting, ahead of anything newer: each piece
	 * is a tail of the one before, so a batch skipped leaves a hole that every later one is read past.
	 */
	async flush(): Promise<void> {
		this.clearTimer();
		pendingWriters.delete(this);
		const token = this.token;
		if (this.pending.length === 0 || !token) return;
		const stream = this.diff;
		const batch = this.pending;
		const chars = this.pendingChars;
		this.pending = [];
		this.pendingChars = 0;
		try {
			await this.sink.appendPartial(this.sessionId(), token, mergePieces(batch));
		} catch (error) {
			// Unless the reply was settled or replaced meanwhile: then the batch belongs to nothing.
			if (this.diff === stream && stream) {
				this.pending = [...batch, ...this.pending];
				this.pendingChars += chars;
				pendingWriters.add(this);
			}
			throw error;
		}
	}

	/**
	 * `flush` for the stream itself, which does not stop for it. The copy on disk is what recovers a
	 * reply after a crash; the reply still reaches the window and the transcript without it, so a
	 * failed write is reported and retried rather than ending the turn.
	 */
	private async write(): Promise<void> {
		try {
			await this.flush();
			this.failing = false;
		} catch (error) {
			if (!this.failing) console.error("[partial] could not save the streaming reply; retrying", error);
			this.failing = true;
			this.schedule();
		}
	}

	private schedule(): void {
		if (this.timer || this.pending.length === 0) return;
		this.timer = setTimeout(() => void this.write(), PARTIAL_FLUSH_MS);
		this.timer.unref?.();
	}

	/** The reply was committed, and the commit removed what was on disk. Forget the rest. */
	settle(): void {
		this.clearTimer();
		pendingWriters.delete(this);
		this.pending = [];
		this.pendingChars = 0;
		this.failing = false;
		this.diff = null;
		this.token = null;
		this.last = null;
	}

	/**
	 * What has streamed so far, as the reply a stop would have produced; null when nothing was said.
	 * Built by the same rules a dead writer's leftovers are (`assemblePartial`). Changes nothing: the
	 * caller commits it, or discards.
	 */
	stopped(): AssistantMessage | null {
		if (!this.diff || !this.last) return null;
		const whole: PartialPiece[] = [];
		this.last.content.forEach((block, i) => {
			const text = textOf(block);
			if (text !== null) whole.push({ i, type: block.type as PartialPiece["type"], text, reset: true });
		});
		return assemblePartial(this.last, [whole]);
	}

	/** The reply was thrown away: nothing of it is to be recovered. */
	async discard(): Promise<void> {
		const token = this.token;
		this.settle();
		if (token) await this.sink.dropPartial(this.sessionId(), token);
	}

	private clearTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}
}

/**
 * Write out every batch still waiting, for a normal quit mid-stream.
 *
 * Called from an `exit` handler, where nothing asynchronous runs. That is enough for the SQLite
 * store, whose writes happen synchronously inside the call; `flush` only awaits after that.
 */
export function flushPendingPartials(): void {
	for (const writer of pendingWriters) void writer.flush().catch((error: unknown) => console.error("[partial] could not save the streaming reply on exit", error));
}
