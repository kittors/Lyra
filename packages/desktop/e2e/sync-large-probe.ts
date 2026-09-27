/* oxlint-disable no-console -- measurement CLI that prints a before/after table */
/**
 * What a large conversation and a large file cost on the phone link, measured end to end.
 *
 * Not a test — a probe that produces numbers for a before/after comparison. Three real processes
 * are involved: the desktop app (started on a throwaway profile), the relay (`packages/relay`,
 * started from the same checkout as this file), and the phone's renderer (the real mobile bridge
 * and the renderer served by the desktop, in Chromium). A throttling TCP proxy sits in front of
 * whatever the phone dials, so the phone's leg behaves like a network rather than like loopback.
 *
 * Measured per transport (LAN direct and relay):
 *   - opening a large conversation: time to the first painted rows, time until the main thread is
 *     quiet again, how long the transcript call took, JSON parse time, long tasks, connection drops;
 *   - sending a large file from the phone's composer: whether it reaches the model, how long it
 *     takes, whether the connection dropped, and whether the renderer survived;
 *   - peak RSS of the relay, the desktop main process and the phone renderer while each ran.
 *
 * The conversation is a copy of the largest session in `~/.lyra` (or `PERF_SESSION`), scaled up by
 * replicating its messages — real rows cost what real rows cost. Its content is never printed: this
 * reports sizes and timings only, the copy lives in a temporary profile, and the profile is deleted
 * on exit. Titles and working directories are replaced with neutral ones before the app sees them.
 *
 *   node --experimental-strip-types e2e/sync-large-probe.ts
 *
 * Environment:
 *   SYNC_PROBE_LABEL       label written into every result row (default "run")
 *   SYNC_PROBE_OUT         JSON file the rows are written to (default /tmp/sync-probe-<label>.json)
 *   SYNC_PROBE_SCALES      comma list of replication factors for the conversation (default "1,6")
 *   SYNC_PROBE_FILES       comma list of kind:MB, kind ∈ png|log (default "png:20,log:20,log:100,log:300")
 *   SYNC_PROBE_TRANSPORTS  comma list of lan|relay (default "lan,relay")
 *   SYNC_PROBE_CPU         CPU slowdown applied to the phone renderer (default 4)
 *   SYNC_PROBE_LAN_RATE    phone↔desktop bandwidth in MB/s per direction (default 20)
 *   SYNC_PROBE_RELAY_DOWN  relay→phone bandwidth in MB/s (default 6)
 *   SYNC_PROBE_RELAY_UP    phone→relay bandwidth in MB/s (default 3)
 *   SYNC_PROBE_SKIP        comma list of phases to skip: open|upload
 *   PERF_SESSION           id of the session to copy (default: the one with most messages)
 *   PERF_SOURCE_HOME       where to copy it from (default ~/.lyra)
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createTcpServer, connect, type Server, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { closeListeningServer, startApp, stopProcessGroup, type RunningApp } from "./app.ts";
import { bridgeScript } from "../../mobile/src/bridge.ts";
import { appUrlOf, type Connection } from "../../mobile/src/connection.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");
const LABEL = process.env.SYNC_PROBE_LABEL ?? "run";
const OUT = process.env.SYNC_PROBE_OUT ?? join(tmpdir(), `sync-probe-${LABEL}.json`);
const SCALES = (process.env.SYNC_PROBE_SCALES ?? "1,6").split(",").map(Number).filter((n) => n > 0);
const FILES = (process.env.SYNC_PROBE_FILES ?? "png:20,log:20,log:100,log:300")
	.split(",")
	.filter(Boolean)
	.map((entry) => {
		const [kind, mb] = entry.split(":");
		return { kind: kind === "png" ? "png" : "log", mb: Number(mb) } as const;
	});
const TRANSPORTS = (process.env.SYNC_PROBE_TRANSPORTS ?? "lan,relay").split(",").filter((t): t is "lan" | "relay" => t === "lan" || t === "relay");
const CPU = Number(process.env.SYNC_PROBE_CPU ?? 4);
const MB = 1024 * 1024;
const LAN_RATE = Number(process.env.SYNC_PROBE_LAN_RATE ?? 20) * MB;
const RELAY_DOWN = Number(process.env.SYNC_PROBE_RELAY_DOWN ?? 6) * MB;
const RELAY_UP = Number(process.env.SYNC_PROBE_RELAY_UP ?? 3) * MB;
const SKIP = new Set((process.env.SYNC_PROBE_SKIP ?? "").split(","));
const SOURCE_HOME = process.env.PERF_SOURCE_HOME ?? join(homedir(), ".lyra");
const UPLOAD_TIMEOUT = Number(process.env.SYNC_PROBE_UPLOAD_TIMEOUT ?? 300) * 1000;

/** Progress on stderr, so stdout stays one JSON row per measurement. */
const step = (text: string) => process.stderr.write(`[probe ${LABEL}] ${text}\n`);

const TOKEN = randomBytes(16).toString("hex");
const DESKTOP_CDP = 9741;
const PHONE_CDP = 9742;
const SYNC_PORT = 4611;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

interface Peaks {
	relayMb: number | null;
	desktopMainMb: number | null;
	phoneRendererMb: number | null;
	phoneHeapMb: number | null;
}

type Row = Record<string, unknown> & { label: string; transport: string; scenario: string; mem?: Peaks };
const rows: Row[] = [];

function record(row: Row): void {
	rows.push(row);
	const { mem, ...rest } = row;
	console.log(JSON.stringify({ ...rest, ...(mem ? { mem } : {}) }));
}

