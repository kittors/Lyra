/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * Driving the screenshot overlay for real, and looking at what it produced.
 *
 * The overlay is a second window: the main one is what `startApp` attaches to, so this finds the
 * other page target and talks to it directly. Everything the overlay does is pointer work on a
 * canvas, which is exactly the kind of thing that typechecks, renders, and still does nothing —
 * so this presses the buttons rather than reading the code.
 *
 * Run: `node --experimental-strip-types e2e/screenshot-probe.ts`
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { startApp } from "./app.ts";

const execFileAsync = promisify(execFile);

const PORT = 9411;

/** Width and height out of a PNG's IHDR, which is the first chunk and always at a fixed offset. */
async function pngSize(path: string): Promise<{ width: number; height: number }> {
	const head = await readFile(path);
	return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

interface Target {
	title: string;
	type: string;
	url: string;
	webSocketDebuggerUrl?: string;
}

async function targets(): Promise<Target[]> {
	return (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())) as Target[];
}

/** One call, one socket — the same arrangement `app.ts` uses, for the same reason. */
async function call<T>(target: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
	const socket = new WebSocket(target);
	try {
		await new Promise((resolve, reject) => {
			socket.addEventListener("open", resolve, { once: true });
			socket.addEventListener("error", reject, { once: true });
		});
		const answer = new Promise<T>((resolve, reject) => {
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(String(event.data));
				if (message.id !== 1) return;
				if (message.error) reject(new Error(`${method}: ${message.error.message}`));
				else resolve(message.result as T);
			});
			setTimeout(() => reject(new Error(`${method} timed out`)), 30_000);
		});
		socket.send(JSON.stringify({ id: 1, method, params }));
		return await answer;
	} finally {
		socket.close();
	}
}

