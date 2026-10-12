/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * A picture opened in the file pane: does it appear at its fitted size, or appear at 100% and shrink?
 *
 * Every frame from the click records what was painted — the picture's visibility, the scale its
 * transform actually has, and its on-screen width — so "it opens by shrinking" is a number.
 *
 *   node --experimental-strip-types e2e/image-pane-fit-probe.ts [--tag=修复前]
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { boatPictures, relaySettings, startFakeImageRelay } from "./fake-image-relay.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9456;
const INSPECT = 9457;
const TAG = process.argv.find((arg) => arg.startsWith("--tag="))?.slice(6) ?? "";
const OUT = join(homedir(), "Desktop", "Lyra看图动画测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

let app: RunningApp;

interface Rec {
	t: number;
	shown: boolean;
	scale: number;
	width: number;
}

const SAMPLER = `(() => {
	const S = window.__pane = { frames: [], t0: performance.now(), stop: false };
	const tick = () => {
		if (S.stop) return;
		const img = document.querySelector('.ly-checker img');
		if (img && img.naturalWidth > 0) {
			const m = getComputedStyle(img).transform.match(/matrix\\(([^,]+),\\s*([^,]+)/);
			const scale = m ? Math.hypot(Number(m[1]), Number(m[2])) : 1;
			S.frames.push({ t: performance.now() - S.t0, shown: getComputedStyle(img).visibility === 'visible', scale, width: img.getBoundingClientRect().width });
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})()`;

async function main() {
	await mkdir(OUT, { recursive: true });
	const relay = await startFakeImageRelay({ scenes: [], art: await boatPictures(), drawMs: 0 });
	const art = await boatPictures();
	app = await startApp({
		port: PORT,
		inspectPort: INSPECT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			// 1408×792: several times wider than the pane, so "fit" and "100%" are far apart.
			await writeFile(join(cwd, "boat.jpg"), Buffer.from(art.day, "base64"));
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
			await writeFile(join(home, "settings.json"), relaySettings(relay.port, cwd, { appearance: { theme: "light" } }));
		},
	});
	const { until, click } = driver(app);
	const frames: Frame[] = [];
	let stopRecording: (() => Promise<void>) | null = null;
	try {
		await app.evaluate("document.fonts.ready");
		await pause(1200);
		stopRecording = await startRecording(PORT, frames);
		await app.evaluate(`document.querySelector('button[aria-label="面板"]').setAttribute('data-probe-panels', '')`);
		await click("[data-probe-panels]");
		await pause(300);
		await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件")).setAttribute('data-probe-files', '')`);
		await click("[data-probe-files]");
		await until(`[...document.querySelectorAll('[data-ly-tree] [data-path]')].some((r) => r.getAttribute('data-path').endsWith('boat.jpg'))`, 15000);
		await pause(500);
		await app.evaluate(`[...document.querySelectorAll('[data-ly-tree] [data-path]')].find((r) => r.getAttribute('data-path').endsWith('boat.jpg')).setAttribute('data-probe-boat', '')`);
		await app.evaluate(SAMPLER);
		await click("[data-probe-boat]");
		await pause(1200);
		const recs = await app.evaluate<Rec[]>(`(() => { window.__pane.stop = true; return window.__pane.frames; })()`);
		const painted = recs.filter((r) => r.shown);
		for (const r of recs.slice(0, 12)) console.log(`     ${r.t.toFixed(0).padStart(4)}ms ${r.shown ? "可见" : "隐藏"}  缩放 ${r.scale.toFixed(3)}  宽 ${r.width.toFixed(1)}`);
		if (painted.length < 2) {
			check("图片在面板里画出来了", false, `${painted.length} 帧可见`);
		} else {
			const first = painted[0];
			const last = painted[painted.length - 1];
			check("第一帧就是适配后的大小，不是 100% 再缩下去", Math.abs(first.scale - last.scale) < 0.01, `第一帧缩放 ${first.scale.toFixed(3)}，落定 ${last.scale.toFixed(3)}`);
			const widest = Math.max(...painted.map((r) => r.width));
			check("打开过程中没有一帧比落定时更大", widest <= last.width + 1, `最大宽 ${widest.toFixed(1)}，落定 ${last.width.toFixed(1)}`);
		}
		await pause(400);
		const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		const file = join(OUT, `${stamp}_${TAG ? `${TAG}_` : ""}文件面板打开大图.png`);
		await writeFile(file, Buffer.from(data, "base64"));
		console.log(`   📸 ${file}`);
	} finally {
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过`);
		if (stopRecording) {
			await stopRecording();
			const video = join(OUT, `${stamp}_${TAG ? `${TAG}_` : ""}文件面板打开大图_${passed}of${results.length}.mp4`);
			await encode(frames, video, 60);
			console.log(`   🎬 ${video}`);
		}
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		relay.close();
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