// ---------------------------------------------------------------------------
// A throttled TCP hop, so the phone's leg is a network and not loopback
// ---------------------------------------------------------------------------

/**
 * One direction of a throttled connection: a token bucket plus a fixed one-way delay.
 *
 * The queue is bounded, and the source is paused while it is full — which is what a real bottleneck
 * does to the sender: its writes back up instead of vanishing into an infinite buffer.
 */
function throttle(from: Socket, to: Socket, bytesPerSecond: number, latencyMs: number): void {
	const queue: { at: number; chunk: Buffer }[] = [];
	let queued = 0;
	let budget = 0;
	let last = performance.now();
	let timer: NodeJS.Timeout | null = null;
	let blocked = false;
	const pump = () => {
		timer = null;
		if (blocked) return;
		const now = performance.now();
		budget = Math.min(budget + ((now - last) * bytesPerSecond) / 1000, bytesPerSecond * 0.05);
		last = now;
		while (queue.length > 0 && queue[0].at <= now && budget >= 1) {
			const head = queue[0];
			const take = Math.min(head.chunk.length, Math.floor(budget));
			const ok = to.write(head.chunk.subarray(0, take));
			budget -= take;
			queued -= take;
			if (take === head.chunk.length) queue.shift();
			else head.chunk = head.chunk.subarray(take);
			if (!ok) {
				blocked = true;
				to.once("drain", () => {
					blocked = false;
					schedule();
				});
				break;
			}
		}
		if (queued < 256 * 1024 && from.isPaused()) from.resume();
		schedule();
	};
	const schedule = () => {
		if (timer || blocked || queue.length === 0) return;
		const delay = Math.max(1, Math.min(10, queue[0].at - performance.now()));
		timer = setTimeout(pump, delay);
	};
	from.on("data", (chunk: Buffer) => {
		queue.push({ at: performance.now() + latencyMs, chunk });
		queued += chunk.length;
		if (queued > 1024 * 1024) from.pause();
		schedule();
	});
	from.on("end", () => {
		const flush = () => (queue.length === 0 ? to.end() : setTimeout(flush, 10));
		flush();
	});
}

