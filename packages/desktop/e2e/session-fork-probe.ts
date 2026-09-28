/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 「从这里分叉」 on a message, in the real window with the real pointer.
 *
 * A two-question conversation; the second question is forked. Measured from what is on screen and
 * on disk: the new conversation in the sidebar, what its transcript holds, what waits in its
 * composer, and that the conversation it came from still has every message — then the fork's own
 * turn is sent, and the original still has every message.
 *
 *   node --experimental-strip-types e2e/session-fork-probe.ts [--before]
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const OUT = join(homedir(), "Desktop", "Lyra会话分叉测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const phase = process.argv.includes("--before") ? "before" : "after";
const PORT = 9437;

const Q1 = "帮我起草一份 0.9 版发布说明的提纲";
const A1 = "提纲：一、这一版解决了什么；二、改动明细；三、升级须知。";
const Q2 = "把第二节展开写成三段";
const A2 = "第二节展开如下：先说输入框，再说分屏，最后说同步。";
const FORKED_REPLY = "（分叉里的回答）第二节换个写法：按用户会碰到的场景来组织。";

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

let app: RunningApp | undefined;
let server: Server | undefined;
const frames: Frame[] = [];
let stopRecording: (() => Promise<void>) | undefined;

async function until(expression: string, ms = 20_000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await app!.evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(100);
	}
	throw new Error(`UI condition not reached: ${expression}`);
}

async function centre(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})`);
	await app!.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
	await pause(200);
	return app!.evaluate<{ x: number; y: number }>(
		`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
}

async function move(selector: string) {
	await app!.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await centre(selector)) });
}

async function click(selector: string) {
	const at = await centre(selector);
	await app!.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await app!.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1 });
	await app!.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: 1 });
}

