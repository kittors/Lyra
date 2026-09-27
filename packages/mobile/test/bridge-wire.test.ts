/**
 * The phone half of wire 2, inside the generated bridge, against a fake socket.
 *
 * The end-to-end half — the real desktop, a real socket — is `desktop/test/sync-link.test.ts`. This
 * pins down what only the phone decides: when it may speak in parts, how it paces them, what counts
 * as the link being alive, and how an upload behaves when the link goes and comes back.
 */

import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";
import { bridgeScript } from "../src/bridge.ts";
import type { Connection } from "../src/connection.ts";

const LAN: Connection = { host: "192.168.1.5", port: 4517, token: "tok", platform: "darwin" };

interface FakeSocket {
	readyState: number;
	bufferedAmount: number;
	queues: boolean;
	binaryType: string;
	onopen: (() => void) | null;
	onmessage: ((event: { data: string | ArrayBuffer }) => void) | null;
	onclose: (() => void) | null;
	onerror: (() => void) | null;
	sent: (string | Uint8Array)[];
	send(data: string | Uint8Array): void;
	close(): void;
}

/** A relay whose /health answers `version`, so the bridge knows whether to pace its parts. */
const RELAY: Connection = { host: "relay.example.com", port: 443, token: "tok", platform: "darwin", relay: true, tls: true };

function install(connection: Connection = LAN, relayVersion = 1) {
	const sockets: FakeSocket[] = [];
	const timers = new Map<number, { callback: () => void; delay: number }>();
	let nextTimer = 0;
	const window = new EventTarget() as EventTarget & Record<string, unknown>;
	const document = { documentElement: { setAttribute() {} }, addEventListener() {} };
	class Socket implements FakeSocket {
		readyState = 1;
		bufferedAmount = 0;
		binaryType = "blob";
		onopen: (() => void) | null = null;
		onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
		onclose: (() => void) | null = null;
		onerror: (() => void) | null = null;
		sent: (string | Uint8Array)[] = [];
		constructor() {
			sockets.push(this);
		}
		/** When set, bytes handed over stay queued until the test drains them, as a real socket's do. */
		queues = false;
		send(data: string | Uint8Array) {
			this.sent.push(typeof data === "string" ? data : new Uint8Array(data));
			if (this.queues) this.bufferedAmount += typeof data === "string" ? data.length : data.byteLength;
		}
		close() {}
	}
	const setTimeout = (callback: () => void, delay: number) => {
		const id = ++nextTimer;
		timers.set(id, { callback, delay });
		return id;
	};
	const clearTimeout = (id: number) => void timers.delete(id);
	const fetch = async () => ({ json: async () => ({ app: "lyra-relay", version: relayVersion }) });
	new Function("window", "document", "WebSocket", "setTimeout", "clearTimeout", "navigator", "fetch", bridgeScript(connection))(window, document, Socket, setTimeout, clearTimeout, {}, fetch);
	const socket = () => sockets.at(-1)!;
	socket().onopen?.();
	return {
		lyra: window.lyra as {
			sessions: { transcript(p: string, s: string): Promise<unknown> };
			agent: { prompt(s: string, content: unknown): Promise<unknown>; onEvent(handler: (event: unknown) => void): () => void };
			files: { upload(file: Blob, options?: Record<string, unknown>): Promise<unknown>; pathForDrop(file: unknown): unknown };
			sync: { capabilities(): Promise<unknown>; onTransfer(handler: (transfer: Record<string, unknown>) => void): () => void };
		},
		window,
		socket,
		sockets,
		timers,
		probe: () => (window.__lyraProbe as () => void)(),
		receive(message: unknown) {
			socket().onmessage?.({ data: JSON.stringify(message) });
		},
		receiveBinary(bytes: Uint8Array) {
			socket().onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
		},
		texts: () => socket().sent.filter((s): s is string => typeof s === "string").map((s) => JSON.parse(s) as Record<string, unknown>),
		binaries: () => socket().sent.filter((s): s is Uint8Array => typeof s !== "string"),
		runTimer(delay: number) {
			const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
			if (!entry) return false;
			timers.delete(entry[0]);
			entry[1].callback();
			return true;
		},
	};
}

function part(kind: number, sid: number, offset: number, payload: Uint8Array): Uint8Array {
	const bytes = new Uint8Array(13 + payload.length);
	const view = new DataView(bytes.buffer);
	view.setUint8(0, kind);
	view.setUint32(1, sid);
	view.setFloat64(5, offset);
	bytes.set(payload, 13);
	return bytes;
}

function header(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { kind: view.getUint8(0), sid: view.getUint32(1), offset: view.getFloat64(5), length: bytes.length - 13 };
}

