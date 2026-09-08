/**
 * The capture toolbar's four newest promises, checked in the window they are made in.
 *
 * These are here rather than in a unit test because each of them fails in a way a unit test cannot
 * see. A button's size is a class name until something lays it out. A drag handle whose press never
 * reaches its handler — because a parent stops the event, which the toolbar's own container does —
 * looks draggable and is not. Pinning produces a *second window*, and the interesting failure is
 * that it is hidden a few frames after it appears, by the code that hands the foreground back at
 * the end of a capture. Downloading ends in a file.
 *
 * `screenshot-toolbar-probe.ts` is the same ground covered with a screen recording and a much
 * longer report; this is the part worth failing a build over.
 *
 * Everything acts through synthesised pointer events at real coordinates. `element.click()` would
 * be shorter and would dispatch no pointer events at all — which is exactly how every button in
 * this bar was once broken while a test file reported all green.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

const PORT = 9429;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let app: RunningApp;
/** The overlay's own page: a second window, which `startApp` does not attach to. */
let overlay = "";
let downloads = "";

interface Target {
	type: string;
	url: string;
	webSocketDebuggerUrl?: string;
}

async function targets(): Promise<Target[]> {
	return (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())) as Target[];
}

async function pageFor(hash: string, tries = 40): Promise<string> {
	for (let i = 0; i < tries; i++) {
		await pause(250);
		const found = (await targets()).find((t) => t.type === "page" && t.url.includes(hash));
		if (found?.webSocketDebuggerUrl) return found.webSocketDebuggerUrl;
	}
	return "";
}

/** One call, one socket — the same arrangement `app.ts` uses, for the same reason. */
async function call<T>(target: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
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
			setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
		});
		socket.send(JSON.stringify({ id: 1, method, params }));
		return await answer;
	} finally {
		socket.close();
	}
}

function evaluator(socket: string) {
	return async <T>(expression: string): Promise<T> => {
		const result = (await call(socket, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true })) as {
			exceptionDetails?: { text: string };
			result?: { value: T };
		};
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
		return result.result?.value as T;
	};
}

/**
 * One mouse event, with a short leash on `mouseMoved`.
 *
 * A synthesised move into a window that the *system* pointer is not over sometimes never gets
 * acknowledged: `Input.dispatchMouseEvent` hangs for its full timeout while `Runtime.evaluate` on
 * the very same page answers instantly. It showed up on the pinned shot, right after a drag, in
 * roughly two runs out of three.
 *
 * It is the protocol, not the app, and that was established rather than assumed: the same window in
 * the same state reveals its close button to the *real* pointer, with Lyra not even frontmost —
 * `screenshot-toolbar-probe.ts` warps the system cursor onto it and checks. So an event that goes
 * unanswered is sent again and then let go. Duplicates are safe here because every assertion in
 * this file is about a settled end state — the window moved, the window closed — rather than about
 * a count of events.
 */
async function mouse(socket: string, type: string, x: number, y: number, buttons = 1): Promise<unknown> {
	const send = (timeoutMs: number) =>
		call(
			socket,
			"Input.dispatchMouseEvent",
			{
				type,
				x: Math.round(x),
				y: Math.round(y),
				button: "left",
				buttons: type === "mouseReleased" ? 0 : buttons,
				clickCount: type === "mouseMoved" ? 0 : 1,
			},
			timeoutMs,
		);
	return send(8_000).catch(() => send(8_000).catch(() => undefined));
}

