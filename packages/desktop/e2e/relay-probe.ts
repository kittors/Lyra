/* oxlint-disable no-console -- probe CLI that prints what each hop saw */
/**
 * A phone reaching the desktop through a relay, with no route between them.
 *
 * This is the path that unit tests cannot make a claim about. The relay is a separate process that
 * knows nothing about either end; the desktop dials *out* to it; and the phone dials out to the
 * same room from somewhere else entirely. Whether that actually carries a call is a question about
 * three processes and two sockets, so all three are real here.
 *
 * The phone is stood in for by this process — the same frames, the same room derivation, the same
 * protocol. What a real phone adds is a WebView, and that is not what this is asking about.
 *
 *   node e2e/relay-probe.ts            使用本机起的中转
 *   node e2e/relay-probe.ts <ws-url>   使用一台真实的中转服务器
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { startApp } from "./app.ts";

const RELAY_PORT = 9931;
const SYNC_PORT = 4598;
const TOKEN = "1111111111111111111111111111abcd";
/** A relay given on the command line, so the same probe can check a deployed one. */
const REMOTE = process.argv[2];
const RELAY_URL = REMOTE ?? `ws://127.0.0.1:${RELAY_PORT}`;

const room = createHash("sha256").update(TOKEN).digest("hex");

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# 中转测试\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "p", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "",
			permissionMode: "auto",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			// The whole point of the run: the desktop should dial out to this on start.
			sync: { enabled: true, port: SYNC_PORT, token: TOKEN, relayUrl: RELAY_URL },
			editor: { defaultOpenTarget: "Zed", showBottomPanel: true },
			appearance: { theme: "dark" },
		}),
	);
}

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
	if (!ok) failures++;
	console.log(`${ok ? "✔" : "✖"} ${label}${ok || !detail ? "" : `\n     ${detail}`}`);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The relay, unless one was named on the command line. */
function startRelay(): ChildProcess | null {
	if (REMOTE) return null;
	const script = fileURLToPath(new URL("../../relay/server.mjs", import.meta.url));
	const child = spawn(process.execPath, [script], {
		env: { ...process.env, PORT: String(RELAY_PORT) },
		stdio: "ignore",
	});
	return child;
}

/**
 * The phone: dial the relay, claim the room, then speak the sync protocol.
 *
 * Everything after the hello is what the bridge sends — this is deliberately not a special client.
 */
async function phone(): Promise<{ socket: WebSocket; seen: Record<string, unknown>[] }> {
	const socket = new WebSocket(RELAY_URL);
	const seen: Record<string, unknown>[] = [];
	socket.on("message", (data) => {
		try {
			seen.push(JSON.parse(String(data)) as Record<string, unknown>);
		} catch {
			/* not ours */
		}
	});
	await new Promise<void>((resolve, reject) => {
		socket.once("open", () => resolve());
		socket.once("error", reject);
	});
	socket.send(JSON.stringify({ type: "hello", room }));
	return { socket, seen };
}

/** One call, the way the bridge makes it: a frame with an id, answered by a frame with the same id. */
function callThrough(socket: WebSocket, seen: Record<string, unknown>[], method: string, args: unknown[]) {
	const id = `probe-${method}`;
	socket.send(JSON.stringify({ type: "rpc", id, method, args }));
	return async (): Promise<Record<string, unknown> | undefined> => {
		for (let i = 0; i < 60; i++) {
			const answer = seen.find((m) => m.type === "rpc_result" && m.id === id);
			if (answer) return answer;
			await wait(100);
		}
		return undefined;
	};
}

const relay = startRelay();
if (relay) await wait(800);
console.log(`中转：${RELAY_URL}${REMOTE ? "（外部）" : "（本机）"}\n房间：${room.slice(0, 16)}…\n`);

const desktop = await startApp({ port: 9469, seed });
let link: WebSocket | null = null;

try {
	// The desktop dials out on start; give it a moment to arrive in the room.
	await wait(3000);

	const { socket, seen } = await phone();
	link = socket;

	// The relay says `ready` to both once the second one arrives — which is the desktop being there.
	let ready = false;
	for (let i = 0; i < 50 && !ready; i++) {
		ready = seen.some((m) => m.type === "ready");
		if (!ready) await wait(100);
	}
	check("两端在同一个房间里碰上了", ready, `中转回的是：${JSON.stringify(seen)}`);

	/*
	 * Waited for rather than checked once.
	 *
	 * `ready` goes to both ends at the same moment, and the desktop's hello is sent *in reply* to
	 * it — so it is a full round trip behind, and on a relay across the internet that is long enough
	 * to fail a check made immediately. It failed exactly that way the first time this ran against a
	 * real one.
	 */
	let hello: Record<string, unknown> | undefined;
	for (let i = 0; i < 50 && !hello; i++) {
		hello = seen.find((m) => m.type === "hello");
		if (!hello) await wait(100);
	}
	check("桌面端的招呼穿过了中转", Boolean(hello), `收到的消息：${JSON.stringify(seen.map((m) => m.type))}`);

	// A real call, end to end: phone → relay → desktop → allowlist → back.
	const settings = await callThrough(socket, seen, "settings.get", [])();
	check("通过中转能读到设置", Boolean(settings?.ok), `返回：${JSON.stringify(settings)?.slice(0, 200)}`);

	const sessions = await callThrough(socket, seen, "sessions.list", [])();
	check("通过中转能列出会话", Boolean(sessions?.ok), `返回：${JSON.stringify(sessions)?.slice(0, 200)}`);

	// And the allowlist still applies on this path — the relay must not become a way around it.
	const refused = await callThrough(socket, seen, "terminal.attach", ["x"])();
	check(
		"白名单在中转这条路上同样生效",
		refused?.ok === false && refused?.error === "method-not-allowed",
		`返回：${JSON.stringify(refused)}`,
	);
} finally {
	link?.close();
	await desktop.stop();
	relay?.kill();
}

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 条失败`);
process.exit(failures === 0 ? 0 : 1);
