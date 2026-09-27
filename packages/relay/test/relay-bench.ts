/* oxlint-disable no-console -- benchmark CLI that prints one JSON row per measurement */
/**
 * What large traffic costs the relay, measured against a real relay process.
 *
 * Not a test — numbers for a before/after comparison. Run it from any checkout and it benchmarks
 * that checkout's `server.mjs`, so the same file measures the old relay and the new one:
 *
 *   node --experimental-strip-types test/relay-bench.ts
 *   RELAY_BENCH_SERVER=/path/to/old/server.mjs node --experimental-strip-types test/relay-bench.ts
 *
 * Three shapes of traffic, each the way a real client produces it:
 *
 *   - desktop → phone, one large message in one frame: what `ws` does with a big transcript;
 *   - phone → desktop, one large message split into 128 KiB continuation frames: what Chromium
 *     (the Android WebView) does with anything over about 128 KiB;
 *   - desktop → a phone that reads slowly, as a stream of 1 MiB messages: what a mobile network does
 *     to chunked traffic, and the case where a relay without backpressure keeps the whole
 *     difference between the two links in memory.
 *
 * Reported: whether the message arrived intact, how long it took, whether either side was
 * disconnected, and the relay's peak RSS and CPU time during the run (sampled with `ps`).
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocket } from "ws";

const SERVER = process.env.RELAY_BENCH_SERVER ?? fileURLToPath(new URL("../server.mjs", import.meta.url));
const SIZES = (process.env.RELAY_BENCH_SIZES ?? "4,16,64").split(",").map(Number);
const SLOW_RATE = Number(process.env.RELAY_BENCH_SLOW_MBPS ?? 4) * 1024 * 1024;
const MB = 1024 * 1024;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startRelay(): Promise<{ child: ChildProcess; port: number }> {
	const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
	const port = await new Promise<number>((resolve, reject) => {
		let out = "";
		const timer = setTimeout(() => reject(new Error(`relay did not start: ${out}`)), 10_000);
		child.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString();
			const match = /listening on :(\d+)/.exec(out);
			if (match) {
				clearTimeout(timer);
				resolve(Number(match[1]));
			}
		});
	});
	return { child, port };
}

/** RSS in MB and cumulative CPU seconds of one process, from `ps`. */
async function usage(pid: number): Promise<{ rssMb: number; cpuS: number }> {
	const { stdout } = await promisify(execFile)("ps", ["-o", "rss=,time=", "-p", String(pid)]).catch(() => ({ stdout: "" }));
	const [rss, time] = stdout.trim().split(/\s+/);
	const parts = (time ?? "0:0").split(":").map(Number);
	const cpu = parts.reduce((total, part) => total * 60 + part, 0);
	return { rssMb: Math.round(Number(rss ?? 0) / 1024), cpuS: cpu };
}

class Sampler {
	peak = 0;
	private timer: NodeJS.Timeout | null = null;
	private readonly pid: number;
	// A plain field: strip-types does not support constructor parameter properties.
	constructor(pid: number) {
		this.pid = pid;
	}
	start(): void {
		const tick = async () => {
			const { rssMb } = await usage(this.pid);
			this.peak = Math.max(this.peak, rssMb);
			this.timer = setTimeout(tick, 50);
		};
		void tick();
	}
	stop(): void {
		if (this.timer) clearTimeout(this.timer);
	}
}

interface Member {
	socket: WebSocket;
	/** What the far end sent, in order. */
	messages: Buffer[];
	/** What the relay itself said: waiting, ready, peer-left, error. */
	relay: string[];
	closed: boolean;
	ready: Promise<void>;
}

function member(port: number, room: string, role: "desktop" | "mobile"): Member {
	const socket = new WebSocket(`ws://127.0.0.1:${port}`, { maxPayload: 1024 * MB });
	const self: Member = { socket, messages: [], relay: [], closed: false, ready: Promise.resolve() };
	self.ready = new Promise<void>((resolve, reject) => {
		socket.once("open", () => socket.send(JSON.stringify({ type: "hello", room, role })));
		socket.on("message", (data: Buffer, isBinary: boolean) => {
			const word = !isBinary && data.length < 200 ? /"type":"(waiting|ready|peer-left|error)"/.exec(data.toString())?.[1] : undefined;
			if (word) self.relay.push(word);
			else self.messages.push(data);
			if (word === "ready") resolve();
		});
		socket.once("error", reject);
	});
	socket.on("close", () => {
		self.closed = true;
	});
	socket.on("error", () => {});
	return self;
}

