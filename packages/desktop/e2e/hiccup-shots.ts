/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 把那条记录的三个阶段拍下来，外加一段录屏。
 *
 * 「看起来对不对」是这次改动的一半——另一半在 `retry-trace.test.ts` 里断言着——而断言看不出分量。
 * 一行字是不是真的安静、失败那条是不是真的不刺眼、长错误有没有把转录顶宽，这些只能看。
 *
 * 三张图分别是：等待中（倒计时）、自己好了（灰字留痕）、真的没救了（中性提示条）。录屏是同一段
 * 过程连起来，因为「重连成功之后那行字怎么变的」是个动作，截图拍不到。
 *
 * Run: node --experimental-strip-types e2e/hiccup-shots.ts
 */

import { createServer, type Server } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp } from "./app.ts";

const MODEL_PORT = 9575;
const OUT = join(homedir(), "Desktop", "lyra-重试改动");
/** 帧先落在临时目录，合成完就删——桌面上不该多出几百个 png。 */
const FRAMES = "/tmp/lyra-hiccup-frames";

let failuresLeft = 0;
/** 失败时发什么：流内 error（可重试）还是 401（当场停）。 */
let mode: "stream-error" | "fatal" = "stream-error";

const OK_STREAM = [
	`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1200, output_tokens: 0 } } })}`,
	`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}`,
	`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "这个项目是一个 Electron 桌面应用，主进程在 electron/ 下，渲染层在 src/ 下。" } })}`,
	`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
	`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } })}`,
	`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
].join("\n\n");

/**
 * 一条又长又难读的错误，因为那正是要看的东西。
 *
 * 中转报错时给的就是这种：一串英文加一个请求 id 加一段栈。用户说「不希望看到一大段的错误显示」，
 * 所以这张图要证明它被收成了一行。
 */
const LONG_ERROR =
	"upstream provider returned an unexpected response while streaming the completion: connection reset by peer after 12384 bytes (request 8f2a1b4c-9d3e-4f01-b2a7-6e5c8d9f0a1b, upstream node relay-sg-04, retry budget exhausted)";

const streamError = () =>
	[
		`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1200, output_tokens: 0 } } })}`,
		`event: error\ndata: ${JSON.stringify({ type: "error", error: { message: LONG_ERROR } })}`,
	].join("\n\n");

