/* oxlint-disable no-console -- probe CLI that prints the pairing details it is holding open */
/**
 * A desktop with sync switched on, held open so a phone can pair with it.
 *
 * `node e2e/pair-host.ts [port]` — prints the address, the token and the pairing code, then waits.
 * The point is the other end: everything here is already covered by unit tests, and none of it
 * proves that a phone on the same network can actually connect, authenticate and read a session.
 *
 * A scripted model is wired up alongside it, so a message sent from the phone produces a reply and
 * a real transcript to look at. Without one the phone can pair and then do nothing — and the parts
 * worth checking by hand (how a conversation renders in a WebView, whether the controls under a
 * message can be reached without a pointer) all need a conversation to exist first.
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = Number(process.argv[2] ?? 4593);
const MODEL_PORT = PORT + 1000;

/** Kept so they can be hung up on; an unclosed response keeps the server alive at exit. */
const open = new Set<ServerResponse>();

function sse(res: ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * A model that answers in one short line.
 *
 * Scripted rather than real: a real one makes every check slow, needs a key, and answers
 * differently each time — none of which is what is being looked at here.
 */
function startModel(): Server {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			open.add(res);
			res.on("close", () => open.delete(res));
			sse(res, { type: "message_start", message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 5, output_tokens: 0 } } });
			sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "收到了，这是脚本模型的回复。" } });
			sse(res, { type: "content_block_stop", index: 0 });
			sse(res, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } });
			sse(res, { type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# 配对测试用的项目\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "local",
					name: "本地脚本",
					baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [
						{
							id: "local/scripted",
							providerId: "local",
							modelId: "scripted",
							name: "脚本模型",
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: false,
							supportsImages: false,
							supportsTools: true,
						},
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "pair", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			/*
			 * A fixed token, so a phone paired once stays paired across restarts of this probe.
			 * Re-pairing by hand between every check is most of the time a manual test takes.
			 */
			/*
			 * A relay can be named on the command line, which is the only way to exercise that path
			 * by hand: it needs a server, and the point of the path is that neither end can reach the
			 * other directly.
			 */
			sync: {
				enabled: true,
				port: PORT,
				token: "1111111111111111111111111111abcd",
				...(process.argv[3] ? { relayUrl: process.argv[3] } : {}),
			},
			editor: { defaultOpenTarget: "Zed", showBottomPanel: true },
			appearance: { theme: "dark" },
		}),
	);
}

const model = startModel();
const app = await startApp({ port: 9464, seed });
try {
	await new Promise((r) => setTimeout(r, 2500));
	const status = await app.evaluate<string>(`window.lyra.sync.status().then((s) => JSON.stringify(s))`);
	const parsed = JSON.parse(status) as { running: boolean; port: number; token: string; addresses: string[] };
	console.log(JSON.stringify({ running: parsed.running, port: parsed.port, token: parsed.token, addresses: parsed.addresses }));
	console.log(`PAIRING_CODE lyra://pair?host=${parsed.addresses[0]}&port=${parsed.port}&token=${parsed.token}`);
	console.log("HOLDING — 按 Ctrl-C 结束");
	// Held open: the phone connects to this process.
	await new Promise(() => {});
} finally {
	await app.stop();
	for (const res of open) res.destroy();
	await new Promise<void>((resolve) => model.close(() => resolve()));
}
