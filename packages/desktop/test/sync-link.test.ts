/**
 * The phone link end to end: the real sync server, the real bridge script, a real socket between.
 *
 * The bridge runs here the way it runs in the WebView — its generated source evaluated with a
 * window, a document stub and a WebSocket — except the WebSocket is Node's own, so every frame
 * crosses a real connection. Old builds on either side are stood in for by the protocol they speak:
 * an old phone is a client that never says `wire`, an old desktop a server whose hello has no `wire`.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket as WsClient, WebSocketServer } from "ws";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";
import { SyncServer } from "../electron/sync-server.ts";
import { UploadStore } from "../electron/sync-uploads.ts";
import { bridgeScript } from "../../mobile/src/bridge.ts";
import type { Connection } from "../../mobile/src/connection.ts";

const TOKEN = "2222222222222222222222222222abcd";
let nextPort = 46300 + (process.pid % 300);
const port = () => nextPort++;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (value: string | Buffer | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** A transcript-shaped answer: many messages, compressible the way real ones are. */
function transcript(messages: number) {
	return {
		meta: { id: "big", title: "large" },
		messages: Array.from({ length: messages }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: `message ${i}: ${"the quick brown fox ".repeat(20)}${i}` }], timestamp: i })),
		running: false,
		pendingApprovals: [],
	};
}

async function desktop(t: TestContext, options: { relayUrl?: string; answer?: unknown } = {}) {
	const root = await mkdtemp(join(tmpdir(), "lyra-link-"));
	const uploads = new UploadStore(root);
	const answer = options.answer ?? transcript(30_000);
	const listen = port();
	let settings: Settings = { ...DEFAULT_SETTINGS, sync: { enabled: true, port: listen, token: TOKEN, ...(options.relayUrl ? { relayUrl: options.relayUrl } : {}) } };
	const server = new SyncServer({
		getSettings: () => settings,
		saveSettings: async (next: Settings) => {
			settings = next;
		},
		store: { listSessions: async () => [], load: async () => null },
		live: (id: string) => (id === "big" ? {} : undefined),
		snapshot: async () => answer,
		touch: () => {},
		uploads,
	} as never);
	await server.start(listen, TOKEN);
	t.after(async () => {
		await server.stop();
		await rm(root, { recursive: true, force: true });
	});
	return { server, uploads, answer, port: listen };
}

interface Bridge {
	lyra: {
		sessions: { transcript(projectId: string, sessionId: string): Promise<unknown> };
		agent: { prompt(sessionId: string, content: unknown, options?: unknown): Promise<unknown>; onEvent(handler: (event: unknown) => void): () => void };
		files: { upload(file: Blob, options?: { onProgress?: (progress: Transfer) => void; name?: string }): Promise<{ id: string; path: string; size: number } | null> };
		sync: { connectionStatus(): string; capabilities(): Promise<{ wire: number; uploads: boolean; maxUpload: number }>; onTransfer(handler: (transfer: Transfer) => void): () => void };
	};
	/** Frames the bridge's socket received, by kind. */
	received: ("text" | "binary")[];
	/** Frames it sent, by kind, with text frames' types. */
	sent: string[];
}

interface Transfer {
	id: string;
	kind: string;
	direction: string;
	done: number;
	total: number;
	state: string;
}

/**
 * The generated bridge, installed in a window of its own, over Node's WebSocket.
 *
 * `slow` hands each incoming frame to the page a few milliseconds after the one before, in order —
 * a phone that takes its time — so a transfer lasts long enough on loopback to be overtaken.
 */
function bridge(t: TestContext, connection: Connection, slow = 0): Bridge {
	const received: Bridge["received"] = [];
	const sent: string[] = [];
	const sockets: WebSocket[] = [];
	class Tracking extends WebSocket {
		private queue: MessageEvent[] = [];
		private handler: ((event: MessageEvent) => void) | null = null;
		constructor(url: string) {
			super(url);
			sockets.push(this);
			this.addEventListener("message", (event) => received.push(typeof event.data === "string" ? "text" : "binary"));
		}
		override set onmessage(handler: ((event: MessageEvent) => void) | null) {
			this.handler = handler;
			super.onmessage = !slow || !handler ? handler : (event: MessageEvent) => {
				this.queue.push(event);
				if (this.queue.length === 1) setTimeout(() => this.release(), slow);
			};
		}
		override get onmessage() {
			return this.handler;
		}
		private release() {
			const event = this.queue.shift();
			if (event) this.handler?.(event);
			if (this.queue.length > 0) setTimeout(() => this.release(), slow);
		}
		override send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
			sent.push(typeof data === "string" ? String((JSON.parse(data) as { type?: string }).type) : "binary");
			super.send(data);
		}
	}
	const window = Object.assign(new EventTarget(), {}) as EventTarget & Record<string, unknown>;
	const document = { documentElement: { setAttribute() {}, classList: { contains: () => false } }, body: null, addEventListener() {}, querySelectorAll: () => [] };
	// Unref'd: the bridge's heartbeat and reconnect timers must not keep the test process alive.
	const timeout = (callback: () => void, ms: number) => {
		const timer = setTimeout(callback, ms);
		timer.unref();
		return timer;
	};
	new Function("window", "document", "WebSocket", "setTimeout", "clearTimeout", "navigator", bridgeScript(connection))(window, document, Tracking, timeout, clearTimeout, {});
	t.after(() => {
		for (const socket of sockets) socket.close();
	});
	return { lyra: window.lyra as Bridge["lyra"], received, sent };
}

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 20_000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (await check()) return;
		await wait(20);
	}
	assert.fail(`timed out waiting for ${what}`);
}

