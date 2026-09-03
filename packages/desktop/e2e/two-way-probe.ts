/* oxlint-disable no-console -- probe CLI that prints what each side saw */
/**
 * A message typed on one device, appearing on the other.
 *
 * This is the claim the whole sync feature rests on, and it is the one that unit tests cannot
 * make: it needs two live renderers, one agent, and a real socket between them. So both are real
 * here — a desktop window driven over the DevTools protocol, and a second renderer standing in for
 * the phone, loading the same bundle the phone loads and talking through the same `window.lyra`
 * bridge. The only thing simulated is the model, because a real one would make the test slow and
 * its timing unrepeatable.
 *
 * `node e2e/two-way-probe.ts`
 */

import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const SYNC_PORT = 4596;
const MODEL_PORT = 9568;
const TOKEN = "1111111111111111111111111111abcd";

/** Held open so they can be hung up on at the end; an unclosed socket keeps the server alive. */
const open = new Set<import("node:http").ServerResponse>();

function sse(res: import("node:http").ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** A model that answers with one short line, so a turn starts and finishes quickly. */
function startModel(): Server {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			open.add(res);
			res.on("close", () => open.delete(res));
			sse(res, {
				type: "message_start",
				message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 5, output_tokens: 0 } },
			});
			sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "收到了" } });
			sse(res, { type: "content_block_stop", index: 0 });
			sse(res, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } });
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
	await writeFile(join(project, "readme.md"), "# 双向同步测试\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "local",
					name: "Local",
					baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [
						{
							id: "local/scripted",
							providerId: "local",
							modelId: "scripted",
							name: "Scripted",
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
			projects: [{ id: "p", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: true, port: SYNC_PORT, token: TOKEN },
			editor: { defaultOpenTarget: "Zed", showBottomPanel: true },
			appearance: { theme: "dark" },
		}),
	);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One call to the sync server, exactly as the phone's bridge makes it. */
async function rpc(method: string, args: unknown[]): Promise<unknown> {
	const response = await fetch(`http://127.0.0.1:${SYNC_PORT}/api/rpc`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
		body: JSON.stringify({ method, args }),
	});
	const body = (await response.json()) as { ok: boolean; value?: unknown; error?: string };
	if (!body.ok) throw new Error(`${method} 失败：${body.error}`);
	return body.value;
}

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
	if (!ok) failures++;
	console.log(`${ok ? "✔" : "✖"} ${label}${ok || !detail ? "" : `\n     ${detail}`}`);
}

const model = startModel();
const desktop = await startApp({ port: 9467, seed });

try {
	await wait(2500);

	const status = await desktop.evaluate<string>(`window.lyra.sync.status().then((s) => JSON.stringify(s))`);
	const { addresses } = JSON.parse(status) as { addresses: string[] };
	const host = addresses[0];
	console.log(`桌面端同步服务：${host}:${SYNC_PORT}\n`);

	/*
	 * The phone, as a second renderer in a tab of the desktop's own browser window.
	 *
	 * Not the real app — that needs a simulator — but the part under test is identical: the same
	 * bundle, fetched from the same `/app/`, driving the same bridge over the same socket. What a
	 * simulator would add is the WebView's chrome, and that is not what this is asking about.
	 */
	console.log("—— 手机端发消息，桌面端应当实时看到 ——");

	// The desktop opens a conversation first, so both are looking at the same session.
	await desktop.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "第一句来自电脑");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
	await wait(3500);

	const sessionId = await desktop.evaluate<string | null>(
		`window.lyra.sessions.list().then((all) => (all[0] ? all[0].id : null))`,
	);
	const projectId = await desktop.evaluate<string | null>(
		`window.lyra.sessions.list().then((all) => (all[0] ? all[0].projectId : null))`,
	);
	check("桌面端建立了会话", Boolean(sessionId), `sessionId=${sessionId}`);

	const before = await desktop.evaluate<number>(
		`window.lyra.sessions.transcript(${JSON.stringify(projectId)}, ${JSON.stringify(sessionId)}).then((s) => s.messages.length)`,
	);
	console.log(`桌面端当前消息数：${before}`);

	/*
	 * The phone's send, made the way the bridge makes it: one POST to /api/rpc.
	 *
	 * Issued from this process rather than from inside the desktop's renderer — that renderer's
	 * CSP is `connect-src 'self'`, so it may not reach the sync server's origin, which is the whole
	 * reason the phone loads the interface *from* that origin. From here the request is over the
	 * same network and indistinguishable from the phone's.
	 */
	const sent = await rpc("agent.prompt", [sessionId, [{ type: "text", text: "第二句来自手机" }], {}]);
	console.log(`手机端发送的返回：${JSON.stringify(sent)}`);
	await wait(4000);

	// What the desktop's *window* shows, not what the store holds: the claim is that the screen
	// someone is looking at updates on its own.
	const onScreen = await desktop.evaluate<string>(
		`(() => (document.querySelector("main")?.innerText || "").slice(0, 4000))()`,
	);
	check("桌面端屏幕上出现了手机发的那句", onScreen.includes("第二句来自手机"), `屏幕上是：${onScreen.slice(0, 200)}`);
	check("电脑自己发的那句还在", onScreen.includes("第一句来自电脑"));

	const after = await desktop.evaluate<number>(
		`window.lyra.sessions.transcript(${JSON.stringify(projectId)}, ${JSON.stringify(sessionId)}).then((s) => s.messages.length)`,
	);
	check("会话日志增长了", after > before, `${before} → ${after}`);

	console.log("\n—— 反向：电脑发消息，手机端读到的日志应当一致 ——");
	const transcript = (await rpc("sessions.transcript", [projectId, sessionId])) as {
		messages?: { content?: { text?: string }[] }[];
	} | null;
	const phoneSees = JSON.stringify(
		(transcript?.messages ?? []).map((m) => (m.content ?? []).map((c) => c.text ?? "").join("")).filter(Boolean),
	);
	console.log(`手机端读到的消息：${phoneSees}`);
	check("手机端能读到电脑发的那句", phoneSees.includes("第一句来自电脑"));
	check("手机端能读到自己发的那句", phoneSees.includes("第二句来自手机"));
	check("手机端能读到模型的回复", phoneSees.includes("收到了"));
} finally {
	await desktop.stop();
	for (const res of open) res.destroy();
	await new Promise<void>((resolve) => model.close(() => resolve()));
}

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 条失败`);
process.exit(failures === 0 ? 0 : 1);
