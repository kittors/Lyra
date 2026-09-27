/**
 * Large data through the relay: streamed, kept whole, and paced by the slower end.
 *
 * Each case here is a way the relay used to break the link, reproduced with the traffic a real
 * client sends — `ws` on the desktop sends a transcript as one frame, Chromium on the phone splits
 * anything over ~128 KiB into continuation frames — against a real relay process. Raw sockets stand
 * in where a library would hide the thing under test (a partial frame, a reserved bit, an unread
 * receive buffer).
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const MB = 1024 * 1024;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function relay(t: TestContext, env: Record<string, string> = {}): Promise<number> {
	const child: ChildProcess = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: "0", ...env }, stdio: "pipe" });
	t.after(() => {
		child.kill("SIGKILL");
	});
	return new Promise<number>((resolve, reject) => {
		let stdout = "";
		const timer = setTimeout(() => reject(new Error("relay did not start")), 10_000);
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
			const match = /listening on :(\d+)/.exec(stdout);
			if (!match) return;
			clearTimeout(timer);
			resolve(Number(match[1]));
		});
	});
}

interface Member {
	socket: WebSocket;
	/** Messages from the far end, in order, as the library delivers them — whole messages only. */
	messages: { data: Buffer; binary: boolean }[];
	/** The relay's own words. */
	relay: string[];
	closed: boolean;
}

/** A `ws` client that has joined `room`, as the desktop's relay link and the probes do. */
async function member(t: TestContext, port: number, room: string, role: "desktop" | "mobile"): Promise<Member> {
	const socket = new WebSocket(`ws://127.0.0.1:${port}`, { maxPayload: 512 * MB });
	t.after(() => socket.terminate());
	const self: Member = { socket, messages: [], relay: [], closed: false };
	socket.on("message", (data: Buffer, binary: boolean) => {
		const word = !binary && data.length < 200 ? /"type":"(waiting|ready|peer-left|error|asset_request)"/.exec(data.toString())?.[1] : undefined;
		if (word) self.relay.push(word);
		else self.messages.push({ data, binary });
	});
	socket.on("close", () => {
		self.closed = true;
	});
	socket.on("error", () => {});
	await new Promise<void>((resolve, reject) => {
		socket.once("open", () => {
			socket.send(JSON.stringify({ type: "hello", room, role }));
			resolve();
		});
		socket.once("error", reject);
	});
	return self;
}

async function pair(t: TestContext, port: number): Promise<{ desktop: Member; mobile: Member }> {
	const room = hash(randomBytes(16));
	const desktop = await member(t, port, room, "desktop");
	const mobile = await member(t, port, room, "mobile");
	await until(() => desktop.relay.includes("ready") && mobile.relay.includes("ready"), "both ends ready");
	return { desktop, mobile };
}

async function until(check: () => boolean, what: string, ms = 10_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (check()) return;
		await wait(20);
	}
	assert.fail(`timed out waiting for ${what}`);
}

// ---------------------------------------------------------------------------
// A raw client, for the frames no library will send
// ---------------------------------------------------------------------------

interface Raw {
	socket: Socket;
	/** Every byte the relay has written to this socket after the handshake. */
	received: Buffer[];
	closed: boolean;
}