async function throttledProxy(targetPort: number, down: number, up: number, latencyMs: number): Promise<{ port: number; server: Server }> {
	const server = createTcpServer((client) => {
		const upstream = connect(targetPort, "127.0.0.1");
		client.on("error", () => upstream.destroy());
		upstream.on("error", () => client.destroy());
		client.on("close", () => upstream.destroy());
		upstream.on("close", () => client.destroy());
		throttle(client, upstream, up, latencyMs);
		throttle(upstream, client, down, latencyMs);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("proxy did not bind");
	return { port: address.port, server };
}

// ---------------------------------------------------------------------------
// Memory, sampled from the outside
// ---------------------------------------------------------------------------

interface Sample {
	at: number;
	relay: number | null;
	desktopMain: number | null;
	phoneRenderer: number | null;
}

/**
 * RSS of the three processes that matter, several times a second.
 *
 * From `ps` rather than from inside: a renderer that is busy parsing forty megabytes cannot answer
 * a question about its own memory, and one that crashed cannot answer at all. The phone renderer is
 * found as the `--type=renderer` child in the phone app's process group.
 */
class MemorySampler {
	samples: Sample[] = [];
	private timer: NodeJS.Timeout | null = null;
	pids = { relay: 0, desktop: 0, phoneGroup: 0 };

	start(): void {
		const tick = async () => {
			try {
				const { stdout } = await promisify(execFile)("ps", ["-A", "-o", "pid=,pgid=,rss=,args="], { maxBuffer: 16 * MB });
				const sample: Sample = { at: performance.now(), relay: null, desktopMain: null, phoneRenderer: null };
				for (const line of stdout.split("\n")) {
					const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
					if (!match) continue;
					const pid = Number(match[1]);
					const pgid = Number(match[2]);
					const rss = Number(match[3]) / 1024;
					const args = match[4];
					if (pid === this.pids.relay) sample.relay = rss;
					if (pid === this.pids.desktop) sample.desktopMain = rss;
					if (this.pids.phoneGroup && pgid === this.pids.phoneGroup && args.includes("--type=renderer")) {
						sample.phoneRenderer = Math.max(sample.phoneRenderer ?? 0, rss);
					}
				}
				this.samples.push(sample);
			} catch {
				/* one missed sample is not worth failing a run */
			}
			this.timer = setTimeout(tick, 150);
		};
		void tick();
	}

	stop(): void {
		if (this.timer) clearTimeout(this.timer);
	}

	peaks(from: number, to: number): Omit<Peaks, "phoneHeapMb"> {
		const window = this.samples.filter((s) => s.at >= from && s.at <= to + 200);
		const peak = (key: "relay" | "desktopMain" | "phoneRenderer") => {
			const values = window.map((s) => s[key]).filter((v): v is number => v !== null);
			return values.length ? Math.round(Math.max(...values)) : null;
		};
		return { relayMb: peak("relay"), desktopMainMb: peak("desktopMain"), phoneRendererMb: peak("phoneRenderer") };
	}
}

async function pidOf(pattern: string): Promise<number> {
	for (let i = 0; i < 50; i++) {
		const { stdout } = await promisify(execFile)("pgrep", ["-f", pattern]).catch(() => ({ stdout: "" }));
		const pid = Number(stdout.trim().split("\n")[0]);
		if (pid) return pid;
		await wait(100);
	}
	return 0;
}

// ---------------------------------------------------------------------------
// A model that answers every request, and says what it was sent
// ---------------------------------------------------------------------------

interface SeenRequest {
	at: number;
	bytes: number;
	markers: Set<string>;
}

/**
 * Anthropic-shaped SSE, one short reply per request.
 *
 * The body is streamed and scanned rather than buffered: in the before case a single request can
 * carry hundreds of megabytes of attachment, and holding it would make this process the one that
 * falls over. What is kept is the size and which of the watched markers appeared.
 */
function startModel(watched: () => string[]) {
	const seen: SeenRequest[] = [];
	let turn = 0;
	const server = createHttpServer((request: IncomingMessage, response: ServerResponse) => {
		const markers = new Set<string>();
		let bytes = 0;
		let tail = "";
		request.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			const text = tail + chunk.toString("latin1");
			for (const marker of watched()) if (text.includes(marker)) markers.add(marker);
			tail = text.slice(-256);
		});
		request.on("end", () => {
			seen.push({ at: performance.now(), bytes, markers });
			step(`model request: ${bytes} bytes, markers [${[...markers].join(", ")}]`);
			const sse = (event: Record<string, unknown>) => response.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
			response.writeHead(200, { "content-type": "text/event-stream" });
			sse({ type: "message_start", message: { id: `probe-${++turn}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
			sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "收到。" } });
			sse({ type: "content_block_stop", index: 0 });
			sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } });
			sse({ type: "message_stop" });
			response.end();
		});
	});
	return { server, seen };
}

// ---------------------------------------------------------------------------
// The profile: a real conversation, neutralised, scaled; plus small targets for uploads
// ---------------------------------------------------------------------------

interface Meta {
	id: string;
	title: string;
	cwd: string;
	projectId: string;
	projectName: string;
	messageCount: number;
	seq: number;
	[key: string]: unknown;
}

async function pickSource(): Promise<Meta> {
	const index = JSON.parse(await readFile(join(SOURCE_HOME, "sessions", "index.json"), "utf8")) as Meta[];
	const wanted = process.env.PERF_SESSION;
	const found = wanted ? index.find((m) => m.id === wanted) : index.slice().sort((a, b) => (b.messageCount ?? 0) - (a.messageCount ?? 0))[0];
	if (!found) throw new Error("no source session");
	return found;
}

/** The message records of a session log, in order. Only messages: events and titles stay behind. */
async function messageRecords(meta: Meta): Promise<unknown[]> {
	const file = join(SOURCE_HOME, "sessions", meta.projectId, `${meta.id}.jsonl`);
	const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
	const messages: unknown[] = [];
	for await (const line of lines) {
		if (!line.trim()) continue;
		try {
			const record = JSON.parse(line) as { type?: string; message?: unknown };
			if (record.type === "message" && record.message) messages.push(record.message);
		} catch {
			/* a torn final line */
		}
	}
	return messages;
}

async function writeSession(home: string, meta: Meta, messages: unknown[]): Promise<void> {
	const dir = join(home, "sessions", meta.projectId);
	await mkdir(dir, { recursive: true });
	const out = createWriteStream(join(dir, `${meta.id}.jsonl`));
	// Sequence numbers start at 1: a meta record at 0 is silently read past.
	const write = (line: string) => new Promise<void>((resolve) => (out.write(`${line}\n`) ? resolve() : out.once("drain", () => resolve())));
	await write(JSON.stringify({ type: "meta", meta, seq: 1, ts: 1 }));
	let seq = 1;
	for (const message of messages) await write(JSON.stringify({ type: "message", message, seq: ++seq, ts: 2 }));
	await new Promise<void>((resolve) => out.end(resolve));
}

interface Seeded {
	projectId: string;
	large: { id: string; scale: number; messages: number }[];
	uploadTargets: string[];
}

async function seed(home: string, modelPort: number, relayPort: number): Promise<Seeded> {
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# sync probe\n");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const base = { cwd, projectId, projectName: "sync-probe", createdAt: 1, updatedAt: 2, modelId: "probe/model", usage };
	const index: Meta[] = [];

	const source = await pickSource();
	const original = await messageRecords(source);
	const large: Seeded["large"] = [];
	for (const scale of SCALES) {
		const messages: unknown[] = [];
		for (let i = 0; i < scale; i++) messages.push(...original);
		const id = `probe-x${scale}-${randomBytes(4).toString("hex")}`;
		const meta: Meta = { ...base, id, title: `probe ×${scale}`, messageCount: messages.length, seq: messages.length + 1 };
		await writeSession(home, meta, messages);
		index.push(meta);
		large.push({ id, scale, messages: messages.length });
	}

	/*
	 * Small conversations to send files into, four to a project.
	 *
	 * The sidebar shows five conversations per project and folds the rest behind 「展开显示」, so a
	 * dozen targets in one project would leave most of them unclickable. One file per conversation,
	 * too: a turn that carried 300 MB of text would otherwise ride along in every later request.
	 */
	const uploadTargets: string[] = [];
	const projects = [{ id: projectId, path: cwd, name: "sync-probe", pinned: true, lastOpenedAt: 1 }];
	const targets = FILES.length * TRANSPORTS.length + 2;
	for (let i = 0; i < targets; i++) {
		const group = Math.floor(i / 4);
		const dir = join(home, `uploads-${group}`);
		if (i % 4 === 0) {
			await mkdir(dir, { recursive: true });
			projects.push({ id: createHash("sha256").update(dir).digest("hex").slice(0, 16), path: dir, name: `uploads-${group}`, pinned: true, lastOpenedAt: 1 });
		}
		const id = `probe-up-${i}-${randomBytes(3).toString("hex")}`;
		const messages = [
			{ role: "user", content: [{ type: "text", text: `upload target ${i}` }], timestamp: 1 },
			{ role: "assistant", content: [{ type: "text", text: "ok" }], api: "anthropic-messages", provider: "probe", model: "model", usage, stopReason: "stop", timestamp: 2 },
		];
		const meta: Meta = { ...base, cwd: dir, projectId: projects.at(-1)!.id, projectName: `uploads-${group}`, id, title: `upload ${i}`, messageCount: 2, seq: 3, updatedAt: 100 + i };
		await writeSession(home, meta, messages);
		index.push(meta);
		uploadTargets.push(id);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(index));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1200, height: 800, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			providers: [
				{
					id: "probe",
					name: "probe",
					api: "anthropic-messages",
					baseUrl: `http://127.0.0.1:${modelPort}`,
					apiKey: "probe",
					enabled: true,
					models: [{ id: "probe/model", providerId: "probe", modelId: "model", name: "Probe", contextWindow: 10_000_000, maxOutputTokens: 4096, supportsImages: true, supportsTools: true, supportsThinking: false }],
				},
			],
			defaultModelId: "probe/model",
			mcpServers: [],
			hooks: [],
			permissionMode: "auto",
			thinking: "off",
			projects,
			sync: { enabled: true, port: SYNC_PORT, token: TOKEN, relayUrl: `ws://127.0.0.1:${relayPort}` },
			uiLocale: "zh-CN",
			appearance: { theme: "dark", reduceMotion: "on" },
		}),
	);
	return { projectId, large, uploadTargets };
}

/** Files to send, each with a marker the model can be checked for. Written once, reused. */
async function makeFiles(dir: string): Promise<{ kind: "png" | "log"; mb: number; path: string; name: string; marker: string; size: number }[]> {
	const made = [];
	for (const { kind, mb } of FILES) {
		const marker = `LYRA-PROBE-${kind}-${mb}-${randomBytes(4).toString("hex")}`;
		const name = `${marker}.${kind}`;
		const path = join(dir, name);
		const out = createWriteStream(path);
		const size = mb * MB;
		let written = 0;
		const write = (chunk: Buffer) => new Promise<void>((resolve) => (out.write(chunk) ? resolve() : out.once("drain", () => resolve())));
		if (kind === "png") {
			// A PNG signature and then noise: the composer decides by name and type, never by decoding.
			const head = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(marker)]);
			await write(head);
			written += head.length;
			while (written < size) {
				const chunk = randomBytes(Math.min(MB, size - written));
				await write(chunk);
				written += chunk.length;
			}
		} else {
			await write(Buffer.from(`${marker}\n`));
			written += marker.length + 1;
			let line = 0;
			while (written < size) {
				const lines: string[] = [];
				for (let i = 0; i < 4000; i++) lines.push(`2026-09-27T08:00:${String(line % 60).padStart(2, "0")}Z INFO worker-${line % 17} handled request ${line++} in ${(line * 7) % 400}ms`);
				let chunk = Buffer.from(`${lines.join("\n")}\n`);
				if (written + chunk.length > size) chunk = chunk.subarray(0, size - written);
				await write(chunk);
				written += chunk.length;
			}
		}
		await new Promise<void>((resolve) => out.end(resolve));
		made.push({ kind, mb, path, name, marker, size: (await stat(path)).size });
	}
	return made;
}