async function drag(socket: string, from: [number, number], to: [number, number], steps = 10): Promise<void> {
	await mouse(socket, "mousePressed", from[0], from[1]);
	for (let i = 1; i <= steps; i++) {
		await mouse(socket, "mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
		await pause(16);
	}
	await mouse(socket, "mouseReleased", to[0], to[1], 0);
}

async function click(socket: string, x: number, y: number): Promise<void> {
	await mouse(socket, "mousePressed", x, y);
	await pause(30);
	await mouse(socket, "mouseReleased", x, y, 0);
}

/**
 * Move the *real* pointer into a corner, and say whether it worked.
 *
 * Every press in this file is a synthetic event delivered to a window; the system pointer stays
 * wherever the person at the keyboard left it. That matters for exactly one assertion — a pinned
 * shot's close button is supposed to be invisible until the pointer arrives — because a real cursor
 * already sitting where the window opens makes it visible before anything here has touched it. On a
 * CI runner nothing moves the cursor and it is a no-op; on a developer's machine it is the
 * difference between a real check and a coin toss.
 *
 * `CGWarpMouseCursorPosition` through the Python that ships with the developer tools: no compiler,
 * no accessibility grant, nothing left on disk. Anywhere it does not work, the caller relaxes the
 * assertion rather than failing on the environment.
 */
async function parkCursor(): Promise<boolean> {
	if (process.platform !== "darwin") return false;
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	return promisify(execFile)("python3", [
		"-c",
		[
			"import ctypes, ctypes.util",
			"lib = ctypes.cdll.LoadLibrary(ctypes.util.find_library('ApplicationServices'))",
			"class P(ctypes.Structure): _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double)]",
			"lib.CGWarpMouseCursorPosition.argtypes = [P]",
			"lib.CGWarpMouseCursorPosition(P(8.0, 8.0))",
		].join("\n"),
	]).then(() => true, () => false);
}

/** Press the control whose tooltip starts with `tip`, at its real coordinates. */
async function pressTip(socket: string, tip: string): Promise<boolean> {
	const at = await evaluator(socket)<{ x: number; y: number } | null>(`(() => {
		const b = [...document.querySelectorAll("[data-ly-tip]")].find(b => b.dataset.lyTip.startsWith(${JSON.stringify(tip)}));
		if (!b) return null;
		const r = b.getBoundingClientRect();
		if (!r.width || !r.height) return null;
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
	})()`);
	if (!at) return false;
	await click(socket, at.x, at.y);
	return true;
}

/**
 * A capture with a region already framed, from nothing.
 *
 * The previous one is cancelled first and given time to leave, which is not tidiness: starting a
 * capture while one is up takes the new snapshot *while the old overlay is still on screen*, so the
 * picture contains the previous selection's own frame and grips. A test that pinned that image
 * would be looking at a blue rectangle baked into it and blaming this feature for drawing it.
 */
async function frameRegion(): Promise<{ x: number; y: number; width: number; height: number }> {
	await app.evaluate(`window.lyra.screenshot.cancel()`).catch(() => {});
	await pause(900);
	await app.evaluate(`window.lyra.screenshot.start()`);
	if (!overlay) overlay = await pageFor("screenshot-overlay");
	assert.ok(overlay, "截图浮层窗口没有出现");
	const run = evaluator(overlay);
	for (let i = 0; i < 60; i++) {
		if (await run<boolean>(`document.visibilityState === "visible" && !document.hidden`)) break;
		await pause(100);
	}
	await pause(400);

	const screen = await run<{ w: number; h: number }>(`({ w: window.innerWidth, h: window.innerHeight })`);
	await drag(
		overlay,
		[Math.round(screen.w * 0.22), Math.round(screen.h * 0.24)],
		[Math.round(screen.w * 0.68), Math.round(screen.h * 0.6)],
	);
	await pause(400);
	const box = await run<{ x: number; y: number; width: number; height: number } | null>(`(() => {
		const el = document.querySelector("[data-selection]");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
	})()`);
	assert.ok(box, "拖拽之后没有选区");
	return box;
}

before(async () => {
	app = await startApp({
		port: PORT,
		seed: async (dir) => {
			downloads = join(dir, "downloads");
			await mkdir(downloads, { recursive: true });
			const { writeFile } = await import("node:fs/promises");
			await writeFile(
				join(dir, "settings.json"),
				JSON.stringify({ screenshot: { downloadLocation: downloads, saveLocation: "", copyToClipboard: false, openEditor: false } }),
			);
		},
	});
	// The overlay window and one thrown-away capture are built three seconds after launch; measuring
	// before that measures the warm-up rather than the feature.
	await pause(4_500);
});

after(async () => {
	await app?.evaluate(`window.lyra.screenshot.cancel()`).catch(() => {});
	await app?.stop();
});

test("截图工具栏的控件够大，不是文件查看器里那一排", async () => {
	await frameRegion();
	const run = evaluator(overlay);

	const bar = await run<{ width: number; height: number } | null>(`(() => {
		const el = document.querySelector("[data-screenshot-ui]");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { width: Math.round(r.width), height: Math.round(r.height) };
	})()`);
	assert.ok(bar, "拉出选区之后没有工具栏");

	const button = await run<{ width: number; height: number; icon: number } | null>(`(() => {
		const b = document.querySelector("[data-tool-index]");
		if (!b) return null;
		const r = b.getBoundingClientRect();
		const svg = b.querySelector("svg");
		return { width: Math.round(r.width), height: Math.round(r.height), icon: svg ? Math.round(svg.getBoundingClientRect().width) : 0 };
	})()`);
	assert.ok(button, "工具栏里没有工具按钮");

	/*
	 * 32 rather than 36, which is what it is: the claim being defended is 「不能再回到 24」, and a
	 * threshold set at the exact current value fails on any deliberate adjustment as loudly as it
	 * would on a regression. Every capture tool on this platform lands between 32 and 36.
	 */
	assert.ok(button.height >= 32, `工具按钮太小：${button.width}×${button.height}`);
	assert.ok(button.icon >= 16, `按钮里的图标太小：${button.icon}pt`);
	assert.ok(bar.height >= 44, `工具栏整条太矮：${bar.height}pt`);
});

test("鼠标放在工具栏上不是禁用光标，手柄上是抓手", async () => {
	/*
	 * The bar floats *outside* the selection, and everything out there carries `not-allowed` — the
	 * rule that says a press there does nothing. Cursors are inherited, so the bar inherited it too:
	 * a row of live buttons under a 🚫, which is how it was reported.
	 */
	const cursors = await evaluator(overlay)<{ bar: string; button: string; grip: string; confirm: string }>(`(() => {
		const at = (sel) => {
			const el = document.querySelector(sel);
			return el ? getComputedStyle(el).cursor : "没有这个元素";
		};
		return {
			bar: at("[data-screenshot-ui]"),
			button: at("[data-tool-index]"),
			grip: at("[data-toolbar-grip]"),
			confirm: at("[data-ly-tip='完成']"),
		};
	})()`);
	assert.notEqual(cursors.bar, "not-allowed", "鼠标放在工具栏上是禁用光标");
	assert.equal(cursors.grip, "grab", "拖动手柄上应该是抓手");
	assert.equal(cursors.button, "pointer", "工具按钮上应该是手型");
	assert.equal(cursors.confirm, "pointer", "「完成」上应该是手型");
});

test("属性气泡指着它属于的那个工具，即使前面还有别的控件", async () => {
	/*
	 * The bubble used to be anchored by arithmetic — button width times index, plus the bar's
	 * padding — which is a copy of the layout kept somewhere the layout does not know about. The
	 * drag handle sits in front of the tools and shifts every one of them along by its own width, so
	 * that formula pointed at the tool before the one in hand.
	 */
	assert.ok(await pressTip(overlay, "文字"), "工具栏上没有「文字」工具");
	await pause(300);
	const aim = await evaluator(overlay)<{ bubble: number; button: number } | null>(`(() => {
		const bar = document.querySelector("[data-screenshot-ui]");
		const bubble = bar && bar.querySelector("[class*='bottom-full'], [class*='top-full']");
		const button = bar && bar.querySelector('[data-tool-index="6"]');
		if (!bubble || !button) return null;
		const a = bubble.getBoundingClientRect(), b = button.getBoundingClientRect();
		return { bubble: Math.round(a.x + a.width / 2), button: Math.round(b.x + b.width / 2) };
	})()`);
	assert.ok(aim, "选中「文字」之后没有属性气泡");
	assert.ok(Math.abs(aim.bubble - aim.button) <= 24, `气泡没有对准它的工具：气泡 ${aim.bubble}，按钮 ${aim.button}`);
});

test("工具栏可以拖到别处，按钮跟着一起走", async () => {
	const run = evaluator(overlay);
	const before = await run<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector("[data-screenshot-ui]");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x), y: Math.round(r.y) };
	})()`);
	const grip = await run<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector("[data-toolbar-grip]");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
	})()`);
	assert.ok(before && grip, "工具栏上没有拖动手柄");

	const screen = await run<{ w: number; h: number }>(`({ w: window.innerWidth, h: window.innerHeight })`);
	await drag(overlay, [grip.x, grip.y], [Math.round(screen.w * 0.12), Math.round(screen.h * 0.12)], 14);
	await pause(300);

	const after = await run<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector("[data-screenshot-ui]");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x), y: Math.round(r.y) };
	})()`);
	assert.ok(after, "拖完之后工具栏不见了");
	assert.ok(Math.abs(after.x - before.x) + Math.abs(after.y - before.y) > 40, `工具栏没有被拖走：${JSON.stringify(before)} → ${JSON.stringify(after)}`);
	assert.ok(after.x >= 0 && after.y >= 0, `工具栏被拖出屏幕了：${JSON.stringify(after)}`);

	/*
	 * And it still answers where it was put.
	 *
	 * Moving a floating bar by changing the coordinates of its container is the kind of change that
	 * can leave hit testing behind — the picture moves and the presses do not.
	 */
	assert.ok(await pressTip(overlay, "矩形"), "在新位置按不到「矩形」");
	await pause(200);
	const pressed = await run<string>(`(() => {
		const b = [...document.querySelectorAll("[data-ly-tip]")].find(b => b.dataset.lyTip === "矩形");
		return b ? String(b.getAttribute("aria-pressed")) : "没有这个按钮";
	})()`);
	assert.equal(pressed, "true", "工具栏挪走之后按钮点不动了——移动的只是画面，命中区域没跟上");
});

test("置顶在桌面：图片留在原地，hover 出现关闭按钮，能拖能关", async () => {
	const region = await frameRegion();
	// Out of the way first: the window opens where the selection was, and a real cursor already
	// sitting there reveals the close button before this test has pressed anything.
	const parked = await parkCursor();
	assert.ok(await pressTip(overlay, "置顶在桌面"), "工具栏上没有「置顶在桌面」按钮");

	const pinned = await pageFor("pinned-shot");
	assert.ok(pinned, "按了置顶之后没有出现置顶窗口");
	const pin = evaluator(pinned);
	/*
	 * Front it before driving it.
	 *
	 * A pinned shot is shown with `showInactive` — it must not steal the foreground from whatever the
	 * user turned back to — so it is not the key window, and synthesised input into a window that is
	 * neither key nor under the system cursor is where `Input.dispatchMouseEvent` hangs. A real hand
	 * fronts it by pressing on it, which is the first thing it does anyway.
	 */
	await call(pinned, "Page.bringToFront").catch(() => {});
	await pause(300);
	/*
	 * A moment later, which is the failure this is really for.
	 *
	 * A capture that came from the shortcut hands the foreground back by hiding the whole
	 * application — and `app.hide()` does not distinguish the overlay from a window created a line
	 * earlier. The window appears and is gone two or three frames afterwards; anything that checked
	 * immediately would report it working.
	 */
	await pause(900);
	const state = await pin<{ w: number; h: number; shown: boolean }>(`({
		w: Math.round(window.innerWidth), h: Math.round(window.innerHeight),
		shown: document.querySelector('[data-pinned="shown"]') !== null,
	})`);
	assert.ok(state.shown, "置顶窗口里没有画出图片");
	assert.ok(Math.abs(state.w - region.width) <= 4 && Math.abs(state.h - region.height) <= 4,
		`置顶窗口和选区对不上：${state.w}×${state.h} vs ${region.width}×${region.height}`);
	assert.equal(await app.evaluate<number>(`window.lyra.screenshot.pinnedCount()`), 1, "置顶窗口在主进程里已经没了");

	// The close button appears with the pointer, and only with it.
	const closeOpacity = () => pin<string>(`(() => {
		const b = document.querySelector("[data-pinned-close]");
		return b ? getComputedStyle(b).opacity : "没有这个按钮";
	})()`);
	if (parked) assert.equal(await closeOpacity(), "0", "鼠标还没放上去，关闭按钮就已经显示了");
	await mouse(pinned, "mouseMoved", state.w / 2, state.h / 2, 0);
	await pause(400);
	assert.equal(await closeOpacity(), "1", "鼠标放上去之后关闭按钮没有出现");

	// Dragged by the picture itself, because a drag region would take the hover away with it.
	const was = await pin<{ x: number; y: number }>(`({ x: window.screenX, y: window.screenY })`);
	await mouse(pinned, "mousePressed", state.w / 2, state.h / 2);
	await pause(60);
	await mouse(pinned, "mouseMoved", state.w / 2 + 120, state.h / 2 + 90);
	await pause(250);
	await mouse(pinned, "mouseReleased", state.w / 2 + 120, state.h / 2 + 90, 0);
	await pause(300);
	const now = await pin<{ x: number; y: number }>(`({ x: window.screenX, y: window.screenY })`);
	assert.ok(now.x > was.x && now.y > was.y, `置顶图片拖不动：${JSON.stringify(was)} → ${JSON.stringify(now)}`);

	await mouse(pinned, "mouseMoved", state.w / 2, state.h / 2, 0);
	await pause(300);
	const closeAt = await pin<{ x: number; y: number } | null>(`(() => {
		const b = document.querySelector("[data-pinned-close]");
		if (!b) return null;
		const r = b.getBoundingClientRect();
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
	})()`);
	assert.ok(closeAt, "置顶窗口上没有关闭按钮");
	await click(pinned, closeAt.x, closeAt.y);
	await pause(800);
	assert.equal(await app.evaluate<number>(`window.lyra.screenshot.pinnedCount()`), 0, "点了关闭按钮，置顶窗口还在");
});

test("下载截图：文件落在设置好的目录里，界面确认它保存了", async () => {
	await frameRegion();
	assert.ok(await pressTip(overlay, "下载截图"), "工具栏上没有「下载截图」按钮");

	/*
	 * Polled, not slept at.
	 *
	 * The confirmation goes up only once the file is written — deliberately, so it never says
	 * 「已保存」 about a write that failed — and how long that takes is the disk's business. A fixed
	 * 600ms was enough almost every time, which is the worst kind of enough.
	 */
	let said = "没有提示";
	for (let i = 0; i < 20 && !said.includes("已保存"); i++) {
		await pause(200);
		said = await evaluator(overlay)<string>(`(() => {
			const el = document.querySelector("[data-screenshot-toast]");
			return el ? el.textContent.replace(/\\s+/g, " ").trim() : "没有提示";
		})()`).catch(() => "读不到");
	}
	assert.ok(said.includes("已保存"), `下载之后没有出现「已保存」的提示：「${said}」`);

	await pause(2_000);
	const files = (await readdir(downloads).catch(() => [] as string[])).filter((name) => name.endsWith(".png"));
	assert.equal(files.length, 1, `设置的下载目录里应该有一张 PNG，实际有 ${files.length} 个：${files.join(", ")}`);

	// And the capture ends on its own: the errand is finished, and staying in it means dismissing
	// something the user is already done with.
	const over = await evaluator(overlay)<boolean>(`document.querySelector('[data-capture="active"]') === null`).catch(() => true);
	assert.ok(over, "下载完成之后截图没有自动退出");
});

/**
 * A caption still being typed when the capture is confirmed.
 *
 * The failure this defends against is quiet and total: the text is on screen, in a `<textarea>`
 * over the canvas, and the picture is cut out of the canvas — so 完成 pressed with the cursor still
 * in a caption produced a screenshot without the words the user had just written, and nothing
 * anywhere said so. The field only commits itself on blur, and the toolbar deliberately never takes
 * focus (pressing 粗 while writing has to resize that caption rather than end it).
 *
 * Measured in pixels of the caption's own colour rather than by reading state, because state is
 * exactly what was right the whole time. The default is `#ef4444`; a Lyra window has almost none of
 * it, so a control run with no caption gives the floor to compare against.
 */