async function pair(port: number) {
	const room = createHash("sha256").update(randomBytes(16)).digest("hex");
	const desktop = member(port, room, "desktop");
	const mobile = member(port, room, "mobile");
	await Promise.all([desktop.ready, mobile.ready]);
	return { desktop, mobile };
}

/** A message split into continuation frames, the way Chromium sends anything over ~128 KiB. */
function sendFragmented(socket: WebSocket, payload: Buffer, fragment = 128 * 1024): void {
	for (let offset = 0; offset < payload.length; offset += fragment) {
		const last = offset + fragment >= payload.length;
		socket.send(payload.subarray(offset, offset + fragment), { binary: true, fin: last });
	}
}

/**
 * Hold the phone's receiving socket to a fixed rate by pausing its TCP stream.
 *
 * A paused socket stops reading, the kernel buffer fills, and the relay's writes start returning
 * false — exactly what a slow mobile link looks like from the relay's side.
 */
function readSlowly(target: WebSocket, bytesPerSecond: number): () => void {
	const raw = (target as unknown as { _socket: import("node:net").Socket })._socket;
	let budget = 0;
	let stopped = false;
	raw.on("data", (chunk: Buffer) => {
		budget -= chunk.length;
		if (budget < 0) raw.pause();
	});
	const tick = setInterval(() => {
		budget = Math.min(budget + bytesPerSecond / 20, bytesPerSecond / 20);
		if (budget > 0 && !stopped) raw.resume();
	}, 50);
	return () => {
		stopped = true;
		clearInterval(tick);
		raw.resume();
	};
}

async function until(check: () => boolean, ms: number): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (check()) return true;
		await wait(20);
	}
	return check();
}

type Shape = "one-frame desktop→phone" | "fragmented phone→desktop" | "slow reader desktop→phone";

async function run(shape: Shape, mb: number): Promise<void> {
	const relay = await startRelay();
	const pid = relay.child.pid ?? 0;
	const sampler = new Sampler(pid);
	try {
		const { desktop, mobile } = await pair(relay.port);
		const payload = randomBytes(mb * MB);
		const digest = createHash("sha256").update(payload).digest("hex");
		const before = await usage(pid);
		sampler.start();
		const started = performance.now();
		let stopSlow = () => {};
		let receiver: Member;
		let expected = 1;
		if (shape === "fragmented phone→desktop") {
			receiver = desktop;
			sendFragmented(mobile.socket, payload);
		} else if (shape === "slow reader desktop→phone") {
			receiver = mobile;
			stopSlow = readSlowly(mobile.socket, SLOW_RATE);
			expected = mb;
			for (let i = 0; i < mb; i++) desktop.socket.send(payload.subarray(i * MB, (i + 1) * MB), { binary: true });
		} else {
			receiver = mobile;
			desktop.socket.send(payload, { binary: true });
		}
		const timeout = shape === "slow reader desktop→phone" ? (mb * MB * 1000) / SLOW_RATE + 60_000 : 60_000;
		const arrived = await until(() => receiver.messages.length >= expected || desktop.closed || mobile.closed || receiver.relay.includes("peer-left"), timeout);
		const elapsed = performance.now() - started;
		stopSlow();
		await wait(200);
		sampler.stop();
		const after = await usage(pid);
		const got = receiver.messages.length >= expected ? Buffer.concat(receiver.messages.slice(0, expected)) : null;
		console.log(
			JSON.stringify({
				server: SERVER,
				shape,
				mb,
				outcome: got && createHash("sha256").update(got).digest("hex") === digest
					? "intact"
					: got
						? "corrupted"
						: receiver.messages.length > 0
							? "truncated"
							: arrived
								? "disconnected"
								: "timeout",
				peerLeft: receiver.relay.includes("peer-left"),
				ms: Math.round(elapsed),
				desktopClosed: desktop.closed,
				mobileClosed: mobile.closed,
				relayPeakRssMb: sampler.peak,
				relayRssBeforeMb: before.rssMb,
				relayCpuS: Math.round((after.cpuS - before.cpuS) * 100) / 100,
			}),
		);
		desktop.socket.terminate();
		mobile.socket.terminate();
	} finally {
		sampler.stop();
		relay.child.kill("SIGKILL");
	}
}

for (const mb of SIZES) {
	for (const shape of ["one-frame desktop→phone", "fragmented phone→desktop", "slow reader desktop→phone"] as const) {
		await run(shape, mb);
	}
}
process.exit(0);