// ---------------------------------------------------------------------------
// New phone, new desktop
// ---------------------------------------------------------------------------

test("a large answer arrives in parts, and the link keeps carrying small messages meanwhile", async (t) => {
	// Random text: it does not compress, so it stays large on the wire and takes many parts.
	const noise = { meta: { id: "big" }, messages: Array.from({ length: 200 }, () => ({ role: "user", content: [{ type: "text", text: randomBytes(24_000).toString("base64") }] })) };
	const { server, answer, port } = await desktop(t, { answer: noise });
	const phone = bridge(t, { host: "127.0.0.1", port, token: TOKEN }, 3);
	await until(() => phone.lyra.sync.connectionStatus() === "connected", "the link");
	await until(async () => (await phone.lyra.sync.capabilities()).wire === 2, "the desktop's hello");

	const transfers: Transfer[] = [];
	phone.lyra.sync.onTransfer((transfer) => transfers.push(transfer));
	const events: unknown[] = [];
	phone.lyra.agent.onEvent((event) => events.push(event));

	let resolvedAt = 0;
	const reading = phone.lyra.sessions.transcript("p", "big").then((value) => {
		resolvedAt = performance.now();
		return value;
	});
	await until(() => transfers.some((transfer) => transfer.direction === "down" && transfer.state === "active"), "the answer starting");
	server.broadcast("big", { type: "agent_start" } as never);
	await until(() => events.length > 0, "a push during the transfer");
	const pushedAt = performance.now();

	assert.deepEqual(await reading, answer);
	assert.ok(pushedAt < resolvedAt, "the push was not held behind the large answer");
	assert.ok(phone.received.filter((kind) => kind === "binary").length > 10, "the answer came in parts");
	assert.equal(phone.sent[0], "wire", "the phone said what it reads before anything else");
});

test("a transcript is compressed on the wire for a phone that can inflate it", async (t) => {
	const { answer, port } = await desktop(t);
	const phone = bridge(t, { host: "127.0.0.1", port, token: TOKEN });
	await until(async () => (await phone.lyra.sync.capabilities()).wire === 2, "the desktop's hello");
	const transfers: Transfer[] = [];
	phone.lyra.sync.onTransfer((transfer) => transfers.push(transfer));
	assert.deepEqual(await phone.lyra.sessions.transcript("p", "big"), answer);
	const done = transfers.find((transfer) => transfer.direction === "down" && transfer.state === "done");
	const size = Buffer.byteLength(JSON.stringify(answer));
	assert.ok(done && done.total < size / 5, `on the wire: ${done?.total} bytes of ${size}`);
});

test("a file uploads in parts, survives a dropped link, and finishes from where it stopped", async (t) => {
	const { server, uploads, port } = await desktop(t);
	// A phone that takes its time with each frame, so the upload is still going when the link drops.
	const phone = bridge(t, { host: "127.0.0.1", port, token: TOKEN }, 20);
	await until(() => phone.lyra.sync.connectionStatus() === "connected", "the link");
	await until(async () => (await phone.lyra.sync.capabilities()).wire === 2, "the desktop's hello");

	// Large enough that acknowledgements arriving 20 ms apart take a second: progress reports
	// (throttled to one per 150 ms) see it mid-way.
	const bytes = randomBytes(12 * 1024 * 1024);
	const file = new File([bytes], "capture.mov", { type: "video/quicktime" });
	const progress: Transfer[] = [];
	let dropped = false;
	const uploading = phone.lyra.files.upload(file, {
		onProgress: (update) => {
			progress.push(update);
			// Once some of it is on the desktop's disk, the desktop goes away and comes back — a relay
			// restart, a laptop lid.
			if (!dropped && update.state === "active" && update.done > 0) {
				dropped = true;
				void server.stop().then(() => server.start(port, TOKEN));
			}
		},
	});
	const result = await uploading;
	assert.ok(result, "an upload-capable desktop takes the file");
	assert.equal(result.size, bytes.length);
	assert.equal(sha(await readFile(result.path)), sha(bytes));
	assert.equal(uploads.pathFor(result.id), result.path);

	const paused = progress.findIndex((update) => update.state === "paused");
	assert.ok(paused > 0, "the drop was seen as a pause, not a failure");
	const resumed = progress.slice(paused).find((update) => update.state === "active");
	assert.ok(resumed && resumed.done > 0, `resumed from ${resumed?.done}, not from zero`);
	assert.equal(progress.at(-1)?.state, "done");
});

