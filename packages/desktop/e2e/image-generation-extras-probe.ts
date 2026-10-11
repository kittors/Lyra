/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * The image card in the states the main demo does not walk through: the dark theme, several
 * pictures from one call, the download button actually writing a file, and 编辑 opening the marker.
 *
 *   node --experimental-strip-types e2e/image-generation-extras-probe.ts
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { startApp, type RunningApp } from "./app.ts";
import { boatPictures, relaySettings, startFakeImageRelay, type Scene } from "./fake-image-relay.ts";
import { driver, pause } from "./record.ts";

const PORT = 9442;
const INSPECT = 9443;
const ELECTRON = `(()=>({BrowserWindow:process._linkedBinding('electron_browser_window').BrowserWindow}))`;
const OUT = join(homedir(), "Desktop", "Lyra生图测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

const SCENES: Scene[] = [
	{ cue: "两张", call: "call_two", args: { prompt: "Two variations of a red paper boat on calm water, flat illustration", aspect_ratio: "3:2", count: 2 }, reply: "画了两张，挑一张喜欢的。" },
];

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

let app: RunningApp;

async function shot(name: string) {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

/** Downloads go to this folder without a dialog: one browser-level call, for the whole run. */
async function downloadsInto(dir: string): Promise<void> {
	const version = (await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json())) as { webSocketDebuggerUrl: string };
	const socket = new WebSocket(version.webSocketDebuggerUrl);
	await new Promise<void>((done, fail) => {
		socket.once("open", () => done());
		socket.once("error", fail);
	});
	await new Promise<void>((done) => {
		socket.once("message", () => done());
		socket.send(JSON.stringify({ id: 1, method: "Browser.setDownloadBehavior", params: { behavior: "allow", downloadPath: dir, eventsEnabled: false } }));
	});
	socket.close();
}

async function main() {
	await mkdir(OUT, { recursive: true });
	const downloads = await mkdtemp(join(tmpdir(), "lyra-image-downloads-"));
	const relay = await startFakeImageRelay({ scenes: SCENES, art: await boatPictures(), drawMs: 4500 });
	app = await startApp({
		port: PORT,
		inspectPort: INSPECT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
			await writeFile(join(home, "settings.json"), relaySettings(relay.port, cwd, { appearance: { theme: "dark" } }));
		},
	});
	const { until, hover, type, submit, click, settled } = driver(app);
	try {
		await app.evaluate("document.fonts.ready");
		await pause(1500);
		await downloadsInto(downloads);
		/*
		 * And from the main process: whether a download starts at all, saved without a dialog. The
		 * CDP setting is not honoured by every Electron build; the session's own event is the truth.
		 */
		const hooked = await app.main<string>(`(()=>{const {BrowserWindow}=${ELECTRON}();const w=BrowserWindow.getAllWindows().filter(x=>!x.isDestroyed()&&x.isVisible()).sort((a,b)=>b.getBounds().width-a.getBounds().width)[0];globalThis.__downloads=[];w.webContents.session.on('will-download',(event,item)=>{const offered=(item.getSaveDialogOptions().defaultPath||item.getFilename()).split('/').pop();item.setSavePath(${JSON.stringify(downloads)}+'/'+offered);globalThis.__downloads.push({url:item.getURL().slice(0,80),name:offered});});return 'hooked '+w.id})()`);
		console.log(`   ${hooked}`);

		console.log("① 暗色主题，一次两张");
		await type("画两张纸船，挑一张");
		await pause(600);
		await submit();
		await until(`document.querySelectorAll('[data-ly-image-card="drawing"] canvas').length === 2`, 30000);
		await pause(1600);
		await shot("13_暗色_两张生成中");
		const drawing = await app.evaluate<{ frames: number; columns: string; ink: string }>(`(() => {
			const frames = document.querySelectorAll('[data-ly-image-frame="drawing"]');
			const canvas = frames[0].querySelector('canvas');
			return { frames: frames.length, columns: getComputedStyle(frames[0].parentElement).gridTemplateColumns, ink: getComputedStyle(canvas).color };
		})()`);
		check("两张就是两格点阵，并排", drawing.frames === 2 && drawing.columns.split(" ").length === 2, `${drawing.frames} 格，列 ${drawing.columns}`);
		const light = await app.evaluate<boolean>(`(() => { const m = getComputedStyle(document.querySelector('[data-ly-image-frame] canvas')).color.match(/\\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3 > 140; })()`);
		check("暗色主题下点是浅色的，跟着文字颜色走", light, drawing.ink);
		await until(`document.querySelectorAll('[data-ly-image-card="done"] img').length === 2 && [...document.querySelectorAll('[data-ly-image-card="done"] img')].every((i) => i.naturalWidth > 0)`, 60000);
		await pause(1200);
		await shot("14_暗色_两张落地");
		const generations = relay.seen.filter((s) => s.path.endsWith("/images/generations"));
		check("两张各发一个请求，并排发出", generations.length === 2 && generations.every((s) => s.body.n === 1), `${generations.length} 个请求，n=${generations.map((s) => s.body.n).join("/")}`);
		await settled(60000);

		console.log("② 下载按钮");
		await hover('[data-ly-image-frame="done"]');
		await pause(700);
		await app.evaluate(`document.querySelector('[data-ly-image-frame="done"] .ly-image-action[aria-label="下载"]').setAttribute('data-probe-download', '')`);
		await click("[data-probe-download]");
		let saved: string[] = [];
		for (let i = 0; i < 40 && saved.length === 0; i++) {
			await pause(250);
			saved = (await readdir(downloads)).filter((name) => !name.endsWith(".crdownload"));
		}
		const started = await app.main<{ url: string; name: string }[]>(`globalThis.__downloads`);
		const media = (started[0]?.url ?? "").split("/").pop() ?? "";
		const same = saved[0] && media ? (await readFile(join(downloads, saved[0]))).equals(await readFile(join(app.home, "session-media", media))) : false;
		check("下载下来的就是原图，一个字节没改", same, `${saved[0] ?? "无"} ↔ session-media/${media}`);
		check("「下载」存下的是原图，保存框里给的是带时间的名字", saved.length === 1 && /^lyra-image-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.jpg$/.test(saved[0]), `${saved.join("、") || "目录是空的"}；主进程看到的下载：${JSON.stringify(started)}`);

		console.log("③ 编辑：打开标注");
		await hover('[data-ly-image-frame="done"]');
		await pause(500);
		await app.evaluate(`document.querySelector('[data-ly-image-frame="done"] .ly-image-action[aria-label="编辑"]').setAttribute('data-probe-edit', '')`);
		await click("[data-probe-edit]");
		await until(`[...document.querySelectorAll('button')].some((b) => /保存|Save/.test(b.getAttribute('aria-label') || b.textContent || '') && b.checkVisibility())`, 10000);
		await pause(900);
		check("「编辑」打开了标注工具", true, "标注工具条已出现");
		await shot("15_编辑进入标注");
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await pause(600);
	} finally {
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		await rm(downloads, { recursive: true, force: true });
		relay.close();
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
