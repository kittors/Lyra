/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * A turn's folded line under the default call chain, in a real window, recorded while it is checked.
 *
 * Three things the unit tests cannot show, because they are about frames: the line glides while its
 * stretch's tools are running, a dropped connection's countdown stays on screen rather than inside the
 * fold, and once the turn is over the line is still and says what the work was.
 *
 * The model is scripted: a batch of calls, a dropped connection, the resumed batch, then the answer.
 *
 * Usage: node --experimental-strip-types e2e/fold-line-demo.ts [output directory]
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra界面移植测试");
const PORT = 9481;
const MODEL_PORT = 9583;
const BLOCK_DELAY_MS = 700;
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

type Block = { tool: string; args: Record<string, unknown> } | { text: string } | { drop: true };
/** One entry per request, in order. */
const SCRIPT: Block[][] = [
	[
		{ tool: "ls", args: { path: "." } },
		{ tool: "glob", args: { pattern: "**/*.ts" } },
		{ tool: "read", args: { path: "one.ts" } },
	],
	[{ drop: true }],
	[{ tool: "read", args: { path: "two.ts" } }],
	[{ text: "两个文件都看过了，改动可以从 one.ts 开始。" }],
];

let app: RunningApp;
let model: Server;
const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

function sse(res: ServerResponse, payload: { type: string }): void {
	res.write(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function startModel(): Server {
	let request = 0;
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", async () => {
			const blocks = SCRIPT[Math.min(request, SCRIPT.length - 1)];
			request++;
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			sse(res, { type: "message_start", message: { id: `msg_${request}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } } as { type: string });
			for (const [index, block] of blocks.entries()) {
				await pause(BLOCK_DELAY_MS);
				if ("drop" in block) {
					// The socket going away mid-call, which is what a dropped connection is; not a clean end.
					sse(res, { type: "content_block_start", index, content_block: { type: "tool_use", id: `call_${request}_drop`, name: "ls", input: {} } } as { type: string });
					await pause(120);
					res.socket?.destroy();
					return;
				}
				if ("text" in block) {
					sse(res, { type: "content_block_start", index, content_block: { type: "text", text: "" } } as { type: string });
					sse(res, { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } } as { type: string });
				} else {
					sse(res, { type: "content_block_start", index, content_block: { type: "tool_use", id: `call_${request}_${index}`, name: block.tool, input: {} } } as { type: string });
					sse(res, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.args) } } as { type: string });
				}
				sse(res, { type: "content_block_stop", index } as { type: string });
			}
			const stop = blocks.some((block) => "tool" in block) ? "tool_use" : "end_turn";
			sse(res, { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 40 } } as { type: string });
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
	await writeFile(join(project, "one.ts"), "export const one = 1\n");
	await writeFile(join(project, "two.ts"), "export const two = 2\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1180, height: 760, x: 0, y: 0 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1,
		providers: [{
			id: "local", name: "Local", baseUrl: `http://127.0.0.1:${MODEL_PORT}`, api: "anthropic-messages", apiKey: "not-a-key", enabled: true,
			models: [{ id: "local/scripted", providerId: "local", modelId: "scripted", name: "Scripted", contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: false, supportsImages: false, supportsTools: true }],
		}],
		mcpServers: [],
		projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
		defaultModelId: "local/scripted",
		autoSummarizeTitle: false,
		permissionMode: "full",
		thinking: "off",
		// One attempt per request, so the drop goes straight to the resume and its countdown.
		retryAttempts: 1,
		hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
		sync: { enabled: false, port: 4531, token: null },
	}));
}

interface Sample {
	running: boolean;
	folds: string[];
	/** Glides on a fold's own line. */
	foldGlides: number;
	glides: number;
	/** The dropped connection's line, when one is on screen outside the fold. */
	drop: string;
	line: string;
}

const SAMPLE = `(() => {
	const shown = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().height > 0;
	const drops = [...document.querySelectorAll("main [data-hiccup-trace]")];
	const outside = drops.filter((el) => !el.closest("[data-ly-turn-process]") && shown(el));
	return {
		running: Boolean(document.querySelector('main button[aria-label="停止"]')),
		folds: [...document.querySelectorAll("main [data-ly-turn-process]")].map((el) => el.dataset.lyTurnProcess),
		foldGlides: document.querySelectorAll("main [data-ly-turn-process] > button .ly-glide").length,
		glides: document.querySelectorAll("main .ly-glide").length,
		drop: outside.map((el) => el.innerText.replace(/\\s+/g, " ").trim()).join(" / "),
		line: [...document.querySelectorAll("main [data-ly-turn-process] > button .ly-flow-summary")].map((el) => el.innerText.trim()).join(" / "),
	};
})()`;

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	model = startModel();
	const frames: Frame[] = [];
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const d = driver(app);
	const stop = await startRecording(PORT, frames);
	const samples: Sample[] = [];
	try {
		console.log("【一】发一句话，模型先干一批活");
		await d.until('document.querySelector("main textarea")', 30000);
		await pause(1200);
		await d.type("看看这两个文件");
		await pause(600);
		await d.submit();

		// Sampled from Node at ~8 a second for the whole turn: drop, countdown, resume and answer included.
		const end = Date.now() + 60_000;
		let started = false;
		let quiet = 0;
		while (Date.now() < end) {
			const sample = await app.evaluate<Sample>(SAMPLE);
			samples.push(sample);
			if (sample.running) { started = true; quiet = 0; }
			else if (started && ++quiet > 16) break;
			await pause(120);
		}

		const working = samples.filter((s) => s.running && s.folds.includes("running"));
		check("折叠行在这一段的工具跑的时候带着扫光", working.some((s) => s.foldGlides === 1), JSON.stringify(working.slice(0, 3)));
		check("任何时候最多一处在扫光", samples.every((s) => s.glides <= 1), String(Math.max(...samples.map((s) => s.glides))));
		const waiting = samples.filter((s) => /连接中断/.test(s.drop));
		check("断线后的倒计时在折叠外面，看得见", waiting.length >= 5, `${waiting.length} 次采样里看得见`);
		const seconds = [...new Set(waiting.map((s) => Number(s.drop.match(/(\d+) 秒后/)?.[1] ?? NaN)).filter(Number.isFinite))];
		check("倒计时在走", seconds.length >= 3, seconds.join(", ") || "（没有读数）");
		const last = samples.at(-1);
		check("这一轮结束后，什么都不再扫光", last !== undefined && last.glides === 0, JSON.stringify(last));
		check("折叠行说的是做了什么", Boolean(last && /读取文件/.test(last.line)), last?.line ?? "");
		await pause(1800);

		console.log("【二】点开折叠行，看里面的每一步");
		await d.click('main [data-ly-turn-process] > button');
		await pause(1600);
		const opened = await app.evaluate<number>(`document.querySelectorAll("main [data-ly-turn-process] [data-ly-tool]").length`);
		check("点开后每次调用各占一行", opened >= 4, `${opened} 行`);
		await pause(1800);
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成…`);
	}

	if (frames.length === 0) throw new Error("一帧都没采到");
	const passed = checks.filter((c) => c.ok).length;
	const out = join(OUT_DIR, `${STAMP}_折叠行扫光与断线倒计时_${passed}of${checks.length}.mp4`);
	await app.stop();
	await closeListeningServer(model);
	await encode(frames, out, 60, 1200);
	console.log(`\n${passed}/${checks.length} 项通过`);
	console.log(`视频：${out}`);
	if (passed !== checks.length) process.exitCode = 1;
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	if (model) await closeListeningServer(model).catch(() => {});
	process.exitCode = 1;
});
