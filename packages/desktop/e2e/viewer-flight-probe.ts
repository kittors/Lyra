/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * The image viewer's flight, measured frame by frame: out of a generated picture's 编辑 button,
 * out of the picture itself, and back again.
 *
 * Each frame records what was painted — the figure's on-screen box with the running transform
 * applied, its opacity, and whether an <img> or the annotation canvas was inside it — so "the
 * picture blew up and then shrank" is a number rather than an impression.
 *
 *   node --experimental-strip-types e2e/viewer-flight-probe.ts [--wide] [--tag=修复前]
 *
 * `--wide` draws a 1408×792 picture instead of a square one.
 */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { boatPictures, relaySettings, startFakeImageRelay, type Scene } from "./fake-image-relay.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9452;
const INSPECT = 9453;
const WIDE = process.argv.includes("--wide");
const TAG = process.argv.find((arg) => arg.startsWith("--tag="))?.slice(6) ?? "";
const OUT = join(homedir(), "Desktop", "Lyra看图动画测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const label = `${TAG ? `${TAG}_` : ""}${WIDE ? "宽图" : "方图"}`;

const SCENES: Scene[] = [
	{ cue: "小狗", call: "call_dog", args: { prompt: "A cute puppy sitting on the grass, warm light", aspect_ratio: WIDE ? "16:9" : "auto" }, reply: "为你画了一只可爱的小狗。" },
	// What 完成 is for: the marked-up copy is the newest picture, so `#1` is it.
	{ cue: "照这个改", call: "call_redo", args: { prompt: "Redraw the puppy, turning what is circled in red into a flower", images: ["#1"] }, reply: "照你的标注重画了一张。" },
];

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

let app: RunningApp;
/** The thumbnail frame's own corners, read once the picture has landed in the conversation. */
let thumbRadius = 0;

async function shot(name: string) {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${label}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

interface Rec {
	t: number;
	thumb?: string;
	back?: number;
	chrome?: number;
	toolbar?: number;
	lw?: number;
	lh?: number;
	vx?: number;
	vy?: number;
	vw?: number;
	vh?: number;
	op?: number;
	clip?: string;
	bubble?: number;
	kind?: string;
	cw?: number;
	ch?: number;
}

interface Sampled {
	frames: Rec[];
	muts: { t: number; old?: string | null; now?: string | null; child?: string }[];
}

type Box = { x: number; y: number; width: number; height: number };

/*
 * The sampler, in the page. One record per animation frame, read in rAF so it is the state about to
 * be painted. A MutationObserver beside it keeps every write to the figure's inline style, oldValue
 * included: FLIP writes the start transform and clears it again inside one task, so no frame ever
 * shows the start — only the observer sees it.
 */
const SAMPLER = `(() => {
	const S = window.__probe = { frames: [], muts: [], t0: performance.now(), stop: false };
	const thumb = document.querySelector('[data-ly-image-frame="done"]');
	const isFigure = (el) => el && el.parentElement && el.parentElement.matches('[role=dialog]') && el.classList && el.classList.contains('relative');
	const mo = new MutationObserver((list) => {
		for (const r of list) {
			const t = performance.now() - S.t0;
			if (r.type === 'attributes' && isFigure(r.target)) S.muts.push({ t, old: r.oldValue, now: r.target.getAttribute('style') });
			if (r.type === 'childList' && r.target.closest && r.target.closest('[role=dialog]') && isFigure(r.target.parentElement)) {
				S.muts.push({ t, child: [...r.addedNodes].map((n) => n.nodeName).join(',') + ' / -' + [...r.removedNodes].map((n) => n.nodeName).join(',') });
			}
		}
	});
	mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true, childList: true });
	if (!Element.prototype.__probeAnimate) {
		const animate = Element.prototype.animate;
		Element.prototype.__probeAnimate = animate;
		Element.prototype.animate = function (frames, options) {
			const a = animate.call(this, frames, options);
			if (isFigure(this)) {
				const P = window.__probe;
				const at = () => performance.now() - P.t0;
				P.muts.push({ t: at(), child: 'animate ' + JSON.stringify(frames).slice(0, 160) + ' ' + JSON.stringify(options) });
				a.addEventListener('finish', () => window.__probe.muts.push({ t: performance.now() - window.__probe.t0, child: 'finish' }));
				a.addEventListener('cancel', () => window.__probe.muts.push({ t: performance.now() - window.__probe.t0, child: 'cancel' }));
			}
			return a;
		};
	}
	const tick = () => {
		if (S.stop) { mo.disconnect(); return; }
		const rec = { t: performance.now() - S.t0 };
		if (thumb) rec.thumb = getComputedStyle(thumb).visibility;
		const dlg = document.querySelector('[role=dialog][aria-modal]');
		if (dlg) {
			const back = dlg.querySelector(':scope > button');
			if (back) rec.back = +getComputedStyle(back).opacity;
			const fig = [...dlg.children].find(isFigure);
			if (fig) {
				const cs = getComputedStyle(fig);
				const r = fig.getBoundingClientRect();
				rec.lw = fig.offsetWidth; rec.lh = fig.offsetHeight;
				rec.vx = r.x; rec.vy = r.y; rec.vw = r.width; rec.vh = r.height;
				rec.op = +cs.opacity;
				rec.clip = cs.clipPath;
				const pan = fig.firstElementChild;
				const leaf = pan && pan.firstElementChild;
				rec.kind = leaf ? (leaf.querySelector && leaf.querySelector('canvas') ? 'CANVAS' : leaf.nodeName) : '-';
				const cv = pan && pan.querySelector('canvas');
				if (cv) { rec.cw = cv.width; rec.ch = cv.height; }
			}
			const bubble = document.querySelector('[data-toolbar-bubble]');
			if (bubble) { const b = bubble.getBoundingClientRect(); rec.bubble = b.x + b.width / 2; }
			const tools = dlg.querySelector('[data-ly-annotate-toolbar]') || [...dlg.querySelectorAll(':scope > div')].find((d) => d.querySelector('button[aria-label="撤销"]'));
			if (tools) rec.toolbar = +getComputedStyle(tools).opacity;
			const top = [...dlg.querySelectorAll('button[aria-label]')].find((b) => /^关闭/.test(b.getAttribute('aria-label')) && b.closest('.absolute.top-4'));
			if (top) rec.chrome = top.checkVisibility({ opacityProperty: true }) ? 1 : 0;
		}
		S.frames.push(rec);
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})()`;

async function sample(act: () => Promise<void>, ms: number): Promise<Sampled> {
	await app.evaluate(SAMPLER);
	await act();
	await pause(ms);
	return app.evaluate<Sampled>(`(() => { const S = window.__probe; S.stop = true; return { frames: S.frames, muts: S.muts }; })()`);
}

const f1 = (n: number | undefined) => (n === undefined ? "-" : n.toFixed(1));

function print(data: Sampled, thumb: Box) {
	for (const m of data.muts.slice(0, 12)) {
		if (m.child) console.log(`     ${m.t.toFixed(0).padStart(4)}ms  子元素 ${m.child}`);
		else console.log(`     ${m.t.toFixed(0).padStart(4)}ms  style: ${(m.old ?? "").replace(/will-change[^;]*;?/g, "").trim()}  →  ${(m.now ?? "").replace(/will-change[^;]*;?/g, "").trim()}`);
	}
	let shown = 0;
	for (const f of data.frames) {
		if (f.vw === undefined && f.back === undefined) continue;
		if (shown++ > 30) break;
		const cx = f.vx !== undefined && f.vw !== undefined ? f.vx + f.vw / 2 : undefined;
		const cy = f.vy !== undefined && f.vh !== undefined ? f.vy + f.vh / 2 : undefined;
		console.log(
			`     ${f.t.toFixed(0).padStart(4)}ms ${String(f.kind ?? "-").padEnd(6)} 布局 ${f1(f.lw)}×${f1(f.lh)}  画面 ${f1(f.vw)}×${f1(f.vh)} (×缩略图 ${f.vw ? (f.vw / thumb.width).toFixed(2) : "-"})  中心 ${f1(cx)},${f1(cy)}  不透明 ${f.op?.toFixed(2) ?? "-"}  遮罩 ${f.back?.toFixed(2) ?? "-"}  缩略图 ${f.thumb ?? "-"}${f.toolbar !== undefined ? `  工具条 ${f.toolbar.toFixed(2)}` : ""}${f.chrome !== undefined ? `  右上按钮 ${f.chrome}` : ""}${f.cw ? `  画布 ${f.cw}×${f.ch}` : ""}`,
		);
	}
}

/** The corner radius the first keyframe draws on screen: the clip's radius times the scale. */
function startCorner(data: Sampled): number | null {
	const call = data.muts.find((m) => m.child?.startsWith("animate "));
	const scale = /scale\(([\d.]+)\)/.exec(call?.child ?? "")?.[1];
	const round = /round ([\d.]+)px/.exec(call?.child ?? "")?.[1];
	return scale && round ? Number(scale) * Number(round) : null;
}

/** What an arrival has to look like: from the thumbnail, growing, never past where it ends up. */
function judgeArrival(name: string, data: Sampled, thumb: Box) {
	const frames = data.frames.filter((f) => f.vw !== undefined) as Required<Rec>[];
	if (frames.length < 3) return check(`${name}：查看器出现了`, false, `只采到 ${frames.length} 帧`);
	const first = frames[0];
	const last = frames[frames.length - 1];
	const peak = Math.max(...frames.map((f) => f.vw));
	const shrinks = frames.slice(1).filter((f, i) => f.vw < frames[i].vw - 0.5).length;
	const layouts = new Set(frames.map((f) => `${f.lw}×${f.lh}`));
	check(`${name}：第一帧从缩略图的大小起步`, first.vw <= thumb.width * 1.08, `第一帧 ${f1(first.vw)}，缩略图 ${f1(thumb.width)}，终点 ${f1(last.vw)}（${(first.vw / thumb.width).toFixed(2)} 倍缩略图）`);
	check(`${name}：不会先放大再缩小`, peak <= last.vw + 0.5 && shrinks === 0, `最大 ${f1(peak)} / 终点 ${f1(last.vw)}，变小的帧 ${shrinks} 个`);
	check(`${name}：飞行途中布局尺寸不变`, layouts.size === 1, [...layouts].join(" → "));
	const centre = { x: first.vx + first.vw / 2, y: first.vy + first.vh / 2 };
	const from = { x: thumb.x + thumb.width / 2, y: thumb.y + thumb.height / 2 };
	check(`${name}：第一帧在缩略图的位置`, Math.hypot(centre.x - from.x, centre.y - from.y) < Math.max(24, thumb.width * 0.1), `第一帧中心 ${f1(centre.x)},${f1(centre.y)}，缩略图中心 ${f1(from.x)},${f1(from.y)}`);
	check(`${name}：起步不发虚`, first.op >= 0.9, `第一帧不透明度 ${first.op.toFixed(2)}`);
	check(`${name}：遮罩是淡入的，不是一下子全黑`, first.back < 0.6, `第一帧遮罩 ${first.back.toFixed(2)}`);
	const corner = startCorner(data);
	check(`${name}：起飞那一帧的圆角就是缩略图的圆角`, corner !== null && Math.abs(corner - thumbRadius) < 0.6, `起飞圆角 ${corner?.toFixed(2) ?? "无"}px，缩略图 ${thumbRadius}px`);
	const bubbles = data.frames.filter((f) => f.bubble !== undefined).map((f) => f.bubble as number);
	if (bubbles.length > 2) check(`${name}：工具条上方的气泡进场时不跳`, Math.max(...bubbles) - Math.min(...bubbles) < 1, `气泡中心 ${Math.min(...bubbles).toFixed(1)}–${Math.max(...bubbles).toFixed(1)}`);
}

/** What a return has to look like: lands exactly on the thumbnail, solid, and hands over in one frame. */
function judgeReturn(name: string, data: Sampled, thumb: Box, chromeBefore: boolean) {
	const open = data.frames.filter((f) => f.vw !== undefined) as Required<Rec>[];
	const lastOpen = open[open.length - 1];
	const gone = data.frames.findIndex((f, i) => i > 0 && f.vw === undefined && data.frames[i - 1].vw !== undefined);
	if (!lastOpen || gone < 0) return check(`${name}：查看器关掉了`, false, `${open.length} 帧开着，${gone < 0 ? "没关" : ""}`);
	check(`${name}：落地时和缩略图一样大`, Math.abs(lastOpen.vw - thumb.width) <= 3 && Math.abs(lastOpen.vh - thumb.height) <= 3, `最后一帧 ${f1(lastOpen.vw)}×${f1(lastOpen.vh)}，缩略图 ${f1(thumb.width)}×${f1(thumb.height)}`);
	check(`${name}：落地时不褪色`, lastOpen.op >= 0.9, `最后一帧不透明度 ${lastOpen.op.toFixed(2)}`);
	const settling = open.filter((f) => Math.abs(f.vw - thumb.width) <= 3 && f.op < 0.9).length;
	check(`${name}：没有停在缩略图上发白的帧`, settling === 0, `${settling} 帧已到位却还是半透明`);
	const back = data.frames[gone].thumb;
	check(`${name}：缩略图在查看器消失的那一帧回来`, back === "visible", `消失那帧缩略图 ${back}`);
	if (!chromeBefore) check(`${name}：返程不冒出预览的右上角按钮`, open.every((f) => !f.chrome), `右上按钮在返程中 ${open.filter((f) => f.chrome).length} 帧可见`);
	const tools = open.filter((f) => f.toolbar !== undefined);
	if (tools.length) check(`${name}：工具条淡出而不是瞬间消失`, tools.length >= 3 && tools[0].toolbar > 0.5, `工具条在返程中留了 ${tools.length} 帧，第一帧 ${tools[0].toolbar.toFixed(2)}`);
}

async function chromeShown(): Promise<boolean> {
	return app.evaluate<boolean>(`Boolean([...document.querySelectorAll('[role=dialog] button[aria-label]')].find((b) => /^关闭/.test(b.getAttribute('aria-label')) && b.closest('.absolute.top-4')))`);
}

async function pressBackdrop() {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 40, y: 420 });
	const onBackdrop = await app.evaluate<boolean>(`document.elementFromPoint(40, 420) === document.querySelector('[role=dialog] > button')`);
	if (!onBackdrop) throw new Error("(40,420) 不在遮罩上");
	for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, x: 40, y: 420, button: "left", clickCount: 1 });
}

