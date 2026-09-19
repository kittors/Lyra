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

const SERVER = join(fileURLToPath(import.meta.url), "..", "..", "server.mjs");

let port = 0;
let server: ChildProcess;

before(async () => {
	const started = await spawnRelay();
	server = started.child;
	port = started.port;
});

/** `PORT=0` so the OS picks a free one. A hashed high port collided on the arm64 dry-run runner. */
async function spawnRelay(): Promise<{ child: ChildProcess; port: number }> {
	const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: "0" }, stdio: "pipe" });
	return { child, port: await listening(child) };
}

async function listening(child: ChildProcess): Promise<number> {
	// Wait for the line it prints once it is listening, rather than guessing at a delay.
	return new Promise<number>((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => reject(new Error(`中转没有在 10 秒内启动：${stderr || stdout}`)), 10_000);
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString()).slice(-8192);
		});
		child.once("error", (error) => { clearTimeout(timer); reject(error); });
		child.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`Relay exited before listening (${code}): ${stderr || stdout}`));
		});
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout = (stdout + chunk.toString()).slice(-8192);
			const match = /listening on :(\d+)/.exec(stdout);
			if (!match) return;
			clearTimeout(timer);
			resolve(Number(match[1]));
		});
	});
}

after(() => {
	server?.kill("SIGKILL");
});