const flush = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
	await new Promise((resolve) => setImmediate(resolve));
};

test("the phone says what it reads first, and nothing about it breaks an old desktop's hello", () => {
	const page = install();
	assert.deepEqual(page.texts()[0], { type: "wire", version: 2, inflate: ["deflate-raw"] });
	page.receive({ type: "hello", version: 1 });
	assert.equal(page.socket().binaryType, "arraybuffer");
});

test("a large call stays one frame until the desktop has offered wire 2", async () => {
	const page = install();
	page.receive({ type: "hello", version: 1 });
	void page.lyra.agent.prompt("s", [{ type: "text", text: "a".repeat(500_000) }]);
	assert.equal(page.binaries().length, 0);
	assert.ok(page.texts().some((m) => m.type === "rpc"));
});

test("with wire 2, a large call goes up in parts, never more than a window ahead", async () => {
	const page = install();
	page.receive({ type: "hello", version: 1, wire: 2, maxUpload: 1024 });
	const text = "b".repeat(3 * 1024 * 1024);
	void page.lyra.agent.prompt("s", [{ type: "text", text }]);
	const announce = page.texts().find((m) => m.type === "stream")!;
	assert.ok(announce, "announced before any part");
	// The fake socket never reports anything buffered, so every part the window allows goes at once.
	const sent = page.binaries().map(header);
	assert.ok(sent.every((p) => p.kind === 1 && p.sid === announce.s && p.length <= 262_144));
	// The window is checked before each part, so at most one part past it is in flight.
	const inFlight = sent.reduce((n, p) => n + p.length, 0);
	assert.ok(inFlight >= 1024 * 1024 && inFlight <= 1024 * 1024 + 262_144, `one window, then it waits for acks (${inFlight} in flight)`);

	// A socket that has more queued than it should is waited for rather than piled onto.
	page.socket().bufferedAmount = 600_000;
	page.receive({ type: "ack", s: announce.s, n: 1024 * 1024 });
	assert.equal(page.binaries().length, sent.length, "nothing more until the socket has drained");
	page.socket().bufferedAmount = 0;
	assert.equal(page.runTimer(4), true);
	assert.ok(page.binaries().length > sent.length);
});

test("through a relay not known to be version 2, parts are 48 KiB and each waits for the last to leave", async () => {
	/*
	 * A version 1 relay re-sends each fragment as a whole message, and Chromium fragments any message
	 * that straddles its 64 KiB pipe. A small part, alone in the pipe, is never split.
	 */
	const page = install(RELAY, 1);
	await new Promise((resolve) => setImmediate(resolve));
	page.receive({ type: "ready" });
	page.receive({ type: "hello", version: 1, wire: 2, maxUpload: 1024 });
	page.socket().queues = true;
	void page.lyra.agent.prompt("s", [{ type: "text", text: "b".repeat(300_000) }]);
	// Even the announcement ahead of the parts has to leave first.
	assert.equal(page.binaries().length, 0);
	const drainThenTick = () => {
		page.socket().bufferedAmount = 0;
		assert.equal(page.runTimer(4), true);
	};
	drainThenTick();
	assert.equal(page.binaries().length, 1);
	assert.equal(header(page.binaries()[0]).length, 49_152);
	// The part sits in the socket; the next waits for it to leave.
	assert.equal(page.runTimer(4), true);
	assert.equal(page.binaries().length, 1, "still queued: nothing more");
	drainThenTick();
	assert.equal(page.binaries().length, 2, "drained: exactly one more");
});

test("through a version 2 relay, parts go at full size", async () => {
	const page = install(RELAY, 2);
	await new Promise((resolve) => setImmediate(resolve));
	page.receive({ type: "ready" });
	page.receive({ type: "hello", version: 1, wire: 2, maxUpload: 1024 });
	void page.lyra.agent.prompt("s", [{ type: "text", text: "b".repeat(600_000) }]);
	assert.ok(page.binaries().map(header).some((p) => p.length > 49_152));
});

test("calls keep their order: one made while a large one is going up waits for its last part", () => {
	const page = install();
	page.receive({ type: "hello", version: 1, wire: 2, maxUpload: 1024 });
	// A socket that is still busy, so the large call is mid-way when the next one is made.
	page.socket().bufferedAmount = 600_000;
	void page.lyra.agent.prompt("s", [{ type: "text", text: "c".repeat(300_000) }]);
	void page.lyra.sessions.transcript("p", "s");
	const rpcs = () => page.texts().filter((m) => m.type === "rpc").map((m) => m.method);
	assert.deepEqual(rpcs(), [], "the small call waits behind the streaming one");
	page.socket().bufferedAmount = 0;
	while (page.runTimer(4)) {
		// Each turn hands over one more part once the socket has drained.
	}
	assert.deepEqual(rpcs(), ["sessions.transcript"], "and goes once the last part has");
	const lastPart = page.socket().sent.map((s) => typeof s !== "string").lastIndexOf(true);
	const call = page.socket().sent.findIndex((s) => typeof s === "string" && s.includes('"sessions.transcript"'));
	assert.ok(call > lastPart);
});