function evaluator(socket: string) {
	return async <T>(expression: string): Promise<T> => {
		const result = (await call(socket, "Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		})) as { exceptionDetails?: { text: string }; result?: { value: T } };
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
		return result.result?.value as T;
	};
}

/** A press, a path and a release, dispatched as real input rather than synthesised React events. */
async function drag(socket: string, from: [number, number], to: [number, number], steps = 8) {
	const mouse = (type: string, x: number, y: number) =>
		call(socket, "Input.dispatchMouseEvent", {
			type,
			x,
			y,
			button: "left",
			buttons: type === "mouseReleased" ? 0 : 1,
			clickCount: 1,
		});
	await mouse("mousePressed", from[0], from[1]);
	for (let i = 1; i <= steps; i++) {
		await mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
	}
	await mouse("mouseReleased", to[0], to[1]);
}

async function click(socket: string, x: number, y: number) {
	await call(socket, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
	await call(socket, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Whether the capture has ended, asked of the overlay page itself.
 *
 * There used to be a simpler answer: the overlay was destroyed when a capture finished, so "is its
 * debugger target still listed?" was the same question. It is not any more — the window is built
 * once and shown and hidden after that, because building one per capture took 147ms and the frozen
 * picture is taken *before* that wait, so the delay was visible as the desktop jumping backwards
 * when the overlay landed. The page reports which state it is in through `data-capture`.
 */
let captureOver: () => Promise<boolean> = async () => false;

/**
 * Press a toolbar button the way a person does: a real pointer press at its real coordinates.
 *
 * Not `element.click()`, and this distinction cost a release. A DOM click dispatches one `click`
 * event and no pointer events at all, so it cannot see anything that goes wrong on `pointerdown` —
 * and what was wrong was that pressing any tool button fell through to the overlay's own handler,
 * which read it as "pressed outside the selection", threw the selection away and went back to the
 * empty crosshair. Every button was broken in the shipped app while this file reported all green.
 */
async function pressTool(
	socket: string,
	run: <T>(expression: string) => Promise<T>,
	tip: string,
): Promise<{ x: number; y: number } | null> {
	const at = await run<{ x: number; y: number } | null>(`(() => {
		const b = [...document.querySelectorAll("button[data-ly-tip]")].find(b => b.dataset.lyTip.startsWith(${JSON.stringify(tip)}));
		if (!b) return null;
		const r = b.getBoundingClientRect();
		if (!r.width || !r.height) return null;
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
	})()`);
	if (!at) return null;
	await call(socket, "Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
	await call(socket, "Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
	return at;
}

/**
 * Which application is frontmost, according to the window server.
 *
 * `lsappinfo` rather than AppleScript: it needs no accessibility grant, so it works on a machine
 * where nobody has clicked through a permission dialog for the test runner. macOS only — elsewhere
 * this returns null and the check is skipped, which is honest about what it covers.
 */
async function frontmostApp(): Promise<string | null> {
	if (process.platform !== "darwin") return null;
	try {
		const { stdout: asn } = await execFileAsync("lsappinfo", ["front"]);
		const { stdout } = await execFileAsync("lsappinfo", ["info", "-only", "name", asn.trim()]);
		return /"LSDisplayName"="(.*)"/.exec(stdout.trim())?.[1] ?? null;
	} catch {
		return null;
	}
}

/** Where the finished screenshot should land, so the export can be checked as a file on disk. */
let shots = "";
/** The app's own directory for this run, so the capture log can be read back at the end. */
let home = "";
/** The main process's account of what it did, read out before the directory is deleted. */
let timeline = "";
const app = await startApp({
	port: PORT,
	seed: async (dir) => {
		home = dir;
		shots = join(dir, "shots");
		await mkdir(shots, { recursive: true });
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({ screenshot: { saveLocation: shots, copyToClipboard: false, openEditor: false } }, null, 2),
		);
	},
});
const problems: string[] = [];
const note = (line: string) => {
	console.log(line);
};

try {
	/*
	 * Let the warm-up finish before asking for anything.
	 *
	 * Both halves of it run three seconds after launch: the overlay window is built, and one
	 * screenshot is taken and thrown away so macOS has a ScreenCaptureKit stream ready. Measuring
	 * the very first capture of a cold process measures the warm-up itself, which is not what
	 * anybody experiences — by the time a person presses the shortcut, the app has been open for
	 * more than three seconds.
	 */
	await pause(4500);
	note("• 主窗口已启动，请求打开截图浮层…");
	/*
	 * Watch the *main* window while the overlay comes up.
	 *
	 * The report is that the whole page jumps on entry, and the page in question is this one — the
	 * overlay covers the screen, so anything moving underneath it is the app being relaid out. On
	 * macOS that is what switching the process between `regular` and `accessory` does, which is
	 * exactly what `setVisibleOnAllWorkspaces` used to trigger. Sampled on a timer rather than a
	 * frame callback: a still page stops producing frames, and this one is meant to be still.
	 */
	await app.evaluate(`(() => {
		window.__mainLayout = [];
		const tick = () => {
			if (window.__mainLayout.length >= 60) return;
			window.__mainLayout.push({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio });
			setTimeout(tick, 16);
		};
		tick();
		return true;
	})()`);
	await app.evaluate(`window.lyra.screenshot.start()`);

	// The overlay only shows itself once its snapshot is painted, so give it a moment to appear.
	let overlay: Target | undefined;
	for (let i = 0; i < 40 && !overlay; i++) {
		await pause(250);
		overlay = (await targets()).find((t) => t.type === "page" && t.url.includes("screenshot-overlay"));
	}
	if (!overlay?.webSocketDebuggerUrl) throw new Error("截图浮层窗口没有出现");
	const socket = overlay.webSocketDebuggerUrl;
	const run = evaluator(socket);
	note("• 浮层窗口已出现");
	captureOver = async () =>
		await run<boolean>(`document.querySelector('[data-capture="active"]') === null`).catch(() => true);

	// Anything the renderer throws, kept where the probe can read it at the end. A React effect that
	// throws leaves a half-painted canvas and no other trace.
	/*
	 * Wait for the document before putting anything on `window`.
	 *
	 * The debugger target exists from the moment the page is created, so an injection made too
	 * early is thrown away by the navigation that follows it — which is why the frame recorder
	 * below came back empty. Loading is not showing: this completes while the window is still
	 * hidden, which is exactly the window of opportunity that is wanted.
	 */
	for (let i = 0; i < 60; i++) {
		if (await run<boolean>(`document.readyState === "complete"`)) break;
		await pause(100);
	}

	/*
	 * Record the dimming's opacity every frame, starting now.
	 *
	 * `requestAnimationFrame` is exactly the right clock for this: a hidden window is not
	 * composited, so nothing is recorded until the moment it is shown — which is when the fade
	 * begins. Sampling over the debugger instead would race the 160ms transition and mostly miss it.
	 */
	/*
	 * Sampled on a timer, not on animation frames.
	 *
	 * A page with nothing moving stops producing frames, so `requestAnimationFrame` recorded one
	 * sample and stopped — which reads as "no fade" and "no jump" whatever is actually happening.
	 * A timer keeps counting while the window is still hidden too, which is what makes the entry
	 * transition visible here at all: the first samples are from before it was shown.
	 */
	await run(`(() => {
		window.__layout = [];
		window.__fade = [];
		const tick = () => {
			if (window.__layout.length >= 150) return;
			const c = document.querySelector("canvas");
			window.__layout.push({
				w: window.innerWidth, h: window.innerHeight,
				cw: c ? Math.round(c.getBoundingClientRect().width) : 0,
				ch: c ? Math.round(c.getBoundingClientRect().height) : 0,
			});
			const el = [...document.querySelectorAll("div")].find(d => d.style.opacity !== "" && String(d.style.transition).includes("opacity"));
			if (el) window.__fade.push(Number(getComputedStyle(el).opacity));
			setTimeout(tick, 16);
		};
		tick();
	})()`);

	await run(`(() => {
		window.__probeErrors = [];
		window.addEventListener("error", (e) => window.__probeErrors.push(String(e.message)));
		window.addEventListener("unhandledrejection", (e) => window.__probeErrors.push("rejected: " + e.reason));
		const err = console.error.bind(console);
		console.error = (...a) => { window.__probeErrors.push(a.map(String).join(" ")); err(...a); };
	})()`);

	const painted = await run<{ w: number; h: number; blank: boolean; css: number; dpr: number }>(`(() => {
		const c = document.querySelector("canvas");
		if (!c) return { w: 0, h: 0, blank: true, css: 0, dpr: 0 };
		const ctx = c.getContext("2d");
		const d = ctx.getImageData(0, 0, Math.min(200, c.width), Math.min(200, c.height)).data;
		let blank = true;
		for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) { blank = false; break; }
		return { w: c.width, h: c.height, blank, css: window.innerWidth, dpr: window.devicePixelRatio };
	})()`);
	note(`  背景画布 ${painted.w}×${painted.h}，${painted.blank ? "空白" : "已绘制屏幕快照"}`);
	if (painted.blank) problems.push("背景快照没有画出来");
	/*
	 * The backdrop's bitmap has to be the capture's own pixel count, not the display's logical size.
	 *
	 * Sized logically, a Retina snapshot is squeezed to half resolution and stretched back over the
	 * screen — the frozen desktop goes visibly soft the moment the overlay appears, which reads as
	 * the capture itself being low quality.
	 */
	const wantBacking = Math.round(painted.css * painted.dpr);
	note(`     位图 ${painted.w} vs 物理像素 ${wantBacking}（dpr ${painted.dpr}）`);
	if (Math.abs(painted.w - wantBacking) > 1) {
		problems.push(`背景画布不是物理分辨率：位图 ${painted.w}，屏幕 ${wantBacking}`);
	}

	// ---- 1. 拉出一个选区 -------------------------------------------------
	/*
	 * Wait for the window to be its full size before pressing anything.
	 *
	 * The overlay appears in the target list before it has been shown, and `clampRect` clamps the
	 * selection to `window.innerHeight` — so a drag dispatched too early is trimmed to whatever the
	 * window measured at the time, which showed up as an intermittent short selection.
	 */
	/*
	 * Wait for the window to actually be on screen, not merely to exist.
	 *
	 * The overlay is created with `show: false` and revealed only once the renderer says the
	 * snapshot is painted, so its debugger target is listed well before it is visible. Pointer
	 * events dispatched into a window that has not been shown go nowhere useful, which showed up
	 * as the first drag intermittently producing no selection at all — a flaky probe reporting a
	 * real feature as broken, and worse, sometimes reporting a broken one as fine.
	 */
	let visible = false;
	for (let i = 0; i < 60 && !visible; i++) {
		visible = await run<boolean>(`document.visibilityState === "visible" && !document.hidden`);
		if (!visible) await pause(100);
	}
	if (!visible) problems.push("浮层窗口一直没有显示出来");

	/*
	 * The way in is a fade, not a cut.
	 *
	 * Sampled the instant the window becomes visible, because that is when the transition starts —
	 * the complaint is that capture mode arrives all at once. A dimming layer that reads 1 on the
	 * very first sample never animated: it was already at its end state, which is what happens when
	 * the transition is started while the page is still hidden and has no frames to run in.
	 */
	/*
	 * Whether anything moves while the overlay is coming up.
	 *
	 * The report is that the whole page jumps on entry. Recorded frame by frame from the moment the
	 * window is shown: the backdrop covers the screen and the window is a fixed size, so every one
	 * of these should be identical from the first frame. A value that changes is the jump.
	 */
	const layout = await run<{ w: number; h: number; cw: number; ch: number }[]>(`window.__layout ?? []`);
	const shifted = layout.filter((l, i) => i > 0 && (l.w !== layout[0].w || l.h !== layout[0].h || l.cw !== layout[0].cw || l.ch !== layout[0].ch));
	note(`     浮层自身尺寸 → ${layout.length ? `${layout[0].w}×${layout[0].h}，画布 ${layout[0].cw}×${layout[0].ch}` : "(没采到)"}`);
	if (shifted.length > 0) {
		problems.push(`浮层进入时尺寸发生了跳动：例如 ${JSON.stringify(shifted[0])} vs 首帧 ${JSON.stringify(layout[0])}`);
	}
	/*
	 * The window must be the whole display from its very first sample.
	 *
	 * A window is created inside the work area — the screen minus the menu bar and the Dock — so a
	 * capture that has not re-asserted its bounds opens slightly inset and then snaps outwards. On
	 * screen that is the whole desktop appearing to scale for a moment.
	 */
	const display = await run<{ w: number; h: number }>(`({ w: screen.width, h: screen.height })`);
	if (layout.length && (layout[0].w < display.w || layout[0].h < display.h)) {
		problems.push(
			`浮层第一帧没有铺满屏幕：${layout[0].w}×${layout[0].h}，屏幕 ${display.w}×${display.h}——进入时会看到一次缩放`,
		);
	}

	const mainLayout = await app.evaluate<{ w: number; h: number; dpr: number }[]>(`window.__mainLayout ?? []`);
	const relaid = mainLayout.filter((l) => l.w !== mainLayout[0]?.w || l.h !== mainLayout[0]?.h || l.dpr !== mainLayout[0]?.dpr);
	note(`     主窗口在浮层弹出期间 → 采样 ${mainLayout.length} 次，${relaid.length === 0 ? "尺寸始终不变" : `有 ${relaid.length} 次变了`}`);
	if (relaid.length > 0) {
		problems.push(
			`浮层弹出时主窗口被重新布局了（${JSON.stringify(relaid[0])} vs ${JSON.stringify(mainLayout[0])}）——这就是「整个页面跳动」`,
		);
	}

	let stable = 0;
	let last = 0;
	for (let i = 0; i < 30 && stable < 3; i++) {
		const tall = await run<number>(`window.innerHeight`);
		stable = tall === last && tall > 700 ? stable + 1 : 0;
		last = tall;
		await pause(100);
	}
	// And let the way-in finish, so nothing below is racing a transition.
	await pause(250);
	note(`  0. 窗口已显示，高度稳定在 ${last}`);

	// ---- 0b. 指向一个窗口就提示整窗截图 -----------------------------------
	/*
	 * The common case for a screenshot is "this window", and framing one by hand is both slower and
	 * less accurate than the window's own bounds. Checked by moving the pointer over the middle of
	 * the screen — where the app under test has its own window — and looking for the offer.
	 */
	await call(socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(last * 0.7), y: Math.round(last * 0.45) });
	await pause(200);
	const offered = await run<{ w: number; h: number; label: string } | null>(`(() => {
		const frame = document.querySelector('[data-window-highlight]');
		if (!frame) return null;
		const r = frame.getBoundingClientRect();
		return { w: Math.round(r.width), h: Math.round(r.height), label: (frame.textContent || "").trim() };
	})()`);
	/*
	 * The loupe reports the pixel under the crosshair, and its colour.
	 *
	 * Checked before a region exists, which is the only time it is up: afterwards a magnifier
	 * following the pointer is in the way of the drawing rather than in aid of it.
	 */
	const loupe = await run<{ coord: string; hex: string } | null>(`(() => {
		const el = document.querySelector("[data-loupe]");
		if (!el) return null;
		const text = (el.textContent || "").replace(/\\s+/g, " ");
		return { coord: (/坐标\\s*([0-9]+,\\s*[0-9]+)/.exec(text) || [])[1] || "", hex: (/(#[0-9A-F]{6})/.exec(text) || [])[1] || "" };
	})()`);
	note(`  0c. 取色放大镜 → ${loupe ? `坐标 ${loupe.coord || "?"}，色值 ${loupe.hex || "?"}` : "没有出现"}`);
	if (!loupe) problems.push("移动鼠标时没有出现取色放大镜");
	else {
		if (!/^\d+, \d+$/.test(loupe.coord)) problems.push(`放大镜没有报出坐标：「${loupe.coord}」`);
		if (!/^#[0-9A-F]{6}$/.test(loupe.hex)) problems.push(`放大镜没有报出色值：「${loupe.hex}」`);
	}

	const windowCount = await run<number>(`Number(document.querySelector("[data-window-count]")?.dataset.windowCount ?? -1)`);
	note(`  0b. 指向窗口 → ${offered ? `${offered.w}×${offered.h}，标注「${offered.label}」` : "没有提示整窗"}（浮层收到 ${windowCount} 个窗口）`);
	if (!offered) {
		problems.push("鼠标指向窗口时没有高亮出整个窗口——进入截图应该默认可以点选窗口");
	} else {
		if (offered.w < 100 || offered.h < 100) problems.push(`提示的窗口太小，不像真的窗口：${offered.w}×${offered.h}`);
		if (!/\d+\s*×\s*\d+/.test(offered.label)) problems.push(`窗口高亮上没有显示尺寸：「${offered.label}」`);
	}

	/*
	 * And a press without a drag takes it. The two gestures share a beginning and are told apart by
	 * what happened next, so this is the half that a drag test can never cover.
	 */
	if (offered) {
		await click(socket, Math.round(last * 0.7), Math.round(last * 0.45));
		await pause(250);
		const taken = await run<{ w: number; h: number } | null>(`(() => {
			const box = document.querySelector('[data-selection]');
			if (!box) return null;
			const r = box.getBoundingClientRect();
			return { w: Math.round(r.width), h: Math.round(r.height) };
		})()`);
		note(`      单击之后的选区 → ${taken ? `${taken.w}×${taken.h}` : "没有选区"}`);
		if (!taken) problems.push("点击窗口没有把它变成选区");
		else if (Math.abs(taken.w - offered.w) > 4 || Math.abs(taken.h - offered.h) > 4) {
			problems.push(`点击之后的选区和提示的窗口对不上：${taken.w}×${taken.h} vs ${offered.w}×${offered.h}`);
		}
		/*
		 * Back to a blank slate — by starting over, not by pressing outside.
		 *
		 * Pressing outside used to throw the region away and begin a new one, and this probe relied
		 * on it. That is exactly the behaviour that was removed: a press a few pixels wide of the
		 * frame, on the way to the toolbar, should not cost a framed region and everything drawn on
		 * it. Outside is inert now, so the way back to nothing is to cancel and open again — which is
		 * also the only way a person has.
		 */
		await app.evaluate(`window.lyra.screenshot.cancel()`);
		await pause(700);
		await app.evaluate(`window.lyra.screenshot.start()`);
		for (let i = 0; i < 40; i++) {
			await pause(200);
			if (!(await captureOver())) break;
		}
		await pause(400);
		await call(socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(last * 0.7), y: Math.round(last * 0.45) });
		await pause(250);
	}

	/*
	 * ⌘C takes the colour, says so, and ends the capture.
	 *
	 * Taking a value is the whole errand — there is nothing left to frame afterwards — so staying in
	 * capture mode would leave the user dismissing something they are already done with.
	 */
	await call(socket, "Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "c",
		code: "KeyC",
		modifiers: 4,
		windowsVirtualKeyCode: 67,
		nativeVirtualKeyCode: 67,
	});
	await pause(300);
	const said = await run<string>(`(() => {
		const el = [...document.querySelectorAll("span")].find(d => (d.textContent || "").trim() === "已复制色值");
		return el ? "有" : "没有";
	})()`).catch(() => "读不到");
	note(`      ⌘C → 提示「已复制色值」${said}`);
	if (said !== "有") problems.push("按 ⌘C 之后没有出现「已复制色值」的提示");

	/*
	 * And again, because the second colour pick is where this broke.
	 *
	 * `toastLeaving` was added to the toast's fade and to neither reset path, so the first pick set
	 * it and nothing cleared it — every pick after the first rendered 「已复制色值」 at `opacity: 0`.
	 * One capture is not enough to catch that class of bug now that the page outlives the capture.
	 */
	const secondPick = { checked: false, seen: false };

	/*
	 * The capture leaves at once; the confirmation does not.
	 *
	 * Taking a colour used to hold the whole frozen screen up for 850ms before it even started
	 * leaving, so the message could be read — nearly a second of an unresponsive-looking desktop
	 * after the errand was already done. It should go the way Escape goes, and leave the message
	 * behind over the real screen. Measured 300ms in: by then the frozen picture must be gone and
	 * the message must still be there.
	 */
	const handover = await run<{ frozen: string | null; toast: boolean }>(`(() => {
		const c = document.querySelector("canvas");
		return {
			frozen: c ? getComputedStyle(c).opacity : null,
			toast: [...document.querySelectorAll("span")].some(d => (d.textContent || "").trim() === "已复制色值"),
		};
	})()`).catch(() => ({ frozen: null, toast: false }));
	note(`      取色 300ms 后 → 冻结画面透明度 ${handover.frozen ?? "?"}，提示${handover.toast ? "还在" : "已经没了"}`);
	if (handover.frozen !== "0") {
		problems.push(`取色之后冻结画面还盖着屏幕（透明度 ${handover.frozen ?? "?"}）——截图应该像按 Esc 一样立刻退出`);
	}
	if (!handover.toast) problems.push("取色提示消失得太早——它应该在截图退出之后还留一会儿");
	await pause(1400);
	/*
	 * "Is the capture over?", asked of the page rather than of the debugger.
	 *
	 * The overlay window is built once and then shown and hidden — it is not destroyed between
	 * captures any more, because building one cost 147ms that was visible as the desktop jumping.
	 * So its target is listed whether a capture is running or not, and the old check here reported
	 * every capture as "still open" no matter what the app did.
	 */
	const closedAfterCopy = await captureOver();
	note(`      ⌘C 之后浮层${closedAfterCopy ? "已退出" : "还开着"}`);
	if (!closedAfterCopy) problems.push("取完色之后没有自动退出截图");

	/*
	 * Everything below needs a capture again — in the same window, which is the point.
	 *
	 * The socket does not change: one window serves every capture now. What is waited for is the
	 * page reporting itself back in capture mode, which is the only outward sign that the new
	 * session's init actually arrived.
	 */
	/*
	 * The sampler goes in *before* the trigger, which it did not have to before.
	 *
	 * The fade lasts 160ms and the overlay now appears about 170ms after the shortcut, so installing
	 * a recorder after asking for the capture arrives at the end of the transition and reads two
	 * samples of its final value — "no fade", from a probe that was simply too late. The window is
	 * the same one across captures now, so this can be armed while the last capture is closed.
	 */
	await run(`(() => {
		window.__fade = [];
		const tick = () => {
			if (window.__fade.length >= 120) return;
			const el = [...document.querySelectorAll("div")].find(d => d.style.opacity !== "" && String(d.style.transition).includes("opacity"));
			if (el) window.__fade.push(Number(getComputedStyle(el).opacity));
			setTimeout(tick, 16);
		};
		tick();
	})()`);
	await app.evaluate(`window.lyra.screenshot.start()`);
	let reopened = false;
	for (let i = 0; i < 40 && !reopened; i++) {
		await pause(250);
		reopened = !(await captureOver());
	}
	if (!reopened) throw new Error("取色之后再开截图失败");
	await pause(400);

	/*
	 * The way in is a fade, not a cut.
	 *
	 * A dimming layer that reads 1 on its very first sample never animated: it was already at its
	 * end state, which is what happens when the transition is started while the page is still
	 * hidden and has no frames to run in.
	 */
	const fade = await run<number[]>(`window.__fade ?? []`);
	const spread = fade.length ? `${Math.min(...fade).toFixed(2)} → ${Math.max(...fade).toFixed(2)}` : "(没采到)";
	note(`  0d. 进入时的遮罩透明度 → ${spread}（${fade.length} 次采样）`);
	if (fade.length === 0) problems.push("采不到遮罩的透明度，淡入无法验证");
	else if (Math.min(...fade) >= 1) problems.push("浮层是直接跳到最终状态的，没有淡入过渡");
	else if (Math.max(...fade) < 0.99) problems.push(`淡入没有走完，遮罩最高只到 ${Math.max(...fade).toFixed(2)}`);

	/*
	 * The second colour pick, which is the one that broke.
	 *
	 * Everything about a capture used to be new because the page was new. It is not any more, and
	 * the failure that follows is invisible to a probe that only ever does something once:
	 * `toastLeaving` was added to the toast's fade and to neither reset path, so the first pick set
	 * it, nothing cleared it, and from the second pick onwards 「已复制色值」 rendered at
	 * `opacity: 0` — present in the DOM, never seen.
	 *
	 * So the *computed* opacity is what is checked, not whether the element exists.
	 */
	await call(socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 420 });
	await pause(200);
	await call(socket, "Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "c",
		code: "KeyC",
		modifiers: 4,
		windowsVirtualKeyCode: 67,
		nativeVirtualKeyCode: 67,
	});
	await pause(300);
	const secondToast = await run<{ present: boolean; opacity: string | null }>(`(() => {
		const el = [...document.querySelectorAll("span")].find(d => (d.textContent || "").trim() === "已复制色值");
		if (!el) return { present: false, opacity: null };
		const layer = el.closest("div[style*='opacity']") || el.parentElement?.parentElement;
		return { present: true, opacity: layer ? getComputedStyle(layer).opacity : null };
	})()`).catch(() => ({ present: false, opacity: null }));
	secondPick.checked = true;
	secondPick.seen = secondToast.present && secondToast.opacity !== "0";
	note(`      第二次取色 → 提示${secondToast.present ? "在 DOM 里" : "不存在"}，透明度 ${secondToast.opacity ?? "?"}`);
	if (!secondToast.present) problems.push("第二次取色时没有出现「已复制色值」");
	else if (secondToast.opacity === "0") {
		problems.push("第二次取色的提示透明度是 0——它在 DOM 里但完全看不见（上一次取色的淡出状态没有被重置）");
	}

	// And back into a capture for the annotation checks below.
	await pause(1400);
	await app.evaluate(`window.lyra.screenshot.start()`);
	let thirdOpen = false;
	for (let i = 0; i < 40 && !thirdOpen; i++) {
		await pause(250);
		thirdOpen = !(await captureOver());
	}
	if (!thirdOpen) throw new Error("第二次取色之后再开截图失败");
	await pause(300);

	await drag(socket, [300, 220], [900, 620]);
	await pause(150);
	const drawn = await run<{ x: number; y: number; w: number; h: number } | null>(`(() => {
		const box = document.querySelector('[data-selection]');
		if (!box) return null;
		const r = box.getBoundingClientRect();
		return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
	})()`);
	note(`  1. 拉选区 → ${drawn ? `${drawn.x},${drawn.y} ${drawn.w}×${drawn.h}` : "没有选区"}`);
	if (!drawn || drawn.w < 500 || drawn.h < 300) problems.push("拖拽没有拉出预期大小的选区");

	// ---- 2. 八个手柄 -----------------------------------------------------
	const handles = await run<number>(`document.querySelectorAll('[data-selection-handle]').length`);
	note(`  2. 手柄 → ${handles} 个`);
	if (handles !== 8) problems.push(`应该有 8 个缩放手柄，实际 ${handles} 个`);

	// ---- 3. 工具条在选区左下方 -------------------------------------------
	const bar = await run<{ x: number; y: number; w: number } | null>(`(() => {
		const el = document.querySelector('[class*="1c1c1e"]');
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
	})()`);
	note(`  3. 工具条 → ${bar ? `${bar.x},${bar.y} 宽 ${bar.w}` : "没有出现"}`);
	// A capture bar is a palette, not a desktop toolbar. 742pt was most of a laptop's screen.
	if (bar && bar.w > 660) problems.push(`工具条太宽了：${bar.w}pt`);
	/*
	 * Every control has to be reachable, which means the whole bar has to be on screen.
	 *
	 * It is placed by clamping against a declared width, so a declared width that has drifted from
	 * the real one pushes the far end — 完成 among them — past the edge of the display, where no
	 * pointer can go. Checked per button rather than on the bar as a whole, because that is the
	 * thing that actually has to be clickable.
	 */
	const offscreen = await run<{ tip: string; x: number; right: number }[]>(`(() => {
		const out = [];
		for (const b of document.querySelectorAll("button[data-ly-tip]")) {
			const r = b.getBoundingClientRect();
			if (r.width === 0 && r.height === 0) continue;
			if (r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight) {
				out.push({ tip: b.dataset.lyTip, x: Math.round(r.left), right: Math.round(r.right) });
			}
		}
		return out;
	})()`);
	note(`     控件是否都在屏幕内 → ${offscreen.length === 0 ? "是" : `${offscreen.length} 个跑到屏幕外`}`);
	if (offscreen.length > 0) {
		problems.push(`工具条有 ${offscreen.length} 个控件在屏幕外点不到：${offscreen.map((o) => o.tip).join("、")}（窗口宽 ${await run<number>(`window.innerWidth`)}）`);
	}
	if (!bar) problems.push("工具条没有出现");
	else {
		// Right-aligned: cancel and confirm end up under the hand that just finished the drag.
		const wantRight = (drawn?.x ?? 0) + (drawn?.w ?? 0);
		if (Math.abs(bar.x + bar.w - wantRight) > 2) {
			problems.push(`工具条没有和选区右边缘对齐（右边缘 ${bar.x + bar.w} vs 选区 ${wantRight}）`);
		}
		if (bar.y < (drawn?.y ?? 0) + (drawn?.h ?? 0)) problems.push("工具条没有落在选区下方");
	}

	// ---- 3b. 标注画布正好盖住选区 ----------------------------------------
	/*
	 * The one thing a screenshot annotator cannot get wrong.
	 *
	 * The canvas is the whole screen, shifted up and left by the selection's offset and clipped to
	 * it, so in viewport terms it should sit at the origin at exactly window size. Left to lay out
	 * at its own bitmap's size it is `devicePixelRatio` times too big — on a Retina screen the marks
	 * land at twice the distance from the corner that the pointer was, and three quarters of the
	 * region being annotated is outside the frame. That is invisible to a typecheck and to every
	 * other assertion in this file.
	 */
	const canvasFit = await run<{ x: number; y: number; w: number; h: number; bitmap: number; win: number; dpr: number } | null>(`(() => {
		const cs = document.querySelectorAll("canvas");
		const c = cs[cs.length - 1];
		if (!c || cs.length < 2) return null;
		const r = c.getBoundingClientRect();
		return {
			x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
			bitmap: c.width, win: window.innerWidth, dpr: window.devicePixelRatio,
		};
	})()`);
	note(`  3b. 标注画布 → ${canvasFit ? `${canvasFit.x},${canvasFit.y} ${canvasFit.w}×${canvasFit.h}（位图 ${canvasFit.bitmap}，窗口 ${canvasFit.win}，dpr ${canvasFit.dpr}）` : "没有出现"}`);
	if (!canvasFit) problems.push("框选之后标注画布没有挂上");
	else {
		if (Math.abs(canvasFit.x) > 1 || Math.abs(canvasFit.y) > 1) {
			problems.push(`标注画布没有和屏幕对齐：落在 ${canvasFit.x},${canvasFit.y}`);
		}
		if (Math.abs(canvasFit.w - canvasFit.win) > 1) {
			problems.push(`标注画布的显示尺寸不等于屏幕：${canvasFit.w} vs ${canvasFit.win}（dpr ${canvasFit.dpr}）`);
		}
		if (Math.abs(canvasFit.bitmap - canvasFit.win * canvasFit.dpr) > 1) {
			problems.push(`标注画布的位图不是物理分辨率：${canvasFit.bitmap}`);
		}
	}

	// ---- 4. 拖动选区边缘整体移动 -----------------------------------------
	/*
	 * The edge, not the middle.
	 *
	 * Once there is something to annotate the inside of the selection belongs to the pen — a press
	 * there draws, which is the whole point of it. The region is picked up by its border instead.
	 *
	 * A quarter of the way along, not the middle: the middle of each edge is a resize handle, and
	 * grabbing one of those resizes rather than moves — which is correct, and not what this checks.
	 */
	await drag(socket, [drawn!.x + drawn!.w * 0.25, drawn!.y + 2], [drawn!.x + drawn!.w * 0.25 + 60, drawn!.y + 52]);
	await pause(150);
	const moved = await run<{ x: number; y: number; w: number; h: number } | null>(`(() => {
		const box = document.querySelector('[data-selection]');
		if (!box) return null;
		const r = box.getBoundingClientRect();
		return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
	})()`);
	note(`  4. 拖边缘移动 → ${moved ? `${moved.x},${moved.y} ${moved.w}×${moved.h}` : "选区没了"}`);
	if (!moved) problems.push("拖动选区边缘把选区弄丢了");
	else {
		if (Math.abs(moved.x - (drawn!.x + 60)) > 3 || Math.abs(moved.y - (drawn!.y + 50)) > 3) {
			problems.push(`选区没有跟着指针移动（期望 ${drawn!.x + 60},${drawn!.y + 50}，实际 ${moved.x},${moved.y}）`);
		}
		if (moved.w !== drawn!.w || moved.h !== drawn!.h) problems.push("移动选区时尺寸变了");
	}

	// ---- 5. 拖右下角手柄缩放 ---------------------------------------------
	const corner: [number, number] = [moved!.x + moved!.w, moved!.y + moved!.h];
	await drag(socket, corner, [corner[0] + 80, corner[1] + 60]);
	await pause(150);
	const resized = await run<{ w: number; h: number } | null>(`(() => {
		const box = document.querySelector('[data-selection]');
		if (!box) return null;
		const r = box.getBoundingClientRect();
		return { w: Math.round(r.width), h: Math.round(r.height) };
	})()`);
	note(`  5. 拖右下角 → ${resized ? `${resized.w}×${resized.h}` : "选区没了"}`);
	if (!resized || Math.abs(resized.w - (moved!.w + 80)) > 3 || Math.abs(resized.h - (moved!.h + 60)) > 3) {
		problems.push(`拖手柄没有把选区放大到预期尺寸（实际 ${resized?.w}×${resized?.h}）`);
	}

	/*
	 * Outside a region that already exists is a dead zone.
	 *
	 * It used to begin a new region, which threw away the framed one and every mark on it — easy to
	 * trigger with a press a few pixels wide of the frame while reaching for the toolbar. Checked by
	 * dragging well outside and confirming the region did not move, and that the cursor out there
	 * says nothing is on offer.
	 */
	const readSel = () =>
		run<{ x: number; y: number; w: number; h: number } | null>(`(() => {
			const box = document.querySelector('[data-selection]');
			if (!box) return null;
			const r = box.getBoundingClientRect();
			return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
		})()`);
	const beforeOutside = await readSel();
	await call(socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 60, y: 60 });
	await pause(150);
	const outsideCursor = await run<string>(`getComputedStyle(document.querySelector('[data-capture="active"]')).cursor`).catch(() => "?");
	await drag(socket, [60, 60], [240, 200]);
	await pause(250);
	const afterOutside = await readSel();
	note(`  5b. 选区外 → 光标 ${outsideCursor}；在外面拖一次后选区 ${afterOutside ? `${afterOutside.w}×${afterOutside.h}` : "没了"}`);
	if (outsideCursor !== "not-allowed") problems.push(`选区之外的光标是「${outsideCursor}」，应该是 not-allowed——那里不该能做任何事`);
	if (!afterOutside) problems.push("在选区外拖拽把选区弄没了——外面应该是禁区");
	else if (beforeOutside && (afterOutside.w !== beforeOutside.w || afterOutside.h !== beforeOutside.h || afterOutside.x !== beforeOutside.x)) {
		problems.push(`在选区外拖拽改变了选区：${beforeOutside.w}×${beforeOutside.h} @${beforeOutside.x} → ${afterOutside.w}×${afterOutside.h} @${afterOutside.x}`);
	}

	// ---- 6. 每一种工具都真的画出东西 -------------------------------------
	const inside = { x: moved!.x + 60, y: moved!.y + 60 };
	const marks = await run<number>(`document.querySelectorAll('[class*="1c1c1e"] button[data-ly-tip]').length`);
	note(`  6. 工具条按钮 → ${marks} 个`);

	/**
	 * What is on the mark canvas: how much of it is covered, and a checksum of every byte.
	 *
	 * The count alone is not enough and cost an hour finding out. A caption drawn over a mosaic
	 * block adds no *newly* opaque pixels, so "text drew nothing" and "undo changed nothing" both
	 * looked like real failures when the app was drawing exactly what it should. The checksum sees
	 * any change at all, which is the actual question being asked.
	 */
	const inkOf = async () =>
		run<{ ink: number; sum: number }>(`(() => {
			const cs = document.querySelectorAll("canvas");
			const c = cs[cs.length - 1];
			const box = document.querySelector('[data-selection]');
			if (!c || !c.width || !box) return { ink: -1, sum: -1 };
			/*
			 * Only the region, not the whole screen the canvas covers. Reading every pixel of a 5K
			 * display back into JavaScript takes seconds per call, and the part outside the frame is
			 * not exported anyway.
			 */
			const r = box.getBoundingClientRect();
			const s = c.width / window.innerWidth;
			const d = c.getContext("2d").getImageData(
				Math.round(r.x * s), Math.round(r.y * s),
				Math.max(1, Math.round(r.width * s)), Math.max(1, Math.round(r.height * s)),
			).data;
			let ink = 0, sum = 0;
			for (let i = 0; i < d.length; i += 4) {
				if (d[i + 3] > 8) ink++;
				sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) | 0;
			}
			return { ink, sum };
		})()`);

	const tools: [string, string][] = [
		["矩形", "R"],
		["圆形", "O"],
		["箭头", "A"],
		["直线", "L"],
		["画笔", "P"],
		["步骤标号", "S"],
		["马赛克", "M"],
	];
	let before = await inkOf();
	note(`     起始墨迹 ${before.ink} 像素`);
	/*
	 * Each tool gets a lane of its own.
	 *
	 * The first version drew all of them along the same path, so the pen landed exactly on the line
	 * that had just been drawn there and added no new pixels — which read as "the pen draws
	 * nothing" when the pen was fine and the probe was wrong.
	 */
	for (const [index, entry] of tools.entries()) {
		const [name, key] = entry;
		const picked = await pressTool(socket, run, name);
		if (!picked) {
			problems.push(`工具条上没有「${name}」按钮`);
			continue;
		}
		await pause(80);
		/*
		 * The selection has to survive being pressed on the toolbar.
		 *
		 * This is the check that would have caught the shipped bug: the bar floats outside the
		 * selection, so a press on it that reaches the overlay's handler is read as "start a new
		 * region" and the selection is gone. On screen that is a capture that resets itself the
		 * moment you pick a tool.
		 */
		const alive = await run<boolean>(`Boolean(document.querySelector('[data-selection]'))`);
		if (!alive) {
			problems.push(`点了「${name}」按钮之后选区没了——工具条的点击穿到浮层上了`);
			break;
		}
		/*
		 * The colour swatches belong to tools that draw in a colour.
		 *
		 * A mosaic samples the picture underneath it, so colours shown beside it do nothing to
		 * anything — a control that cannot affect what is selected is a promise the tool does not keep.
		 */
		/*
		 * The properties live in a bubble above the row now, so they are found by what they are
		 * rather than by a tooltip the bubble no longer needs.
		 */
		const swatches = await run<number>(`document.querySelectorAll('[aria-label="红色"], [aria-label="蓝色"]').length`);
		if (name === "马赛克" && swatches > 0) problems.push("选中马赛克时还显示着颜色选择——马赛克没有颜色");
		if (name !== "马赛克" && swatches === 0) problems.push(`选中「${name}」时颜色选择不见了`);
		// And the size control follows the tool, whatever that tool calls its size.
		const sizes = await run<number>(`document.querySelectorAll('[aria-label^="字号"], [aria-label^="马赛克大小"], [aria-label^="粗细"], [aria-label^="标号大小"]').length`);
		if (sizes === 0) problems.push(`选中「${name}」时没有大小档位可调`);

		/*
		 * The mosaic says how much it will cover, before it covers it.
		 *
		 * Checked by moving the pointer over the canvas and looking for a ring: redaction is not
		 * something anyone wants to discover they did too narrowly, and a system cursor cannot say
		 * how wide the brush is.
		 */
		if (name === "马赛克") {
			await call(socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x: inside.x + 60, y: inside.y + 60 });
			await pause(120);
			const ring = await run<{ w: number; h: number } | null>(`(() => {
				const el = [...document.querySelectorAll("span")].find(s => s.className.includes("rounded-full") && s.className.includes("pointer-events-none") && s.getBoundingClientRect().width > 4);
				if (!el) return null;
				const r = el.getBoundingClientRect();
				return { w: Math.round(r.width), h: Math.round(r.height) };
			})()`);
			note(`     马赛克光标圈 → ${ring ? `${ring.w}×${ring.h}` : "没有出现"}`);
			if (!ring) problems.push("选中马赛克后，光标处没有显示涂抹范围的圆圈");
			else if (Math.abs(ring.w - ring.h) > 2) problems.push(`马赛克光标圈不是正圆：${ring.w}×${ring.h}`);
		}
		const lane = inside.y + index * 32;
		// A short drag for the ones that are dragged; a click is enough for the step badge.
		if (name === "步骤标号") await click(socket, inside.x + 400, lane);
		else await drag(socket, [inside.x, lane], [inside.x + 120, lane + 18], 6);
		await pause(120);
		const after = await inkOf();
		note(`     ${name} (${key}) → 新增 ${after.ink - before.ink} 像素`);
		if (after.sum === before.sum) problems.push(`「${name}」工具没有画出任何东西`);
		before = after;
	}

	// ---- 7. 文字工具 -----------------------------------------------------
	/** How many pixels the caption itself changed, which is the yardstick undo is measured against. */
	let captionInk = 0;

	/*
	 * The region as it is now, kept in the page so a later moment can be compared against it.
	 *
	 * A checksum can say two pictures differ; it cannot say where, and every question worth asking
	 * about undo is a question about a particular part of the picture.
	 */
	const readFrame = `(() => {
		const cs = document.querySelectorAll("canvas");
		const c = cs[cs.length - 1];
		const box = document.querySelector('[data-selection]');
		if (!c || !box) return null;
		const r = box.getBoundingClientRect();
		const s = c.width / window.innerWidth;
		return { r, s, data: c.getContext("2d").getImageData(
			Math.round(r.x * s), Math.round(r.y * s),
			Math.max(1, Math.round(r.width * s)), Math.max(1, Math.round(r.height * s)),
		) };
	})()`;
	const keepFrame = `(() => {
		const f = ${readFrame};
		if (!f) return false;
		window.__frame = f.data;
		return true;
	})()`;
	const frameDiff = `(() => {
		const a = window.__frame;
		const f = ${readFrame};
		if (!a || !f) return null;
		const b = f.data;
		if (a.width !== b.width || a.height !== b.height) return { count: -1, resized: true };
		let count = 0;
		for (let i = 0; i < b.data.length; i += 4) {
			const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i+1] - b.data[i+1]), Math.abs(a.data[i+2] - b.data[i+2]));
			if (d > 4) count++;
		}
		return { count };
	})()`;
	/*
	 * How much the canvas changes when nothing about it changes.
	 *
	 * Switching tools repaints the whole canvas from the same shapes, so any pixels that differ
	 * afterwards are the renderer's own noise — antialiased edges are not reproduced bit for bit
	 * across repaints. Measured rather than assumed, because the undo check below compares two
	 * repaints and would otherwise read that noise as a fault in undo.
	 */
	await run(keepFrame);
	await pressTool(socket, run, "画笔");
	await pause(200);
	const noise = await run<{ count: number } | null>(frameDiff);
	note(`     重绘噪声基线 → ${noise?.count ?? "?"} 像素`);
	if ((noise?.count ?? 0) > 0) problems.push(`同样的内容重绘了一次就有 ${noise?.count} 个像素对不上`);

	await run(keepFrame);
	/** Which step of the caption flow moved pixels that were not the caption. */
	const diffCount = async (what: string) => {
		const d = await run<{ count: number } | null>(frameDiff);
		note(`     ${what} → 差 ${d?.count ?? "?"} 像素`);
	};

	/*
	 * How much of the caption's own corner differs from before it was written.
	 *
	 * Undo is checked here rather than across the whole region, and the reason is that the whole
	 * region is not a stable measurement: the overlay is a fullscreen window sitting under a live
	 * desktop, and comparing every pixel of it turns any stray input during the run into a failure
	 * about undo. What undo actually promises is local — the caption is gone and what was under it
	 * is back — and that is what this reads.
	 */
	const caption = { x: inside.x + 250, y: inside.y + 20, w: 320, h: 90 };
	const captionDiff = `(() => {
		const a = window.__frame;
		const f = ${readFrame};
		if (!a || !f) return null;
		const { r, s, data: b } = f;
		if (a.width !== b.width || a.height !== b.height) return null;
		const x0 = Math.max(0, Math.round((${caption.x} - r.x) * s));
		const y0 = Math.max(0, Math.round((${caption.y} - r.y) * s));
		const x1 = Math.min(b.width, x0 + Math.round(${caption.w} * s));
		const y1 = Math.min(b.height, y0 + Math.round(${caption.h} * s));
		let count = 0;
		for (let y = y0; y < y1; y++) {
			for (let x = x0; x < x1; x++) {
				const i = (y * b.width + x) * 4;
				const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i+1] - b.data[i+1]), Math.abs(a.data[i+2] - b.data[i+2]));
				if (d > 4) count++;
			}
		}
		return { count, area: (x1 - x0) * (y1 - y0) };
	})()`;
	await pressTool(socket, run, "文字");
	await pause(120);
	await diffCount("选中文字工具后");
	/*
	 * Clear of the lanes the tools above drew in.
	 *
	 * Pressing on an existing mark selects it — correctly — instead of starting a caption, so a
	 * caption has to be started somewhere nothing has been drawn. The lanes run down the left of the
	 * region, so this goes to the right of them.
	 */
	await click(socket, inside.x + 250, inside.y + 20);
	await pause(150);
	await diffCount("点开输入框后");
	const field = await run<boolean>(`Boolean(document.querySelector("textarea"))`);
	note(`  7. 文字 → 输入框${field ? "已出现" : "没有出现"}`);
	if (!field) problems.push("选了文字工具后没有出现输入框");
	else {
		await run(`(() => {
			const el = document.querySelector("textarea");
			const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
			setter.call(el, "彻底修复");
			el.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await pause(80);
		const typed = await run<string>(`document.querySelector("textarea")?.value ?? "(没有输入框)"`);
		note(`     输入框内容 → ${JSON.stringify(typed)}`);
		if (typed !== "彻底修复") problems.push(`输入的文字没有进到输入框：${JSON.stringify(typed)}`);
		// Pressing elsewhere is what commits it — somewhere else empty, for the same reason.
		await click(socket, inside.x + 250, inside.y + 300);
		await pause(200);
		const still = await run<string | null>(`document.querySelector("textarea")?.value ?? null`);
		note(`     点击别处后 → ${still === null ? "输入框已关闭" : `又开了一个新的（${JSON.stringify(still)}）`}`);
		const afterText = await inkOf();
		note(`     提交后墨迹 ${afterText.ink}（此前 ${before.ink}），校验和 ${afterText.sum !== before.sum ? "已变" : "没变"}`);
		if (afterText.sum === before.sum) problems.push("文字没有画到画布上");
		captionInk = (await run<{ count: number; area: number } | null>(captionDiff))?.count ?? 0;
		note(`     文字落在自己那块区域的 ${captionInk} 个像素上`);
		if (captionInk < 100) problems.push(`文字没有画在预期位置（只有 ${captionInk} 个像素变化）`);
		before = afterText;
	}

	// ---- 8. 撤销 / 重做 ---------------------------------------------------
	await pressTool(socket, run, "撤销");
	await pause(200);
	const undone = await inkOf();
	note(`  8. 撤销 → ${undone.ink} 像素（此前 ${before.ink}）`);
	if (undone.sum === before.sum) problems.push("撤销没有让画面回退");
	if (captionInk > 0) {
		const back = await run<{ count: number; area: number } | null>(captionDiff);
		note(`     文字那块区域还剩 ${back?.count ?? "?"} 个像素和写文字前不同（写上去时是 ${captionInk} 个）`);
		/*
		 * A tenth of what the caption drew — room for an antialiased edge, nowhere near enough for
		 * the caption still to be there.
		 *
		 * Local, not the whole region, and that is deliberate. Comparing every pixel of the overlay
		 * across two moments makes any stray input during the run — this is a fullscreen window over
		 * a live desktop — come out as a failure about undo, which is not what it would mean.
		 */
		if ((back?.count ?? 0) > captionInk / 10) {
			problems.push(`撤销之后文字没有从画布上消失（还差 ${back?.count} 个像素）`);
		}
	}
	await pressTool(socket, run, "重做");
	await pause(200);
	const redone = await inkOf();
	note(`     重做 → ${redone.ink} 像素`);
	if (redone.sum !== before.sum) problems.push("重做没有还原到撤销前的画面");

	const errors = await run<string[]>(`window.__probeErrors ?? []`);
	if (errors.length) {
		note(`     渲染进程报错 ${errors.length} 条：`);
		for (const e of errors.slice(0, 8)) note(`       ${e}`);
		problems.push(`渲染进程抛了 ${errors.length} 条错误`);
	}

	// ---- 9. 存下来看一眼 --------------------------------------------------
	const shot = (await call<{ data: string }>(socket, "Page.captureScreenshot", { format: "png" })).data;
	await writeFile("/tmp/lyra-screenshot-overlay.png", Buffer.from(shot, "base64"));
	note("  9. 浮层截图已写入 /tmp/lyra-screenshot-overlay.png");

	// ---- 10. 完成，走真实保存路径 -----------------------------------------
	/*
	 * Clicked for real, and checked by the file that comes out of it.
	 *
	 * The first version of this replaced `window.lyra.screenshot.finish` with a spy. `window.lyra`
	 * comes through `contextBridge`, which hands over a frozen object — the assignment did nothing,
	 * the real handler ran, the overlay was destroyed mid-evaluate, and the probe hung until it
	 * timed out. Seeding a save directory and looking at what lands in it covers the whole path
	 * instead: the renderer's export, the IPC hop, and the main process writing the PNG.
	 */
	// The destination the app believes in, printed because a mismatch between this and the directory
	// below is what a stale instance on the debug port looks like from here.
	note(`      保存位置 → ${await app.evaluate<string>(`window.lyra.settings.get().then(s => s.screenshot?.saveLocation ?? "(没有)")`)}`);
	const finished = await pressTool(socket, run, "完成");
	if (!finished) problems.push("工具条上没有「完成」按钮");
	await pause(700);
	const overlayGone = await captureOver();
	note(`      点「完成」之后浮层${overlayGone ? "已关闭" : "还开着"}`);
	if (!overlayGone) {
		problems.push("点了完成之后浮层没有关闭——还停在截图状态");
		const why = await run<string[]>(`window.__probeErrors ?? []`).catch(() => []);
		if (why.length) note(`      渲染进程报错：${why.slice(0, 4).join(" | ")}`);
	}
	let saved: { name: string; bytes: number } | null = null;
	for (let i = 0; i < 40 && !saved; i++) {
		await pause(250);
		const name = (await readdir(shots).catch(() => [] as string[])).find((n) => n.endsWith(".png"));
		if (name) saved = { name, bytes: (await stat(join(shots, name))).size };
	}
	note(`  10. 完成 → ${saved ? `${saved.name}，${Math.round(saved.bytes / 1024)} KB` : "没有保存任何文件"}`);
	if (!saved) {
		problems.push("点了完成之后没有保存出文件");
		// Which half is broken: the save path itself, or the overlay's call into it.
		const direct = await app.evaluate<string>(
			`window.lyra.screenshot.finish("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==").then(r => JSON.stringify(r), e => "threw: " + e.message)`,
		).catch((e) => `evaluate failed: ${e.message}`);
		note(`      直接调用保存 → ${direct}`);
		const now = await readdir(shots).catch((e) => [`(读不了: ${e.message})`]);
		note(`      探针在看的目录 → ${shots}`);
		note(`      直接调用之后目录里 → ${now.length ? now.join(", ") : "(还是空的)"}`);
		const claimed = /"filePath":"([^"]+)"/.exec(direct)?.[1];
		if (claimed) {
			note(`      主进程说写到了 → ${claimed}`);
			note(`      那个文件真的在吗 → ${await stat(claimed).then((s) => `${s.size} 字节`, (e) => `不在：${e.code}`)}`);
		}
	}
	else {
		const size = await pngSize(join(shots, saved.name));
		note(`      图片尺寸 ${size.width}×${size.height}`);
		// Kept where it can be looked at: the export is its own code path, and "the file exists and
		// is the right size" does not say the marks made it into it.
		await writeFile("/tmp/lyra-screenshot-export.png", await readFile(join(shots, saved.name)));
		note("      导出的图片已复制到 /tmp/lyra-screenshot-export.png");
		// The selection ended at 680×460 CSS pixels, so the file is that times the scale factor.
		if (size.width < 600 || size.height < 400) problems.push(`导出的图片尺寸不对：${size.width}×${size.height}`);
	}

	// ---- 11. 焦点回到应用本身 ----------------------------------------------
	/*
	 * Not "the main window is still rendering" — it always was.
	 *
	 * The reported bug is that the app disappears behind whatever was on screen before it: the
	 * overlay is `alwaysOnTop` at screen-saver level, and when macOS destroys it the foreground
	 * goes to the application underneath, not back to Lyra. Nothing about the main window's DOM
	 * changes, which is why the first version of this check passed while the bug was there. The
	 * window server is the only thing that can answer it.
	 *
	 * Confirmed to fail when it should: with `app.focus({ steal: true })` removed from
	 * `closeScreenshotOverlay`, this reports whichever application happened to be behind the
	 * overlay instead of Lyra.
	 */
	const alive = await app.evaluate<boolean>(`Boolean(document.querySelector(".ly-shell"))`);
	if (!alive) problems.push("完成截图后主窗口没了");
	await pause(600);
	const front = await frontmostApp();
	note(`  11. 主窗口 ${alive ? "仍在渲染" : "不见了"}，前台应用 → ${front ?? "(这个平台读不到)"}`);
	/*
	 * Reported, not asserted, and the reason is the point.
	 *
	 * Where the foreground goes now depends on where the screenshot came from — see `cameFromApp`
	 * in `screenshot.ts`. Started from inside Lyra it comes back to Lyra; started by the global
	 * shortcut while reading something else it deliberately does not, because being yanked into a
	 * different application after screenshotting a browser is the complaint that produced that
	 * rule. Whether *this* run had focus at the moment it began is not something the probe controls,
	 * so asserting either answer would make it flaky in one direction or the other.
	 */
} finally {
	// Before `stop`, which deletes the directory this lives in.
	timeline = await readFile(join(home, "screenshot-debug.log"), "utf8").catch(() => "");
	await app.stop();
}

/*
 * The main process's own account of what it did, which is where the timing lives.
 *
 * Everything above is measured from inside the page, and the two things that were worst about this
 * feature — the desktop appearing to jump on the way in, the app flashing on the way out — are not
 * visible from there at all. They are gaps between main-process operations: how long from the
 * shortcut to the window being shown, and whether anything was uncovered before the hide landed.
 */
if (timeline) {
	console.log("\n—— 主进程时序 ——");
	console.log(timeline.trim());
	const blocks = timeline.split("===== capture").slice(1);
	blocks.forEach((block, i) => {
		const shown = /\[\+ *(\d+)ms\] reveal: after showInactive/.exec(block);
		const snap = /\[\+ *(\d+)ms\] snapshot \+ windows ready/.exec(block);
		if (!shown || !snap) return;
		const total = Number(shown[1]);
		const own = total - Number(snap[1]);
		const grab = /"getSources":(\d+)/.exec(block)?.[1] ?? "?";
		console.log(`\n• 第 ${i + 1} 次：触发→上屏 ${total}ms（系统取画面 ${grab}ms，Lyra 自己 ${own}ms）`);
		/*
		 * Judged on Lyra's own share, not the total.
		 *
		 * `getSources` is the system taking the picture and varies with what else the machine is
		 * doing; the part worth defending is everything after it — decoding, painting, showing —
		 * because that is what used to be 280ms of window-building and PNG encoding, and it is time
		 * in which the screen can change and then visibly snap back when the frozen copy arrives.
		 *
		 * The first capture of a run is exempt: the overlay is built lazily and the warm-up runs
		 * three seconds after launch, which a probe that captures immediately does not wait for.
		 */
		if (i === 0 && Number(grab) > 140) {
			problems.push(`第一次截图系统取画面花了 ${grab}ms——预热没生效，头一两张截图仍会看到画面跳一下`);
		}
		if (i > 0 && own > 90) {
			problems.push(`浮层上屏前 Lyra 自己花了 ${own}ms——这段时间内屏幕的变化会在浮层落下时被“抹回去”，看起来就是画面跳一下`);
		}
	});
} else {
	console.log("\n（没有读到主进程时序日志）");
}

console.log("");
if (problems.length === 0) {
	console.log("✅ 全部通过");
} else {
	console.log(`❌ ${problems.length} 个问题：`);
	for (const p of problems) console.log(`   - ${p}`);
	process.exitCode = 1;
}