async function raw(t: TestContext, port: number, hello?: { room: string; role: string }): Promise<Raw> {
	const socket = connect(port, "127.0.0.1");
	t.after(() => socket.destroy());
	const self: Raw = { socket, received: [], closed: false };
	await new Promise<void>((resolve, reject) => {
		socket.once("connect", () => resolve());
		socket.once("error", reject);
	});
	socket.write(
		"GET / HTTP/1.1\r\nHost: relay\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
			`Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
	);
	await new Promise<void>((resolve) => {
		let head = Buffer.alloc(0);
		const onData = (chunk: Buffer) => {
			head = Buffer.concat([head, chunk]);
			const end = head.indexOf("\r\n\r\n");
			if (end < 0) return;
			socket.off("data", onData);
			const rest = head.subarray(end + 4);
			if (rest.length) self.received.push(rest);
			socket.on("data", (more: Buffer) => self.received.push(more));
			resolve();
		};
		socket.on("data", onData);
	});
	socket.on("close", () => {
		self.closed = true;
	});
	socket.on("error", () => {});
	if (hello) socket.write(frame(Buffer.from(JSON.stringify({ type: "hello", ...hello })), 0x1));
	return self;
}

/** A client frame: masked, with the given FIN bit, opcode and (optionally lying) length. */
function frame(payload: Buffer, opcode: number, { fin = true, length = payload.length, reserved = 0 } = {}): Buffer {
	const mask = randomBytes(4);
	const first = (fin ? 0x80 : 0) | reserved | opcode;
	let header: Buffer;
	if (length < 126) header = Buffer.from([first, 0x80 | length]);
	else if (length < 65536) {
		header = Buffer.alloc(4);
		header[0] = first;
		header[1] = 0x80 | 126;
		header.writeUInt16BE(length, 2);
	} else {
		header = Buffer.alloc(10);
		header[0] = first;
		header[1] = 0x80 | 127;
		header.writeBigUInt64BE(BigInt(length), 2);
	}
	const masked = Buffer.from(payload);
	for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
	return Buffer.concat([header, mask, masked]);
}

/** Server frames out of a byte stream: whole frames only, and whatever is left over. */
function parseFrames(bytes: Buffer): { frames: { fin: boolean; opcode: number; payload: Buffer }[]; rest: number } {
	const frames: { fin: boolean; opcode: number; payload: Buffer }[] = [];
	let at = 0;
	for (;;) {
		if (bytes.length - at < 2) break;
		let length = bytes[at + 1] & 0x7f;
		let offset = at + 2;
		if (length === 126) {
			if (bytes.length - at < 4) break;
			length = bytes.readUInt16BE(at + 2);
			offset = at + 4;
		} else if (length === 127) {
			if (bytes.length - at < 10) break;
			length = Number(bytes.readBigUInt64BE(at + 2));
			offset = at + 10;
		}
		if (bytes.length < offset + length) break;
		frames.push({ fin: (bytes[at] & 0x80) !== 0, opcode: bytes[at] & 0x0f, payload: bytes.subarray(offset, offset + length) });
		at = offset + length;
	}
	return { frames, rest: bytes.length - at };
}

const joined = (client: Raw) => Buffer.concat(client.received).toString("latin1").includes('"ready"');

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

test("a transcript sent as one 20 MiB frame reaches the phone intact", async (t) => {
	/*
	 * `ws` sends a message as one frame, and a large conversation's transcript is one message. The
	 * relay used to refuse any frame over 8 MiB by disconnecting the desktop — and the phone's
	 * resync asked for the same transcript again, so the link fell over in a loop.
	 */
	const port = await relay(t);
	const { desktop, mobile } = await pair(t, port);
	const payload = randomBytes(20 * MB);
	desktop.socket.send(payload, { binary: true });
	await until(() => mobile.messages.length > 0 || mobile.closed || desktop.closed, "the transcript", 30_000);
	assert.equal(desktop.closed, false, "the desktop must not be disconnected for sending a large frame");
	assert.equal(mobile.messages.length, 1);
	assert.equal(hash(mobile.messages[0].data), hash(payload));
});

test("a message Chromium splits into continuation frames arrives as one message", async (t) => {
	/*
	 * The Android WebView sends anything over ~128 KiB as a first frame with FIN clear and a run of
	 * continuation frames. The relay re-sent each with FIN set: the desktop got a truncated JSON
	 * text, then a continuation with nothing to continue, and closed the link on the protocol error.
	 * A phone could not send one photo through a relay.
	 */
	const port = await relay(t);
	const { desktop, mobile } = await pair(t, port);
	const text = JSON.stringify({ type: "rpc", id: "r1", method: "agent.prompt", args: ["s", "x".repeat(3 * MB)] });
	const bytes = Buffer.from(text);
	for (let at = 0; at < bytes.length; at += 128 * 1024) {
		mobile.socket.send(bytes.subarray(at, at + 128 * 1024), { binary: false, fin: at + 128 * 1024 >= bytes.length });
	}
	await until(() => desktop.messages.length > 0 || desktop.closed, "the prompt", 20_000);
	assert.equal(desktop.closed, false, "the desktop must not see a protocol error");
	assert.equal(desktop.messages.length, 1);
	assert.equal(desktop.messages[0].binary, false);
	assert.equal(desktop.messages[0].data.toString(), text);
});

test("a frame larger than the old 8 MiB ceiling is forwarded as it arrives, not collected", async (t) => {
	/*
	 * Streaming is what bounds memory now: the payload leaves as it comes in, so a frame that never
	 * completes costs a socket buffer, not its declared size. Asserted from the far side — the phone
	 * holds most of the payload while the desktop is still in the middle of sending it.
	 */
	const port = await relay(t);
	const room = hash(randomBytes(16));
	const desktop = await raw(t, port, { room, role: "desktop" });
	const phone = await raw(t, port, { room, role: "mobile" });
	await until(() => joined(desktop) && joined(phone), "both joined");
	phone.received.length = 0;

	const declared = 64 * MB;
	const payload = randomBytes(12 * MB);
	const whole = frame(Buffer.alloc(0), 0x2, { length: declared });
	// Header and mask only, then a slice of payload masked with the same key.
	const header = whole.subarray(0, 14);
	const mask = header.subarray(10, 14);
	const masked = Buffer.from(payload);
	for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
	desktop.socket.write(header);
	desktop.socket.write(masked);
	await until(() => phone.received.reduce((n, b) => n + b.length, 0) >= payload.length, "the payload streaming through", 20_000);
	const got = Buffer.concat(phone.received);
	assert.equal(got[0], 0x82, "a binary frame with FIN set, as the desktop sent it");
	assert.equal(got[1], 127);
	assert.equal(Number(got.readBigUInt64BE(2)), declared);
	assert.equal(hash(got.subarray(10, 10 + payload.length)), hash(payload));
	assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

test("a phone that reads slowly slows the desktop down instead of filling the relay", async (t) => {
	/*
	 * The relay wrote whatever arrived to the other socket and ignored the answer, so the difference
	 * between a desktop's uplink and a phone's downlink piled up in its memory. With backpressure the
	 * wait moves back to the sender: the desktop's own send buffer stays full while the phone is not
	 * reading, and everything still arrives once it does.
	 */
	const port = await relay(t);
	const room = hash(randomBytes(16));
	const desktop = await member(t, port, room, "desktop");
	const phone = await raw(t, port, { room, role: "mobile" });
	await until(() => desktop.relay.includes("ready") && joined(phone), "both joined");
	phone.received.length = 0;
	phone.socket.pause();

	const chunks = Array.from({ length: 48 }, () => randomBytes(MB));
	for (const chunk of chunks) desktop.socket.send(chunk, { binary: true });
	await wait(1500);
	/*
	 * Measured where the kernel leaves it measurable. On Windows' loopback the socket buffers are
	 * tuned up as data arrives, and they can take the whole 48 MiB between them — the desktop's own
	 * buffer then reads 0 whether the relay pushes back or not (it did, in one release run in three).
	 * The relay is the same JavaScript on every platform, so macOS and Linux answer for it.
	 */
	if (process.platform !== "win32") {
		assert.ok(
			desktop.socket.bufferedAmount > 24 * MB,
			`most of 48 MiB should still be waiting on the desktop, not inside the relay (desktop still holds ${Math.round(desktop.socket.bufferedAmount / MB)} MiB)`,
		);
	}

	phone.socket.resume();
	await until(() => parseFrames(Buffer.concat(phone.received)).frames.length >= chunks.length, "all 48 messages", 30_000);
	const { frames } = parseFrames(Buffer.concat(phone.received));
	assert.deepEqual(frames.map((f) => hash(f.payload)), chunks.map((c) => hash(c)));
});

test("the relay's own frames wait for the message in flight to finish", async (t) => {
	/*
	 * A frame written into the middle of another frame's payload is read as payload; a data frame
	 * written between two fragments of a message is a protocol error. Streaming creates both
	 * openings, so the relay's own frames — a pong, an asset request — are held for a boundary.
	 */
	const port = await relay(t);
	const room = hash(randomBytes(16));
	const assetKey = hash(`lyra-assets\0${room}`);
	const desktop = await raw(t, port);
	desktop.socket.write(frame(Buffer.from(JSON.stringify({ type: "hello", room, role: "desktop", assetKey })), 0x1));
	const phone = await raw(t, port, { room, role: "mobile" });
	await until(() => joined(desktop) && joined(phone), "both joined");
	desktop.received.length = 0;
	phone.received.length = 0;

	// The phone starts a fragmented message and pauses in the middle of it.
	phone.socket.write(frame(Buffer.from('{"type":"rpc","id":"r1","args":["'), 0x1, { fin: false }));
	await wait(200);
	// Meanwhile a browser asks the relay for a renderer asset: the relay wants to tell the desktop.
	const asset = fetch(`http://127.0.0.1:${port}/app/${assetKey}/index.html`).catch(() => null);
	// And the desktop pings in the middle of it all.
	desktop.socket.write(frame(Buffer.from("hi"), 0x9));
	await wait(300);
	phone.socket.write(frame(Buffer.from('tail"]}'), 0x0, { fin: true }));
	await until(() => parseFrames(Buffer.concat(desktop.received)).frames.length >= 4, "the message, the pong and the asset request");

	const { frames, rest } = parseFrames(Buffer.concat(desktop.received));
	assert.equal(rest, 0, "no stray bytes: every frame is whole");
	const kinds = frames.map((f) => (f.opcode === 0xa ? "pong" : f.opcode === 0x0 ? "continuation" : f.payload.toString().includes("asset_request") ? "asset_request" : "data"));
	// The pong may come between the fragments; the asset request only after the message's last one.
	const last = kinds.lastIndexOf("continuation");
	assert.ok(kinds.indexOf("asset_request") > last, `asset request inside the message: ${kinds.join(",")}`);
	assert.equal(frames[0].fin, false);
	assert.equal(frames[last].fin, true);
	assert.equal(Buffer.concat(frames.filter((f) => f.opcode !== 0xa && !f.payload.toString().includes("asset_request")).map((f) => f.payload)).toString(), '{"type":"rpc","id":"r1","args":["tail"]}');
	void asset;
});