test("a call the desktop refuses as too large does not hold up the calls behind it", () => {
	const page = install();
	page.receive({ type: "hello", version: 1, wire: 2, maxUpload: 1024 });
	page.socket().bufferedAmount = 600_000;
	void page.lyra.agent.prompt("s", [{ type: "text", text: "c".repeat(300_000) }]);
	void page.lyra.sessions.transcript("p", "s");
	const announce = page.texts().find((m) => m.type === "stream")!;
	assert.ok(!page.texts().some((m) => m.method === "sessions.transcript"));
	page.receive({ type: "stream_abort", s: announce.s, reason: "refused" });
	assert.ok(page.texts().some((m) => m.method === "sessions.transcript"));
});

test("an answer in compressed parts is acknowledged, inflated and delivered as one message", async () => {
	const page = install();
	const answer = { big: "d".repeat(400_000) };
	const inflated = Buffer.from(JSON.stringify({ type: "rpc_result", id: "r1", ok: true, value: answer }));
	const packed = deflateRawSync(inflated);
	const reading = page.lyra.sessions.transcript("p", "s");
	page.receive({ type: "stream", s: 9, size: packed.length, z: 1, for: "r1", label: "sessions.transcript" });
	for (let at = 0; at < packed.length; at += 20_000) page.receiveBinary(part(1, 9, at, packed.subarray(at, at + 20_000)));
	assert.deepEqual(await reading, answer);
	const acks = page.texts().filter((m) => m.type === "ack");
	assert.equal(acks.at(-1)?.n, packed.length);
});

test("events after a compressed message wait for it: an agent's events keep their order", async () => {
	const page = install();
	const seen: unknown[] = [];
	page.lyra.agent.onEvent((event) => seen.push((event as { event: { n: number } }).event.n));
	const first = deflateRawSync(Buffer.from(JSON.stringify({ type: "agent_event", sessionId: "s", event: { n: 1, text: "e".repeat(100_000) } })));
	page.receive({ type: "stream", s: 1, size: first.length, z: 1 });
	page.receiveBinary(part(1, 1, 0, first));
	page.receive({ type: "agent_event", sessionId: "s", event: { n: 2 } });
	assert.deepEqual(seen, [], "the small event does not overtake the one being inflated");
	for (let i = 0; i < 200 && seen.length < 2; i++) await flush();
	assert.deepEqual(seen, [1, 2]);
});

test("any frame from the desktop proves the link alive, not only a pong", () => {
	/*
	 * A large answer holds the pong behind it. The probe used to wait for the pong alone and killed a
	 * working link mid-transfer — then the reconnect asked for the same answer again.
	 */
	const page = install();
	page.probe();
	page.receiveBinary(part(1, 99, 0, new Uint8Array(10)));
	assert.equal(page.runTimer(5000), false, "the deadline was cleared by the part");
	assert.equal(page.sockets.length, 1);
});

test("a call's deadline is re-armed while its answer is still arriving", () => {
	const page = install();
	void page.lyra.sessions.transcript("p", "s");
	const call = page.texts().find((m) => m.type === "rpc")!;
	const before = [...page.timers.entries()].filter(([, t]) => t.delay === 20_000).map(([id]) => id);
	page.receive({ type: "stream", s: 5, size: 10, for: call.id });
	const after = [...page.timers.entries()].filter(([, t]) => t.delay === 20_000).map(([id]) => id);
	assert.equal(after.length, 1);
	assert.notEqual(after[0], before[0], "the old deadline is gone and a fresh one set");
});

test("a picked file's path is an empty string, never a promise the composer would send", () => {
	const page = install();
	assert.equal(page.lyra.files.pathForDrop({}), "");
});

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

test("an old desktop cannot take uploads, so the composer is told to fall back", async () => {
	const page = install();
	page.receive({ type: "hello", version: 1 });
	assert.equal(await page.lyra.files.upload(new Blob(["x"])), null);
	assert.deepEqual(await page.lyra.sync.capabilities(), { wire: 0, uploads: false, maxUpload: 0 });
});

