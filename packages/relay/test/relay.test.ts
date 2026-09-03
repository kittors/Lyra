/**
 * The rendezvous, against a real socket.
 *
 * Everything here is about two clients finding each other, so a mocked transport would be testing
 * the mock. The server is started on a port of its own and driven with a real WebSocket client —
 * which also exercises the half of this that is hand-written: the RFC 6455 handshake and the frame
 * codec underneath it. A masked frame decoded wrongly does not throw, it delivers rubbish.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { WebSocket } from "ws";

const PORT = 47800 + (process.pid % 150);
const URL = `ws://127.0.0.1:${PORT}`;
const SERVER = join(fileURLToPath(import.meta.url), "..", "..", "server.mjs");

let server: ChildProcess;

before(async () => {
	server = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
	// Wait for the line it prints once it is listening, rather than guessing at a delay.
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("中转没有在 10 秒内启动")), 10_000);
		server.stdout?.on("data", (chunk: Buffer) => {
			if (chunk.toString().includes("listening")) {
				clearTimeout(timer);
				resolve();
			}
		});
	});
});

after(() => {
	server?.kill("SIGKILL");
});

/** A client that records everything it is sent, so assertions read as a transcript. */
function client(room: string, role: "host" | "guest") {
	const received: string[] = [];
	const socket = new WebSocket(URL);
	const ready = new Promise<void>((resolve, reject) => {
		socket.once("open", () => {
			socket.send(JSON.stringify({ type: "hello", room, role }));
			resolve();
		});
		socket.once("error", reject);
	});
	socket.on("message", (raw: Buffer) => received.push(raw.toString()));
	return {
		received,
		ready,
		send: (text: string) => socket.send(text),
		close: () => socket.close(),
		/** Wait until `predicate` holds over what has arrived, or fail saying what did. */
		async until(predicate: (lines: string[]) => boolean, what: string) {
			for (let i = 0; i < 60; i++) {
				if (predicate(received)) return;
				await new Promise((r) => setTimeout(r, 50));
			}
			assert.fail(`等不到${what}，收到的是：${JSON.stringify(received)}`);
		},
	};
}

const roomFor = (token: string) => createHash("sha256").update(token).digest("hex");

test("the first to arrive is told to wait, and the second makes them both ready", async () => {
	const room = roomFor("t1");
	const host = client(room, "host");
	await host.ready;
	await host.until((lines) => lines.some((l) => l.includes("waiting")), "waiting");

	const guest = client(room, "guest");
	await guest.ready;
	await host.until((lines) => lines.some((l) => l.includes("ready")), "host 的 ready");
	await guest.until((lines) => lines.some((l) => l.includes("ready")), "guest 的 ready");

	host.close();
	guest.close();
});

test("what one sends, the other receives, byte for byte", async () => {
	const room = roomFor("t2");
	const host = client(room, "host");
	const guest = client(room, "guest");
	await Promise.all([host.ready, guest.ready]);
	await guest.until((lines) => lines.some((l) => l.includes("ready")), "ready");

	// Non-ASCII on purpose: the frame codec deals in bytes, and a length computed in characters
	// truncates exactly here.
	host.send("从电脑发的 🖥");
	guest.send("从手机发的 📱");

	await guest.until((lines) => lines.includes("从电脑发的 🖥"), "电脑发来的消息");
	await host.until((lines) => lines.includes("从手机发的 📱"), "手机发来的消息");

	host.close();
	guest.close();
});

test("a message larger than one TCP segment arrives whole", async () => {
	// The codec keeps a buffer across chunks; a payload over 126 bytes also switches the frame to
	// its extended-length form, which is a separate branch.
	const room = roomFor("t3");
	const host = client(room, "host");
	const guest = client(room, "guest");
	await Promise.all([host.ready, guest.ready]);
	await guest.until((lines) => lines.some((l) => l.includes("ready")), "ready");

	const big = "x".repeat(200_000);
	host.send(big);
	await guest.until((lines) => lines.includes(big), "大消息");

	host.close();
	guest.close();
});

test("a third client is refused rather than displacing anyone", async () => {
	/*
	 * The room id is derived from the pairing token, so a third arrival means the token is known
	 * to someone it should not be. Refusing the newcomer is the safer half of that: evicting a
	 * member would let whoever holds a leaked token push the real device out.
	 */
	const room = roomFor("t4");
	const host = client(room, "host");
	const guest = client(room, "guest");
	await Promise.all([host.ready, guest.ready]);
	await guest.until((lines) => lines.some((l) => l.includes("ready")), "ready");

	const third = client(room, "guest");
	await third.ready;
	await third.until((lines) => lines.some((l) => l.includes("room-full")), "room-full");

	// And the two that were already talking are undisturbed.
	host.send("还在");
	await guest.until((lines) => lines.includes("还在"), "转发仍然通");

	host.close();
	guest.close();
});

test("two rooms do not hear each other", async () => {
	const a = client(roomFor("room-a"), "host");
	const b = client(roomFor("room-b"), "host");
	await Promise.all([a.ready, b.ready]);
	await a.until((lines) => lines.some((l) => l.includes("waiting")), "waiting");
	await b.until((lines) => lines.some((l) => l.includes("waiting")), "waiting");

	a.send("只给 A 房间");
	await new Promise((r) => setTimeout(r, 400));
	assert.ok(!b.received.includes("只给 A 房间"), "B 房间不该收到 A 房间的消息");

	a.close();
	b.close();
});

test("leaving tells the one still there", async () => {
	const room = roomFor("t5");
	const host = client(room, "host");
	const guest = client(room, "guest");
	await Promise.all([host.ready, guest.ready]);
	await guest.until((lines) => lines.some((l) => l.includes("ready")), "ready");

	host.close();
	await guest.until((lines) => lines.some((l) => l.includes("peer-left")), "peer-left");
	guest.close();
});

test("a hello that is not one is refused", async () => {
	// The room must be a sha256; anything else is a client that does not speak this protocol, and
	// letting it occupy a room would be a way to squat on someone's token hash.
	for (const bad of [JSON.stringify({ type: "hello", room: "short" }), "not json at all"]) {
		const socket = new WebSocket(URL);
		const seen: string[] = [];
		await new Promise<void>((resolve) => {
			socket.once("open", () => socket.send(bad));
			socket.on("message", (raw: Buffer) => seen.push(raw.toString()));
			socket.once("close", () => resolve());
			setTimeout(resolve, 3000);
		});
		assert.ok(
			seen.some((line) => line.includes("bad-hello")),
			`期望拒绝 ${bad}，实际收到 ${JSON.stringify(seen)}`,
		);
	}
});

test("the health endpoint answers, for a deployment to point a check at", async () => {
	const response = await fetch(`http://127.0.0.1:${PORT}/health`);
	assert.equal(response.status, 200);
	const body = (await response.json()) as { app: string };
	assert.equal(body.app, "lyra-relay");
});
