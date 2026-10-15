/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * Every annotation tool on a picture drawn in a conversation, in a real window, measured off the
 * pixels that were drawn.
 *
 * A fake relay draws the picture, so the path is the real one: the picture in the transcript, the
 * viewer, 标注, and 完成 handing the marked-up copy to the composer. Sizes, sharpness and positions
 * are read off the annotation canvas and the screen, never off component state; the copy handed on
 * is compared with what was on screen.
 *
 * `pnpm --filter @lyra/desktop build`, then
 * `node --experimental-strip-types packages/desktop/e2e/annotate-tools-demo.ts [out-dir]`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { boatPictures, relaySettings, startFakeImageRelay } from "./fake-image-relay.ts";
import { driver, encode, frameGrabber, pause, startRecording, type Frame } from "./record.ts";

const OUT = process.argv[2] ?? join(homedir(), "Desktop", "Lyra标注工具测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9879;
const VIEWER = '[aria-label="图片预览"]';
const CANVAS = `${VIEWER} canvas`;

const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};
const section = (title: string) => console.log(`\n── ${title}`);

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number; count: number };
type Point = { x: number; y: number };

/*
 * Pixel helpers installed in the page once. The annotation canvas is read through its own backing
 * store; every rectangle in and out is in screen CSS pixels. No backticks or newlines in here: this
 * whole block travels inside a template string.
 */
const HELPERS = `(()=>{
	const canvas = () => document.querySelector('${CANVAS}');
	/*
	 * Pixels are read off a copy, never off the canvas itself: a canvas read back a few times is moved
	 * off the GPU by Chromium, and from then on draws its colours a shade lighter than the user sees.
	 */
	const scratch = document.createElement('canvas');
	const sctx = scratch.getContext('2d', { willReadFrequently: true });
	const read = (c, sx, sy, sw, sh) => { scratch.width = sw; scratch.height = sh; sctx.drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh); return sctx.getImageData(0, 0, sw, sh).data; };
	window.__apRead = read;
	const colours = {
		red: (r, g, b) => r > 170 && g < 130 && b < 130 && r - g > 80,
		blue: (r, g, b) => b > 170 && r < 120 && b - r > 80,
	};
	const grab = (x, y, w, h) => {
		const c = canvas(); const box = c.getBoundingClientRect();
		const kx = c.width / box.width, ky = c.height / box.height;
		const sx = Math.max(0, Math.floor((x - box.left) * kx)), sy = Math.max(0, Math.floor((y - box.top) * ky));
		const sw = Math.max(1, Math.min(c.width - sx, Math.ceil(w * kx))), sh = Math.max(1, Math.min(c.height - sy, Math.ceil(h * ky)));
		return { data: read(c, sx, sy, sw, sh), sx, sy, sw, sh, kx, ky, box };
	};
	window.__ap = {
		ink(x, y, w, h, colour) {
			const g = grab(x, y, w, h); const test = colours[colour];
			let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity, count = 0;
			for (let j = 0; j < g.sh; j++) for (let i = 0; i < g.sw; i++) {
				const p = (j * g.sw + i) * 4;
				if (test(g.data[p], g.data[p + 1], g.data[p + 2])) { count++; if (i < l) l = i; if (i > r) r = i; if (j < t) t = j; if (j > b) b = j; }
			}
			if (!count) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, count: 0 };
			const toX = (i) => g.box.left + (g.sx + i) / g.kx, toY = (j) => g.box.top + (g.sy + j) / g.ky;
			return { left: +toX(l).toFixed(1), top: +toY(t).toFixed(1), right: +toX(r + 1).toFixed(1), bottom: +toY(b + 1).toFixed(1), width: +((r + 1 - l) / g.kx).toFixed(2), height: +((b + 1 - t) / g.ky).toFixed(2), count };
		},
		sig() {
			const c = canvas(); const d = read(c, 0, 0, c.width, c.height);
			const cols = 96, rows = 54, out = [];
			for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
				const x0 = Math.floor(gx * c.width / cols), x1 = Math.floor((gx + 1) * c.width / cols);
				const y0 = Math.floor(gy * c.height / rows), y1 = Math.floor((gy + 1) * c.height / rows);
				let r = 0, g = 0, b = 0, n = 0;
				for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const p = (y * c.width + x) * 4; r += d[p]; g += d[p + 1]; b += d[p + 2]; n++; }
				out.push(Math.round(r / n), Math.round(g / n), Math.round(b / n));
			}
			return out;
		},
		backing() {
			const c = canvas(); const r = c.getBoundingClientRect();
			return { backing: [c.width, c.height], drawn: [+r.width.toFixed(1), +r.height.toFixed(1)], perDevicePx: +(c.width / (r.width * devicePixelRatio)).toFixed(3) };
		},
		runs(x, y, w) {
			const g = grab(x, y, w, 1); const runs = []; let start = 0;
			const same = (a, b) => Math.abs(g.data[a] - g.data[b]) + Math.abs(g.data[a + 1] - g.data[b + 1]) + Math.abs(g.data[a + 2] - g.data[b + 2]) < 6;
			for (let i = 1; i <= g.sw; i++) if (i === g.sw || !same(i * 4, (i - 1) * 4)) { runs.push(i - start); start = i; }
			return { runs, kx: g.kx };
		},
		natural() {
			const c = canvas(); const img = document.querySelector('${VIEWER} img:not([aria-hidden])');
			const w = img.naturalWidth, h = img.naturalHeight;
			const o = document.createElement('canvas'); o.width = w; o.height = h;
			const g = o.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, w, h);
			window.__screenCopy = g.getImageData(0, 0, w, h);
			return [w, h];
		},
	};
	return true;
})()`;

async function seed(home: string, relayPort: number) {
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(join(home, "settings.json"), relaySettings(relayPort, cwd));
}

const art = await boatPictures();
const relay = await startFakeImageRelay({
	scenes: [{ cue: "纸船", call: "call_boat", args: { prompt: "A red paper boat on calm water", aspect_ratio: "16:9" }, reply: "画好了：一只停在水面上的红色纸船。" }],
	art,
	drawMs: 900,
});

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];
const shots: { name: string; data: Buffer }[] = [];