async function thumbBox(): Promise<Box> {
	return app.evaluate<Box>(`(() => { const r = document.querySelector('[data-ly-image-frame="done"]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
}

async function main() {
	await mkdir(OUT, { recursive: true });
	const scratch = await mkdtemp(join(tmpdir(), "lyra-viewer-flight-"));
	const boats = await boatPictures();
	let art = boats.day;
	if (!WIDE) {
		// A square picture, as the 1024×1024 one in the recording that reported this.
		const wide = join(scratch, "wide.jpg");
		const square = join(scratch, "square.jpg");
		await writeFile(wide, Buffer.from(boats.day, "base64"));
		execFileSync("sips", ["-c", "792", "792", wide, "--out", square], { stdio: "ignore" });
		art = (await readFile(square)).toString("base64");
	}
	const relay = await startFakeImageRelay({ scenes: SCENES, art: { day: art, night: art }, drawMs: 1200 });
	app = await startApp({
		port: PORT,
		inspectPort: INSPECT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
			await writeFile(join(home, "settings.json"), relaySettings(relay.port, cwd, { appearance: { theme: "light" } }));
		},
	});
	const { until, hover, type, submit, click, settled, key } = driver(app);
	const frames: Frame[] = [];
	let stopRecording: (() => Promise<void>) | null = null;
	try {
		await app.evaluate("document.fonts.ready");
		await pause(1200);
		await type("画一只可爱的小狗");
		await submit();
		await until(`[...document.querySelectorAll('[data-ly-image-card="done"] img')].some((i) => i.naturalWidth > 0)`, 60000);
		await settled(60000);
		await pause(800);
		stopRecording = await startRecording(PORT, frames);
		await pause(600);

		const thumb = await thumbBox();
		thumbRadius = await app.evaluate<number>(`parseFloat(getComputedStyle(document.querySelector('[data-ly-image-frame="done"]')).borderTopLeftRadius)`);
		console.log(`缩略图 ${f1(thumb.width)}×${f1(thumb.height)} @ ${f1(thumb.x)},${f1(thumb.y)}`);

		console.log("\n① 卡片上的「编辑」：直接进标注（第一次）");
		const pressEdit = async () => {
			await hover('[data-ly-image-frame="done"]');
			await pause(500);
			await app.evaluate(`document.querySelector('[data-ly-image-frame="done"] .ly-image-action[aria-label="编辑"]').setAttribute('data-probe-edit', '')`);
			await click("[data-probe-edit]");
		};
		const editOpen = await sample(pressEdit, 900);
		print(editOpen, thumb);
		judgeArrival("编辑打开", editOpen, thumb);
		await pause(600);
		await shot("01_编辑打开后");

		console.log("\n② 标注中点空白处关掉");
		let chrome = await chromeShown();
		const editClose = await sample(pressBackdrop, 800);
		print(editClose, thumb);
		judgeReturn("标注中关掉", editClose, thumb, chrome);
		await pause(800);

		console.log("\n③ 关掉之后再点「编辑」（录屏里那条路）");
		const editAgain = await sample(pressEdit, 900);
		print(editAgain, thumb);
		judgeArrival("再次编辑打开", editAgain, thumb);
		await pause(500);

		console.log("\n④ Esc 退出标注，再 Esc 关掉");
		const leaveEdit = await sample(() => key("Escape", 27), 500);
		const leaveSizes = new Set(leaveEdit.frames.filter((f) => f.vw !== undefined).map((f) => `${f1(f.vw)}×${f1(f.vh)}`));
		check("退出标注时画面一个像素都不变", leaveSizes.size === 1, [...leaveSizes].join(" → "));
		chrome = await chromeShown();
		const escClose = await sample(() => key("Escape", 27), 800);
		print(escClose, thumb);
		judgeReturn("Esc 关掉", escClose, thumb, chrome);
		await pause(800);

		console.log("\n⑤ 点图片：预览");
		const viewOpen = await sample(async () => {
			await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: thumb.x + thumb.width / 2, y: thumb.y + thumb.height / 2 });
			for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, x: thumb.x + thumb.width / 2, y: thumb.y + thumb.height / 2, button: "left", clickCount: 1 });
		}, 900);
		print(viewOpen, thumb);
		judgeArrival("预览打开", viewOpen, thumb);

		console.log("\n⑥ 预览里按「标注」");
		await app.evaluate(`[...document.querySelectorAll('[role=dialog] button[aria-label]')].find((b) => b.getAttribute('aria-label') === '标注').setAttribute('data-probe-annotate', '')`);
		const toEdit = await sample(() => click("[data-probe-annotate]"), 700);
		const sizes = new Set(toEdit.frames.filter((f) => f.vw !== undefined).map((f) => `${f1(f.vw)}×${f1(f.vh)}`));
		check("切到标注时画面一个像素都不变", sizes.size === 1, [...sizes].join(" → "));
		await pause(400);

		console.log("\n⑦ 画一笔，按「完成」");
		const done = await app.evaluate<{ label: string; tip: string; disabled: boolean } | null>(`(() => { const b = [...document.querySelectorAll('[role=dialog] button[aria-label]')].find((x) => x.getAttribute('aria-label') === '完成'); return b ? { label: b.getAttribute('aria-label'), tip: b.getAttribute('data-ly-tip'), disabled: b.disabled } : null; })()`);
		check("对话里的图，确认键叫「完成」而不是「保存副本」", done !== null, done ? `「${done.label}」，提示「${done.tip}」` : "没有「完成」键");
		if (done) {
			const stage = await app.evaluate<Box>(`(() => { const r = document.querySelector('[role=dialog] canvas').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
			const cx = stage.x + stage.width * 0.62;
			const cy = stage.y + stage.height * 0.38;
			await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx + 60, y: cy });
			await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx + 60, y: cy, button: "left", clickCount: 1 });
			for (let i = 1; i <= 24; i++) {
				const a = (i / 24) * Math.PI * 2;
				await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx + 60 * Math.cos(a), y: cy + 46 * Math.sin(a), button: "left", buttons: 1 });
			}
			await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx + 60, y: cy, button: "left", clickCount: 1 });
			await pause(500);
			await shot("02_画了一个圈");
			const before = await app.evaluate<number>(`document.querySelectorAll('[data-ly-attachment][data-ly-shape="image"]').length`);
			await app.evaluate(`[...document.querySelectorAll('[role=dialog] button[aria-label]')].find((b) => b.getAttribute('aria-label') === '完成').setAttribute('data-probe-done', '')`);
			const finish = await sample(() => click("[data-probe-done]"), 900);
			const gone = finish.frames.some((f, i) => i > 0 && f.vw === undefined && finish.frames[i - 1].vw !== undefined);
			check("按「完成」后查看器收起", gone, `${finish.frames.filter((f) => f.vw !== undefined).length} 帧还开着`);
			await pause(600);
			const handed = await app.evaluate<{ count: number; focused: boolean; inComposer: boolean }>(`(() => {
				const tiles = [...document.querySelectorAll('[data-ly-attachment][data-ly-shape="image"]')];
				const field = document.querySelector('main textarea');
				const last = tiles[tiles.length - 1];
				return { count: tiles.length, focused: document.activeElement === field, inComposer: Boolean(last && !last.closest('.ly-user-images')) };
			})()`);
			check("标注后的图进了这个对话的输入框", handed.count === before + 1 && handed.inComposer, `输入框上方的图 ${before} → ${handed.count}`);
			check("光标落在输入框里，可以直接说要怎么改", handed.focused, handed.focused ? "输入框有焦点" : "焦点不在输入框");
			await shot("03_完成后进了输入框");

			console.log("\n⑧ 说一句「照这个改」，看它拿标注图去二次生成");
			const attached = await app.evaluate<string>(`(() => { const tiles = [...document.querySelectorAll('[data-ly-attachment][data-ly-shape="image"] img')]; return tiles[tiles.length - 1]?.src ?? ""; })()`);
			// Typed the way keys arrive — at the caret, after the picture's mark — not by replacing the
			// field's value, which would delete the mark and, with it, the picture.
			await app.send("Input.insertText", { text: "照这个改，把圈起来的地方画成一朵花" });
			await pause(300);
			const draft = await app.evaluate<string>(`document.querySelector('main textarea').value`);
			check("标注图在句子里有自己的标记，打字接在它后面", /【[^】]+】照这个改/.test(draft), JSON.stringify(draft));
			await app.evaluate(`(() => { const T = window.__tray = { hs: [], stop: false }; const tick = () => { if (T.stop) return; const el = document.querySelector('main [data-ly-composer-attachments]'); T.hs.push(el ? el.getBoundingClientRect().height : -1); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`);
			await submit();
			await pause(800);
			const tray = await app.evaluate<number[]>(`(() => { window.__tray.stop = true; return window.__tray.hs; })()`);
			const trayOpen = tray[0] ?? 0;
			const between = tray.filter((h) => h > 1 && h < trayOpen - 1).length;
			check("带图发出去后，附件托盘是收起来的，不是一帧消失", trayOpen > 20 && (tray[tray.length - 1] ?? 1) < 1 && between >= 3, `托盘 ${trayOpen.toFixed(0)}px → ${(tray[tray.length - 1] ?? -1).toFixed(0)}px，中间 ${between} 帧`);
			await until(`document.querySelectorAll('[data-ly-image-frame="drawing"]').length > 0`, 30000);
			const drawingShape = await app.evaluate<number>(`(() => { const r = [...document.querySelectorAll('[data-ly-image-frame="drawing"]')].pop().getBoundingClientRect(); return r.width / r.height; })()`);
			await until(`document.querySelectorAll('[data-ly-image-card="done"] img').length >= 2 && [...document.querySelectorAll('[data-ly-image-card="done"] img')].every((i) => i.naturalWidth > 0)`, 60000);
			const landedShape = await app.evaluate<number>(`(() => { const r = [...document.querySelectorAll('[data-ly-image-frame="done"]')].pop().getBoundingClientRect(); return r.width / r.height; })()`);
			check("二次生成时，画的过程中图框就是成品的形状", Math.abs(drawingShape - landedShape) < 0.02, `画的时候 ${drawingShape.toFixed(3)}，落地 ${landedShape.toFixed(3)}`);
			await settled(60000);
			const chats = relay.seen.filter((x) => x.path.endsWith("/chat/completions"));
			const asked = (chats[chats.length - 1]?.body.messages as { role: string; content: unknown }[] | undefined) ?? [];
			const shape = (content: unknown) => Array.isArray(content) ? (content as { type: string; text?: string }[]).map((part) => part.type === "text" ? `text(${(part.text ?? "").replace(/\s+/g, " ").slice(0, 18)})` : part.type).join("+") : `str(${String(content ?? "").replace(/\s+/g, " ").slice(0, 18)})`;
			console.log(`     最后一次对话请求：${asked.map((m) => `${m.role}:${shape(m.content)}`).join(" | ")}`);
			const edits = relay.seen.filter((x) => x.path.endsWith("/images/edits"));
			const sent = (edits[0]?.body.image as string[] | undefined)?.[0] ?? "";
			const sentPng = sent.startsWith("data:image/png;base64,");
			const sameAsAttached = attached.startsWith("data:") ? sent === attached : sentPng;
			check("二次生成走的是「编辑」接口，带上了标注图", edits.length === 1 && sentPng && sameAsAttached, `edits 请求 ${edits.length} 个，图 ${sent.slice(0, 22)}…（${Math.round(sent.length / 1024)} KB）${attached.startsWith("data:") ? (sent === attached ? "，和输入框里那张逐字节一致" : "，和输入框里那张不一样") : ""}`);
			await pause(800);
			await shot("04_照标注二次生成");
		} else {
			await key("Escape", 27);
			await pause(300);
			await key("Escape", 27);
			await pause(800);
		}

		console.log("\n⑨ 标注中开、关，连做五轮");
		let early = 0;
		for (let round = 0; round < 5; round++) {
			await sample(pressEdit, 700);
			const back = await sample(pressBackdrop, 700);
			const open = back.frames.filter((f) => f.vw !== undefined);
			const last = open[open.length - 1];
			if (!last || Math.abs(last.vw! - thumb.width) > 3) early++;
			await pause(300);
		}
		check("五轮里每一次都落回缩略图上才收起", early === 0, `${early} 轮没落到位就收了`);

		console.log("\n⑩ 十倍慢放，拍「编辑」打开的几个瞬间");
		await app.send("Animation.enable");
		await app.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
		await hover('[data-ly-image-frame="done"]');
		await pause(500);
		await app.evaluate(`document.querySelector('[data-ly-image-frame="done"] .ly-image-action[aria-label="编辑"]').setAttribute('data-probe-edit', '')`);
		const t0 = Date.now();
		await click("[data-probe-edit]");
		for (const at of [30, 400, 900, 1600, 2700]) {
			await pause(Math.max(0, at - (Date.now() - t0)));
			await shot(`05_慢放_${String(at).padStart(4, "0")}ms`);
		}
		await app.send("Animation.setPlaybackRate", { playbackRate: 1 });
		await pause(400);
		await key("Escape", 27);
		await pause(300);
		await key("Escape", 27);
		await pause(800);
	} finally {
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过`);
		if (stopRecording) {
			await stopRecording();
			const video = join(OUT, `${stamp}_${label}_看图飞行_${passed}of${results.length}.mp4`);
			await encode(frames, video, 60);
			console.log(`   🎬 ${video}`);
		}
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		await rm(scratch, { recursive: true, force: true });
		relay.close();
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
