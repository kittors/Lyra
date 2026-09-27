/**
 * The phone link's framing: large messages as acknowledged binary parts, small ones as they were.
 *
 * Until wire 2 every message was one WebSocket frame, and that shape broke in four places at once
 * once a conversation or an attachment got large: the relay refused frames over 8 MiB by closing the
 * link; one 20 MB transcript held every small message (a pong, a streamed token) behind it for as
 * long as the phone's network took to carry it, so the phone's 5-second heartbeat declared the link
 * dead mid-transfer; nothing bounded how much sat in the relay or in socket buffers; and each hop
 * held the whole message at once. See docs/adr/0028-sync-link-streams-large-data.md.
 *
 * Wire 2 keeps text frames for everything small and adds, both ways:
 *
 *   {"type":"stream","s":7,"size":N,"z":1?,"for":"r12"?,"label":"sessions.open"?}   announce
 *   binary [kind u8][sid u32][offset f64][bytes]                                      parts
 *   {"type":"ack","s":7,"n":bytesReceived}                                           per part
 *
 * A sender keeps at most `WINDOW_BYTES` unacknowledged, so a slow receiver slows the sender instead
 * of filling whatever sits between them — including an old relay that never learned backpressure.
 * Uploads (kind 2) share the framing and the acks; see `sync-uploads.ts`.
 *
 * Negotiated, never assumed: the desktop's hello says `wire: 2`, the phone answers
 * `{"type":"wire","version":2}`, and until that answer arrives this sends exactly what it always
 * did. An old phone never answers, so it never sees a binary frame.
 */

import { deflateRaw, inflateRaw } from "node:zlib";
import { promisify } from "node:util";

export const WIRE_VERSION = 2;
/** Messages up to this size still go as one text frame. */
export const STREAM_THRESHOLD = 256 * 1024;
/** Payload per binary part from the desktop; `ws` never fragments, so any size crosses whole. */
export const PART_BYTES = 256 * 1024;
/** Unacknowledged bytes one link may have in flight, across all its streams. */
export const WINDOW_BYTES = 1024 * 1024;
/** Written-but-unflushed bytes at which parts stop being handed to the socket. */
const LOW_WATER_BYTES = 512 * 1024;
/** A peer may announce a message up to this size; beyond it the stream is refused. */
const MAX_STREAM_BYTES = 512 * 1024 * 1024;
/** Streams one peer may have half-received at once. */
const MAX_INBOUND_STREAMS = 8;
const HEADER_BYTES = 13;

export const PART_MESSAGE = 1;
const PART_UPLOAD = 2;

const deflate = promisify(deflateRaw);
const inflate = promisify(inflateRaw);

/** What of `ws`'s WebSocket this needs — kept small so tests can hand in a fake. */
export interface WireSocket {
	readyState: number;
	send(data: string | Buffer, callback?: (error?: Error) => void): void;
}

export function encodePart(kind: number, sid: number, offset: number, payload: Buffer): Buffer {
	const frame = Buffer.allocUnsafe(HEADER_BYTES + payload.length);
	frame[0] = kind;
	frame.writeUInt32BE(sid, 1);
	frame.writeDoubleBE(offset, 5);
	payload.copy(frame, HEADER_BYTES);
	return frame;
}

export function decodePart(data: Buffer): { kind: number; sid: number; offset: number; payload: Buffer } | null {
	if (data.length < HEADER_BYTES) return null;
	const offset = data.readDoubleBE(5);
	if (!Number.isSafeInteger(offset) || offset < 0) return null;
	return { kind: data[0], sid: data.readUInt32BE(1), offset, payload: data.subarray(HEADER_BYTES) };
}

/** Where upload control messages and upload parts go; implemented by `sync-uploads.ts`. */
export interface UploadEndpoint {
	control(message: Record<string, unknown>, reply: (message: Record<string, unknown>) => void): void;
	part(sid: number, offset: number, payload: Buffer, reply: (message: Record<string, unknown>) => void): void;
	/** The peer went away or was replaced: close what is open, keep what was written. */
	release(): void;
}

interface Outbound {
	sid: number;
	bytes: Buffer;
	sent: number;
	acked: number;
	/** Called once the last part has been handed to the socket. */
	written?: () => void;
}

interface Inbound {
	size: number;
	compressed: boolean;
	buffer: Buffer;
	received: number;
}

/**
 * One peer's link: what it has said it understands, and the streams moving each way.
 *
 * Deliberately transport-blind — a direct socket and the relay's socket get the same channel — and
 * reset rather than rebuilt when a relay replaces the phone at the far end of the same socket.
 */
export class SyncChannel {
	/** The wire version the peer announced; 0 until it does, which is also what an old phone is. */
	peerWire = 0;
	/** The peer can inflate `deflate-raw`, so large messages to it are compressed. */
	peerInflates = false;

