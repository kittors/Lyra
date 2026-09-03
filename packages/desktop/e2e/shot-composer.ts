/* oxlint-disable no-console -- a picture-taker that says where it put the file */
/**
 * A picture of the composer's toolbar at the widths it used to get wrong.
 *
 * Not a test — `node e2e/shot-composer.ts` — and beside the tests because it boots the app the same
 * way they do. `composer-fit.test.ts` can assert that the meter is on screen and that nothing
 * overlaps; it cannot say whether the row reads as one thing. That is what this is for.
 */

import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const MODEL = "claude-opus-4-6-thinking";
const MODEL_PORT = 9579;

/** Answers once, so the conversation has a context reading for the meter to draw. */
function startModel() {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			const sse = (p: unknown) => res.write(`event: ${(p as { type: string }).type}\ndata: ${JSON.stringify(p)}\n\n`);
			sse({ type: "message_start", message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 48_000, output_tokens: 0 } } });
			sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "好的，我看一下。" } });
			sse({ type: "content_block_stop", index: 0 });
			sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 400 } });
			sse({ type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "relay", name: "Relay", baseUrl: `http://127.0.0.1:${MODEL_PORT}`, api: "anthropic-messages",
					apiKey: "not-a-key", enabled: true,
					models: [{
						id: `relay/${MODEL}`, providerId: "relay", modelId: MODEL, name: MODEL,
						contextWindow: 200000, maxOutputTokens: 8192,
						supportsThinking: true, supportsImages: true, supportsTools: true,
					}],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: `relay/${MODEL}`, permissionMode: "full", thinking: "high", retryAttempts: 1,
			hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			sync: { enabled: false, port: 4525, token: null },
		}),
	);
}

const out = process.argv[2] ?? "/tmp/lyra-composer";
const model = startModel();
const app = await startApp({ port: 9470, seed });

try {
	await new Promise((r) => setTimeout(r, 1400));

	// One exchange, so the context meter has a reading rather than nothing to draw.
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "你好");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 3500));
	await app.evaluate(`(() => {
		const style = document.createElement("style");
		style.id = "shot-width";
		document.head.appendChild(style);
		return true;
	})()`);

	// 440 is under both old breakpoints; 300 is where the row genuinely has to give something up.
	for (const width of [440, 300]) {
		await app.evaluate(`(() => {
			document.getElementById("shot-width").textContent =
				"main .ly-composer { max-width: ${width}px !important; }";
			return true;
		})()`);
		await new Promise((r) => setTimeout(r, 600));

		const box = await app.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => {
			// Found from the model name outwards: the composer class is a shadow the 回到最新 button
			// wears too, and that button sits above the field once a conversation has scrollback.
			const shell = document.querySelector("main .ly-fit-probe").closest(".ly-composer");
			const r = shell.getBoundingClientRect();
			return { x: Math.round(r.left) - 12, y: Math.round(r.top) - 12, width: Math.round(r.width) + 24, height: Math.round(r.height) + 24 };
		})()`);
		const shot = await app.send<{ data: string }>("Page.captureScreenshot", {
			format: "png",
			clip: { ...box, scale: 2 },
		});
		await writeFile(`${out}-${width}.png`, Buffer.from(shot.data, "base64"));
		console.log(`wrote ${out}-${width}.png`);
	}
} finally {
	await app.stop();
	model.closeAllConnections?.();
	await new Promise<void>((r) => server_close(model, r));
}

function server_close(s: ReturnType<typeof startModel>, done: () => void) {
	s.close(() => done());
	setTimeout(done, 1500);
}