// ---------------------------------------------------------------------------
// The phone: the real bridge and renderer in Chromium, on one persistent DevTools session
// ---------------------------------------------------------------------------

class Cdp {
	private socket: WebSocket;
	private next = 0;
	private waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private listeners = new Map<string, ((params: unknown) => void)[]>();
	closed = false;

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string } };
			if (message.id !== undefined) {
				const entry = this.waiting.get(message.id);
				this.waiting.delete(message.id);
				if (message.error) entry?.reject(new Error(message.error.message));
				else entry?.resolve(message.result);
				return;
			}
			for (const listener of this.listeners.get(message.method ?? "") ?? []) listener(message.params);
		});
		socket.addEventListener("close", () => {
			this.closed = true;
			for (const entry of this.waiting.values()) entry.reject(new Error("devtools connection closed"));
			this.waiting.clear();
		});
	}

	static async open(url: string): Promise<Cdp> {
		const socket = new WebSocket(url);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve(), { once: true });
			socket.addEventListener("error", () => reject(new Error("devtools socket error")), { once: true });
		});
		return new Cdp(socket);
	}

	send<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
		if (this.closed) return Promise.reject(new Error("devtools connection closed"));
		const id = ++this.next;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiting.delete(id);
				reject(new Error(`${method} timed out`));
			}, timeoutMs);
			this.waiting.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value as T);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	on(method: string, listener: (params: unknown) => void): void {
		this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
	}

	/** A short synchronous expression. Long waits are polled from here rather than awaited in-page. */
	async evaluate<T>(expression: string, timeoutMs = 60_000): Promise<T> {
		const answer = await this.send<{ result?: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
			"Runtime.evaluate",
			{ expression, returnByValue: true, awaitPromise: false },
			timeoutMs,
		);
		if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
		return answer.result?.value as T;
	}

	close(): void {
		this.socket.close();
	}
}

interface Phone {
	cdp: Cdp;
	crashed: boolean;
	stop(): Promise<void>;
	pgid: number;
}