test("a file over the desktop's limit is refused before anything is sent, saying the limit", async () => {
	const page = install();
	page.receive({ type: "hello", version: 1, wire: 2, maxUpload: 1024 });
	await assert.rejects(page.lyra.files.upload(new Blob([new Uint8Array(4096)])), /文件太大（4 KB），手机一次最多传 1 KB/);
	assert.ok(!page.texts().some((m) => m.type === "upload_begin"));
});

test("an upload is read a slice at a time, reports progress, pauses with the link and resumes from the desktop's offset", async () => {
	const page = install();
	page.receive({ type: "hello", version: 1, wire: 2, maxUpload: 10 * 1024 * 1024 });
	const bytes = new Uint8Array(200_000).map((_, i) => i % 251);
	const progress: Record<string, unknown>[] = [];
	const uploading = page.lyra.files.upload(new File([bytes], "shot.png", { type: "image/png" }), { onProgress: (update: Record<string, unknown>) => progress.push(update) });
	const begin = page.texts().find((m) => m.type === "upload_begin")!;
	assert.deepEqual({ ...begin, id: undefined }, { type: "upload_begin", id: undefined, name: "shot.png", size: 200_000, mimeType: "image/png" });

	page.receive({ type: "upload_state", id: begin.id, upload: "f".repeat(32), sid: 3, offset: 0, size: 200_000 });
	await flush();
	await flush();
	const first = page.binaries().map(header);
	assert.ok(first.length >= 1 && first.every((p) => p.kind === 2 && p.sid === 3 && p.length <= 262_144));
	page.receive({ type: "upload_ack", upload: "f".repeat(32), n: 49_152 });

	// The link drops. The upload waits instead of failing.
	page.socket().onclose?.();
	assert.equal(progress.at(-1)?.state, "paused");
	assert.equal(page.runTimer(500), true);
	page.socket().onopen?.();
	page.receive({ type: "hello", version: 1, wire: 2, maxUpload: 10 * 1024 * 1024 });
	const again = page.texts().find((m) => m.type === "upload_begin")!;
	assert.equal(again.resume, "f".repeat(32), "it asks to resume, naming the upload it was given");

	// The desktop has 98 304 bytes on disk; the phone continues from there, not from what it sent.
	page.receive({ type: "upload_state", id: again.id, upload: "f".repeat(32), sid: 4, offset: 98_304, size: 200_000 });
	await flush();
	await flush();
	const resumed = page.binaries().map(header);
	assert.equal(resumed[0].offset, 98_304);
	assert.ok(resumed.every((p) => p.sid === 4));

	page.receive({ type: "upload_done", upload: "f".repeat(32), name: "shot.png", size: 200_000, mimeType: "image/png", path: "/lyra/uploads/f/shot.png" });
	assert.deepEqual(await uploading, { id: "f".repeat(32), name: "shot.png", size: 200_000, mimeType: "image/png", path: "/lyra/uploads/f/shot.png" });
	assert.equal(progress.at(-1)?.state, "done");
});

test("a desktop error reaches the caller in words a person can act on", async () => {
	const page = install();
	page.receive({ type: "hello", version: 1, wire: 2, maxUpload: 10 * 1024 * 1024 });
	const uploading = page.lyra.files.upload(new Blob([new Uint8Array(100)]), { name: "a.bin" });
	const begin = page.texts().find((m) => m.type === "upload_begin")!;
	page.receive({ type: "upload_error", id: begin.id, error: "disk-full", message: "not enough free disk space on the desktop" });
	await assert.rejects(uploading, /桌面端磁盘空间不足/);
});

test("an upload the link never comes back for gives up after a while and says so", async () => {
	const page = install();
	page.receive({ type: "hello", version: 1, wire: 2, maxUpload: 10 * 1024 * 1024 });
	const uploading = page.lyra.files.upload(new Blob([new Uint8Array(100)]), { name: "a.bin" });
	page.socket().onclose?.();
	assert.equal(page.runTimer(300_000), true);
	await assert.rejects(uploading, /连接中断太久/);
});

test("cancelling an upload tells the desktop to drop what it has", async () => {
	const page = install();
	page.receive({ type: "hello", version: 1, wire: 2, maxUpload: 10 * 1024 * 1024 });
	const controller = new AbortController();
	const uploading = page.lyra.files.upload(new Blob([new Uint8Array(100_000)]), { name: "a.bin", signal: controller.signal });
	const begin = page.texts().find((m) => m.type === "upload_begin")!;
	page.receive({ type: "upload_state", id: begin.id, upload: "e".repeat(32), sid: 1, offset: 0, size: 100_000 });
	controller.abort();
	await assert.rejects(uploading, (error: Error) => error.name === "AbortError");
	assert.ok(page.texts().some((m) => m.type === "upload_abort" && m.upload === "e".repeat(32)));
});