async function redPixels(file: string): Promise<number> {
	const { readFile } = await import("node:fs/promises");
	const png = await readFile(file);
	// Through a data URL: the overlay's `img-src` is `self data: blob:` and stays that way, and this
	// is the only decoder to hand that knows how to read a PNG.
	return evaluator(overlay)<number>(`(async () => {
		const img = new Image();
		img.src = "data:image/png;base64,${png.toString("base64")}";
		await img.decode();
		const c = document.createElement("canvas");
		c.width = img.width;
		c.height = img.height;
		const ctx = c.getContext("2d");
		ctx.drawImage(img, 0, 0);
		const d = ctx.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 0; i < d.length; i += 4) {
			if (d[i] > 200 && d[i + 1] < 100 && d[i + 2] < 100) n++;
		}
		return n;
	})()`);
}

/** Frame a region, write a caption into it, and leave the cursor in that caption. */
async function typeCaption(text: string): Promise<void> {
	const region = await frameRegion();
	assert.ok(await pressTip(overlay, "文字"), "工具栏上没有「文字」工具");
	await pause(200);
	// Inside the region, where the caption goes. Far enough from the edges not to hit a resize grip.
	await click(overlay, region.x + Math.round(region.width * 0.3), region.y + Math.round(region.height * 0.4));
	await pause(400);

	const field = await evaluator(overlay)<boolean>(`document.querySelector("textarea") !== null`);
	assert.ok(field, "选了文字工具并在选区里点了一下，却没有出现输入框");
	await call(overlay, "Input.insertText", { text });
	await pause(300);
	const written = await evaluator(overlay)<string>(`document.querySelector("textarea")?.value ?? ""`);
	assert.equal(written, text, "输入框里没有拿到文字");
}

