import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const SERVER = new URL("../server.mjs", import.meta.url);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** The relay process behind each port, for the test that weighs it. */
const pids = new Map<number, number>();

/**
 * Another process's resident memory, in MiB.
 *
 * `ps -o rss=` on macOS and Linux. On Windows the `ps` on PATH is Git Bash's, which has no `-o`, so
 * the working set comes from `tasklist`: its CSV row ends in `"52,344 K"`, in the machine's own
 * thousands separator, so only the digits are kept.
 */
function residentMiB(pid: number): number {
	if (process.platform === "win32") {
		const row = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]).toString().trim();
		return Number(row.split('","').at(-1)?.replace(/\D/g, "")) / 1024;
	}
	return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) / 1024;
}

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
			pids.set(Number(match[1]), child.pid ?? 0);
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
 * A frame that is never finished holds no memory.
 *
 * The relay used to collect every frame whole before forwarding it, capped at 8 MiB so that a
 * length field written wrong could not make it wait for bytes forever — and it closed any sender
 * that went past the cap. Frames are streamed now, so the declared length is not an allocation: a
 * desktop alone in its room can claim 256 MiB and send 160, and the relay drops them as they arrive
 * and keeps the connection. Weighed on the relay process itself, with room for garbage the collector
 * has not got to yet but not for the 160 MiB a buffering relay would hold.
 */
test("a frame that is never finished costs the relay no memory", async (t) => {
	const port = await relay(t);
	const { socket } = await desktop(t, port, hash("buffer-token"), hash(`lyra-assets\0${hash("buffer-token")}`));
	const pid = pids.get(port) ?? 0;
	const rss = () => residentMiB(pid);

	// Handshake and hello through ws, then raw bytes: this shape is not one ws will send itself.
	const raw = (socket as unknown as { _socket: import("node:net").Socket })._socket;
	const before = rss();

	// FIN + binary, masked (with a zero key), 64-bit length: 256 MiB declared.
	const header = Buffer.alloc(14);
	header[0] = 0x82;
	header[1] = 0xff;
	header.writeBigUInt64BE(256n * 1024n * 1024n, 2);
	raw.write(header);
	const filler = Buffer.alloc(1024 * 1024);
	let peak = 0;
	for (let sent = 0; sent < 160 * 1024 * 1024 && raw.writable; sent += filler.length) {
		if (!raw.write(filler)) await new Promise((resolve) => raw.once("drain", resolve));
		if (sent % (16 * 1024 * 1024) === 0) peak = Math.max(peak, rss() - before);
	}
	await new Promise((resolve) => setTimeout(resolve, 300));
	peak = Math.max(peak, rss() - before);

	assert.ok(raw.writable, "a large frame is not a reason to close the connection");
	assert.ok(peak < 96, `the relay grew by ${Math.round(peak)} MiB while dropping a frame nobody will read`);
	assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});
