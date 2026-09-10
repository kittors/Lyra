/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 录一段真实的演示：真模型、真工具、真设置页，拍窗口不拍屏幕。
 *
 * 抓全屏会把用户自己的窗口一起录进去，所以画面走 CDP 的 `Page.startScreencast`——它只给这一个页面
 * 的合成帧。`app.send` 是一问一答收不到事件，这里自己开一条常驻 WS 来接。
 *
 * 帧按**真实到达时间**写进 concat 清单，不是按固定 fps 排：屏幕录制的帧只在画面变化时产生，
 * 当成等间隔去合成，等待的那几秒会被压成一瞬，节奏就假了。
 *
 * 用法：node --experimental-strip-types e2e/demo-recorder.ts [输出文件]
 */

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { startApp, type RunningApp } from "./app.ts";

const REAL_HOME = join(homedir(), ".lyra");
const OUT = process.argv[2] ?? join(homedir(), "Downloads", "lyra-flow-demo.mp4");
const PORT = 9420;

/** 一份带暗号的文档，用来演示附件占位符：气泡里只留胶囊，模型却读得到正文。 */
const DOC = [
	"# 交接说明",
	"",
	...Array.from({ length: 120 }, (_, i) => `- 条目 ${i + 1}：一段用来把文档撑长的说明文字。`),
	"",
	"## 暗号",
	"",
	"LYRA-DEMO-2026",
	"",
].join("\n");

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 演示工程\n\n一个用来录制界面的空壳工程。\n");
	await writeFile(join(cwd, "index.ts"), "export const version = '1.0.0'\n");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	for (const file of ["credentials.json", "vault.key"]) {
		await copyFile(join(REAL_HOME, file), join(home, file)).catch(() => {
			throw new Error(`没找到 ~/.lyra/${file}——真实模型调用需要它`);
		});
	}
	const real = JSON.parse(await readFile(join(REAL_HOME, "settings.json"), "utf8"));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			...real,
			permissionMode: "full",
			projects: [{ id: projectId, path: cwd, name: "演示工程", pinned: true, lastOpenedAt: Date.now() }],
			pinnedSessionIds: [],
			sync: { enabled: false },
		}),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900 }));
}

// ---------------------------------------------------------------------------
// 录制：一条常驻 WS 接合成帧
// ---------------------------------------------------------------------------

interface Frame {
	at: number;
	data: Buffer;
}

async function pageTarget(): Promise<string> {
	const list = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())) as Array<{
		type: string;
		webSocketDebuggerUrl?: string;
	}>;
	const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
	if (!page?.webSocketDebuggerUrl) throw new Error("没找到页面的调试地址");
	return page.webSocketDebuggerUrl;
}

async function startRecording(frames: Frame[]): Promise<() => Promise<void>> {
	const socket = new WebSocket(await pageTarget(), { maxPayload: 256 * 1024 * 1024 });
	await new Promise<void>((done, fail) => {
		socket.once("open", () => done());
		socket.once("error", fail);
	});
	let id = 0;
	const send = (method: string, params: Record<string, unknown> = {}) =>
		socket.send(JSON.stringify({ id: ++id, method, params }));

	socket.on("message", (raw: Buffer) => {
		const message = JSON.parse(raw.toString()) as { method?: string; params?: { data: string; sessionId: number } };
		if (message.method !== "Page.screencastFrame" || !message.params) return;
		frames.push({ at: Date.now(), data: Buffer.from(message.params.data, "base64") });
		// 必须回执，否则 Chromium 只发这一帧就停了。
		send("Page.screencastFrameAck", { sessionId: message.params.sessionId });
	});

	send("Page.enable");
	send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
	return async () => {
		send("Page.stopScreencast");
		await new Promise((r) => setTimeout(r, 400));
		socket.close();
	};
}