	private readonly socket: WireSocket;
	private readonly onMessage: (message: Record<string, unknown>) => void;
	private readonly uploads: UploadEndpoint | null;
	private nextSid = 1;
	private outbound: Outbound[] = [];
	private inbound = new Map<number, Inbound>();
	private unflushed = 0;
	/** Pushes wait here while an earlier push is still being streamed: pushes are ordered. */
	private orderedQueue: string[] = [];
	private orderedBusy = false;
	/** Completed inbound messages, delivered strictly in arrival order. */
	private backlog: (() => Promise<void> | void)[] = [];
	private draining = false;
	private generation = 0;

	constructor(socket: WireSocket, onMessage: (message: Record<string, unknown>) => void, uploads: UploadEndpoint | null = null) {
		this.socket = socket;
		this.onMessage = onMessage;
		this.uploads = uploads;
	}

	get streaming(): boolean {
		return this.peerWire >= WIRE_VERSION;
	}

	/** The far end is a different peer now, or gone: nothing in flight belongs to anyone. */
	reset(): void {
		this.generation++;
		this.peerWire = 0;
		this.peerInflates = false;
		this.outbound = [];
		this.inbound.clear();
		this.orderedQueue = [];
		this.orderedBusy = false;
		this.backlog = [];
		this.uploads?.release();
	}

	// -------------------------------------------------------------------------
	// Inbound
	// -------------------------------------------------------------------------

