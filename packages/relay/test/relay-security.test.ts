import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const SERVER = new URL("../server.mjs", import.meta.url);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function relay(t: TestContext): Promise<number> {
	// Fixed high ports may belong to Windows' excluded ranges; let the OS allocate one.
	const child: ChildProcess = spawn(process.execPath, [fileURLToPath(SERVER)], {
		env: { ...process.env, PORT: "0" },
		stdio: "pipe",
	});
	t.after(() => { child.kill("SIGKILL"); });
	let output = "";
	child.stderr?.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-8192); });
	return new Promise<number>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Relay did not start: ${output}`)), 10_000);
		child.once("error", (error) => { clearTimeout(timer); reject(error); });
		child.once("close", (code, signal) => { clearTimeout(timer); reject(new Error(`Relay exited (${code}, ${signal}): ${output}`)); });
		let stdout = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout = (stdout + chunk.toString()).slice(-8192);
			const match = /listening on :(\d+)\n/.exec(stdout);
			if (!match) return;
			clearTimeout(timer);
			resolve(Number(match[1]));
		});
	});
}

async function desktop(t: TestContext, port: number, room: string, assetKey: string) {
	const socket = new WebSocket(`ws://127.0.0.1:${port}`);
	t.after(() => socket.terminate());
	const first = await new Promise<string>((resolve, reject) => {
		socket.once("error", reject);
		socket.once("open", () => socket.send(JSON.stringify({ type: "hello", role: "desktop", room, assetKey })));
		socket.once("message", (raw: Buffer) => resolve(raw.toString()));
	});
	return { socket, first };
}

test("an asset URL cannot be claimed from another room while its desktop is online", async (t) => {
	const port = await relay(t);
	const room = hash("owner-token");
	const assetKey = hash(`lyra-assets\0${room}`);
	const owner = await desktop(t, port, room, assetKey);
	assert.match(owner.first, /waiting/);
	const attacker = await desktop(t, port, hash("attacker-token"), assetKey);
	assert.match(attacker.first, /bad-hello/);

	const received = new Promise<Buffer>((resolve) => owner.socket.once("message", resolve));
	const response = fetch(`http://127.0.0.1:${port}/app/${assetKey}/`);
	const assetRequest: unknown = JSON.parse((await received).toString());
	assert.ok(assetRequest && typeof assetRequest === "object" && "id" in assetRequest);
	owner.socket.send(JSON.stringify({
		type: "asset_response", id: assetRequest.id, status: 200,
		contentType: "text/html", bodyBase64: Buffer.from("owner build").toString("base64"),
	}));
	assert.equal(await (await response).text(), "owner build");
});

test("an asset URL cannot be claimed before its desktop connects", async (t) => {
	const port = await relay(t);
	const assetKey = hash(`lyra-assets\0${hash("offline-owner-token")}`);
	const attacker = await desktop(t, port, hash("attacker-token"), assetKey);
	assert.match(attacker.first, /bad-hello/);
	assert.equal((await fetch(`http://127.0.0.1:${port}/app/${assetKey}/`)).status, 404);
});

async function status(port: number, path: string, host: string): Promise<number | undefined> {
	return new Promise((resolve, reject) => {
		const req = request({ hostname: "127.0.0.1", port, path, headers: { Host: host } }, (res) => {
			res.resume();
			res.once("end", () => resolve(res.statusCode));
		});
		req.once("error", reject);
		req.end();
	});
}

test("a malformed Host cannot terminate the HTTP relay", async (t) => {
	const port = await relay(t);
	assert.equal(await status(port, "/missing", "["), 404);
	assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});

test("a malformed request target is rejected without terminating the HTTP relay", async (t) => {
	const port = await relay(t);
	assert.equal(await status(port, "http://[", "localhost"), 400);
	assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});

test("an asset host cannot terminate the relay with an invalid response header", async (t) => {
	const port = await relay(t);
	const room = hash("header-host");
	const assetKey = hash(`lyra-assets\0${room}`);
	const owner = await desktop(t, port, room, assetKey);
	const received = new Promise<Buffer>((resolve) => owner.socket.once("message", resolve));
	const response = fetch(`http://127.0.0.1:${port}/app/${assetKey}/`);
	const assetRequest: unknown = JSON.parse((await received).toString());
	assert.ok(assetRequest && typeof assetRequest === "object" && "id" in assetRequest);
	owner.socket.send(JSON.stringify({
		type: "asset_response", id: assetRequest.id, status: 200,
		contentType: "text/plain\u0001", bodyBase64: Buffer.from("build").toString("base64"),
	}));
	assert.equal((await response).headers.get("content-type"), "application/octet-stream");
	assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});

/*
 * 攒不出帧的字节不会无限攒下去。
 *
 * `decode` 对声明长度超过 8 MiB 的帧返回 `null`，而 `onData` 把 `null` 当成「这块还不完整」，
 * 于是缓冲永远不会被清。发一个这样的帧头再一直发下去，进程的内存就一直涨——不需要是攻击，一个
 * 把长度字段写错的客户端就够了。中转的全部安全性在于它只是转发字节，那它至少不能被几兆字节
 * 撑死。
 */
test("一个永远凑不成的帧不会把内存撑上去", async (t) => {
	const port = await relay(t);
	/*
	 * 先正常入房。
	 *
	 * 不入房的连接十秒后会被另一条规则（等 hello 的那个 destroy）关掉，而十秒也正是一个耐心的
	 * 断言愿意等的时间——第一版测试就是这么在关掉上限的情况下照样变绿的。入了房，关掉上限之后
	 * 就没有任何东西会来关它。
	 */
	const { socket } = await desktop(t, port, hash("buffer-token"), hash(`lyra-assets\0${hash("buffer-token")}`));

	// 握手和 hello 交给 ws，之后直接往裸 socket 上写——这个形状 ws 自己不会发。
	const raw = (socket as unknown as { _socket: import("node:net").Socket })._socket;
	const closed = new Promise<void>((resolve) => {
		raw.once("close", () => resolve());
		socket.once("close", () => resolve());
	});

	// FIN + binary，masked，长度字段走 64 位那一档，声明 9 MiB —— 比 `decode` 肯接的最大帧还大。
	const header = Buffer.alloc(14);
	header[0] = 0x82;
	header[1] = 0xff;
	header.writeBigUInt64BE(9n * 1024n * 1024n, 2);
	raw.write(header);

	/*
	 * 然后一直发。不需要发满 9 MiB：缓冲越过上限就该断，而那个上限比这里发的少。
	 * 写不下去（对端已经关了）也是通过——那正是要的结果。
	 */
	const filler = Buffer.alloc(256 * 1024);
	for (let sent = 0; sent < 12 * 1024 * 1024 && raw.writable; sent += filler.length) {
		if (!raw.write(filler)) await new Promise((resolve) => raw.once("drain", resolve).once("close", resolve));
	}

	// 五秒，短于那条十秒的 hello 闸，所以走到这里的只可能是缓冲上限。
	await Promise.race([
		closed,
		new Promise((_, reject) => setTimeout(() => reject(new Error("连接没有被断开：缓冲还在涨")), 5_000).unref?.()),
	]);

	// 而中转本身还活着——断的是那一条连接，不是进程。
	assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});