test("a sender that leaves mid-frame closes the receiver instead of feeding it half a frame", async (t) => {
	/*
	 * The phone is partway into reading the desktop's frame. A `peer-left` written now would be read
	 * as the rest of that payload. There is nothing honest to write, so the phone is disconnected and
	 * reconnects — which every client already treats as "resync from the log".
	 */
	const port = await relay(t);
	const room = hash(randomBytes(16));
	const desktop = await raw(t, port, { room, role: "desktop" });
	const phone = await member(t, port, room, "mobile");
	await until(() => joined(desktop) && phone.relay.includes("ready"), "both joined");
	const whole = frame(randomBytes(2 * MB), 0x2);
	desktop.socket.write(whole.subarray(0, MB));
	await wait(300);
	desktop.socket.destroy();
	await until(() => phone.closed, "the phone being closed");
	assert.equal(phone.messages.length, 0, "no truncated message may be delivered");
	assert.ok(!phone.relay.includes("peer-left"), "peer-left cannot be written into a frame");
});

test("a phone that goes away without a close frame frees its seat for the next connection", async (t) => {
	/*
	 * A phone whose app is killed closes its socket with a bare FIN, no WebSocket close frame. The
	 * HTTP server hands upgraded sockets over half-open, so that FIN never closed anything: the old
	 * member kept the room's mobile role, and the same phone reconnecting was refused as role-full.
	 */
	const port = await relay(t);
	const room = hash(randomBytes(16));
	const desktop = await member(t, port, room, "desktop");
	const gone = await raw(t, port, { room, role: "mobile" });
	await until(() => desktop.relay.includes("ready") && joined(gone), "the first phone joined");
	gone.socket.end();
	await until(() => desktop.relay.includes("peer-left"), "the desktop hearing the phone left");
	const back = await member(t, port, room, "mobile");
	await until(() => back.relay.includes("ready") || back.relay.includes("error"), "the phone rejoining");
	assert.ok(back.relay.includes("ready"), `the returning phone was refused: ${back.relay.join(",")}`);
});