test("a prompt too large for one frame goes up in parts and arrives whole", async (t) => {
	const { port } = await desktop(t);
	const phone = bridge(t, { host: "127.0.0.1", port, token: TOKEN });
	await until(async () => (await phone.lyra.sync.capabilities()).wire === 2, "the desktop's hello");
	const text = "log line\n".repeat(200_000);
	// No session behind it, so the call fails — after arriving whole and being read, which is the point.
	await assert.rejects(phone.lyra.agent.prompt("missing", [{ type: "text", text }]), /not needed|找不到|prompt/i);
	assert.ok(phone.sent.includes("stream") && phone.sent.includes("binary"), "the call went up in parts");
});

// ---------------------------------------------------------------------------
// Old builds on either side
// ---------------------------------------------------------------------------

test("a phone that never says wire gets every answer as one text frame, as before", async (t) => {
	const { answer, port } = await desktop(t);
	const old = new WsClient(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`, { maxPayload: 512 * 1024 * 1024 });
	t.after(() => old.terminate());
	const frames: { binary: boolean; data: Buffer }[] = [];
	old.on("message", (data: Buffer, binary: boolean) => frames.push({ binary, data }));
	await new Promise((resolve) => old.once("open", resolve));
	old.send(JSON.stringify({ type: "rpc", id: "r1", method: "sessions.transcript", args: ["p", "big"] }));
	await until(() => frames.some((frame) => frame.data.includes('"rpc_result"')), "the answer");
	assert.ok(frames.every((frame) => !frame.binary), "an old phone is never sent a binary frame");
	const result = JSON.parse(frames.find((frame) => frame.data.includes('"rpc_result"'))!.data.toString()) as { value: unknown };
	assert.deepEqual(result.value, answer);
	const hello = JSON.parse(frames[0].data.toString()) as { type: string; version: number };
	assert.deepEqual([hello.type, hello.version], ["hello", 1], "the hello an old phone knows is unchanged");
});

test("a new phone talking to an old desktop sends only what that desktop understands", async (t) => {
	const listen = port();
	const old = new WebSocketServer({ port: listen, host: "127.0.0.1" });
	t.after(() => old.close());
	const got: { binary: boolean; data: Buffer }[] = [];
	old.on("connection", (socket) => {
		socket.send(JSON.stringify({ type: "hello", version: 1 }));
		socket.on("message", (data: Buffer, binary: boolean) => {
			got.push({ binary, data });
			const message = binary ? null : (JSON.parse(data.toString()) as { type?: string; id?: string });
			if (message?.type === "rpc") socket.send(JSON.stringify({ type: "rpc_result", id: message.id, ok: true, value: "old desktop" }));
		});
	});
	const phone = bridge(t, { host: "127.0.0.1", port: listen, token: TOKEN });
	await until(() => phone.lyra.sync.connectionStatus() === "connected", "the link");
	await wait(100);

	const text = "x".repeat(2 * 1024 * 1024);
	assert.equal(await phone.lyra.agent.prompt("s", [{ type: "text", text }]), "old desktop");
	assert.ok(got.every((frame) => !frame.binary), "no binary frame for a desktop that never offered wire 2");
	assert.ok(got.some((frame) => frame.data.length > text.length), "the large call went as one frame, as before");
	assert.equal(await phone.lyra.files.upload(new File([randomBytes(1024)], "a.bin")), null, "no uploads: the composer falls back");
	assert.deepEqual(await phone.lyra.sync.capabilities(), { wire: 0, uploads: false, maxUpload: 0 });
});

// ---------------------------------------------------------------------------
// Through the relay
// ---------------------------------------------------------------------------

async function relay(t: TestContext): Promise<number> {
	const child: ChildProcess = spawn(process.execPath, [fileURLToPath(new URL("../../relay/server.mjs", import.meta.url))], { env: { ...process.env, PORT: "0" }, stdio: "pipe" });
	t.after(() => {
		child.kill("SIGKILL");
	});
	return new Promise<number>((resolve, reject) => {
		let out = "";
		const timer = setTimeout(() => reject(new Error("relay did not start")), 10_000);
		child.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString();
			const match = /listening on :(\d+)/.exec(out);
			if (!match) return;
			clearTimeout(timer);
			resolve(Number(match[1]));
		});
	});
}

test("through the relay, a large answer and an upload both arrive intact", async (t) => {
	const relayPort = await relay(t);
	const { answer } = await desktop(t, { relayUrl: `ws://127.0.0.1:${relayPort}` });
	const phone = bridge(t, { host: "127.0.0.1", port: relayPort, token: TOKEN, relay: true });
	await until(() => phone.lyra.sync.connectionStatus() === "connected", "the relay pairing", 30_000);
	await until(async () => (await phone.lyra.sync.capabilities()).wire === 2, "the desktop's hello");

	assert.deepEqual(await phone.lyra.sessions.transcript("p", "big"), answer);
	const bytes = randomBytes(2 * 1024 * 1024 + 17);
	const result = await phone.lyra.files.upload(new File([bytes], "notes.txt", { type: "text/plain" }));
	assert.ok(result);
	assert.equal(sha(await readFile(result.path)), sha(bytes));
});