/** 帧按真实间隔合成，等待的那几秒就该是几秒。 */
async function encode(frames: Frame[], out: string): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-demo-"));
	const lines: string[] = [];
	for (const [index, frame] of frames.entries()) {
		const file = join(dir, `${String(index).padStart(6, "0")}.jpg`);
		await writeFile(file, frame.data);
		const next = frames[index + 1];
		// 最后一帧多留一秒，免得画面戛然而止。
		const seconds = next ? Math.max(0.016, (next.at - frame.at) / 1000) : 1;
		lines.push(`file '${file}'`, `duration ${seconds.toFixed(3)}`);
	}
	// concat 解复用器要求最后一帧再写一次，否则它的 duration 被忽略。
	if (frames.length > 0) lines.push(`file '${join(dir, `${String(frames.length - 1).padStart(6, "0")}.jpg`)}'`);
	const list = join(dir, "frames.txt");
	await writeFile(list, lines.join("\n"));

	await mkdir(join(out, "..").replace(/\/\.\.$/, ""), { recursive: true }).catch(() => {});
	await new Promise<void>((done, fail) => {
		const ff = spawn(
			"ffmpeg",
			[
				"-y", "-f", "concat", "-safe", "0", "-i", list,
				"-vsync", "vfr",
				// yuv420p + 偶数边长，否则 QuickTime 和多数播放器不认。
				"-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
				"-c:v", "libx264", "-preset", "slow", "-crf", "18",
				"-movflags", "+faststart",
				out,
			],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let err = "";
		ff.stderr.on("data", (c: Buffer) => { err = (err + c.toString()).slice(-4000); });
		ff.once("close", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg 失败：\n${err}`))));
	});
	await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 剧本
// ---------------------------------------------------------------------------

let app: RunningApp;
const WAIT = `(ms) => new Promise((r) => setTimeout(r, ms))`;

async function pause(ms: number) {
	await new Promise((r) => setTimeout(r, ms));
}

/*
 * 从 Node 侧短轮询，不在页面里挂长 promise。
 *
 * `app.evaluate` 自己 40 秒超时（见 `app.ts`），而一轮真实对话要跑好几分钟——把等待写在页面里，
 * 等到的是那条超时，不是那一轮。
 */
async function until(expression: string, ms = 300000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await app.evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(250);
	}
	throw new Error(`等不到：${expression}`);
}

async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, 20000);
	const point = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
}

async function hover(selector: string) {
	const point = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
}

async function mark(selector: string, attribute: string) {
	await app.evaluate(`(()=>{document.querySelector('[${attribute}]')?.removeAttribute('${attribute}');const el=document.querySelector(${JSON.stringify(selector)});if(el)el.setAttribute('${attribute}','');})()`);
}

async function type(text: string) {
	await app.evaluate(`(()=>{
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(text)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
	})()`);
}

async function submit() {
	await app.evaluate(`(()=>{
		const field = document.querySelector("main textarea");
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	})()`);
}

/** 等这一轮跑完——「停止」按钮出现过，然后消失并保持三秒。 */
async function settled(ms = 300000) {
	const end = Date.now() + ms;
	let started = false;
	let quiet = 0;
	while (Date.now() < end) {
		const turning = await app.evaluate<boolean>(`Boolean(document.querySelector('button[aria-label="停止"]'))`);
		if (turning) { started = true; quiet = 0; }
		else if (started && ++quiet > 12) return;
		await pause(250);
	}
}

async function main() {
	const frames: Frame[] = [];
	app = await startApp({ port: PORT, seed, scaleFactor: 2 });
	const stop = await startRecording(frames);
	try {
		console.log("① 提问 —— 想 → 做 → 说");
		await pause(1200);
		await type("先想清楚：一个 8x8 棋盘去掉对角两格，能用 31 张 1x2 骨牌铺满吗？想明白之后，用 ls 看看这个工程有哪些文件，并把结论追加到 README.md。");
		await pause(1500);
		await submit();
		// 流式过程本身就是要拍的东西：思考行逐字写、工具行扫光。
		await settled();
		await pause(2500);

		console.log("② 回合收起 —— 过程聚合成一行");
		await pause(2000);

		console.log("③ 点开过程");
		await mark("[data-ly-turn-process] .ly-flow-row", "data-demo");
		await click("[data-demo]");
		await pause(2600);

		console.log("④ 悬停一条流水行 —— 图标原地换 chevron");
		await mark("[data-ly-run] .ly-flow-row", "data-demo2");
		await hover("[data-demo2]");
		await pause(1800);

		console.log("⑤ 再收起");
		await click("[data-demo]");
		await pause(2000);

		console.log("⑥ 附件 —— 占位符与胶囊");
		await type("这份文档里的暗号是什么？只回答暗号本身。");
		await pause(800);
		await app.evaluate(`(async () => {
			const wait = ${WAIT};
			const input = document.querySelector('main input[type="file"]');
			const dt = new DataTransfer();
			dt.items.add(new File([${JSON.stringify(DOC)}], "交接说明.md", { type: "text/markdown" }));
			// 再挂两个别的门类，好让那排彩色图标在录像里看得见：表格是绿的，设计稿是紫的。
			// 不写反斜杠 n：这段字符串要穿过一层模板串，转义会被提前吃掉，落到页面里就是一个真换行。
			dt.items.add(new File([["a,b,c", "1,2,3"].join(String.fromCharCode(10))], "季度数据.csv", { type: "text/csv" }));
			dt.items.add(new File([new Uint8Array([0x38, 0x42, 0x50, 0x53])], "首页改版.psd", { type: "image/vnd.adobe.photoshop" }));
			Object.defineProperty(input, "files", { value: dt.files, configurable: true });
			input.dispatchEvent(new Event("change", { bubbles: true }));
			await wait(1200);
		})()`);
		await pause(2200);
		await submit();
		await settled();
		await pause(3000);

		console.log("⑦ 设置页 —— 拉取模型：遮罩盖满整窗，上下文 200K");
		await click(".ly-sidebar-foot button");
		await pause(1200);
		await mark("nav button", "data-nope");
		await app.evaluate(`(()=>{document.querySelector('[data-demo3]')?.removeAttribute('data-demo3');[...document.querySelectorAll("nav button")].find((b)=>b.textContent.trim()==="模型设置")?.setAttribute('data-demo3','');})()`);
		await click("[data-demo3]");
		await pause(1500);
		await app.evaluate(`(()=>{document.querySelector('[data-demo4]')?.removeAttribute('data-demo4');[...document.querySelectorAll("button")].find((b)=>/拉取模型/.test(b.innerText))?.setAttribute('data-demo4','');})()`);
		await click("[data-demo4]");
		await until(`document.querySelector('[data-ly-modal]')`, 60000);
		await pause(3500);
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await pause(1800);
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成…`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
	}
	if (frames.length === 0) throw new Error("一帧都没采到");
	await encode(frames, OUT);
	console.log(`\n✅ ${OUT}`);
}

await main();