async function startPhone(home: string, connection: Connection): Promise<Phone> {
	const preload = join(home, "phone-bridge.cjs");
	const entry = join(home, "phone-host.cjs");
	const profile = join(home, "phone-profile");
	await mkdir(profile, { recursive: true });
	await writeFile(preload, bridgeScript(connection));
	await writeFile(
		entry,
		`const {app,BrowserWindow}=require("electron");
app.setPath('userData',${JSON.stringify(profile)});
app.commandLine.appendSwitch('js-flags','--max-old-space-size=4096');
app.whenReady().then(()=>{const win=new BrowserWindow({width:430,height:932,x:0,y:0,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:false,nodeIntegration:false,sandbox:false,backgroundThrottling:false}});win.loadURL(${JSON.stringify(appUrlOf(connection))});});
app.on('window-all-closed',()=>app.quit());`,
	);
	const { createRequire } = await import("node:module");
	const executable: unknown = createRequire(import.meta.url)("electron");
	if (typeof executable !== "string") throw new Error("Electron executable unavailable");
	const env = { ...process.env };
	delete env.NODE_TEST_CONTEXT;
	const child: ChildProcess = spawn(executable, [entry, `--remote-debugging-port=${PHONE_CDP}`], { env, detached: true, stdio: "ignore" });
	let target: string | undefined;
	for (let i = 0; i < 200 && !target; i++) {
		const pages = await fetch(`http://127.0.0.1:${PHONE_CDP}/json/list`)
			.then((r) => r.json() as Promise<{ type: string; webSocketDebuggerUrl?: string }[]>)
			.catch(() => []);
		target = pages.find((p) => p.type === "page")?.webSocketDebuggerUrl;
		if (!target) await wait(100);
	}
	if (!target) {
		await stopProcessGroup(child);
		throw new Error("phone renderer did not start");
	}
	const cdp = await Cdp.open(target);
	const phone: Phone = { cdp, crashed: false, pgid: child.pid ?? 0, stop: async () => {
		cdp.close();
		await stopProcessGroup(child);
	} };
	cdp.on("Inspector.targetCrashed", () => {
		phone.crashed = true;
	});
	await cdp.send("Inspector.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
	await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
	if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
	for (let i = 0; i < 600; i++) {
		if (await cdp.evaluate<boolean>("Boolean(document.querySelector('.ly-shell'))").catch(() => false)) break;
		await wait(100);
	}
	await cdp.evaluate(INSTRUMENT);
	return phone;
}

/**
 * Installed in the phone page once: what the page itself can see while a scenario runs.
 *
 * `sessions.transcript` is wrapped where the renderer reaches it — the bridge's group object — so
 * the timing is the call the renderer made, not a second one. `JSON.parse` is wrapped to catch the
 * bridge parsing a large frame. Connection changes come from the bridge's own `lyra:connection`.
 */
const INSTRUMENT = `(() => {
	if (window.__probe) return true;
	const probe = window.__probe = { calls: [], parses: [], tasks: [], conn: [], heapPeak: 0, marks: {} };
	const parse = JSON.parse;
	JSON.parse = function (text, reviver) {
		const started = performance.now();
		const value = parse.call(this, text, reviver);
		if (typeof text === "string" && text.length > 262144) probe.parses.push({ chars: text.length, ms: performance.now() - started, at: started });
		return value;
	};
	const sessions = window.lyra.sessions;
	const transcript = sessions.transcript;
	sessions.transcript = function (...args) {
		const call = { id: args[1], start: performance.now(), end: 0, messages: -1, error: null };
		probe.calls.push(call);
		return Promise.resolve(transcript.apply(this, args)).then((value) => {
			call.end = performance.now();
			call.messages = value && Array.isArray(value.messages) ? value.messages.length : -1;
			return value;
		}, (error) => {
			call.end = performance.now();
			call.error = String(error && error.message || error);
			throw error;
		});
	};
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) probe.tasks.push({ start: entry.startTime, duration: entry.duration });
		}).observe({ entryTypes: ["longtask"] });
	} catch {}
	window.addEventListener("lyra:connection", (event) => probe.conn.push({ at: performance.now(), status: event.detail }));
	setInterval(() => {
		const used = performance.memory ? performance.memory.usedJSHeapSize : 0;
		if (used > probe.heapPeak) probe.heapPeak = used;
	}, 100);
	return true;
})()`;

/** Press at an element's centre, after checking that the press would land on it. */
async function tap(phone: Phone, selector: string): Promise<void> {
	const point = await phone.cdp.evaluate<{ x: number; y: number } | string>(
		`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.checkVisibility()); if (!el) return "missing"; el.scrollIntoView({ block: "nearest", behavior: "instant" }); const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; const hit = document.elementFromPoint(x, y); return hit && el.contains(hit) ? { x, y } : "covered by " + (hit ? hit.outerHTML.slice(0, 200) : "nothing"); })()`,
	);
	if (typeof point === "string") throw new Error(`${selector}: ${point}`);
	await phone.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
	await phone.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
	await phone.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}

/** Bring the row on screen, opening the drawer if the sidebar is folded away. */
async function revealRow(phone: Phone, id: string): Promise<void> {
	const row = `[data-ly-row="${id}"] > button`;
	// The shell paints before the session list arrives over the link; wait for the row itself.
	for (let i = 0; i < 200; i++) {
		if (await phone.cdp.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(row)}))`).catch(() => false)) break;
		await wait(100);
	}
	const onScreen = await phone.cdp.evaluate<boolean>(
		`(() => { const el = document.querySelector(${JSON.stringify(row)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`,
	);
	if (!onScreen) {
		await tap(phone, 'button[aria-label^="显示侧边栏"]');
		for (let i = 0; i < 40; i++) {
			const ready = await phone.cdp.evaluate<boolean>(
				`(() => { const el = document.querySelector(${JSON.stringify(row)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`,
			);
			if (ready) break;
			await wait(100);
		}
		await wait(400);
	}
}

/** Open the drawer if the row is off-screen, then open the conversation. */
async function openRow(phone: Phone, id: string): Promise<void> {
	await revealRow(phone, id);
	await tap(phone, `[data-ly-row="${id}"] > button`);
}

// ---------------------------------------------------------------------------
// Scenario 1: opening a large conversation
// ---------------------------------------------------------------------------

async function measureOpen(phone: Phone, sampler: MemorySampler, transport: string, session: { id: string; scale: number; messages: number }): Promise<void> {
	await phone.cdp.evaluate(`(() => { const p = window.__probe; p.calls.length = 0; p.parses.length = 0; p.tasks.length = 0; p.conn.length = 0; p.heapPeak = 0; return true; })()`);
	const watch = `(() => {
		const p = window.__probe; const id = ${JSON.stringify(session.id)};
		p.marks = { click: performance.now(), first: 0, ready: 0 };
		const tick = () => {
			const el = document.querySelector('.ly-transcript[data-ly-session="' + id + '"]');
			const rows = el ? el.querySelectorAll('[data-ly-transcript-rows] > *').length : 0;
			const now = performance.now();
			if (rows > 0 && !p.marks.first) p.marks.first = now;
			if (rows > 0 && el.getAttribute('aria-busy') === 'false' && !p.marks.ready) p.marks.ready = now;
			if (!p.marks.ready && now - p.marks.click < 180000) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return true;
	})()`;
	let error: string | null = null;
	await revealRow(phone, session.id).catch((cause: unknown) => {
		error = cause instanceof Error ? cause.message : String(cause);
	});
	const started = performance.now();
	await phone.cdp.evaluate(watch);
	try {
		if (!error) await tap(phone, `[data-ly-row="${session.id}"] > button`);
	} catch (cause) {
		error = cause instanceof Error ? cause.message : String(cause);
	}
	// Until rendered and quiet — or failed, or out of time.
	type OpenState = { first: number; ready: number; click: number; quietFor: number; failed: string | null; conn: string };
	let state = null as OpenState | null;
	const deadline = performance.now() + 180_000;
	while (!error && performance.now() < deadline) {
		if (phone.crashed) {
			error = "renderer crashed";
			break;
		}
		state = await phone.cdp
			.evaluate<OpenState | null>(
				`(() => { const p = window.__probe; const now = performance.now(); const lastTask = p.tasks.reduce((m, t) => Math.max(m, t.start + t.duration), 0); const call = p.calls.find((c) => c.id === ${JSON.stringify(session.id)}); return { first: p.marks.first, ready: p.marks.ready, click: p.marks.click, quietFor: now - Math.max(lastTask, p.marks.ready || now), failed: call && call.error, conn: window.lyra.sync.connectionStatus() }; })()`,
				20_000,
			)
			.catch((cause: unknown) => {
				error = cause instanceof Error ? cause.message : String(cause);
				return null;
			});
		if (state?.failed) {
			error = state.failed;
			break;
		}
		if (state && state.ready && state.quietFor > 1000) break;
		await wait(100);
	}
	const finished = performance.now();
	if (!error && !(state && state.ready)) error = "timeout";
	const detail = phone.crashed
		? null
		: await phone.cdp
				.evaluate<{ calls: { id: string; start: number; end: number; messages: number; error: string | null }[]; parses: { chars: number; ms: number; at: number }[]; tasks: { start: number; duration: number }[]; conn: { at: number; status: string }[]; heapPeak: number; marks: { click: number; first: number; ready: number } }>(
					"(() => { const p = window.__probe; return { calls: p.calls, parses: p.parses, tasks: p.tasks, conn: p.conn, heapPeak: p.heapPeak, marks: p.marks }; })()",
				)
				.catch(() => null);
	const click = detail?.marks.click ?? 0;
	const call = detail?.calls.find((c) => c.id === session.id);
	const tasks = (detail?.tasks ?? []).filter((t) => t.start >= click);
	const lastTaskEnd = tasks.reduce((m, t) => Math.max(m, t.start + t.duration), 0);
	const ms = (value: number) => Math.round(value);
	record({
		label: LABEL,
		transport,
		scenario: "open",
		session: `x${session.scale}`,
		messages: session.messages,
		outcome: error ? "fail" : "ok",
		error,
		transcriptCallMs: call && call.end ? ms(call.end - call.start) : null,
		firstRowsMs: detail?.marks.first ? ms(detail.marks.first - click) : null,
		readyMs: detail?.marks.ready ? ms(detail.marks.ready - click) : null,
		quietMs: detail?.marks.ready ? ms(Math.max(detail.marks.ready, lastTaskEnd) - click) : null,
		parseMs: ms((detail?.parses ?? []).filter((p) => p.at >= click).reduce((sum, p) => sum + p.ms, 0)),
		parsedChars: (detail?.parses ?? []).filter((p) => p.at >= click).reduce((sum, p) => sum + p.chars, 0),
		longTaskMs: ms(tasks.reduce((sum, t) => sum + t.duration, 0)),
		longestTaskMs: ms(tasks.reduce((m, t) => Math.max(m, t.duration), 0)),
		drops: (detail?.conn ?? []).filter((c) => c.status !== "connected").length,
		wallMs: ms(finished - started),
		mem: { ...sampler.peaks(started, finished), phoneHeapMb: detail ? Math.round(detail.heapPeak / MB) : null },
	});
}

// ---------------------------------------------------------------------------
// Scenario 2: sending a large file from the phone's composer
// ---------------------------------------------------------------------------

async function measureUpload(
	phone: Phone,
	sampler: MemorySampler,
	model: ReturnType<typeof startModel>,
	desktopHome: string,
	transport: string,
	target: string,
	file: Awaited<ReturnType<typeof makeFiles>>[number],
): Promise<void> {
	await openRow(phone, target);
	for (let i = 0; i < 100; i++) {
		const ready = await phone.cdp.evaluate<boolean>(`Boolean(document.querySelector('.ly-transcript[data-ly-session="${target}"][aria-busy="false"]')) && Boolean(document.querySelector('main textarea'))`).catch(() => false);
		if (ready) break;
		await wait(100);
	}
	await phone.cdp.evaluate(`(() => { const p = window.__probe; p.conn.length = 0; p.heapPeak = 0; return true; })()`);
	const seenBefore = model.seen.length;
	const started = performance.now();
	let error: string | null = null;
	let pickedAt = 0;
	let sentAt = 0;
	let arrivedAt = 0;
	try {
		// The composer's own file input, given a real file the way the OS picker would.
		const handle = await phone.cdp.send<{ result: { objectId?: string } }>("Runtime.evaluate", { expression: "document.querySelector('main input[type=file]')" });
		if (!handle.result.objectId) throw new Error("composer file input not found");
		await phone.cdp.send("DOM.enable");
		await phone.cdp.send("DOM.setFileInputFiles", { files: [file.path], objectId: handle.result.objectId });
		// Ready to send: the attachment is in the composer and the send button can be pressed.
		step(`upload ${file.kind}-${file.mb}MB via ${transport}: picking`);
		const deadline = performance.now() + UPLOAD_TIMEOUT;
		while (performance.now() < deadline) {
			if (phone.crashed) throw new Error("renderer crashed while reading the file");
			const state = await phone.cdp.evaluate<{ attached: boolean; problem: string | null }>(
				`(() => { const main = document.querySelector('main'); const text = main ? main.innerText : ''; const alert = [...document.querySelectorAll('[role="alert"],[role="status"]')].map((e) => e.innerText).join(' | '); return { attached: text.includes(${JSON.stringify(file.marker)}) || [...document.querySelectorAll('main [title]')].some((e) => (e.getAttribute('title') || '').includes(${JSON.stringify(file.marker)})), problem: /失败|无法|太大|断开/.test(alert) ? alert.slice(0, 200) : null }; })()`,
				30_000,
			);
			if (state.attached) break;
			if (state.problem) throw new Error(state.problem);
			await wait(150);
		}
		pickedAt = performance.now();
		step(`attached after ${Math.round(pickedAt - started)}ms; sending`);
		/*
		 * Focused from script, not tapped: the attachment's token is drawn over the textarea, and a
		 * tap on the middle of it opens the image preview instead of placing a caret. The caret goes
		 * after the placeholder, not inside it — typing into the placeholder detaches the file.
		 */
		await phone.cdp.evaluate("(() => { const t = document.querySelector('main textarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true; })()");
		await phone.cdp.send("Input.insertText", { text: " 看看这个文件" });
		await tap(phone, 'main button[aria-label="发送"]');
		sentAt = performance.now();
		// Success is the model being asked about this file; failure is anything the page reports.
		while (performance.now() < sentAt + UPLOAD_TIMEOUT) {
			if (phone.crashed) throw new Error("renderer crashed while sending");
			const hit = model.seen.slice(seenBefore).find((request) => request.markers.has(file.marker));
			if (hit) {
				arrivedAt = hit.at;
				break;
			}
			const problem = await phone.cdp
				.evaluate<string | null>(`(() => { const alert = [...document.querySelectorAll('[role="alert"]')].map((e) => e.innerText).join(' | '); return /失败|无法|太大|断开|没有响应/.test(alert) ? alert.slice(0, 200) : null; })()`, 30_000)
				.catch((cause: unknown) => (cause instanceof Error ? cause.message : String(cause)));
			if (problem) throw new Error(problem);
			await wait(200);
		}
		if (!arrivedAt) throw new Error("timeout: the model never saw the file");
	} catch (cause) {
		error = cause instanceof Error ? cause.message : String(cause);
	}
	const finished = performance.now();
	const detail = phone.crashed
		? null
		: await phone.cdp.evaluate<{ conn: { status: string }[]; heapPeak: number }>("(() => ({ conn: window.__probe.conn, heapPeak: window.__probe.heapPeak }))()").catch(() => null);
	// Did the desktop end up holding the file itself (the upload path), and is it the same file?
	const onDesktop = await findUpload(desktopHome, file.name, file.size, file.path);
	const request = model.seen.slice(seenBefore).find((r) => r.markers.has(file.marker));
	record({
		label: LABEL,
		transport,
		scenario: "upload",
		file: `${file.kind}-${file.mb}MB`,
		bytes: file.size,
		outcome: phone.crashed ? "crash" : error ? "fail" : "ok",
		error,
		readyToSendMs: pickedAt ? Math.round(pickedAt - started) : null,
		sendToModelMs: arrivedAt && sentAt ? Math.round(arrivedAt - sentAt) : null,
		totalMs: arrivedAt ? Math.round(arrivedAt - started) : null,
		modelRequestBytes: request?.bytes ?? null,
		storedOnDesktop: onDesktop,
		drops: (detail?.conn ?? []).filter((c) => c.status !== "connected").length,
		mem: { ...sampler.peaks(started, finished), phoneHeapMb: detail ? Math.round(detail.heapPeak / MB) : null },
	});
}

/** An uploaded copy under the desktop's profile, verified byte for byte by hash. */
async function findUpload(home: string, name: string, size: number, original: string): Promise<"verified" | "mismatch" | "absent"> {
	const { stdout } = await promisify(execFile)("find", [home, "-name", name, "-type", "f"]).catch(() => ({ stdout: "" }));
	const candidates = stdout.split("\n").filter(Boolean);
	if (candidates.length === 0) return "absent";
	const digest = (path: string) =>
		new Promise<string>((resolve, reject) => {
			const hash = createHash("sha256");
			createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
		});
	const want = await digest(original);
	for (const candidate of candidates) {
		if ((await stat(candidate)).size === size && (await digest(candidate)) === want) return "verified";
	}
	return "mismatch";
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const scratch = await mkdtemp(join(tmpdir(), "lyra-sync-probe-"));
	const sampler = new MemorySampler();
	let relay: ChildProcess | null = null;
	let desktop: RunningApp | null = null;
	let phone: Phone | null = null;
	const proxies: Server[] = [];
	const files = SKIP.has("upload") ? [] : await makeFiles(scratch);
	const model = startModel(() => files.map((f) => f.marker));
	try {
		await new Promise<void>((resolve) => model.server.listen(0, "127.0.0.1", resolve));
		const modelAddress = model.server.address();
		if (!modelAddress || typeof modelAddress === "string") throw new Error("model did not bind");

		const relayPort = 4612;
		relay = spawn(process.execPath, [join(REPO, "packages", "relay", "server.mjs")], { env: { ...process.env, PORT: String(relayPort) }, detached: true, stdio: "ignore" });
		sampler.pids.relay = relay.pid ?? 0;
		for (let i = 0; i < 100; i++) {
			if (await fetch(`http://127.0.0.1:${relayPort}/health`).then((r) => r.ok).catch(() => false)) break;
			await wait(100);
		}

		let seeded: Seeded | null = null;
		desktop = await startApp({
			port: DESKTOP_CDP,
			seed: async (home) => {
				seeded = await seed(home, modelAddress.port, relayPort);
			},
		});
		if (!seeded) throw new Error("profile was not seeded");
		const plan: Seeded = seeded;
		sampler.pids.desktop = await pidOf(`remote-debugging-port=${DESKTOP_CDP}`);
		sampler.start();
		// The display cache is built on first read; build it now so every run measures a warm read.
		for (const session of plan.large) {
			await desktop.evaluate(`window.lyra.sessions.transcript(${JSON.stringify(plan.projectId)}, ${JSON.stringify(session.id)}).then((s) => s ? s.messages.length : -1)`);
		}
		const transcriptBytes: Record<string, number> = {};
		for (const session of plan.large) {
			transcriptBytes[`x${session.scale}`] = await desktop.evaluate<number>(
				`window.lyra.sessions.transcript(${JSON.stringify(plan.projectId)}, ${JSON.stringify(session.id)}).then((s) => JSON.stringify(s).length)`,
			);
		}
		console.log(JSON.stringify({ label: LABEL, transcriptChars: transcriptBytes }));

		let upload = 0;
		for (const transport of TRANSPORTS) {
			const upstream = transport === "lan" ? SYNC_PORT : relayPort;
			const proxy = transport === "lan" ? await throttledProxy(upstream, LAN_RATE, LAN_RATE, 2) : await throttledProxy(upstream, RELAY_DOWN, RELAY_UP, 30);
			proxies.push(proxy.server);
			const connection: Connection = { host: "127.0.0.1", port: proxy.port, token: TOKEN, platform: "darwin", ...(transport === "relay" ? { relay: true } : {}) };
			phone = await startPhone(desktop.home, connection);
			sampler.pids.phoneGroup = phone.pgid;

			if (!SKIP.has("open")) {
				for (const session of plan.large.slice().sort((a, b) => a.scale - b.scale)) {
					if (phone.crashed) {
						await phone.stop();
						phone = await startPhone(desktop.home, connection);
						sampler.pids.phoneGroup = phone.pgid;
					}
					await measureOpen(phone, sampler, transport, session);
					// Park on a small conversation so the next open is a real open.
					await openRow(phone, plan.uploadTargets[plan.uploadTargets.length - 1]).catch(() => {});
					await wait(1500);
				}
			}
			for (const file of files) {
				if (phone.crashed) {
					await phone.stop();
					phone = await startPhone(desktop.home, connection);
					sampler.pids.phoneGroup = phone.pgid;
				}
				await measureUpload(phone, sampler, model, desktop.home, transport, plan.uploadTargets[upload++], file);
				// A failed send can leave the socket reconnecting; give it time to settle before the next.
				await wait(3000);
				const status = await phone.cdp.evaluate<string>("window.lyra.sync.connectionStatus()").catch(() => "gone");
				if (status !== "connected") {
					await phone.stop();
					phone = await startPhone(desktop.home, connection);
					sampler.pids.phoneGroup = phone.pgid;
				}
			}
			await phone.stop();
			phone = null;
		}
	} finally {
		sampler.stop();
		await phone?.stop().catch(() => {});
		await desktop?.stop().catch(() => {});
		for (const proxy of proxies) proxy.close();
		await closeListeningServer(model.server);
		if (relay) await stopProcessGroup(relay);
		await rm(scratch, { recursive: true, force: true });
		await writeFile(OUT, JSON.stringify(rows, null, 2));
		console.log(`\n${rows.length} rows → ${OUT} (${basename(OUT)})`);
	}
}

await main();
process.exit(0);
