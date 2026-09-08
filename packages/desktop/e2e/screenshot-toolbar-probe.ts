/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * The capture toolbar, driven the way a hand drives it, and filmed while it happens.
 *
 * Four things were added to it and each one fails invisibly in a different way, which is why this
 * exists rather than a unit test:
 *
 *   - **The size.** Every button in this bar typechecks at any size; 「太小了」 is not something a
 *     type says. So the buttons are measured on screen, in the window they actually appear in.
 *   - **Dragging the bar.** A `pointerdown` handler that is never reached — because a parent stops
 *     the event, which is exactly what the bar's container does — leaves a handle that looks
 *     draggable and is not. Only a real press finds that.
 *   - **Pinning.** The failure here is a *second window*: it opens, and then the code that hands
 *     the foreground back hides the whole application and takes the new window with it. Nothing in
 *     the page can see that. It is asked of the window list.
 *   - **Downloading.** Ends in a file, so the file is looked for.
 *
 * The recording is not decoration either. Half of these are timing faults — a window that appears
 * and is hidden two frames later, a toolbar that jumps before it settles — and a probe that samples
 * the DOM at 200ms intervals cannot see any of them. `~/Desktop/lyra-截图控件-*.mp4` is the record
 * of what was actually on screen while the assertions below were being made.
 *
 * Run: `node --experimental-strip-types e2e/screenshot-toolbar-probe.ts`
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startApp } from "./app.ts";

const execFileAsync = promisify(execFile);

const PORT = 9427;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/**
 * One mouse event, with a short leash on `mouseMoved`.
 *
 * A synthesised move into a window that the *system* pointer is not over sometimes never gets
 * acknowledged: `Input.dispatchMouseEvent` hangs for its full timeout while `Runtime.evaluate` on
 * the very same page answers instantly. It showed up on the pinned shot, right after a drag, in
 * roughly two runs out of three.
 *
 * It is the protocol, not the app, and that was established rather than assumed — the same window
 * in the same state reveals its close button to the *real* pointer, with Lyra not even frontmost.
 * See the 「真实鼠标」 check in the pinning section. So a move that goes unanswered is retried once
 * and then let go: a duplicate move changes nothing, where a duplicate press would.
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
	if (type !== "mouseMoved") return send(30_000);
	return send(6_000).catch(() => send(6_000).catch(() => undefined));
}

/**
 * A press, a path and a release, dispatched as real input rather than synthesised React events.
 *
 * Deliberately unhurried — twenty steps at 40ms is most of a second for one drag, where ten at 16ms
 * would do the same job in a sixth of the time. The reason is the recording: this probe's output is
 * a film somebody is going to watch, and a selection that appears fully formed in three frames shows
 * nothing about how it got there. It also happens to be closer to the speed a hand moves at, which
 * is the speed the code has to cope with.
 */