	receive(data: Buffer | string, isBinary: boolean): void {
		if (isBinary && typeof data !== "string") {
			this.receivePart(data);
			return;
		}
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(String(data)) as Record<string, unknown>;
		} catch {
			return;
		}
		if (!message || typeof message !== "object") return;
		switch (message.type) {
			case "wire":
				this.peerWire = typeof message.version === "number" ? message.version : 0;
				this.peerInflates = Array.isArray(message.inflate) && message.inflate.includes("deflate-raw");
				return;
			case "ack":
				this.acknowledge(Number(message.s), Number(message.n));
				return;
			case "stream":
				this.announce(message);
				return;
			case "stream_abort":
				this.abandon(Number(message.s));
				return;
			case "upload_begin":
			case "upload_abort":
				this.uploads?.control(message, (reply) => this.raw(JSON.stringify(reply)));
				return;
			default:
				this.deliver(() => this.onMessage(message));
		}
	}

	private announce(message: Record<string, unknown>): void {
		const sid = Number(message.s);
		const size = Number(message.size);
		if (!Number.isSafeInteger(sid) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_STREAM_BYTES || this.inbound.size >= MAX_INBOUND_STREAMS) {
			this.raw(JSON.stringify({ type: "stream_abort", s: sid, reason: "refused" }));
			return;
		}
		this.inbound.set(sid, { size, compressed: message.z === 1, buffer: Buffer.allocUnsafe(size), received: 0 });
	}

	private receivePart(data: Buffer): void {
		const part = decodePart(data);
		if (!part) return;
		if (part.kind === PART_UPLOAD) {
			this.uploads?.part(part.sid, part.offset, part.payload, (reply) => this.raw(JSON.stringify(reply)));
			return;
		}
		if (part.kind !== PART_MESSAGE) return;
		const stream = this.inbound.get(part.sid);
		// Parts arrive in order on one socket; anything else is a stream this side has already dropped.
		if (!stream || part.offset !== stream.received || stream.received + part.payload.length > stream.size) return;
		part.payload.copy(stream.buffer, stream.received);
		stream.received += part.payload.length;
		this.raw(JSON.stringify({ type: "ack", s: part.sid, n: stream.received }));
		if (stream.received < stream.size) return;
		this.inbound.delete(part.sid);
		const generation = this.generation;
		this.deliver(async () => {
			const bytes = stream.compressed ? await inflate(stream.buffer) : stream.buffer;
			if (generation !== this.generation) return;
			let message: Record<string, unknown>;
			try {
				message = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
			} catch {
				return;
			}
			this.onMessage(message);
		});
	}

	/**
	 * In arrival order, even when one of them needs inflating first.
	 *
	 * A handler's own work is not awaited — an RPC that takes a minute must not hold up the next
	 * one — only the decoding that decides when a message exists at all.
	 */
	private deliver(job: () => Promise<void> | void): void {
		this.backlog.push(job);
		if (!this.draining) void this.drain();
	}

	private async drain(): Promise<void> {
		this.draining = true;
		while (this.backlog.length > 0) {
			const job = this.backlog.shift();
			try {
				await job?.();
			} catch {
				// One message that cannot be handled must not stall the ones behind it.
			}
		}
		this.draining = false;
	}

	// -------------------------------------------------------------------------
	// Outbound
	// -------------------------------------------------------------------------

	/** Straight onto the socket: control messages, and frames something else must read whole. */
	raw(text: string): void {
		if (this.socket.readyState === 1) this.socket.send(text);
	}

	/**
	 * A push — an agent event, a settings change. Pushes arrive in the order they were made, so one
	 * that has to be streamed holds the ones behind it until its last part is written.
	 */
	push(text: string): void {
		if (this.orderedBusy) {
			this.orderedQueue.push(text);
			return;
		}
		this.sendMessage(text, {}, true);
	}

	/**
	 * An answer to one call. Answers are independent of each other and of pushes, so a large one
	 * streams alongside everything else instead of in front of it.
	 */
	reply(text: string, meta: { for?: string; label?: string } = {}): void {
		this.sendMessage(text, meta, false);
	}

	private sendMessage(text: string, meta: { for?: string; label?: string }, ordered: boolean): void {
		if (!this.streaming || text.length <= STREAM_THRESHOLD / 4) {
			// Short in characters is short in bytes too (at most four bytes each) — no encoding needed.
			this.raw(text);
			return;
		}
		const bytes = Buffer.from(text, "utf8");
		if (bytes.length <= STREAM_THRESHOLD) {
			this.raw(text);
			return;
		}
		if (ordered) this.orderedBusy = true;
		const generation = this.generation;
		void this.prepare(bytes).then(({ payload, compressed }) => {
			if (generation !== this.generation) return;
			const sid = this.nextSid++;
			this.raw(JSON.stringify({ type: "stream", s: sid, size: payload.length, ...(compressed ? { z: 1, raw: bytes.length } : {}), ...meta }));
			this.outbound.push({ sid, bytes: payload, sent: 0, acked: 0, ...(ordered ? { written: () => this.orderedDone() } : {}) });
			this.pump();
		});
	}

	/** Compressed when the peer can inflate and it is worth it; JSON usually shrinks five-fold. */
	private async prepare(bytes: Buffer): Promise<{ payload: Buffer; compressed: boolean }> {
		if (!this.peerInflates) return { payload: bytes, compressed: false };
		const packed = await deflate(bytes, { level: 3 });
		return packed.length < bytes.length * 0.9 ? { payload: packed, compressed: true } : { payload: bytes, compressed: false };
	}

	private orderedDone(): void {
		this.orderedBusy = false;
		while (!this.orderedBusy && this.orderedQueue.length > 0) {
			const next = this.orderedQueue.shift() as string;
			this.sendMessage(next, {}, true);
		}
	}

	/**
	 * The peer refused a stream (too large for it): stop sending it. If it was a push, the pushes
	 * queued behind it go now rather than wait for parts that will never be acknowledged.
	 */
	private abandon(sid: number): void {
		const stream = this.outbound.find((entry) => entry.sid === sid);
		if (!stream) return;
		this.outbound = this.outbound.filter((entry) => entry !== stream);
		const written = stream.written;
		stream.written = undefined;
		written?.();
		this.pump();
	}

	private acknowledge(sid: number, received: number): void {
		const stream = this.outbound.find((entry) => entry.sid === sid);
		if (!stream || !Number.isFinite(received)) return;
		stream.acked = Math.max(stream.acked, Math.min(received, stream.bytes.length));
		if (stream.acked >= stream.bytes.length) this.outbound = this.outbound.filter((entry) => entry !== stream);
		this.pump();
	}

	/**
	 * Hand parts to the socket while the window and the socket's own queue allow.
	 *
	 * Round-robin across streams, one part each per turn, so two large answers progress together
	 * and a small one that arrives later is not stuck behind a large one's remainder.
	 */
	private pump(): void {
		let progressed = true;
		while (progressed) {
			progressed = false;
			for (const stream of this.outbound) {
				if (stream.sent >= stream.bytes.length) continue;
				if (this.inFlight() >= WINDOW_BYTES || this.unflushed >= LOW_WATER_BYTES) return;
				if (this.socket.readyState !== 1) return;
				const payload = stream.bytes.subarray(stream.sent, stream.sent + PART_BYTES);
				const frame = encodePart(PART_MESSAGE, stream.sid, stream.sent, payload);
				stream.sent += payload.length;
				this.unflushed += frame.length;
				const generation = this.generation;
				this.socket.send(frame, () => {
					if (generation !== this.generation) return;
					this.unflushed -= frame.length;
					this.pump();
				});
				if (stream.sent >= stream.bytes.length) {
					const written = stream.written;
					stream.written = undefined;
					written?.();
				}
				progressed = true;
			}
		}
	}

	private inFlight(): number {
		let total = 0;
		for (const stream of this.outbound) total += stream.sent - stream.acked;
		return total;
	}
}