// ---------------------------------------------------------------------------
// Malformed input
// ---------------------------------------------------------------------------

for (const [name, bytes] of [
	["a reserved bit that no extension was negotiated for", frame(Buffer.from("x"), 0x1, { reserved: 0x40 })],
	["a continuation frame with nothing to continue", frame(Buffer.from("x"), 0x0)],
	["a control frame longer than 125 bytes", frame(Buffer.alloc(200), 0x9)],
	["a fragmented control frame", frame(Buffer.from("x"), 0x9, { fin: false })],
	["an unknown opcode", frame(Buffer.from("x"), 0x3)],
	["a length with its top bit set", (() => {
		const bad = frame(Buffer.alloc(0), 0x2, { length: 70000 });
		bad.writeBigUInt64BE(0x8000000000000001n, 2);
		return bad.subarray(0, 14);
	})()],
] as const) {
	test(`${name} closes that connection and nothing else`, async (t) => {
		const port = await relay(t);
		const { desktop } = await pair(t, port);
		const room = hash(randomBytes(16));
		const bad = await raw(t, port, { room, role: "desktop" });
		await until(() => Buffer.concat(bad.received).toString("latin1").includes("waiting"), "waiting");
		bad.socket.write(bytes);
		await until(() => bad.closed, "the connection closing");
		// Another room is untouched, and the relay is still up.
		desktop.socket.send("still here");
		assert.equal(desktop.closed, false);
		assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
	});
}