function startModel(): Server {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			if (failuresLeft > 0) {
				failuresLeft--;
				if (mode === "fatal") {
					res.writeHead(401, { "content-type": "application/json" });
					res.end(JSON.stringify({ error: { message: "invalid api key provided for this endpoint" } }));
					return;
				}
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.end(`${streamError()}\n\n`);
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.end(`${OK_STREAM}\n\n`);
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "one.ts"), "export const one = 1\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1180, height: 800, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [{
				id: "local", name: "Local", baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
				api: "anthropic-messages", apiKey: "not-a-key", enabled: true,
				models: [{ id: "local/scripted", providerId: "local", modelId: "scripted", name: "Scripted", contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: false, supportsImages: false, supportsTools: true }],
			}],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "off",
			// 三次重试、每次三秒：慢到看得清倒计时，快到一段录屏放得下。
			retryPolicy: {
				network: { retries: 3, strategy: "fixed", intervalMs: 3000, maxIntervalMs: 3000 },
				upstream: { retries: 3, strategy: "fixed", intervalMs: 3000, maxIntervalMs: 3000 },
			},
			hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			sync: { enabled: false, port: 4523, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const model = startModel();
await mkdir(OUT, { recursive: true });
const app = await startApp({ port: 9463, seed });

/** 一张图，写到桌面那个文件夹里。 */
async function shot(name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
	console.log(`  ⧉ ${name}.png`);
}

async function ask(text: string): Promise<void> {
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(text)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
}

const row = () =>
	app.evaluate<{ text: string; outcome: string } | null>(`(() => {
		const el = document.querySelector("[data-hiccup]");
		return el ? { text: el.innerText.replace(/\\s+/g, " ").trim(), outcome: el.dataset.hiccup } : null;
	})()`);

async function waitFor(outcome: string, tries = 60): Promise<boolean> {
	for (let i = 0; i < tries; i++) {
		if ((await row())?.outcome === outcome) return true;
		await pause(250);
	}
	return false;
}

try {
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 800, deviceScaleFactor: 2, mobile: false });
	await pause(900);

	/*
	 * 逐帧截这个窗口，而不是录整个屏幕。
	 *
	 * 第一版用 `avfoundation` 抓屏，抓到的是当时压在最前面的另一个应用——录屏会把屏幕上所有东西
	 * 都拍进去，包括与这次改动毫不相干的私人窗口。`Page.captureScreenshot` 只认这一个页面，别的
	 * 窗口挡在它前面也没关系。
	 */
	console.log("• 开始逐帧记录（只拍这个窗口）");
	await rm(FRAMES, { recursive: true, force: true }).catch(() => {});
	await mkdir(FRAMES, { recursive: true });
	let frame = 0;
	/** 外面把它换掉，循环就停——`while (filming)` 那种写法 lint 看不出谁改的它。 */
	const stop = { asked: false };
	const film = (async () => {
		while (!stop.asked) {
			try {
				const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
				await writeFile(join(FRAMES, `${String(frame++).padStart(5, "0")}.png`), Buffer.from(data, "base64"));
			} catch {
				// 窗口正在关，或者一帧没截着——少一帧不值得中断整段记录。
			}
			await pause(200);
		}
	})();

	// ── 一、抖两次然后自己好了 ────────────────────────────────────────────────
	mode = "stream-error";
	failuresLeft = 2;
	console.log("• 场景一：抖两次，然后接上");
	await ask("介绍一下这个项目的结构");
	await waitFor("waiting");
	await pause(700);
	console.log(`  等待中：${JSON.stringify((await row())?.text)}`);
	await shot("1-等待中-倒计时");

	await waitFor("recovered");
	await pause(600);
	console.log(`  恢复后：${JSON.stringify((await row())?.text)}`);
	await shot("2-自己好了-只留一行灰字");

	// 悬停：完整原因在气泡里，而不是铺在转录上。
	await app.evaluate(`(() => {
		const el = document.querySelector("[data-hiccup] [data-ly-tip]");
		const box = el.getBoundingClientRect();
		el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: box.left + 20, clientY: box.top + 6 }));
		el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: box.left + 20, clientY: box.top + 6 }));
		return true;
	})()`);
	await pause(900);
	await shot("3-悬停-完整原因在气泡里");

	// ── 二、一直不好，重试用尽 ────────────────────────────────────────────────
	console.log("• 场景二：一直失败，重试用尽");
	mode = "stream-error";
	failuresLeft = 99;
	await ask("那再看看构建脚本");
	await waitFor("gave_up");
	await pause(700);
	console.log(`  放弃后：${JSON.stringify((await row())?.text)}`);
	await shot("4-真的没救了-中性提示条");

	// 展开：一整页原文收在一个限高可滚的盒子里。
	await app.evaluate(`(() => {
		const buttons = [...document.querySelectorAll("[data-hiccup] button")];
		buttons.find((b) => b.textContent?.trim() === "详情")?.click();
		return true;
	})()`);
	await pause(700);
	await shot("5-展开-原文收在可滚的盒子里");

	await pause(1200);
	stop.asked = true;
	await film;
	console.log(`• 记录了 ${frame} 帧，合成中…`);
	// 5fps 拍的，放成 10fps——等待的那几秒不必看足，而那行字怎么变的要看清。
	await new Promise<void>((resolve, reject) => {
		const ff = spawn("ffmpeg", ["-y", "-framerate", "5", "-i", join(FRAMES, "%05d.png"), "-r", "10", "-vf", "scale=1180:-2", "-pix_fmt", "yuv420p", join(OUT, "重连过程.mp4")], { stdio: "ignore" });
		ff.once("error", reject);
		ff.once("close", () => resolve());
	});
	await rm(FRAMES, { recursive: true, force: true }).catch(() => {});
	console.log(`\n全部写到：${OUT}`);
} finally {
	await app.stop();
	await closeListeningServer(model);
}