async function shot(name: string) {
	await pause(500);
	const { data } = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${phase}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

const mainText = () => app!.evaluate<string>(`document.querySelector("main")?.innerText ?? ""`);

try {
	await mkdir(OUT, { recursive: true });
	server = createServer((req, res) => {
		if (req.method !== "POST") {
			res.writeHead(404).end();
			return;
		}
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: "fork-reply", role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: FORKED_REPLY } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } });
			emit("message_stop", {});
			res.end();
		});
	});
	await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No fixture port");

	let projectId = "";
	app = await startApp({
		port: PORT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
			await mkdir(join(home, "sessions", projectId), { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 880, x: 40, y: 40 }));
			await writeFile(join(home, "settings.json"), JSON.stringify({
				uiLocale: "zh-CN", permissionMode: "full", projectMemory: false, thinking: "off", autoSummarizeTitle: false,
				mcpServers: [], hooks: [], sync: { enabled: false }, appearance: { theme: "light", reduceMotion: "on" },
				projects: [{ path: cwd, name: "发布", pinned: true, lastOpenedAt: Date.now() }],
				defaultModelId: "fake/model",
				providers: [{ id: "fake", name: "假模型", api: "anthropic-messages", baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "probe", enabled: true,
					models: [{ id: "fake/model", providerId: "fake", modelId: "model", name: "假模型", contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: false, supportsImages: false, supportsTools: true }] }],
			}));
			const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
			const now = Date.now();
			const meta = { id: "release-notes", title: "发布说明", projectId, projectName: "发布", cwd, createdAt: now - 60_000, updatedAt: now, modelId: "fake/model", messageCount: 4, usage, seq: 5 };
			const say = (text: string, at: number) => ({ role: "user", content: [{ type: "text", text }], timestamp: at });
			const reply = (text: string, at: number) => ({ role: "assistant", content: [{ type: "text", text }], api: "anthropic-messages", provider: "fake", model: "model", usage, stopReason: "stop", timestamp: at });
			const records = [
				{ seq: 1, ts: now - 60_000, type: "meta", meta: { ...meta, seq: 1 } },
				{ seq: 2, ts: now - 50_000, type: "message", message: say(Q1, now - 50_000) },
				{ seq: 3, ts: now - 45_000, type: "message", message: reply(A1, now - 45_000) },
				{ seq: 4, ts: now - 20_000, type: "message", message: say(Q2, now - 20_000) },
				{ seq: 5, ts: now - 15_000, type: "message", message: reply(A2, now - 15_000) },
			];
			await writeFile(join(home, "sessions", projectId, "release-notes.jsonl"), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
			await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta]));
		},
	});
	await app.evaluate("document.fonts.ready");
	if (phase === "after") stopRecording = await startRecording(PORT, frames);

	await click('[data-ly-row="release-notes"] > button');
	await until(`document.querySelector('main')?.innerText.includes(${JSON.stringify(A2)})`);
	await pause(900);

	console.log("① 悬停第二个问题，那一排按钮里有「从这里分叉」");
	await move('[data-question-index="2"]');
	await pause(600);
	const button = await app.evaluate<{ tip: string | null; visible: boolean }>(`(() => {
		const b = document.querySelector('[data-question-index="2"] [data-message-fork]');
		return { tip: b?.getAttribute('data-ly-tip') ?? null, visible: Boolean(b) && getComputedStyle(b.closest('[data-ly-hover-reveal]') ?? b).opacity !== '0' };
	})()`);
	check("第二个问题的按钮里有「从这里分叉」", button.tip === "从这里分叉" && button.visible, JSON.stringify(button));
	await shot("00_悬停第二个问题的那一排按钮");
	await move('[data-question-index="2"] [data-message-fork]');
	await pause(900);
	await shot("01_悬停从这里分叉");

	console.log("② 点下去：新会话从第二个问题之前开始，问题回到输入框");
	await click('[data-question-index="2"] [data-message-fork]');
	await until(`[...document.querySelectorAll('[data-ly-row]')].some((row) => row.innerText.includes('（分叉）'))`);
	await until(`!document.querySelector('main')?.innerText.includes(${JSON.stringify(A2)})`);
	await pause(900);
	const sidebar = await app.evaluate<string[]>(`[...document.querySelectorAll('[data-ly-row]')].map((row) => row.innerText.trim().split(String.fromCharCode(10))[0])`);
	check("侧栏里多了一个「发布说明（分叉）」，原来那个还在", sidebar.some((title) => title.includes("发布说明（分叉）")) && sidebar.some((title) => title === "发布说明"), JSON.stringify(sidebar));
	const text = await mainText();
	check("分叉里只有第二个问题之前的那一问一答", text.includes(Q1) && text.includes(A1) && !text.includes(A2), `含第一问：${text.includes(Q1)}，含第一答：${text.includes(A1)}，含第二答：${text.includes(A2)}`);
	const draft = await app.evaluate<string>(`document.querySelector('main textarea')?.value ?? ''`);
	check("第二个问题回到了分叉的输入框里", draft === Q2, JSON.stringify(draft));
	const original = await app.evaluate<number>(`window.lyra.sessions.transcript(${JSON.stringify(projectId)}, 'release-notes').then((t) => (t.messages ?? t).length)`);
	check("原会话一条都没少", original === 4, `原会话 ${original} 条消息`);
	await shot("02_分叉出来的会话");

	console.log("③ 在分叉里发出去，分叉自己往下走，原会话不受影响");
	await app.evaluate(`(() => { const field = document.querySelector('main textarea'); field.focus(); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
	await until(`document.querySelector('main')?.innerText.includes(${JSON.stringify(FORKED_REPLY)})`, 30_000);
	await pause(1200);
	const afterSend = await app.evaluate<number>(`window.lyra.sessions.transcript(${JSON.stringify(projectId)}, 'release-notes').then((t) => (t.messages ?? t).length)`);
	check("分叉里回答了，原会话还是 4 条", afterSend === 4, `原会话 ${afterSend} 条消息`);
	await shot("03_分叉独立往下走");
	await pause(1200);
} catch (error) {
	check("探针跑完", false, String(error));
} finally {
	await stopRecording?.();
	const passed = results.filter((r) => r.ok).length;
	console.log(`\n${passed}/${results.length} 通过　（${phase}）`);
	await app?.stop();
	if (server) await closeListeningServer(server);
	if (frames.length) {
		const video = join(OUT, `${stamp}_会话分叉_${passed}of${results.length}.mp4`);
		await encode(frames, video);
		console.log(`   🎬 ${video}`);
	}
	if (passed !== results.length) process.exitCode = 1;
}