async function drag(socket: string, from: [number, number], to: [number, number], steps = 20) {
	await mouse(socket, "mousePressed", from[0], from[1]);
	for (let i = 1; i <= steps; i++) {
		await mouse(socket, "mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
		await pause(40);
	}
	await mouse(socket, "mouseReleased", to[0], to[1], 0);
}

async function click(socket: string, x: number, y: number) {
	await mouse(socket, "mousePressed", x, y);
	await pause(30);
	await mouse(socket, "mouseReleased", x, y, 0);
}

/**
 * Press a toolbar button the way a person does: a real pointer press at its real coordinates.
 *
 * Not `element.click()`, and this distinction cost a release once already — a DOM click dispatches
 * one `click` event and no pointer events at all, so it cannot see anything that goes wrong on
 * `pointerdown`. What went wrong then was that pressing any tool button fell through to the
 * overlay's own handler and threw the selection away.
 */
async function pressTip(socket: string, run: <T>(expression: string) => Promise<T>, tip: string): Promise<boolean> {
	const at = await run<{ x: number; y: number } | null>(`(() => {
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
 * Move the *real* pointer out of the way.
 *
 * Every press in this file is a synthetic event delivered to a window; the system pointer stays
 * wherever the person at the keyboard left it, and macOS goes on drawing for it — hover highlights,
 * window affordances — on top of everything being measured. A full-screen capture taken with it
 * sitting over the app under test is a picture of two things at once, and telling them apart cost
 * an hour once already.
 *
 * `CGWarpMouseCursorPosition` through the Python that ships with the developer tools, rather than a
 * helper binary: it needs no compiler, no accessibility grant, and nothing left on disk. A machine
 * without it loses the tidying and keeps every assertion.
 */
async function parkCursor(x: number, y: number): Promise<void> {
	if (process.platform !== "darwin") return;
	await execFileAsync("python3", [
		"-c",
		[
			"import ctypes, ctypes.util",
			"lib = ctypes.cdll.LoadLibrary(ctypes.util.find_library('ApplicationServices'))",
			"class P(ctypes.Structure): _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double)]",
			"lib.CGWarpMouseCursorPosition.argtypes = [P]",
			`lib.CGWarpMouseCursorPosition(P(${x}.0, ${y}.0))`,
		].join("\n"),
	]).catch(() => {});
}

/** The capture overlay's page, once it is up and has been shown. */
async function overlayPage(): Promise<string> {
	for (let i = 0; i < 40; i++) {
		await pause(250);
		const found = (await targets()).find((t) => t.type === "page" && t.url.includes("screenshot-overlay"));
		if (found?.webSocketDebuggerUrl) return found.webSocketDebuggerUrl;
	}
	throw new Error("截图浮层窗口没有出现");
}

// ---------------------------------------------------------------------------------------------

/** Where the download button should put files, checked as a directory afterwards. */
let downloads = "";
const problems: string[] = [];
const note = (line: string) => console.log(line);

/**
 * A beat between one thing and the next, for the benefit of whoever watches the recording.
 *
 * These assertions run as fast as the protocol will carry them, which is far faster than anything
 * can be followed: five features get checked inside twenty seconds and the film is a blur. A second
 * of stillness at each seam is what makes it a demonstration rather than a flicker — and it costs
 * five seconds on a probe that is run by hand.
 */
const beat = () => pause(1_100);

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const CLIP = join(homedir(), "Desktop", `lyra-截图控件-${stamp}.mp4`);
let recorder: ChildProcess | null = null;

/**
 * Start filming the screen, or say why not and carry on.
 *
 * A missing screen-recording grant for the terminal is a permission dialog, not a fault in the app
 * — and the assertions below are worth running either way. `2` is `Capture screen 0` on this
 * machine; `-list_devices` is how that index is found, and it moves when a camera is added.
 */
async function startRecording(): Promise<void> {
	const devices = await execFileAsync("ffmpeg", ["-f", "avfoundation", "-list_devices", "true", "-i", ""]).catch(
		(err: { stderr?: string }) => ({ stdout: "", stderr: err.stderr ?? "" }),
	);
	const screen = /\[(\d+)\] Capture screen 0/.exec(devices.stderr)?.[1];
	if (!screen) {
		note("• 录屏跳过：avfoundation 没报出屏幕设备");
		return;
	}
	recorder = spawn(
		"ffmpeg",
		["-y", "-f", "avfoundation", "-capture_cursor", "1", "-framerate", "30", "-i", screen, "-vf", "scale=iw/2:ih/2", "-pix_fmt", "yuv420p", CLIP],
		{ stdio: ["pipe", "ignore", "ignore"] },
	);
	// Long enough for the stream to be negotiated: frames dropped at the start are the ones showing
	// the capture opening, which is the part worth having.
	await pause(2_500);
	recordingFrom = Date.now();
	note(`• 录屏中 → ${CLIP}`);
}

/** When the recorder was ready, so the film can be checked against the clock afterwards. */
let recordingFrom = 0;

async function stopRecording(): Promise<void> {
	if (!recorder) return;
	const wall = (Date.now() - recordingFrom) / 1000;
	// `q` on stdin rather than a signal: ffmpeg writes the index on the way out, and a killed
	// recording is a file no player will open.
	recorder.stdin?.write("q");
	await Promise.race([new Promise<void>((resolve) => recorder?.once("close", () => resolve())), pause(8_000)]);
	recorder = null;
	await stretchToWallClock(wall);
}

/**
 * Make the film as long as the test it is of.
 *
 * avfoundation hands over a screen at whatever rate it manages — around 8fps here, since most of
 * the screen is not changing — and stamps those frames as though it had hit the 30 it was asked
 * for. Muxed straight through, seventy seconds of test came out as a twenty-second film: everything
 * playing at nearly four times speed, which for a recording whose only purpose is to show what a
 * transition looked like is the same as not having one.
 *
 * Fixed here rather than at capture time because the input options that claim to fix it —
 * `-use_wallclock_as_timestamps`, `-fps_mode cfr` — do not, on this demuxer: the timestamps are
 * already wrong when ffmpeg receives them. Measuring the wall clock and rescaling the presentation
 * times afterwards needs nothing from avfoundation and cannot be wrong about how long the test took.
 */
async function stretchToWallClock(wall: number): Promise<void> {
	if (wall < 1) return;
	const probed = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", CLIP]).catch(() => null);
	const filmed = Number(probed?.stdout.trim());
	if (!Number.isFinite(filmed) || filmed <= 0) return;
	/*
	 * A quarter out, not a tenth.
	 *
	 * avfoundation's own timing is a few percent loose and re-encoding to correct that would cost a
	 * generation of quality for something nobody can see. What this is for is the failure mode where
	 * the film comes out at a fraction of the real length — everything playing at three or four times
	 * speed, which for a recording of a transition is the same as not having one.
	 */
	if (Math.abs(filmed - wall) / wall < 0.25) return;

	const fixed = `${CLIP}.fixed.mp4`;
	const stretched = await execFileAsync("ffmpeg", [
		"-y", "-v", "error",
		"-i", CLIP,
		"-vf", `setpts=${(wall / filmed).toFixed(4)}*PTS`,
		"-r", "30",
		"-pix_fmt", "yuv420p",
		fixed,
	]).then(() => true, () => false);
	if (!stretched) return;
	const { rename, rm } = await import("node:fs/promises");
	await rm(CLIP, { force: true });
	await rename(fixed, CLIP);
	note(`• 录屏时长按真实用时校正：${filmed.toFixed(1)}s → ${wall.toFixed(1)}s`);
}

const app = await startApp({
	port: PORT,
	seed: async (dir) => {
		downloads = join(dir, "downloads");
		await mkdir(downloads, { recursive: true });
		const { writeFile } = await import("node:fs/promises");
		await writeFile(
			join(dir, "settings.json"),
			JSON.stringify({ screenshot: { downloadLocation: downloads, saveLocation: "", copyToClipboard: false, openEditor: false } }, null, 2),
		);
	},
});

try {
	// The warm-up — the overlay window and one thrown-away capture — runs three seconds after launch.
	await pause(4_500);
	await startRecording();

	// ---- 1. 工具栏尺寸 ---------------------------------------------------
	note("\n【1】截图工具栏的尺寸");
	await app.evaluate(`window.lyra.screenshot.start()`);
	const socket = await overlayPage();
	const run = evaluator(socket);
	for (let i = 0; i < 60; i++) {
		if (await run<boolean>(`document.visibilityState === "visible" && !document.hidden`)) break;
		await pause(100);
	}
	await pause(400);

	const screenSize = await run<{ w: number; h: number }>(`({ w: window.innerWidth, h: window.innerHeight })`);
	const region: [number, number, number, number] = [
		Math.round(screenSize.w * 0.22),
		Math.round(screenSize.h * 0.24),
		Math.round(screenSize.w * 0.72),
		Math.round(screenSize.h * 0.62),
	];
	await drag(socket, [region[0], region[1]], [region[2], region[3]]);
	await pause(400);

	const bar = await run<{ h: number; w: number; x: number; y: number } | null>(`(() => {
		const el = document.querySelector("[data-screenshot-ui]");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
	})()`);
	note(`  工具栏 → ${bar ? `${bar.w}×${bar.h}，位于 (${bar.x}, ${bar.y})` : "没有出现"}`);
	if (!bar) problems.push("拉出选区后没有出现工具栏");

	const button = await run<{ w: number; h: number; icon: number } | null>(`(() => {
		const b = [...document.querySelectorAll("[data-tool-index]")][0];
		if (!b) return null;
		const r = b.getBoundingClientRect();
		const svg = b.querySelector("svg");
		return { w: Math.round(r.width), h: Math.round(r.height), icon: svg ? Math.round(svg.getBoundingClientRect().width) : 0 };
	})()`);
	note(`  工具按钮 → ${button ? `${button.w}×${button.h}，图标 ${button.icon}` : "找不到"}（改之前是 24×24、图标 14）`);
	if (!button) problems.push("工具栏里找不到工具按钮");
	else {
		// 微信那一排是 36 见方。低于 32 就是这次报告要修的那个尺寸。
		if (button.h < 32) problems.push(`工具按钮还是太小：${button.w}×${button.h}，参考微信是 36×36`);
		if (button.icon < 16) problems.push(`按钮里的图标太小：${button.icon}pt`);
	}
	if (bar && bar.h < 44) problems.push(`工具栏整条太矮：${bar.h}pt，参考微信是 48 上下`);

	/*
	 * And the pointer over it says the right thing.
	 *
	 * The bar floats *outside* the selection, and everything out there carries `not-allowed` — the
	 * rule that says a press there does nothing. Cursors are inherited, so the bar inherited it: a
	 * row of live buttons under a 🚫. Reported by the user in exactly those words, so it is asserted
	 * rather than left to the eye.
	 */
	const cursors = await run<{ bar: string; button: string; grip: string; confirm: string }>(`(() => {
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
	note(`  光标 → 工具栏 ${cursors.bar}，工具按钮 ${cursors.button}，手柄 ${cursors.grip}，完成 ${cursors.confirm}`);
	if (cursors.bar === "not-allowed") problems.push("鼠标放在工具栏上是禁用光标——它继承了选区外那条「这里什么都不做」的规则");
	if (cursors.grip !== "grab") problems.push(`拖动手柄上的光标不是抓手：${cursors.grip}`);
	if (cursors.button !== "pointer") problems.push(`工具按钮上的光标不是手型：${cursors.button}`);
	if (cursors.confirm !== "pointer") problems.push(`「完成」上的光标不是手型：${cursors.confirm}`);
	await beat();

	// ---- 2. 属性气泡指向当前工具 ----------------------------------------
	note("\n【2】属性气泡还指着它属于的那个工具");
	/*
	 * The bubble is anchored by measurement now, and this is the case that broke the arithmetic it
	 * replaced: a drag handle at the head of the row shifts every button along by its own width, so
	 * a formula counting button widths pointed one tool to the left.
	 */
	await pressTip(socket, run, "文字");
	await pause(300);
	const aim = await run<{ bubble: number; button: number } | null>(`(() => {
		const bar = document.querySelector("[data-screenshot-ui]");
		const bubble = bar && bar.querySelector("[class*='bottom-full'], [class*='top-full']");
		const button = bar && bar.querySelector('[data-tool-index="6"]');
		if (!bubble || !button) return null;
		const a = bubble.getBoundingClientRect(), b = button.getBoundingClientRect();
		return { bubble: Math.round(a.x + a.width / 2), button: Math.round(b.x + b.width / 2) };
	})()`);
	note(`  气泡中心 ${aim?.bubble ?? "?"} vs 「文字」按钮中心 ${aim?.button ?? "?"}`);
	if (!aim) problems.push("选中「文字」之后没有找到属性气泡");
	else if (Math.abs(aim.bubble - aim.button) > 24) {
		problems.push(`属性气泡没有对准它属于的工具：气泡 ${aim.bubble}，按钮 ${aim.button}`);
	}

	// ---- 3. 拖动工具栏 ---------------------------------------------------
	await beat();
	note("\n【3】工具栏可以自由拖动");
	const grip = await run<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector("[data-toolbar-grip]");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
	})()`);
	note(`  拖动手柄 → ${grip ? `在 (${grip.x}, ${grip.y})` : "没有"}`);
	if (!grip) problems.push("工具栏上没有拖动手柄");
	else {
		const before = bar!;
		const to: [number, number] = [Math.round(screenSize.w * 0.12), Math.round(screenSize.h * 0.12)];
		await drag(socket, [grip.x, grip.y], to, 14);
		await pause(300);
		const after = await run<{ x: number; y: number } | null>(`(() => {
			const el = document.querySelector("[data-screenshot-ui]");
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.x), y: Math.round(r.y) };
		})()`);
		note(`  拖动后 → 从 (${before.x}, ${before.y}) 到 ${after ? `(${after.x}, ${after.y})` : "读不到"}`);
		if (!after) problems.push("拖完之后工具栏不见了");
		else {
			const moved = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
			if (moved < 40) problems.push(`拖动手柄没有把工具栏挪走：位移只有 ${moved}pt`);
			// Dragged towards the top-left corner, and clamped so it stays on screen with room for
			// the bubble above it.
			if (after.x < 0 || after.y < 0) problems.push(`工具栏被拖出屏幕了：(${after.x}, ${after.y})`);
		}

		/*
		 * And the buttons still work where it was put.
		 *
		 * Moving a floating bar by changing the coordinates its container is positioned at is the
		 * kind of change that can leave hit testing behind — the picture moves and the presses do
		 * not. Pressing a tool at its new position is what proves the whole thing moved.
		 */
		const worked = await pressTip(socket, run, "矩形");
		await pause(200);
		const active = await run<string>(`(() => {
			const b = [...document.querySelectorAll("[data-ly-tip]")].find(b => b.dataset.lyTip === "矩形");
			return b ? String(b.getAttribute("aria-pressed")) : "没有这个按钮";
		})()`);
		note(`  在新位置按「矩形」→ ${worked ? `aria-pressed=${active}` : "按不到"}`);
		if (active !== "true") problems.push("工具栏挪走之后，按钮点不动了——移动的只是画面，命中区域没跟上");
	}

	// ---- 4. 置顶在桌面 ---------------------------------------------------
	await beat();
	note("\n【4】置顶在桌面");
	/*
	 * From the shortcut, not from inside Lyra, which is the case that can go wrong.
	 *
	 * A capture the app did not start hands the foreground back by hiding the whole application —
	 * and `app.hide()` hides every window, including one created a line earlier. Bringing another
	 * app to the front first is what makes this the real path rather than the easy one.
	 */
	/*
	 * And straight on from the capture that is still up, rather than ending it first.
	 *
	 * This used to cancel and wait 900ms, to dodge something real: the second snapshot was taken
	 * while the first overlay was still displayed, so it contained that overlay's selection frame and
	 * eight grips, and the picture pinned below came out with a blue rectangle and round dots baked
	 * into it. It looked exactly like this feature drawing something wrongly and was not — it was
	 * what the screen contained.
	 *
	 * `clearOverlayForSnapshot` in `screenshot.ts` empties the window before the picture is taken, so
	 * the case can be walked through instead of stepped around, and pinning gets exercised on the
	 * harder path: a capture that supersedes another *and* comes from outside Lyra.
	 * `e2e/screenshot-restart-probe.ts` is what checks the pixels; here it just has to work.
	 */
	await execFileAsync("open", ["-a", "Finder"]).catch(() => {});
	await pause(1_200);
	await app.evaluate(`window.lyra.screenshot.start()`);
	await pause(1_200);
	await drag(socket, [region[0], region[1]], [region[2], region[3]]);
	await pause(400);
	const framed = await run<{ w: number; h: number } | null>(`(() => {
		const el = document.querySelector("[data-selection]");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { w: Math.round(r.width), h: Math.round(r.height) };
	})()`);
	const pinned = await pressTip(socket, run, "置顶在桌面");
	note(`  「置顶在桌面」按钮 → ${pinned ? "按下" : "找不到"}`);
	if (!pinned) problems.push("工具栏上没有「置顶在桌面」按钮");

	let pinSocket = "";
	for (let i = 0; i < 40 && !pinSocket; i++) {
		await pause(250);
		pinSocket = (await targets()).find((t) => t.type === "page" && t.url.includes("pinned-shot"))?.webSocketDebuggerUrl ?? "";
	}
	note(`  置顶窗口 → ${pinSocket ? "已出现" : "没有出现"}`);
	if (!pinSocket) problems.push("按了置顶之后没有出现置顶窗口");
	else {
		const pin = evaluator(pinSocket);
		await pause(600);
		/*
		 * Still on screen a moment later, which is the failure this is for.
		 *
		 * `app.hide()` runs on the way out of a capture that came from outside the app, and it is
		 * asynchronous — the window appears, and is hidden two or three frames afterwards. Anything
		 * that checked immediately would report it working.
		 */
		const alive = await pin<{ w: number; h: number; shown: boolean; x: number; y: number }>(`({
			w: Math.round(window.innerWidth), h: Math.round(window.innerHeight),
			shown: document.querySelector('[data-pinned="shown"]') !== null,
			x: window.screenX, y: window.screenY,
		})`);
		note(`  置顶图片 → ${alive.w}×${alive.h}（选区 ${framed?.w ?? "?"}×${framed?.h ?? "?"}），内容${alive.shown ? "已渲染" : "还是空的"}`);
		if (!alive.shown) problems.push("置顶窗口里没有画出图片");
		if (framed && (Math.abs(alive.w - framed.w) > 4 || Math.abs(alive.h - framed.h) > 4)) {
			problems.push(`置顶窗口的尺寸和选区对不上：${alive.w}×${alive.h} vs ${framed.w}×${framed.h}`);
		}
		/*
		 * And a picture of the whole screen with it up.
		 *
		 * The window's own DOM says what it *should* look like; this says what is actually composited
		 * over the desktop, which is where a transparent always-on-top window can differ. Written next
		 * to the recording so both are to hand.
		 *
		 * The real cursor is parked in a corner first — see `parkCursor`.
		 */
		await parkCursor(8, 8);
		await pause(900);
		await execFileAsync("screencapture", ["-x", join(homedir(), "Desktop", `lyra-置顶截图-${stamp}.png`)]).catch(() => {});

		/*
		 * What the overlay is doing while a pinned picture is on screen.
		 *
		 * It sits at `screen-saver` level and a pinned shot at `floating`, so anything the overlay
		 * still has on screen is drawn *over* the picture — which is what a blue selection frame with
		 * round grips around a pinned shot would be. The capture is over by now, so the answer should
		 * be `idle` with nothing in it.
		 */
		const overlayNow = await run<string>(`JSON.stringify({
			capture: document.querySelector("[data-capture]") ? document.querySelector("[data-capture]").dataset.capture : "没有",
			selection: document.querySelector("[data-selection]") ? "还在" : "没了",
			handles: document.querySelectorAll("[data-selection] > div").length,
		})`).catch((e: unknown) => String(e));
		note(`  置顶时浮层的状态 → ${overlayNow}`);
		if (overlayNow.includes(`"selection":"还在"`)) {
			problems.push("置顶之后截图浮层还画着选区框——它在置顶图片上层，会在图片周围留下蓝框和手柄");
		}

		/*
		 * And the picture itself, on disk.
		 *
		 * The screen shot above is what is *composited*; this is what was handed over. Two very
		 * different faults look identical on screen — something drawn over the window by the system,
		 * and something baked into the image by the capture — and the only way to tell them apart is
		 * to look at the image on its own.
		 */
		const dataUrl = await pin<string>(`document.querySelector("img") ? document.querySelector("img").src : ""`);
		if (dataUrl.startsWith("data:image")) {
			const { writeFile } = await import("node:fs/promises");
			await writeFile(join(homedir(), "Desktop", `lyra-置顶原图-${stamp}.png`), Buffer.from(dataUrl.split(",")[1]!, "base64"));
			note(`  置顶用的原图已写到桌面 lyra-置顶原图-${stamp}.png`);
		}

		const onScreen = await app.evaluate<number>(`window.lyra.screenshot.pinnedCount()`);
		note(`  主进程记着 ${onScreen} 个置顶窗口`);
		if (onScreen < 1) problems.push("置顶窗口在主进程里已经不存在了——多半是被 app.hide() 一起收走了");

		// 4b. hover 才出现关闭按钮
		const hidden = await pin<string>(`(() => {
			const b = document.querySelector("[data-pinned-close]");
			return b ? getComputedStyle(b).opacity : "没有这个按钮";
		})()`);
		await mouse(pinSocket, "mouseMoved", alive.w / 2, alive.h / 2, 0);
		await pause(400);
		const shown = await pin<string>(`(() => {
			const b = document.querySelector("[data-pinned-close]");
			return b ? getComputedStyle(b).opacity : "没有这个按钮";
		})()`);
		note(`  关闭按钮 → 鼠标进来之前 opacity=${hidden}，进来之后 opacity=${shown}`);
		if (hidden !== "0") problems.push(`鼠标没放上去时关闭按钮就已经显示了（opacity=${hidden}）`);
		if (shown !== "1") problems.push(`鼠标放上去之后关闭按钮没有显示（opacity=${shown}）`);

		// 4c. 图片可以拖着走
		const from: [number, number] = [Math.round(alive.w / 2), Math.round(alive.h / 2)];
		await mouse(pinSocket, "mousePressed", from[0], from[1]);
		await pause(60);
		await mouse(pinSocket, "mouseMoved", from[0] + 120, from[1] + 90);
		await pause(200);
		await mouse(pinSocket, "mouseReleased", from[0] + 120, from[1] + 90, 0);
		await pause(300);
		const moved = await pin<{ x: number; y: number }>(`({ x: window.screenX, y: window.screenY })`);
		note(`  拖动置顶图片 → 从 (${alive.x}, ${alive.y}) 到 (${moved.x}, ${moved.y})`);
		if (Math.abs(moved.x - alive.x) < 40 || Math.abs(moved.y - alive.y) < 30) {
			problems.push(`置顶图片拖不动：(${alive.x}, ${alive.y}) → (${moved.x}, ${moved.y})`);
		}

		/*
		 * 4c-bis. And with the *real* pointer, while Lyra is not the front application.
		 *
		 * This is the state the feature is actually used in — a picture pinned over somebody else's
		 * window — and it is not the state anything above tests: a synthetic `Input.dispatchMouseEvent`
		 * is delivered to a window regardless of what macOS thinks is frontmost, so the whole hover
		 * check would pass on a window that shows nothing to a real hand.
		 *
		 * It also settles what `Input.dispatchMouseEvent` timing out after a drag means. If the real
		 * pointer gets a close button out of this window, the page is alive and answering, and the
		 * timeout belongs to the protocol rather than to the app.
		 */
		await parkCursor(moved.x + alive.w / 2, moved.y + alive.h / 2);
		await pause(900);
		const realHover = await pin<string>(`(() => {
			const b = document.querySelector("[data-pinned-close]");
			return b ? getComputedStyle(b).opacity : "没有这个按钮";
		})()`).catch((e: unknown) => `读不到（${String(e)}）`);
		note(`  真实鼠标（Lyra 不在前台）移上去 → 关闭按钮 opacity=${realHover}`);
		if (realHover !== "1") {
			problems.push(`真实鼠标移到置顶图片上时关闭按钮没有出现（opacity=${realHover}）——合成事件能触发不代表真手能`);
		}
		await parkCursor(8, 8);
		await pause(400);

		// 4d. 关闭按钮真的关得掉
		await mouse(pinSocket, "mouseMoved", alive.w / 2, alive.h / 2, 0);
		await pause(300);
		const closeAt = await pin<{ x: number; y: number } | null>(`(() => {
			const b = document.querySelector("[data-pinned-close]");
			if (!b) return null;
			const r = b.getBoundingClientRect();
			return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
		})()`);
		if (!closeAt) problems.push("置顶窗口上没有关闭按钮");
		else {
			await click(pinSocket, closeAt.x, closeAt.y);
			await pause(800);
			const left = await app.evaluate<number>(`window.lyra.screenshot.pinnedCount()`);
			note(`  点关闭之后还剩 ${left} 个置顶窗口`);
			if (left !== 0) problems.push(`点了关闭按钮，置顶窗口还在（剩 ${left} 个）`);
		}
	}

	// ---- 5. 下载到设置好的目录 -------------------------------------------
	await beat();
	note("\n【5】下载截图");
	// Also straight on: the capture above ended itself once the pinned picture was taken, and if it
	// has not, starting over one that is up is now a path with pixels behind it rather than a hazard.
	await app.evaluate(`window.lyra.screenshot.start()`);
	await pause(1_200);
	await drag(socket, [region[0], region[1]], [region[2], region[3]]);
	await pause(400);
	const pressedDownload = await pressTip(socket, run, "下载截图");
	note(`  「下载截图」按钮 → ${pressedDownload ? "按下" : "找不到"}`);
	if (!pressedDownload) problems.push("工具栏上没有「下载截图」按钮");

	await pause(500);
	const said = await run<string>(`(() => {
		const el = document.querySelector("[data-screenshot-toast]");
		return el ? el.textContent.replace(/\\s+/g, " ").trim() : "没有提示";
	})()`).catch(() => "读不到");
	note(`  提示 → 「${said}」`);
	if (!said.includes("已保存")) problems.push(`下载之后没有出现「已保存」的提示：「${said}」`);

	await pause(2_500);
	const files = await readdir(downloads).catch(() => [] as string[]);
	const png = files.find((name) => name.endsWith(".png"));
	const size = png ? (await stat(join(downloads, png))).size : 0;
	note(`  下载目录 ${downloads} → ${files.length ? files.join(", ") : "空的"}${png ? `（${size} 字节）` : ""}`);
	if (!png) problems.push("按了下载，设置的下载目录里没有出现 PNG");
	else if (size < 1_000) problems.push(`下载出来的 PNG 只有 ${size} 字节，不像一张截图`);

	// 截图会话应该已经自己结束了。
	const over = await run<boolean>(`document.querySelector('[data-capture="active"]') === null`).catch(() => true);
	note(`  下载之后截图${over ? "已退出" : "还开着"}`);
	if (!over) problems.push("下载完成之后截图没有自动退出");

	// ---- 6. 正在输入的文字也要进图 ---------------------------------------
	await beat();
	note("\n【6】还在输入框里的文字，点下载时也要画进图里");
	/*
	 * The failure this looks for is silent and total: a caption lives in a `<textarea>` over the
	 * canvas until it is committed, and what commits it is that field losing focus — which the
	 * toolbar deliberately never causes, because pressing 粗 while writing has to resize the caption
	 * rather than end it. So 完成 pressed with the cursor still in a caption produced a picture
	 * without the words that were plainly on screen, and nothing said so.
	 *
	 * Counted in pixels of the caption's own colour, because the state was right the whole time —
	 * only the bitmap was wrong. `#ef4444` is the default, and a Lyra window has almost none of it.
	 */
	const seen = new Set(await readdir(downloads).catch(() => [] as string[]));
	const justSaved = async (): Promise<string | null> => {
		const fresh = (await readdir(downloads)).filter((name) => name.endsWith(".png") && !seen.has(name));
		if (fresh.length !== 1) return null;
		seen.add(fresh[0]!);
		return join(downloads, fresh[0]!);
	};
	const redPixels = async (file: string): Promise<number> => {
		const { readFile } = await import("node:fs/promises");
		const png = await readFile(file);
		// Through a data URL, because the overlay's `img-src` is `self data: blob:` and stays that
		// way — and its canvas is the only PNG decoder to hand.
		return run<number>(`(async () => {
			const img = new Image();
			img.src = "data:image/png;base64,${png.toString("base64")}";
			await img.decode();
			const c = document.createElement("canvas");
			c.width = img.width; c.height = img.height;
			const ctx = c.getContext("2d");
			ctx.drawImage(img, 0, 0);
			const d = ctx.getImageData(0, 0, c.width, c.height).data;
			let n = 0;
			for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 100 && d[i + 2] < 100) n++;
			return n;
		})()`);
	};

	await pause(900);
	await app.evaluate(`window.lyra.screenshot.start()`);
	await pause(1_200);
	await drag(socket, [region[0], region[1]], [region[2], region[3]]);
	await pause(400);
	await pressTip(socket, run, "文字");
	await pause(300);
	// Inside the region, clear of its resize grips.
	await click(socket, region[0] + Math.round((region[2] - region[0]) * 0.3), region[1] + Math.round((region[3] - region[1]) * 0.4));
	await pause(500);
	const field = await run<boolean>(`document.querySelector("textarea") !== null`);
	note(`  选了文字工具并点进选区 → ${field ? "输入框出现了" : "没有输入框"}`);
	if (!field) problems.push("选了文字工具在选区里点一下，没有出现输入框");
	await call(socket, "Input.insertText", { text: "测试文字ABC" });
	await pause(700);
	const written = await run<string>(`document.querySelector("textarea")?.value ?? ""`);
	note(`  输入框里 → 「${written}」（不点别处，直接按下载）`);
	await pressTip(socket, run, "下载截图");
	await pause(2_800);
	const saved = await justSaved();
	const reds = saved ? await redPixels(saved) : -1;
	note(`  下载下来的图里 → ${reds} 个红色像素（修之前是 0：文字还在输入框里，没进画布）`);
	if (reds < 200) {
		problems.push(`正在输入的文字没有画进图里（红色像素 ${reds}）——按下「下载」时输入框里的字还没提交到画布上`);
	}
} finally {
	await stopRecording();
	await app.stop();
}

console.log("\n────────────────────────────────");
if (problems.length === 0) {
	console.log("✅ 全部通过");
} else {
	console.log(`❌ ${problems.length} 个问题：`);
	for (const line of problems) console.log(`   • ${line}`);
}
console.log(`🎬 录屏：${CLIP}`);
process.exit(problems.length === 0 ? 0 : 1);