test("a new message cannot start inside a fragmented one", async (t) => {
	const port = await relay(t);
	const room = hash(randomBytes(16));
	const phone = await raw(t, port, { room, role: "mobile" });
	await until(() => Buffer.concat(phone.received).toString("latin1").includes("waiting"), "waiting");
	phone.socket.write(frame(Buffer.from("first half"), 0x1, { fin: false }));
	phone.socket.write(frame(Buffer.from("a new message"), 0x1));
	await until(() => phone.closed, "the connection closing");
});

test("a frame claiming more than the frame limit is refused before a byte is forwarded", async (t) => {
	const port = await relay(t, { LYRA_RELAY_MAX_FRAME: String(MB) });
	const room = hash(randomBytes(16));
	const desktop = await raw(t, port, { room, role: "desktop" });
	const phone = await member(t, port, room, "mobile");
	await until(() => joined(desktop) && phone.relay.includes("ready"), "both joined");
	desktop.socket.write(frame(Buffer.alloc(0), 0x2, { length: 2 * MB }).subarray(0, 14));
	await until(() => desktop.closed, "the oversized sender being closed");
	assert.equal(phone.messages.length, 0);
});

test("a hello that is too large to be one is refused", async (t) => {
	const port = await relay(t);
	const client = await raw(t, port);
	client.socket.write(frame(Buffer.from(JSON.stringify({ type: "hello", room: "a".repeat(64), role: "mobile", pad: "x".repeat(20_000) })), 0x1));
	await until(() => client.closed, "refusal");
	assert.match(Buffer.concat(client.received).toString("latin1"), /bad-hello/);
});

test("the per-connection quota closes a connection that goes over it", async (t) => {
	const port = await relay(t, { LYRA_RELAY_MAX_BYTES: String(4 * MB) });
	const { desktop, mobile } = await pair(t, port);
	for (let i = 0; i < 6; i++) desktop.socket.send(randomBytes(MB), { binary: true });
	await until(() => desktop.closed, "the desktop being closed at its quota");
	assert.ok(desktop.relay.includes("error"), "the relay says why before closing");
	assert.ok(mobile.messages.length <= 4, `at most the quota is forwarded, got ${mobile.messages.length} MiB`);
});
