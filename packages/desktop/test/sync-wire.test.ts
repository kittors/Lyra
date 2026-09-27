/**
 * The desktop half of wire 2, against a socket that records what it was handed.
 *
 * What these pin down is the part that has to be right regardless of network: a peer that never
 * said `wire` gets exactly the frames an old phone understands; one that did gets large messages in
 * acknowledged parts with never more than a window in flight; pushes keep their order even when one
 * of them is large; answers do not wait behind each other.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import {
	decodePart,
	encodePart,
	PART_BYTES,
	PART_MESSAGE,
	STREAM_THRESHOLD,
	SyncChannel,
	WINDOW_BYTES,
	type WireSocket,
} from "../electron/sync-wire.ts";

interface Sent {
	data: string | Buffer;
	binary: boolean;
}

/** A socket that flushes each write on the next tick, like `ws` handing bytes to the kernel. */
function fakeSocket(): WireSocket & { sent: Sent[] } {
	const sent: Sent[] = [];
	return {
		readyState: 1,
		sent,
		send(data: string | Buffer, callback?: (error?: Error) => void) {
			sent.push({ data, binary: typeof data !== "string" });
			if (callback) setImmediate(() => callback());
		},
	};
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const texts = (socket: { sent: Sent[] }) => socket.sent.filter((s) => !s.binary).map((s) => JSON.parse(String(s.data)) as Record<string, unknown>);
const parts = (socket: { sent: Sent[] }) => socket.sent.filter((s) => s.binary).map((s) => decodePart(s.data as Buffer)!);

/** A peer that acknowledges every part it is handed, as the phone does. */
async function drain(channel: SyncChannel, socket: { sent: Sent[] }, sid: number): Promise<Buffer> {
	const received: Buffer[] = [];
	let seen = 0;
	for (let round = 0; round < 10_000; round++) {
		await tick();
		const mine = parts(socket).filter((p) => p.sid === sid);
		for (const part of mine.slice(seen)) {
			received.push(part.payload);
			channel.receive(JSON.stringify({ type: "ack", s: sid, n: received.reduce((n, b) => n + b.length, 0) }), false);
		}
		seen = mine.length;
		const announced = texts(socket).find((m) => m.type === "stream" && m.s === sid);
		if (announced && received.reduce((n, b) => n + b.length, 0) >= Number(announced.size)) break;
	}
	return Buffer.concat(received);
}

const big = (bytes: number) => JSON.stringify({ type: "rpc_result", id: "r1", ok: true, value: randomBytes(bytes / 2).toString("hex") });

test("a part's header survives the trip and rejects offsets that cannot be one", () => {
	const payload = randomBytes(1000);
	const decoded = decodePart(encodePart(PART_MESSAGE, 7, 3 * 2 ** 40, payload));
	assert.deepEqual({ ...decoded, payload: undefined }, { kind: PART_MESSAGE, sid: 7, offset: 3 * 2 ** 40, payload: undefined });
	assert.ok(decoded?.payload.equals(payload));
	const bad = encodePart(PART_MESSAGE, 1, 0, payload);
	bad.writeDoubleBE(1.5, 5);
	assert.equal(decodePart(bad), null);
	assert.equal(decodePart(Buffer.alloc(5)), null);
});

test("a peer that never said wire 2 gets a large answer as one text frame, as an old phone expects", async () => {
	const socket = fakeSocket();
	const channel = new SyncChannel(socket, () => {});
	const text = big(4 * 1024 * 1024);
	channel.reply(text, { for: "r1", label: "sessions.open" });
	await tick();
	assert.equal(socket.sent.length, 1);
	assert.equal(socket.sent[0].binary, false);
	assert.equal(socket.sent[0].data, text);
});

test("a peer that said wire 2 gets a large answer in parts, never more than a window unacknowledged", async () => {
	const socket = fakeSocket();
	const channel = new SyncChannel(socket, () => {});
	channel.receive(JSON.stringify({ type: "wire", version: 2 }), false);
	const text = big(6 * 1024 * 1024);
	channel.reply(text, { for: "r1", label: "sessions.open" });
	await tick();

	const [announce] = texts(socket);
	assert.equal(announce.type, "stream");
	assert.equal(announce.for, "r1");
	assert.equal(announce.label, "sessions.open");
	assert.equal(announce.z, undefined, "not compressed for a peer that cannot inflate");
	// Nothing acknowledged yet: exactly one window has been handed over, and then it waits.
	for (let i = 0; i < 20; i++) await tick();
	const inFlight = parts(socket).reduce((n, p) => n + p.payload.length, 0);
	assert.equal(inFlight, WINDOW_BYTES);
	assert.ok(parts(socket).every((p) => p.payload.length <= PART_BYTES));

	const received = await drain(channel, socket, Number(announce.s));
	assert.equal(received.toString("utf8"), text);
});

test("a peer that can inflate gets the large answer compressed, and it inflates to the original", async () => {
	const socket = fakeSocket();
	const channel = new SyncChannel(socket, () => {});
	channel.receive(JSON.stringify({ type: "wire", version: 2, inflate: ["deflate-raw"] }), false);
	// Text that compresses the way a transcript does.
	const text = JSON.stringify({ type: "rpc_result", id: "r2", ok: true, value: Array.from({ length: 40_000 }, (_, i) => ({ role: "assistant", content: `line ${i} of a long answer` })) });
	channel.reply(text, { for: "r2" });
	for (let i = 0; i < 50 && texts(socket).length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
	const [announce] = texts(socket);
	assert.equal(announce.z, 1);
	assert.equal(announce.raw, Buffer.byteLength(text));
	assert.ok(Number(announce.size) < Buffer.byteLength(text) / 3, `compressed to ${announce.size} of ${Buffer.byteLength(text)}`);
	const received = await drain(channel, socket, Number(announce.s));
	assert.equal(inflateRawSync(received).toString("utf8"), text);
});

test("small answers go out while a large one is still streaming", async () => {
	const socket = fakeSocket();
	const channel = new SyncChannel(socket, () => {});
	channel.receive(JSON.stringify({ type: "wire", version: 2 }), false);
	channel.reply(big(4 * 1024 * 1024), { for: "r1" });
	await tick();
	channel.reply(JSON.stringify({ type: "rpc_result", id: "r2", ok: true, value: 1 }));
	const order = socket.sent.map((s) => (s.binary ? "part" : (JSON.parse(String(s.data)) as { type: string; id?: string }).id ?? "stream"));
	const small = order.indexOf("r2");
	assert.ok(small > 0 && small < order.length, "the small answer was written");
	assert.ok(parts(socket).length < Math.ceil((4 * 1024 * 1024) / PART_BYTES), "…before the large one had finished");
});

test("pushes keep their order: a large one holds the small ones behind it until its last part is written", async () => {
	const socket = fakeSocket();
	const channel = new SyncChannel(socket, () => {});
	channel.receive(JSON.stringify({ type: "wire", version: 2 }), false);
	const large = JSON.stringify({ type: "agent_event", sessionId: "s", event: { type: "message_end", text: "x".repeat(2 * 1024 * 1024) } });
	channel.push(large);
	channel.push(JSON.stringify({ type: "agent_event", sessionId: "s", event: { type: "message_start", n: 2 } }));
	channel.push(JSON.stringify({ type: "agent_event", sessionId: "s", event: { type: "message_update", n: 3 } }));
	await tick();
	const announce = texts(socket).find((m) => m.type === "stream");
	assert.ok(announce);
	assert.ok(!texts(socket).some((m) => m.type === "agent_event"), "nothing may overtake the large push");
	await drain(channel, socket, Number(announce.s));
	const events = texts(socket).filter((m) => m.type === "agent_event").map((m) => (m.event as { n: number }).n);
	assert.deepEqual(events, [2, 3]);
	const lastPart = socket.sent.map((s) => s.binary).lastIndexOf(true);
	const firstSmall = socket.sent.findIndex((s) => !s.binary && String(s.data).includes('"message_start"'));
	assert.ok(firstSmall > lastPart, "the small pushes follow the large one's last part");
});

test("a push the phone refuses as too large does not hold the pushes behind it", async () => {
	const socket = fakeSocket();
	const channel = new SyncChannel(socket, () => {});
	channel.receive(JSON.stringify({ type: "wire", version: 2 }), false);
	channel.push(JSON.stringify({ type: "agent_event", event: { n: 1, text: "z".repeat(3 * 1024 * 1024) } }));
	channel.push(JSON.stringify({ type: "agent_event", event: { n: 2 } }));
	await tick();
	const announce = texts(socket).find((m) => m.type === "stream")!;
	assert.ok(!texts(socket).some((m) => m.type === "agent_event"));
	channel.receive(JSON.stringify({ type: "stream_abort", s: announce.s, reason: "refused" }), false);
	assert.deepEqual(texts(socket).filter((m) => m.type === "agent_event").map((m) => (m.event as { n: number }).n), [2]);
});

test("a message the phone sends in parts is acknowledged part by part and delivered whole, in order", async () => {
	const socket = fakeSocket();
	const delivered: Record<string, unknown>[] = [];
	const channel = new SyncChannel(socket, (message) => delivered.push(message));
	const text = JSON.stringify({ type: "rpc", id: "r9", method: "agent.prompt", args: ["s", [{ type: "text", text: "y".repeat(300_000) }]] });
	const bytes = Buffer.from(text);
	channel.receive(JSON.stringify({ type: "stream", s: 1, size: bytes.length }), false);
	for (let at = 0; at < bytes.length; at += 49_152) channel.receive(encodePart(PART_MESSAGE, 1, at, bytes.subarray(at, at + 49_152)), true);
	channel.receive(JSON.stringify({ type: "rpc", id: "r10", method: "agent.abort", args: ["s"] }), false);
	await tick();
	await tick();
	assert.deepEqual(delivered.map((m) => m.id), ["r9", "r10"]);
	assert.equal(JSON.stringify(delivered[0]), text);
	const acks = texts(socket).filter((m) => m.type === "ack");
	assert.equal(acks.length, Math.ceil(bytes.length / 49_152));
	assert.equal(acks.at(-1)?.n, bytes.length);
});

test("a stream larger than the limit is refused, not allocated", () => {
	const socket = fakeSocket();
	const channel = new SyncChannel(socket, () => {});
	channel.receive(JSON.stringify({ type: "stream", s: 3, size: 2 ** 40 }), false);
	assert.deepEqual(texts(socket), [{ type: "stream_abort", s: 3, reason: "refused" }]);
});

test("a reset drops everything in flight and forgets what the old peer understood", async () => {
	const socket = fakeSocket();
	const channel = new SyncChannel(socket, () => {});
	channel.receive(JSON.stringify({ type: "wire", version: 2 }), false);
	channel.reply(big(3 * 1024 * 1024), { for: "r1" });
	await tick();
	const before = socket.sent.length;
	channel.reset();
	assert.equal(channel.streaming, false);
	for (let i = 0; i < 10; i++) await tick();
	channel.receive(JSON.stringify({ type: "ack", s: 1, n: 1024 }), false);
	await tick();
	assert.equal(socket.sent.length, before, "nothing more of the old stream is sent to whoever is there now");
	channel.reply(big(STREAM_THRESHOLD * 2));
	assert.equal(socket.sent.at(-1)?.binary, false, "and the new peer is spoken to as an old phone until it says otherwise");
});