/** A client that records everything it is sent, so assertions read as a transcript. */
/** `port` 只有需要一个干净 server 的测试会传——见「限流只挡新房间」那条。 */
function client(room: string, role: "host" | "guest" | "desktop" | "mobile", bindPort = port, assetKey?: string) {
	const received: string[] = [];
	const socket = new WebSocket(`ws://127.0.0.1:${bindPort}`);
	const ready = new Promise<void>((resolve, reject) => {
		socket.once("open", () => {
			socket.send(JSON.stringify({ type: "hello", room, role, assetKey }));
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
		/**
		 * 只结束读端：发一个 FIN、不发 WebSocket close 帧——模拟移动端切后台时
		 * 操作系统收走 socket 的样子。`ws` 的 close() 做的事比这多，测不到这条路径。
		 */
		end: () => socket.terminate(),
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

test("two relays can listen at once without picking the same port", async () => {
	const extra = await spawnRelay();
	try {
		assert.notEqual(extra.port, 0);
		assert.notEqual(extra.port, port);
	} finally {
		extra.child.kill("SIGKILL");
	}
});

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
		const socket = new WebSocket(`ws://127.0.0.1:${port}`);
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
	const response = await fetch(`http://127.0.0.1:${port}/health`);
	assert.equal(response.status, 200);
	const body = (await response.json()) as { app: string };
	assert.equal(body.app, "lyra-relay");
});

test("renderer assets are fetched through the paired desktop only", async () => {
	const token = "renderer-tunnel";
	const room = roomFor(token);
	const assetKey = createHash("sha256").update(`lyra-assets\0${room}`).digest("hex");
	const desktop = client(room, "desktop", port, assetKey);
	await desktop.ready;
	await desktop.until((lines) => lines.some((line) => line.includes("waiting")), "waiting");

	const responsePromise = fetch(`http://127.0.0.1:${port}/app/${assetKey}/assets/app.js`);
	await desktop.until((lines) => lines.some((line) => line.includes("asset_request")), "asset_request");
	const request = desktop.received
		.map((line) => JSON.parse(line) as { type?: string; id?: string; path?: string })
		.find((message) => message.type === "asset_request");
	assert.equal(request?.path, "/app/assets/app.js");

	desktop.send(JSON.stringify({
		type: "asset_response",
		id: request?.id,
		status: 200,
		contentType: "text/javascript; charset=utf-8",
		cacheControl: "public, max-age=31536000, immutable",
		bodyBase64: Buffer.from("console.log('relay renderer')").toString("base64"),
	}));

	const response = await responsePromise;
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("content-type"), "text/javascript; charset=utf-8");
	assert.equal(await response.text(), "console.log('relay renderer')");
	desktop.close();
});

test("an unknown renderer capability does not reveal whether a room exists", async () => {
	const unknown = createHash("sha256").update("unknown-assets").digest("hex");
	const response = await fetch(`http://127.0.0.1:${port}/app/${unknown}/`);
	assert.equal(response.status, 404);
});

test("建房太频繁会被限流，而不是把服务拖垮", async () => {
	/*
	 * 限流防的是失控，不是攻击。
	 *
	 * 这个中转不认识任何人——房间号是令牌的哈希，它既不知道两端是谁也不知道它们在说什么，所以
	 * 唯一能做的判断就是「一个来源要了多少」。而这恰好够用：真正要挡的是一个重连循环跑飞的
	 * 客户端，或者一个把房间当消息队列用的脚本。有针对性的攻击换个令牌就是换个房间，拦不住，
	 * 那要靠令牌本身。
	 *
	 * 上限是每分钟 30 个房间，比任何正常用法宽得多——一次配对建一个。
	 */
	const opened: ReturnType<typeof client>[] = [];
	let refused = "";

	for (let i = 0; i < 34; i++) {
		const c = client(roomFor(`flood-${i}`), "host");
		opened.push(c);
		await c.ready;
		await new Promise((r) => setTimeout(r, 15));
		const hit = c.received.find((l) => l.includes("rate-limited"));
		if (hit) {
			refused = hit;
			break;
		}
	}

	for (const c of opened) c.close();
	assert.ok(refused, `连开 34 个房间应该被限流，实际全部放行`);
	assert.match(refused, /rate-limited/);
});

test("限流只挡新房间，已经在房里的两端不受影响", async () => {
	/*
	 * 自己起一个 server。
	 *
	 * 限流是按来源地址算的，而同一个测试进程里所有连接都来自 127.0.0.1——上一条测试刚把这个
	 * 地址的配额用光，这一条紧接着跑就会被自己的前一条挡住。第一版就是这么红的，而它红的原因
	 * 和被测的行为无关。
	 *
	 * 与其在测试之间等一分钟，不如给它一个干净的进程。
	 */
	const own = await spawnRelay();

	try {
		const room = roomFor("still-working");
		const host = client(room, "host", own.port);
		const guest = client(room, "guest", own.port);
		await Promise.all([host.ready, guest.ready]);
		await host.until((lines) => lines.some((l) => l.includes("ready")), "ready");

		host.send(JSON.stringify({ hello: "还在" }));
		await guest.until((lines) => lines.some((l) => l.includes("还在")), "转发过去的消息");

		host.close();
		guest.close();
	} finally {
		own.child.kill();
	}
});

test("对端只送 FIN 也会腾出房间，后来的连接不再 room-full", async () => {
	/*
	 * 半开连接是这次修复的起点：移动端切后台时操作系统收走 socket，经常只送一个
	 * FIN——服务端看到 `end` 而不是 `close`。旧代码只监听 `close`，于是 socket 停在
	 * CLOSE_WAIT，幽灵成员占着座位，同令牌的重连一律 `room-full`。
	 */
	const port = PORT + 2;
	const own = spawn(process.execPath, [SERVER], {
		env: { ...process.env, PORT: String(port) },
		stdio: "pipe",
	});

	try {
		await listening(own);
		const room = roomFor("half-close");
		const ghost = client(room, "host", port);
		await ghost.ready;
		await ghost.until((lines) => lines.some((l) => l.includes("waiting")), "waiting");

		// 直接断掉 TCP，不给 WebSocket 关闭帧——移动端切后台时操作系统的做法。
		ghost.end();

		// 幽灵走了以后，同一个房间能再进人。
		const next = client(room, "host", port);
		await next.ready;
		await next.until(
			(lines) => lines.some((l) => l.includes("waiting")) || lines.some((l) => l.includes("ready")),
			"重新进房",
		);
		next.close();
	} finally {
		own.kill();
	}
});

test("一声不吭的幽灵成员会被 idle 清理，房间腾给重连的真设备", async () => {
	/*
	 * 另一种失联：连 FIN 都没有。对端进程没了，TCP 却还 ESTABLISHED——服务端永远收
	 * 不到 `close` 也收不到 `end`。idle 巡查是唯一的出口：心跳三倍宽的窗口里一帧
	 * 都没来的成员，请出去。
	 *
	 * idle 窗口用环境变量压到 400ms，这条测试才可能在亚秒级跑完。断言不打在
	 * `peer-left` 上：巡查对两个成员一视同仁（这条测试的 client 都没有心跳），
	 * 全体清空时没有人留下来收 `peer-left`。看 /health 的房间数——回落即腾空。
	 */
	const port = PORT + 3;
	const own = spawn(process.execPath, [SERVER], {
		env: { ...process.env, PORT: String(port), LYRA_MEMBER_IDLE_MS: "400" },
		stdio: "pipe",
	});

	try {
		await listening(own);
		const room = roomFor("silent-ghost");

		// 真设备先在房里等着。
		const real = client(room, "guest", port);
		await real.ready;
		await real.until((lines) => lines.some((l) => l.includes("waiting")), "waiting");

		// 幽灵进来占座，然后一声不吭。
		const ghost = client(room, "host", port);
		await ghost.ready;
		await real.until((lines) => lines.some((l) => l.includes("ready")), "ready");
		assert.equal(await roomCount(port), 1, "两人在场，应恰有一个房间");

		// 不发心跳（这条测试的 client 本来就没有 heartbeat），等巡查把双方请出去。
		for (let i = 0; i < 100 && (await roomCount(port)) > 0; i++) {
			await new Promise((r) => setTimeout(r, 100));
		}
		assert.equal(await roomCount(port), 0, "没人发帧，房间应在 idle 后被清空");

		// 房间腾空了，重连的真设备能再进来。
		const back = client(room, "host", port);
		await back.ready;
		await back.until((lines) => lines.some((l) => l.includes("waiting")), "重新进房");
		back.close();
	} finally {
		own.kill();
	}
});

/** `GET /health` 里的 `rooms`——巡查效果的观测口。 */
async function roomCount(port: number): Promise<number> {
	const response = await fetch(`http://127.0.0.1:${port}/health`);
	const body = (await response.json()) as { rooms: number };
	return body.rooms;
}