/*
 * Driven through 下载 rather than 完成, and it covers both.
 *
 * The report was about 完成, but that hands the picture to Lyra — to the clipboard and the composer
 * — where checking it means reading a clipboard image out of the main process. 下载 ends in a file
 * this test can open, and the two share one line: `withText(() => { crop(); … })`. What is being
 * defended is that line running before the crop, not which button reached it.
 */
test("正在输入的文字，点下载时也会进到图里", async () => {
	/** The PNG this step produced, remembered so the next step's is the next one. */
	const seen = new Set(await readdir(downloads).catch(() => [] as string[]));
	const justSaved = async () => {
		const fresh = (await readdir(downloads)).filter((name) => name.endsWith(".png") && !seen.has(name));
		assert.equal(fresh.length, 1, `这一步应该只产出一张 PNG，实际 ${fresh.length} 张：${fresh.join(", ")}`);
		seen.add(fresh[0]!);
		return join(downloads, fresh[0]!);
	};

	// The control: the same region, no caption. Whatever red this picture has is the picture's own.
	await frameRegion();
	assert.ok(await pressTip(overlay, "下载截图"), "工具栏上没有「下载截图」按钮");
	await pause(2_500);
	const plain = await redPixels(await justSaved());

	// And now with a caption that has never been committed — no click away, straight to 下载.
	await typeCaption("测试文字ABC");
	assert.ok(await pressTip(overlay, "下载截图"), "工具栏上没有「下载截图」按钮");
	await pause(2_500);
	const captioned = await redPixels(await justSaved());

	assert.ok(
		captioned > plain + 200,
		`正在输入的文字没有画进图里：有文字的图 ${captioned} 个红色像素，没文字的 ${plain} 个——` +
			`说明按下「下载」时输入框里的字还没提交到画布上`,
	);
});