try {
	await mkdir(OUT, { recursive: true });
	app = await startApp({ port: PORT, seed: (home) => seed(home, relay.port) });
	const running = app;
	stopRecording = await startRecording(PORT, frames);
	const grabber = await frameGrabber(PORT);
	const { until, type, submit, settled } = driver(running);
	const evaluate = <T>(expression: string) => grabber.evaluate<T>(expression);

	/** Frames while nothing moves, so each step can be seen; the window may be covered by others. */
	async function hold(ms = 900) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			frames.push({ at: Date.now(), data: await grabber.shot() });
			await pause(Math.min(180, Math.max(0, end - Date.now())));
		}
	}
	async function shot(name: string) {
		const { data } = await grabber.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		shots.push({ name, data: Buffer.from(data, "base64") });
	}
	const mouse = (kind: string, at: Point, options: { buttons?: number; modifiers?: number } = {}) =>
		grabber.send("Input.dispatchMouseEvent", {
			type: kind,
			x: at.x,
			y: at.y,
			button: kind === "mouseMoved" && !options.buttons ? "none" : "left",
			buttons: options.buttons ?? 0,
			clickCount: kind === "mouseMoved" ? 0 : 1,
			modifiers: options.modifiers ?? 0,
		});
	const centre = (selector: string) =>
		evaluate<Point>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	/** A real pointer, the landing checked before the press. */
	async function click(selector: string) {
		await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, 20000);
		const at = await centre(selector);
		await mouse("mouseMoved", at);
		await pause(90);
		const lands = await evaluate<boolean>(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const hit=document.elementFromPoint(${at.x},${at.y});return Boolean(hit&&(el===hit||el.contains(hit)));})()`);
		if (!lands) throw new Error(`the pointer would not land on ${selector}`);
		await mouse("mousePressed", at, { buttons: 1 });
		await mouse("mouseReleased", at);
		await pause(120);
	}
	async function press(at: Point, modifiers = 0) {
		await mouse("mouseMoved", at);
		await pause(40);
		await mouse("mousePressed", at, { buttons: 1, modifiers });
		await mouse("mouseReleased", at, { modifiers });
		await pause(160);
	}
	async function drag(points: Point[], modifiers = 0, step = 14) {
		await mouse("mouseMoved", points[0]!, { modifiers });
		await pause(40);
		await mouse("mousePressed", points[0]!, { buttons: 1, modifiers });
		for (let i = 1; i < points.length; i++) {
			await mouse("mouseMoved", points[i]!, { buttons: 1, modifiers });
			await pause(step);
		}
		await mouse("mouseReleased", points.at(-1)!, { modifiers });
		await pause(220);
	}
	/** Points along a straight line, so a drag passes through the frames in between. */
	const along = (a: Point, b: Point, n = 10) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
	async function key(name: string, code: string, vk: number, modifiers = 0) {
		await grabber.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode: vk, modifiers });
		await grabber.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: vk, modifiers });
		await pause(160);
	}
	async function typeText(text: string) {
		for (const char of text) {
			await grabber.send("Input.insertText", { text: char });
			await pause(28);
		}
	}
	const ink = (box: { x: number; y: number; w: number; h: number }, colour: "red" | "blue") =>
		evaluate<Box>(`window.__ap.ink(${box.x},${box.y},${box.w},${box.h},'${colour}')`);
	/*
	 * The picture as a 96×54 grid of average colours, compared with a tolerance.
	 *
	 * Not an exact hash of the pixels: the probe's own reads make Chromium move the canvas from the GPU
	 * to the CPU part-way through (it does that for canvases that are read back often), and the two
	 * rasterise antialiased edges a level or two apart. A mark added or taken away changes whole cells;
	 * that is what "the same picture" has to tell apart.
	 */
	type Sig = number[];
	const hash = () => evaluate<Sig>("window.__ap.sig()");
	const differ = (a: Sig | undefined, b: Sig | undefined) => (a && b && a.length === b.length ? Math.max(...a.map((v, i) => Math.abs(v - b[i]!))) : 255);
	const same = (a: Sig | undefined, b: Sig | undefined) => differ(a, b) <= 8;
	const rect = (selector: string) =>
		evaluate<{ x: number; y: number; w: number; h: number; right: number; bottom: number } | null>(
			`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1)};})()`,
		);
	const frame = () =>
		evaluate<{ x: number; y: number; w: number; h: number; border: number } | null>(
			`(()=>{const el=[...document.querySelectorAll('${VIEWER} span')].find((s)=>s.className.includes('bg-sky-400/10'));if(!el)return null;const r=el.getBoundingClientRect();return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),border:+(parseFloat(getComputedStyle(el).borderTopWidth)).toFixed(2)};})()`,
		);
	const grips = () =>
		evaluate<{ x: number; y: number; size: number }[]>(
			`[...document.querySelectorAll('${VIEWER} span')].filter((s)=>s.className.includes('bg-sky-500')).map((s)=>{const r=s.getBoundingClientRect();return {x:+(r.x+r.width/2).toFixed(1),y:+(r.y+r.height/2).toFixed(1),size:+r.width.toFixed(1)};})`,
		);
	const tool = (name: string) => click(`[data-annotate-bar] button[aria-label="${name}"]`);
	const bubble = (tip: string) => click(`[data-toolbar-bubble] button[data-ly-tip="${tip}"]`);
	const swatch = (name: string) => click(`[data-toolbar-bubble] button[aria-label="${name}"]`);

	// ── A picture drawn in the conversation, opened, and taken into 标注 ────────────────────────
	await running.evaluate("document.fonts.ready");
	await pause(1000);
	await type("画一只停在平静水面上的红色纸船");
	await pause(300);
	await submit();
	await until(`document.querySelector('[data-ly-image-card="done"] [data-ly-image-frame="done"] img')`, 60000);
	await settled(60000);
	await hold(800);
	await click('[data-ly-image-frame="done"] button');
	await until(`document.querySelector('${VIEWER}')`, 20000);
	await hold(1400);
	await click(`${VIEWER} [data-ly-tip="标注"]`);
	await until(`document.querySelector('${CANVAS}')&&document.querySelector('[data-annotate-bar] button')`, 20000);
	await hold(1200);
	await evaluate(HELPERS);
	await shot("01_进入标注_工具栏与缩放控件");

	section("工具栏和画布");
	const metrics = await evaluate<{ button: number; icon: number; bar: number; zoomPill: number; bubbleTop: number; imageBottom: number }>(`(()=>{
		const button = document.querySelector('[data-annotate-bar] button[aria-label="矩形"]').getBoundingClientRect();
		const icon = document.querySelector('[data-annotate-bar] button[aria-label="矩形"] svg').getBoundingClientRect();
		const bar = document.querySelector('[data-annotate-bar] > div').getBoundingClientRect();
		const pill = document.querySelector('[data-ly-viewer-zoom]').getBoundingClientRect();
		const bubble = document.querySelector('[data-toolbar-bubble]').getBoundingClientRect();
		const image = document.querySelector('${CANVAS}').getBoundingClientRect();
		return { button: Math.round(button.width), icon: Math.round(icon.width), bar: Math.round(bar.height), zoomPill: Math.round(pill.height), bubbleTop: Math.round(bubble.top), imageBottom: Math.round(image.bottom) };
	})()`);
	check("tool buttons are 36pt with 18pt icons (were 24 and 14)", metrics.button === 36 && metrics.icon === 18, metrics);
	check("the zoom control is as tall as the toolbar beside it", Math.abs(metrics.bar - metrics.zoomPill) <= 1, { bar: metrics.bar, zoomPill: metrics.zoomPill });
	check("at its default place the size-and-colour bubble stays off a 16:9 picture", metrics.bubbleTop >= metrics.imageBottom, { bubbleTop: metrics.bubbleTop, imageBottom: metrics.imageBottom });
	const sharp = await evaluate<{ backing: number[]; drawn: number[]; perDevicePx: number }>("window.__ap.backing()");
	check("the canvas has at least one pixel per device pixel (was 0.64: blurry on Retina)", sharp.perDevicePx >= 0.99, sharp);

	const image = await evaluate<{ x: number; y: number; w: number; h: number }>(`(()=>{const r=document.querySelector('${CANVAS}').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
	const P = (fx: number, fy: number): Point => ({ x: Math.round(image.x + image.w * fx), y: Math.round(image.y + image.h * fy) });
	const states: Sig[] = [await hash()];

	section("画笔");
	await tool("画笔");
	const wave = Array.from({ length: 41 }, (_, i) => ({ x: P(0.05, 0).x + i * 5, y: Math.round(P(0, 0.12).y + Math.sin(i / 3) * 14) }));
	await drag(wave, 0, 10);
	await hold(500);
	// Straight down through the stroke at the bottom of a trough, where it runs level: how thick it is on screen.
	const penCross = await ink({ x: wave[14]!.x - 1, y: P(0, 0.04).y, w: 2, h: P(0, 0.2).y - P(0, 0.04).y }, "red");
	check("a pen stroke is drawn about 4pt wide on screen (was 2.3)", penCross.height >= 3.5 && penCross.height <= 6, penCross);
	const penProfile = await evaluate<{ edge: number; core: number }>(`(()=>{
		const c = document.querySelector('${CANVAS}'); const box = c.getBoundingClientRect(); const k = c.width / box.width;
		const x = Math.round((${wave[14]!.x} - box.left) * k); const d = window.__apRead(c, x, 0, 1, c.height);
		let edge = 0, core = 0;
		for (let j = 0; j < c.height; j++) { const r = d[j*4], g = d[j*4+1]; const redness = r - g; if (redness > 150) core++; else if (redness > 30) edge++; }
		return { edge, core };
	})()`);
	check("its edges are crisp: no more than 3 device pixels of blur either side of its core", penProfile.edge <= 6 && penProfile.core >= 6, penProfile);
	states.push(await hash());

	section("箭头：画、选中、改色改粗、拖动、Shift 拉直");
	await tool("箭头");
	const penButton = await rect('[data-annotate-bar] button[aria-label="画笔"]');
	await drag(along(P(0.3, 0.27), P(0.45, 0.12)));
	await hold(500);
	const penButtonAfter = await rect('[data-annotate-bar] button[aria-label="画笔"]');
	check("when a selection adds 删除选中 to the bar, the buttons already on it stay where they were", Boolean(penButton && penButtonAfter && penButton.x === penButtonAfter.x), { before: penButton?.x, after: penButtonAfter?.x });
	const arrowGrips = await grips();
	check("a new arrow comes back selected, with a grip at each end", arrowGrips.length === 2 && (await frame()) !== null, arrowGrips);
	await swatch("蓝色");
	await hold(400);
	const arrowBlue = await ink({ x: P(0.29, 0).x, y: P(0, 0.1).y, w: P(0.47, 0).x - P(0.29, 0).x, h: P(0, 0.29).y - P(0, 0.1).y }, "blue");
	check("picking blue recolours the selected arrow", arrowBlue.count > 200, { blue: arrowBlue.count });
	await bubble("粗");
	await hold(400);
	await shot("02_箭头选中后改成蓝色加粗");
	await bubble("中");
	await swatch("红色");
	const arrowBefore = await ink({ x: P(0.29, 0).x, y: P(0, 0.08).y, w: P(0.47, 0).x - P(0.29, 0).x, h: P(0, 0.31).y - P(0, 0.08).y }, "red");
	const arrowMid = { x: Math.round((P(0.3, 0).x + P(0.45, 0).x) / 2), y: Math.round((P(0, 0.27).y + P(0, 0.12).y) / 2) };
	await drag(along(arrowMid, { x: arrowMid.x, y: arrowMid.y + 40 }, 8));
	await hold(400);
	const arrowAfter = await ink({ x: P(0.29, 0).x, y: P(0, 0.08).y, w: P(0.47, 0).x - P(0.29, 0).x, h: P(0, 0.31).y - P(0, 0.08).y + 50 }, "red");
	check("dragging the arrow by its shaft moves it 40pt down", Math.abs(arrowAfter.top - arrowBefore.top - 40) <= 2, { before: arrowBefore.top, after: arrowAfter.top });
	// A second arrow dragged slightly off level with Shift held: it lands level.
	const shiftFrom = P(0.05, 0.3);
	await drag(along(shiftFrom, { x: shiftFrom.x + 160, y: shiftFrom.y + 14 }), 8);
	await hold(400);
	const level = await evaluate<{ startY: number; endY: number }>(`(()=>{
		const a = window.__ap.ink(${shiftFrom.x + 4}, ${shiftFrom.y - 30}, 6, 60, 'red');
		const b = window.__ap.ink(${shiftFrom.x + 120}, ${shiftFrom.y - 30}, 6, 60, 'red');
		return { startY: +((a.top + a.bottom) / 2).toFixed(1), endY: +((b.top + b.bottom) / 2).toFixed(1) };
	})()`);
	check("with Shift held, an arrow dragged 14pt off level comes out level", Math.abs(level.startY - level.endY) <= 1.5, level);
	const head = await ink({ x: shiftFrom.x + 140, y: shiftFrom.y - 20, w: 24, h: 40 }, "red");
	check("its head is in proportion: about 16pt across at the middle size", head.height >= 13 && head.height <= 19, head);
	// A pen stroke is not selected when drawn, but any tool that places can pick it up: then restyle it.
	await press(wave[14]!);
	await hold(300);
	check("pressing on the pen stroke with another tool selects it", (await frame()) !== null, await frame());
	await swatch("绿色");
	await hold(300);
	const green = await evaluate<number>(`(()=>{const c=document.querySelector('${CANVAS}');const r=c.getBoundingClientRect();const k=c.width/r.width;const d=window.__apRead(c,Math.round((${P(0.04, 0).x}-r.left)*k),Math.round((${P(0, 0.03).y}-r.top)*k),Math.round(${Math.round(image.w * 0.24)}*k),Math.round(${Math.round(image.h * 0.2)}*k));let n=0;for(let i=0;i<d.length;i+=4)if(d[i+1]>150&&d[i]<120&&d[i+2]<130)n++;return n;})()`);
	check("and the colour applies to it", green > 300, { green });
	await swatch("红色");
	// The arrow keys move what is selected: Shift+→ five times is 50 points.
	const nudgeFrom = await frame();
	for (let i = 0; i < 5; i++) await key("ArrowRight", "ArrowRight", 39, 8);
	await hold(300);
	const nudgeTo = await frame();
	check("Shift+→ moves the selected mark 10 points a press", Boolean(nudgeFrom && nudgeTo && Math.abs(nudgeTo.x - nudgeFrom.x - 50) <= 1), { before: nudgeFrom?.x, after: nudgeTo?.x });
	for (let i = 0; i < 5; i++) await key("ArrowLeft", "ArrowLeft", 37, 8);
	await hold(200);
	states.push(await hash());

	section("直线、矩形、椭圆");
	await tool("直线");
	await drag(along(P(0.5, 0.12), P(0.68, 0.145)), 8);
	await hold(300);
	const lineEnds = await evaluate<{ a: number; b: number; thick: number }>(`(()=>{
		const a = window.__ap.ink(${P(0.51, 0).x}, ${P(0, 0.05).y}, 4, ${Math.round(image.h * 0.15)}, 'red');
		const b = window.__ap.ink(${P(0.67, 0).x}, ${P(0, 0.05).y}, 4, ${Math.round(image.h * 0.15)}, 'red');
		return { a: +((a.top + a.bottom) / 2).toFixed(1), b: +((b.top + b.bottom) / 2).toFixed(1), thick: a.height };
	})()`);
	check("a line drawn with Shift snaps level", Math.abs(lineEnds.a - lineEnds.b) <= 1.5, lineEnds);
	check("and is 4pt thick on screen", lineEnds.thick >= 3.5 && lineEnds.thick <= 5.5, lineEnds.thick);
	await tool("矩形");
	await drag(along(P(0.72, 0.06), P(0.85, 0.24)));
	await hold(400);
	const rectGrips = await grips();
	check("a rectangle has a grip at all four corners (it had two)", rectGrips.length === 4, rectGrips);
	const before = await frame();
	const topRight = rectGrips.reduce((best, g) => (g.x - g.y > best.x - best.y ? g : best));
	await drag(along(topRight, { x: topRight.x + 40, y: topRight.y - 20 }, 8));
	await hold(400);
	const after = await frame();
	check("dragging its top-right grip widens it to the right and raises its top", Boolean(before && after && Math.abs(after.w - before.w - 40) <= 2 && Math.abs(before.y - after.y - 20) <= 2), { before, after });
	await shot("03_矩形四角手柄");
	const jitterBefore = await hash();
	await drag([P(0.6, 0.85), { x: P(0.6, 0).x + 2, y: P(0, 0.85).y + 1 }]);
	await hold(200);
	check("a click whose hand wobbled 2pt leaves no mark behind", same(await hash(), jitterBefore) && (await frame()) === null, { differ: differ(await hash(), jitterBefore) });
	await tool("圆形");
	await drag(along(P(0.87, 0.06), P(0.97, 0.22)), 8);
	await hold(400);
	const circle = await frame();
	check("an ellipse drawn with Shift is a circle", Boolean(circle && Math.abs(circle.w - circle.h) <= 2), circle);
	states.push(await hash());

	section("步骤标号");
	await tool("步骤标号");
	await press(P(0.06, 0.42));
	await press(P(0.12, 0.42));
	await hold(500);
	const badge = await ink({ x: P(0.12, 0).x - 30, y: P(0, 0.42).y - 30, w: 60, h: 60 }, "red");
	check("a step badge is about 28pt across at the middle size", badge.width >= 25 && badge.width <= 31, badge);
	await bubble("粗");
	await hold(400);
	const bigBadge = await ink({ x: P(0.12, 0).x - 40, y: P(0, 0.42).y - 40, w: 80, h: 80 }, "red");
	check("the size control resizes the selected badge", bigBadge.width > badge.width + 6, { before: badge.width, after: bigBadge.width });
	await bubble("中");
	states.push(await hash());

	section("文字");
	await tool("文字");
	const where = P(0.22, 0.42);
	await press(where);
	await until(`document.querySelector('${VIEWER} textarea')`, 5000);
	await typeText("123123123123 123");
	await hold(600);
	const field = await evaluate<{ font: number; left: number; lineMiddle: number; right: number; text: number }>(`(()=>{
		const f = document.querySelector('${VIEWER} textarea'); const r = f.getBoundingClientRect(); const cs = getComputedStyle(f);
		const pad = parseFloat(cs.paddingLeft); const line = parseFloat(cs.lineHeight);
		const s = document.createElement('span'); s.textContent = f.value; s.style.font = cs.font; s.style.whiteSpace = 'pre'; s.style.position = 'fixed'; document.body.append(s); const text = s.getBoundingClientRect().width; s.remove();
		return { font: parseFloat(cs.fontSize), left: +(r.left + pad).toFixed(1), lineMiddle: +(r.top + parseFloat(cs.paddingTop) + line / 2).toFixed(1), right: +r.right.toFixed(1), text: +text.toFixed(1) };
	})()`);
	check("the caption is typed at 22pt (was 12, smaller than the interface)", field.font === 22, field.font);
	check("the caret starts where the press landed: text at the point, first line centred on it", Math.abs(field.left - where.x) <= 2 && Math.abs(field.lineMiddle - where.y) <= 2, { press: where, textLeft: field.left, lineMiddle: field.lineMiddle });
	await shot("04_文字输入中_22pt");
	// A size picked while the caption is still being written applies to it at once, box and all.
	await bubble("粗");
	await hold(300);
	const grown = await evaluate<{ font: number; width: number }>(`(()=>{const f=document.querySelector('${VIEWER} textarea');return {font:parseFloat(getComputedStyle(f).fontSize),width:+f.getBoundingClientRect().width.toFixed(1)};})()`);
	check("picking 粗 while typing makes the caption 32pt, and its box widens to fit", Math.abs(grown.font - 32) <= 0.5 && grown.width > field.text * 1.3, grown);
	await bubble("中");
	await hold(300);
	await key("Escape", "Escape", 27);
	await hold(500);
	const typed = await ink({ x: where.x - 20, y: where.y - 30, w: field.text + 60, h: 60 }, "red");
	check("Escape keeps what was typed (it used to throw it away)", typed.count > 300 && !(await evaluate<boolean>(`Boolean(document.querySelector('${VIEWER} textarea'))`)), typed);
	check("the committed caption is as wide as it was in the field: same digits, same spacing", Math.abs(typed.width - field.text) / field.text < 0.04, { field: field.text, painted: typed.width });
	check("and it comes back selected, ready to move or restyle", (await frame()) !== null, await frame());
	await swatch("蓝色");
	await hold(300);
	const blueText = await ink({ x: where.x - 20, y: where.y - 30, w: field.text + 60, h: 60 }, "blue");
	check("picking blue recolours the selected caption", blueText.count > 300, blueText.count);
	await bubble("粗");
	await hold(400);
	const bigText = await ink({ x: where.x - 20, y: where.y - 40, w: field.text * 1.6 + 60, h: 90 }, "blue");
	check("the size control makes the selected caption larger (22 → 32pt)", bigText.height > blueText.height * 1.3, { before: blueText.height, after: bigText.height });
	await shot("05_文字选中后改成蓝色大号");
	const textMid = { x: Math.round((bigText.left + bigText.right) / 2), y: Math.round((bigText.top + bigText.bottom) / 2) };
	await drag(along(textMid, { x: textMid.x + 50, y: textMid.y + 36 }, 8));
	await hold(400);
	const movedText = await ink({ x: where.x - 20, y: where.y - 40, w: field.text * 1.6 + 140, h: 140 }, "blue");
	check("dragging the caption moves it", Math.abs(movedText.left - bigText.left - 50) <= 2 && Math.abs(movedText.top - bigText.top - 36) <= 2, { before: [bigText.left, bigText.top], after: [movedText.left, movedText.top] });
	await bubble("中");
	await swatch("红色");

	// A click beside the caption finishes it and does not open another one there.
	await press(P(0.22, 0.6));
	await until(`document.querySelector('${VIEWER} textarea')`, 5000);
	await typeText("第二条说明");
	await hold(300);
	await press(P(0.6, 0.92));
	await hold(400);
	const afterAway = await evaluate<boolean>(`Boolean(document.querySelector('${VIEWER} textarea'))`);
	const second = await ink({ x: P(0.2, 0).x, y: P(0, 0.55).y, w: 160, h: 50 }, "red");
	check("a click beside a caption finishes it, and opens no new box where it landed", !afterAway && second.count > 100, { fieldOpen: afterAway, inked: second.count });

	/*
	 * Reopened to add words, a caption keeps fitting them on one line; one undo takes the edit back.
	 * Turned blue first, so its pixels can be told from the red boat it grows towards.
	 */
	const firstRed = await ink({ x: where.x + 20, y: where.y + 10, w: 220, h: 50 }, "red");
	const firstAt = { x: Math.round((firstRed.left + firstRed.right) / 2), y: Math.round((firstRed.top + firstRed.bottom) / 2) };
	await tool("箭头");
	await press(firstAt);
	await swatch("蓝色");
	await hold(300);
	const lane = { x: firstRed.left - 10, y: firstRed.top - 8, w: 420, h: firstRed.height + 16 };
	const firstBefore = await ink(lane, "blue");
	await tool("文字");
	await press(firstAt);
	await until(`document.querySelector('${VIEWER} textarea')`, 5000);
	await typeText(" 再加几个字");
	await hold(300);
	const reopened = await evaluate<{ lines: number }>(`(()=>{const f=document.querySelector('${VIEWER} textarea');const cs=getComputedStyle(f);return {lines:Math.round((f.getBoundingClientRect().height-parseFloat(cs.paddingTop)*2)/parseFloat(cs.lineHeight))};})()`);
	await key("Escape", "Escape", 27);
	await hold(300);
	const firstAfter = await ink(lane, "blue");
	check("words added to a reopened caption widen it instead of wrapping it at its old width", reopened.lines === 1 && firstAfter.width > firstBefore.width + 60, { lines: reopened.lines, before: firstBefore.width, after: firstAfter.width });
	await key("z", "KeyZ", 90, 4);
	await hold(300);
	const firstUndone = await ink(lane, "blue");
	check("one undo takes the edit back: reopening it left no empty step in the history", Math.abs(firstUndone.width - firstBefore.width) <= 1.5, { before: firstBefore.width, undone: firstUndone.width });
	await swatch("红色");

	// Near the right edge the box moves in and wraps instead of running off the picture.
	await press(P(0.97, 0.33));
	await until(`document.querySelector('${VIEWER} textarea')`, 5000);
	await typeText("靠右边写一段比较长的说明，会在图片边上换行");
	await hold(400);
	const edge = await evaluate<{ left: number; right: number; lines: number }>(`(()=>{const f=document.querySelector('${VIEWER} textarea');const r=f.getBoundingClientRect();return {left:+r.left.toFixed(1),right:+r.right.toFixed(1),lines:Math.round((r.height-parseFloat(getComputedStyle(f).paddingTop)*2)/parseFloat(getComputedStyle(f).lineHeight))};})()`);
	check("a caption begun at the right edge grows to the left and stays on the picture, one line", edge.right <= image.x + image.w + 1 && edge.left < P(0.97, 0).x - 200 && edge.lines === 1, { fieldLeft: edge.left, fieldRight: edge.right, imageRight: Math.round(image.x + image.w), lines: edge.lines });
	await shot("06_靠右边的文字向左长不出图");
	await key("Enter", "Enter", 13, 4);
	await hold(300);
	check("⌘↵ finishes a caption", !(await evaluate<boolean>(`Boolean(document.querySelector('${VIEWER} textarea'))`)), "closed");

	// Picking another tool while typing finishes the caption too.
	await tool("文字");
	await press(P(0.06, 0.62));
	await until(`document.querySelector('${VIEWER} textarea')`, 5000);
	await typeText("换工具也会提交");
	await tool("箭头");
	await hold(400);
	const switched = await ink({ x: P(0.04, 0).x, y: P(0, 0.57).y, w: 180, h: 50 }, "red");
	check("picking another tool while typing commits the caption", !(await evaluate<boolean>(`Boolean(document.querySelector('${VIEWER} textarea'))`)) && switched.count > 100, switched.count);
	states.push(await hash());

	// Narrowed by its handle, a caption breaks its lines exactly where the field did — punctuation and all.
	await tool("文字");
	const narrowAt = P(0.08, 0.76);
	await press(narrowAt);
	await until(`document.querySelector('${VIEWER} textarea')`, 5000);
	await typeText("长的说明，会在图片边上换行（括号）");
	const handle = await centre(`${VIEWER} button[aria-label="调整文字宽度"]`);
	const fieldNow = await rect(`${VIEWER} textarea`);
	await drag(along(handle, { x: fieldNow!.x + 104, y: handle.y }, 10));
	await hold(400);
	const fieldLines = await evaluate<number>(`(()=>{const f=document.querySelector('${VIEWER} textarea');const cs=getComputedStyle(f);return Math.round((f.getBoundingClientRect().height-parseFloat(cs.paddingTop)*2)/parseFloat(cs.lineHeight));})()`);
	const narrowBox = await rect(`${VIEWER} textarea`);
	await key("Escape", "Escape", 27);
	await hold(400);
	const paintedLines = await evaluate<number>(`(()=>{
		const top = ${Math.round(narrowBox!.y)}, h = ${Math.round(narrowBox!.h + 10)};
		let bands = 0, inBand = false, gap = 0;
		for (let y = top; y < top + h; y++) { const b = window.__ap.ink(${Math.round(narrowBox!.x)}, y, ${Math.round(narrowBox!.w)}, 1, 'red'); if (b.count > 0) { if (!inBand) bands++; inBand = true; gap = 0; } else if (++gap > 2) inBand = false; }
		return bands;
	})()`);
	check("a narrowed caption is painted in as many lines as the field showed", fieldLines >= 3 && paintedLines === fieldLines, { field: fieldLines, painted: paintedLines });
	await shot("07_收窄的文字按标点断行");

	section("马赛克");
	await tool("马赛克");
	// The ring that shows the brush: its true size on screen, and nothing else on the picture changes.
	await mouse("mouseMoved", P(0.5, 0.9));
	await hold(300);
	const ring = await evaluate<{ size: number } | null>(`(()=>{const el=[...document.querySelectorAll('${VIEWER} span')].find((s)=>s.className.includes('bg-white/15'));if(!el)return null;return {size:+el.getBoundingClientRect().width.toFixed(1)};})()`);
	check("over the picture the mosaic shows a ring the size of its brush: 32pt at the middle size", Boolean(ring && Math.abs(ring.size - 32) <= 1), ring);
	// Over the second caption: covering words is what a mosaic is for.
	const redactBefore = await ink({ x: P(0.2, 0).x, y: P(0, 0.55).y, w: 170, h: 50 }, "red");
	await drag(along({ x: redactBefore.left - 6, y: Math.round((redactBefore.top + redactBefore.bottom) / 2) }, { x: redactBefore.right + 6, y: Math.round((redactBefore.top + redactBefore.bottom) / 2) }, 16));
	await hold(400);
	const redactAfter = await ink({ x: P(0.2, 0).x, y: P(0, 0.55).y, w: 170, h: 50 }, "red");
	check("a mosaic dragged across a caption leaves it unreadable", redactAfter.count < redactBefore.count * 0.4, { before: redactBefore.count, after: redactAfter.count });
	states.push(await hash());
	await drag(along(P(0.44, 0.66), P(0.6, 0.66), 16));
	await hold(500);
	const mosaicRow = await evaluate<{ runs: number[]; kx: number }>(`window.__ap.runs(${P(0.46, 0).x}, ${P(0, 0.665).y}, ${Math.round(image.w * 0.12)})`);
	const short = mosaicRow.runs.filter((n) => n < 3).length;
	check("the mosaic is solid blocks with no seams between them", short <= 2 && Math.max(...mosaicRow.runs) >= 16, { runs: mosaicRow.runs.slice(0, 14), seams: short });
	await shot("08_每个工具都画过一遍");
	states.push(await hash());

	section("撤销、重做、删除");
	const final = await hash();
	const dump = async (name: string) => {
		if (!process.env.LYRA_PROBE_DUMP) return;
		const url = await evaluate<string>(`document.querySelector('${CANVAS}').toDataURL('image/png')`);
		await writeFile(join(OUT, `dump-${name}.png`), Buffer.from(url.slice(22), "base64"));
	};
	await dump("final");
	await click('[data-annotate-bar] [data-ly-tip^="撤销"]');
	await hold(300);
	check("撤销 takes the mosaic back off", same(await hash(), states.at(-2)), { differ: differ(await hash(), states.at(-2)), fromFinal: differ(await hash(), final) });
	await click('[data-annotate-bar] [data-ly-tip^="重做"]');
	await hold(300);
	await dump("redo");
	check("重做 puts it back", same(await hash(), final), { differ: differ(await hash(), final) });
	await key("z", "KeyZ", 90, 4);
	await key("z", "KeyZ", 90, 12);
	check("⌘Z and ⇧⌘Z do the same", same(await hash(), final), { differ: differ(await hash(), final) });
	await tool("矩形");
	await press({ x: P(0.72, 0).x, y: P(0, 0.15).y });
	await hold(200);
	const selectedRect = await frame();
	await click('[data-annotate-bar] [data-ly-tip^="删除选中"]');
	await hold(300);
	const deleted = await hash();
	check("删除选中 removes the selected rectangle", selectedRect !== null && !same(deleted, final), { selected: selectedRect, differ: differ(deleted, final) });
	await key("z", "KeyZ", 90, 4);
	check("and undo brings it back", same(await hash(), final), { differ: differ(await hash(), final) });

	section("拖动工具栏");
	const barBefore = await rect("[data-annotate-bar]");
	const bubbleBefore = await rect("[data-toolbar-bubble]");
	const grip = await centre('[data-annotate-bar] button[aria-label="圆形"]');
	const activeBefore = await evaluate<string>(`document.querySelector('[data-annotate-bar] button[aria-pressed="true"]')?.getAttribute('aria-label')`);
	await mouse("mouseMoved", grip);
	await mouse("mousePressed", grip, { buttons: 1 });
	await pause(450);
	for (const p of along(grip, { x: grip.x - 120, y: grip.y - 560 }, 14)) {
		await mouse("mouseMoved", p, { buttons: 1 });
		await pause(16);
	}
	await mouse("mouseReleased", { x: grip.x - 120, y: grip.y - 560 });
	await hold(500);
	const barUp = await rect("[data-annotate-bar]");
	const bubbleUp = await rect("[data-toolbar-bubble]");
	const activeAfter = await evaluate<string>(`document.querySelector('[data-annotate-bar] button[aria-pressed="true"]')?.getAttribute('aria-label')`);
	check("holding a tool button and dragging carries the bar away", Boolean(barBefore && barUp && barBefore.y - barUp.y > 300), { before: barBefore, after: barUp });
	check("the size-and-colour bubble goes with it", Boolean(bubbleBefore && bubbleUp && barBefore && barUp && Math.abs(bubbleBefore.x - bubbleUp.x - (barBefore.x - barUp.x)) <= 1 && Math.abs(bubbleBefore.y - bubbleUp.y - (barBefore.y - barUp.y)) <= 1), { before: bubbleBefore, after: bubbleUp });
	check("letting go does not press the button it was held by", activeBefore === activeAfter, { before: activeBefore, after: activeAfter });
	check("with its bubble above it, it stays inside the window", Boolean(barUp && bubbleUp && bubbleUp.y >= 0 && barUp.x >= 0), { bar: barUp, bubble: bubbleUp });
	await shot("09_工具栏拖到图片上方");
	// Thrown at the right edge: clamped, bubble included.
	const gap = await centre("[data-annotate-bar] > div");
	await drag(along({ x: gap.x - 2, y: gap.y + 20 }, { x: gap.x + 900, y: gap.y + 20 }, 14));
	await hold(400);
	const clamped = await rect("[data-annotate-bar]");
	const clampedBubble = await rect("[data-toolbar-bubble]");
	const width = await evaluate<number>("innerWidth");
	check("dragged past the right edge it stops inside the window, bubble and all", Boolean(clamped && clampedBubble && clamped.right <= width && clampedBubble.right <= width), { bar: clamped?.right, bubble: clampedBubble?.right, window: width });
	// Dropped on the zoom control: it slides clear.
	const pill = await rect("[data-ly-viewer-zoom]");
	const holdAt = await centre('[data-annotate-bar] button[aria-label="画笔"]');
	await mouse("mouseMoved", holdAt);
	await mouse("mousePressed", holdAt, { buttons: 1 });
	await pause(450);
	const target = { x: pill!.x + 30, y: pill!.y + 20 };
	for (const p of along(holdAt, target, 16)) {
		await mouse("mouseMoved", p, { buttons: 1 });
		await pause(16);
	}
	await mouse("mouseReleased", target);
	await hold(700);
	const dropped = await rect("[data-annotate-bar]");
	const overlap = Boolean(dropped && pill && dropped.x < pill.right && dropped.right > pill.x && dropped.y < pill.bottom && dropped.bottom > pill.y);
	check("let go on top of the zoom control, it slides clear of it", !overlap, { bar: dropped, zoom: pill });
	await shot("10_工具栏放到缩放控件上会自己让开");

	section("放大到 195% 再看");
	for (let i = 0; i < 3; i++) await click(`${VIEWER} [data-ly-tip="放大"]`);
	await hold(700);
	const zoomed = await evaluate<{ backing: number[]; drawn: number[]; perDevicePx: number }>("window.__ap.backing()");
	check("zoomed in, the canvas still has a pixel for every device pixel", zoomed.perDevicePx >= 0.99, zoomed);
	const beforeZoomMark = await hash();
	await tool("矩形");
	// Blue, so it can be told apart from the red boat it is drawn over.
	await swatch("蓝色");
	// A rectangle drawn at this zoom, in the middle of the screen: it comes back selected.
	const mid = await evaluate<Point>("({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) })");
	await drag(along({ x: mid.x - 60, y: mid.y + 40 }, { x: mid.x + 60, y: mid.y + 120 }));
	await hold(400);
	const zoomGrips = await grips();
	const zoomFrame = await frame();
	check("at 195% the grips are still 10pt and the frame line 1pt: the editing chrome does not zoom with the picture", zoomGrips.length === 4 && zoomGrips.every((g) => Math.abs(g.size - 10) <= 1) && Boolean(zoomFrame && Math.abs(zoomFrame.border * 1.953 - 1) < 0.2), { grips: zoomGrips.map((g) => g.size), border: zoomFrame?.border });
	const zoomStroke = await ink({ x: mid.x - 70, y: mid.y + 60, w: 30, h: 40 }, "blue");
	check("and what is drawn there is the same mark, seen closer: 4pt × 1.95 on screen", zoomStroke.width >= 6.5 && zoomStroke.width <= 9.5, zoomStroke);
	await shot("11_放大到195%_手柄不跟着变大");
	await key("z", "KeyZ", 90, 4);
	check("undo takes it off again", same(await hash(), beforeZoomMark), { differ: differ(await hash(), beforeZoomMark) });
	await click(`${VIEWER} [data-ly-tip="适应窗口"]`);
	await hold(600);

	section("窗口变小");
	await grabber.send("Emulation.setDeviceMetricsOverride", { width: 980, height: 680, deviceScaleFactor: 0, mobile: false });
	await hold(800);
	const small = await rect("[data-annotate-bar]");
	const smallPill = await rect("[data-ly-viewer-zoom]");
	const smallOverlap = Boolean(small && smallPill && small.x < smallPill.right && small.right > smallPill.x && small.y < smallPill.bottom && small.bottom > smallPill.y);
	check("in a 980×680 window the bar is inside it and clear of the zoom control", Boolean(small && small.right <= 980 && small.bottom <= 680 && small.x >= 0 && !smallOverlap), { bar: small, zoom: smallPill });
	await shot("12_窗口变小后工具栏仍在窗口里");
	await grabber.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 0, mobile: false });
	await hold(800);

	section("退出再进来、完成");
	const kept = await hash();
	await click('[data-annotate-bar] [data-ly-tip="退出标注"]');
	await hold(600);
	check("退出标注 leaves annotation mode", !(await evaluate<boolean>(`Boolean(document.querySelector('${CANVAS}'))`)), "no canvas");
	await click(`${VIEWER} [data-ly-tip="标注"]`);
	await until(`document.querySelector('${CANVAS}')`, 10000);
	await hold(900);
	await evaluate(HELPERS);
	check("coming back in, the marks are still there", same(await hash(), kept), { differ: differ(await hash(), kept) });
	const size = await evaluate<number[]>("window.__ap.natural()");
	await shot("13_完成之前");
	await click('[data-annotate-bar] [data-ly-tip="放进输入框，让它照着改"]');
	await until(`!document.querySelector('${VIEWER}') && document.querySelector('[data-ly-attachments] img')`, 15000);
	await hold(900);
	const handed = await evaluate<{ width: number; height: number; diff: number; over: number }>(`(async()=>{
		const img = new Image(); img.src = document.querySelector('[data-ly-attachments] img').src; await img.decode();
		const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
		const g = c.getContext('2d'); g.drawImage(img, 0, 0);
		const a = g.getImageData(0, 0, c.width, c.height).data, b = window.__screenCopy.data;
		let sum = 0, over = 0, n = 0;
		if (a.length === b.length) for (let i = 0; i < a.length; i += 4) { const d = (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2])) / 3; sum += d; if (d > 40) over++; n++; }
		return { width: img.naturalWidth, height: img.naturalHeight, diff: n ? +(sum / n).toFixed(2) : -1, over: n ? +(over / n * 100).toFixed(3) : -1 };
	})()`);
	check("the copy handed to the composer is the picture's own size", handed.width === size[0] && handed.height === size[1], { copy: [handed.width, handed.height], picture: size });
	check("and it is what was on screen: mean difference under 2 levels, under 0.5% of pixels off by more than 40", handed.diff >= 0 && handed.diff < 2 && handed.over < 0.5, handed);
	await shot("14_完成后进了输入框");
	const exported = await evaluate<string>(`document.querySelector('[data-ly-attachments] img').src`);
	if (exported.startsWith("data:image/png;base64,")) await writeFile(join(OUT, `${stamp}_15_交出去的那张图.png`), Buffer.from(exported.slice(22), "base64"));
	grabber.close();
} catch (error) {
	check("probe ran to the end", false, error instanceof Error ? error.stack : String(error));
} finally {
	await stopRecording?.();
	await app?.stop();
	relay.close();
	const passed = checks.filter((c) => c.ok).length;
	await mkdir(OUT, { recursive: true });
	for (const one of shots) await writeFile(join(OUT, `${stamp}_${one.name}.png`), one.data);
	frames.sort((a, b) => a.at - b.at);
	if (frames.length > 1) await encode(frames, join(OUT, `${stamp}_每个工具逐个画一遍_${passed}of${checks.length}.mp4`), 30, 2500);
	console.log(`\n${passed}/${checks.length} passed — saved to ${OUT}`);
	process.exitCode = passed === checks.length ? 0 : 1;
}
