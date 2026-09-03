/* oxlint-disable no-console -- a probe that prints what the window is showing, step by step */
/**
 * What the window actually shows while a reply talks and then calls a tool.
 *
 * Not a test — a way of looking. The assertions were passing and the reported fault was real, which
 * means the thing being read was not the thing that goes missing. This dumps the whole running-line
 * region, its fold state, and the shape of the transcript, at each step of one scripted turn.
 */

import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { closeListeningServer, startApp } from "./app.ts";

const MODEL_PORT = 9576;
const PROSE = "先看看这个文件的内容";

const open = new Set<import("node:http").ServerResponse>();
let held: import("node:http").ServerResponse | null = null;

function sse(res: import("node:http").ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

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
			held = res;

			sse(res, {
				type: "message_start",
				message: { id: "msg_1", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } },
			});
			sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: PROSE } });
			// Everything after this is driven by hand from the script below.
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "one.ts"), "export const one = 1\n");
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
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4520, token: null },
		}),
	);
}

const DUMP = `(() => {
	const line = document.querySelector("main [data-ly-running]");
	const fold = line?.closest(".ly-reveal");
	const reveals = [...document.querySelectorAll("main .ly-reveal")].map((el) => ({
		open: el.getAttribute("data-open"),
		height: Math.round(el.getBoundingClientRect().height),
		text: (el.innerText ?? "").slice(0, 40),
	}));
	return JSON.stringify({
		lineMounted: Boolean(line),
		lineMood: line?.getAttribute("data-ly-mood") ?? null,
		lineText: line ? (line.innerText ?? "").slice(0, 60) : null,
		lineHeight: line ? Math.round(line.getBoundingClientRect().height) : -1,
		foldFound: Boolean(fold),
		foldOpen: fold?.getAttribute("data-open") ?? null,
		foldHeight: fold ? Math.round(fold.getBoundingClientRect().height) : -1,
		reveals,
		stopButton: Boolean(document.querySelector('main button[aria-label="停止"]')),
		runs: [...document.querySelectorAll("main [data-ly-run]")].map((el) => el.getAttribute("data-ly-run")),
		transcript: (document.querySelector("main")?.innerText ?? "").slice(-400),
	}, null, 2);
})()`;

const model = startModel();
const app = await startApp({ port: 9457, seed });

async function look(label: string): Promise<void> {
	const dump = await app.evaluate<string>(DUMP);
	console.log(`\n=========== ${label} ===========`);
	console.log(dump);
}

try {
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "看看 one.ts");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);

	// Wait for the prose to land.
	for (let i = 0; i < 60; i++) {
		const has = await app.evaluate<boolean>(
			`(document.querySelector("main")?.innerText ?? "").includes(${JSON.stringify(PROSE)})`,
		);
		if (has) break;
		await new Promise((r) => setTimeout(r, 250));
	}
	await new Promise((r) => setTimeout(r, 1200));
	await look("1. prose has arrived, nothing else open");

	// Now open a tool call inside the same message and leave its arguments unfinished.
	if (held) {
		sse(held, { type: "content_block_stop", index: 0 });
		sse(held, {
			type: "content_block_start",
			index: 1,
			content_block: { type: "tool_use", id: "toolu_1", name: "read", input: {} },
		});
		sse(held, {
			type: "content_block_delta",
			index: 1,
			delta: { type: "input_json_delta", partial_json: '{"path":"one' },
		});
	}
	await new Promise((r) => setTimeout(r, 1500));
	await look("2. same message now holds [text, toolCall], arguments still streaming");

	// And more prose after the call, the other ordinary shape.
	await new Promise((r) => setTimeout(r, 3000));
	await look("3. three seconds later, still hanging");
} finally {
	await app.stop();
	for (const res of open) res.destroy();
	await closeListeningServer(model);
}
