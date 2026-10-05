/**
 * The annotator's reported defects, driven through the real component.
 *
 * `node --experimental-strip-types e2e/annotator-probe.ts [dir]`
 *
 * Through the image viewer rather than the capture overlay, deliberately: the overlay needs
 * screen-recording permission and a real capture, while the thing under test — `useAnnotator` —
 * is the same hook either way. What is exercised here is the actual component in an actual
 * window, not a reimplementation of its logic in the probe, which would only prove the probe
 * agrees with itself.
 *
 * The one that matters most is the mosaic. Its averaged copies were cached in a ref that was
 * never cleared, so a second picture was redacted with the *first* picture's pixels: the block
 * did not cover what was under it, and it showed content from somewhere else. Two solid-colour
 * images make that unambiguous — if the mosaic over the red one comes out teal, the cache is
 * stale.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9493;

interface Target {
	type: string;
	url: string;
	webSocketDebuggerUrl?: string;
}

/** Every debuggable page, which is how the capture overlay — a second window — is reached. */
async function targets(): Promise<Target[]> {
	return (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())) as Target[];
}

/** One call, one socket — the arrangement `app.ts` and `screenshot-probe.ts` both use. */
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
			setTimeout(() => reject(new Error(`${method} 超时`)), 30_000);
		});
		socket.send(JSON.stringify({ id: 1, method, params }));
		return await answer;
	} finally {
		socket.close();
	}
}

/** Run an expression in the overlay window and get the value back. */
function evaluator(socket: string) {
	return async <T>(expression: string): Promise<T> => {
		const result = (await call(socket, "Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		})) as { result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } };
		if (result.exceptionDetails) {
			throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
		}
		return result.result.value;
	};
}


const dir = process.argv[2] ?? "/tmp/lyra-annotator";

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`${passed ? "✓" : "✗"} ${label}\n    ${evidence}\n`);
}

async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4539, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

const app = await startApp({ port: PORT, seed });
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

/** The capture overlay's window, once it exists. */
async function overlay(): Promise<((expression: string) => Promise<unknown>) | null> {
	for (let attempt = 0; attempt < 30; attempt++) {
		const found = (await targets()).find((t) => t.type === "page" && t.url.includes("screenshot-overlay"));
		if (found?.webSocketDebuggerUrl) return evaluator(found.webSocketDebuggerUrl) as never;
		await settle(300);
	}
	return null;
}

try {
	await mkdir(dir, { recursive: true });
	await settle(2400);

	/**
	 * Capture, drag a mosaic across a fixed spot, and report what colour it came out.
	 *
	 * Run twice with the window's theme flipped in between, which changes what is actually on the
	 * screen at that spot. The mosaic averages the *current* capture, so the second run must come
	 * back a different brightness — if it repeats the first, the averaged copies were still cached
	 * from the previous picture, which is the bug.
	 */
	async function mosaicRound(label: string): Promise<number> {
		await app.evaluate(`window.lyra.screenshot.start()`);
		await settle(2000);
		const window = await overlay();
		if (!window) return -1;
		const evaluate = window as <T>(expression: string) => Promise<T>;
		const brightness = await evaluate<number>(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const first = document.querySelector("canvas");
			const send = (el, type, x, y, buttons) => el.dispatchEvent(new PointerEvent(type, {
				bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons, isPrimary: true,
			}));
			first.setPointerCapture = () => {};
			send(first, "pointerdown", 200, 200, 1);
			await wait(50);
			send(first, "pointermove", 700, 560, 1);
			await wait(50);
			send(first, "pointerup", 700, 560, 0);
			await wait(900);

			const all = document.querySelectorAll("canvas");
			const canvas = all[all.length - 1];
			canvas.setPointerCapture = () => {};
			canvas.releasePointerCapture = () => {};
			document.querySelector('button[data-ly-tip="马赛克"]').click();
			await wait(400);
			send(canvas, "pointerdown", 320, 300, 1);
			await wait(40);
			for (let i = 0; i <= 8; i++) { send(canvas, "pointermove", 320 + i * 25, 300, 1); await wait(30); }
			send(canvas, "pointerup", 520, 300, 0);
			await wait(800);

			// The average brightness where the mosaic went, in the annotation canvas's own pixels.
			const box = canvas.getBoundingClientRect();
			const x = Math.round(((420 - box.left) / box.width) * canvas.width);
			const y = Math.round(((300 - box.top) / box.height) * canvas.height);
			const px = canvas.getContext("2d").getImageData(x - 8, y - 8, 16, 16).data;
			let sum = 0;
			for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
			return Math.round(sum / (px.length / 4));
		})()`);
		await evaluate(`(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true; })()`);
		await settle(1200);
		process.stdout.write(`  ${label}：马赛克处平均亮度 ${brightness}\n`);
		return brightness;
	}

	process.stdout.write("── 马赛克采样的是当前这张，还是上一张 ──\n");
	const darkRound = await mosaicRound("深色界面");

	// Flip the window to light, which changes what is under that exact spot.
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		document.querySelector("[data-ly-open-settings]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await wait(1000);
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "外观")?.click();
		await wait(900);
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "浅色")?.click();
		await wait(1200);
		return true;
	})()`);
	await settle(1800);

	const lightRound = await mosaicRound("浅色界面");
	check(
		"换了界面之后，马赛克采的是新画面而不是上一张",
		darkRound >= 0 && lightRound >= 0 && Math.abs(lightRound - darkRound) > 40,
		`深色 ${darkRound} → 浅色 ${lightRound}，差 ${Math.abs(lightRound - darkRound)}（相同则说明缓存没清）`,
	);

	process.stdout.write("\n── 截图标注：真窗口 ──\n");
	await app.evaluate(`window.lyra.screenshot.start()`);
	await settle(2200);

	const run = await overlay();
	if (!run) {
		check("截图浮层起来了", false, "等不到 screenshot-overlay 窗口（多半是没给屏幕录制权限）");
	} else {
		const evaluate = run as <T>(expression: string) => Promise<T>;

		/* A region, so the toolbar and canvas appear. */
		const framed = await evaluate<string>(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			// The overlay's own root, not the document body: its handler is a capture listener on a
			// div *inside* body, and a capture listener only sees events whose path runs through it.
			// Dispatching at body puts the target above that div, so the press never arrives.
			const root = document.querySelector("canvas") ?? document.querySelector("#root > div") ?? document.body;
			const send = (type, x, y, buttons) => root.dispatchEvent(new PointerEvent(type, {
				bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons, isPrimary: true,
			}));
			root.setPointerCapture = () => {};
			send("pointerdown", 200, 200, 1);
			await wait(50);
			send("pointermove", 700, 560, 1);
			await wait(50);
			send("pointerup", 700, 560, 0);
			await wait(900);
			return document.querySelector("canvas") ? "ok" : "没有画布";
		})()`);
		check("框出了一块区域，画布出现了", framed === "ok", framed);

		/*
		 * The edge strips: real elements above the canvas, each carrying `cursor: move`.
		 *
		 * This is the whole of the first fix — the cursor has to come from an element the pointer
		 * actually lands on, because the canvas covers the region and a child's cursor wins.
		 */
		const edge = await evaluate<{ strips: number; cursor: string; onTop: boolean; grab: number }>(`(() => {
			const frame = document.querySelector("[data-selection]");
			if (!frame) return { strips: 0, cursor: "无", onTop: false, grab: 0 };
			const strips = [...frame.children].filter((el) => getComputedStyle(el).cursor === "move");
			if (strips.length === 0) return { strips: 0, cursor: "无", onTop: false, grab: 0 };
			const box = strips[0].getBoundingClientRect();
			// What the browser says is under a point on the top edge — the strip, not the canvas.
			const frameBox = frame.getBoundingClientRect();
			// A quarter along the top edge, which avoids the handles at the corners and the midpoint.
			const hit = document.elementFromPoint(frameBox.left + frameBox.width * 0.25, frameBox.top);
			return {
				strips: strips.length,
				cursor: hit ? getComputedStyle(hit).cursor : "无",
				onTop: strips.includes(hit),
				grab: Math.round(Math.max(box.width, box.height) < Math.max(frameBox.width, frameBox.height) ? Math.min(box.width, box.height) : 0),
			};
		})()`);

		check("四条边缘都带 move 光标", edge.strips === 4, `${edge.strips} 条`);
		check("边缘上真正命中的是边缘条，不是画布", edge.onTop, edge.onTop ? "命中边缘条" : "命中了别的元素");
		check("在边缘取到的光标就是 move", edge.cursor === "move", edge.cursor);
		check("抓取宽度放宽到了 14px", edge.grab === 14, `${edge.grab}px`);

		/*
		 * The bubble's tip points at the button it belongs to, not away from it.
		 *
		 * It is a square rotated 45° with two borders kept; which two, and whether it hangs off the
		 * top or the bottom, is what decides where it aims. It used to be bottom-and-down always,
		 * so whenever the bubble opened *below* the toolbar the tip aimed at empty screen.
		 */
		const tip = await evaluate<{ found: boolean; above: boolean; sameSide: boolean; note: string }>(`(() => {
			const bubble = [...document.querySelectorAll("div")].find((d) => {
				const text = (d.textContent || "").trim();
				return text.startsWith("细") && text.includes("粗") && d.querySelector("span.rotate-45");
			});
			if (!bubble) return { found: false, above: false, sameSide: false, note: "找不到气泡" };
			const point = bubble.querySelector("span.rotate-45");
			const bar = [...document.querySelectorAll("div")].find((d) => d.querySelector('button[data-ly-tip="矩形"]'));
			if (!point || !bar) return { found: false, above: false, sameSide: false, note: "找不到尖角或工具条" };
			const p = point.getBoundingClientRect();
			const b = bubble.getBoundingClientRect();
			const t = bar.getBoundingClientRect();
			// Which half of the bubble the tip hangs off, and where the toolbar is relative to it.
			const tipOnTop = p.top < b.top + b.height / 2;
			const barAbove = t.top < b.top;
			return {
				found: true,
				above: barAbove,
				sameSide: tipOnTop === barAbove,
				note: "工具条在气泡" + (barAbove ? "上方" : "下方") + "，尖角在气泡" + (tipOnTop ? "顶部" : "底部"),
			};
		})()`);
		check("尖角指向工具条那一侧，而不是背对着它", tip.found && tip.sameSide, tip.note);

		/* Colour and size, applied to the mark that is selected. */
		const restyle = await evaluate<{ before: string; after: string; weightBefore: number; weightAfter: number }>(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			// Two canvases exist once a region is framed: the frozen screen, then the annotation
			// layer on top. The marks go on the last one; dispatching at the first sends the press
			// to the wrong element, and the stroke is never drawn.
			const all = document.querySelectorAll("canvas");
			const canvas = all[all.length - 1];
			if (all.length < 2) return { before: "只有 " + all.length + " 个 canvas，标注层没出现", after: "", weightBefore: 0, weightAfter: 0 };
			canvas.setPointerCapture = () => {};
			canvas.releasePointerCapture = () => {};
			const send = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
				bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons, isPrimary: true,
			}));
			// A rectangle, which selects itself the moment it is drawn.
			document.querySelector('button[data-ly-tip="矩形"]')?.click();
			await wait(300);
			// Inside the region framed above (200,200 → 700,560). A mark drawn outside it is
			// discarded, which is what an earlier version of this probe was unknowingly doing.
			send("pointerdown", 320, 300, 1);
			await wait(40);
			send("pointermove", 560, 460, 1);
			await wait(40);
			send("pointerup", 560, 460, 0);
			await wait(700);

			/*
			 * Count pixels of each hue instead of sampling one point.
			 *
			 * The canvas holds the frozen screen underneath the marks, so "the most saturated pixel"
			 * finds something in the wallpaper rather than the rectangle. Counting how many pixels
			 * are unmistakably red and how many are unmistakably green answers the actual question:
			 * did the mark that was already drawn change colour, or only the next one.
			 */
			const tally = () => {
				const px = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
				let red = 0, green = 0;
				for (let i = 0; i < px.length; i += 4) {
					const r = px[i], g = px[i + 1], b = px[i + 2];
					if (r > 190 && g < 110 && b < 110) red++;
					else if (g > 150 && r < 130 && b < 130) green++;
				}
				return { red, green };
			};
			const before = tally();

			const green = document.querySelector('button[aria-label="绿色"]');
			if (!green) return { before: "找不到绿色按钮", after: "", weightBefore: 0, weightAfter: 0 };
			green.click();
			await wait(700);
			const after = tally();

			// Size, on the same still-selected mark: a thicker stroke paints more pixels of it.
			const thin = document.querySelector('button[aria-label="粗细 细"]');
			const thick = document.querySelector('button[aria-label="粗细 粗"]');
			thin?.click(); await wait(500);
			const weightBefore = tally().green;
			thick?.click(); await wait(500);
			const weightAfter = tally().green;

			return {
				before: "红 " + before.red + " / 绿 " + before.green,
				after: "红 " + after.red + " / 绿 " + after.green,
				weightBefore,
				weightAfter,
			};
		})()`);

		process.stdout.write(`  选中矩形改颜色：${restyle.before} → ${restyle.after}\n`);
		/*
		 * Red giving way to green, pixel for pixel, is the whole claim.
		 *
		 * The frozen screen underneath contributes a fixed number of both, so neither count starts
		 * at zero — what matters is that the red the rectangle added disappears and the same amount
		 * of green appears. That is one mark changing colour, not a setting that only applies to
		 * whatever gets drawn next.
		 */
		const [redBefore, greenBefore] = String(restyle.before).match(/\d+/g)!.map(Number);
		const [redAfter, greenAfter] = String(restyle.after).match(/\d+/g)!.map(Number);
		check(
			"改颜色改的是选中的那个矩形（红退绿进）",
			redBefore - redAfter > 3000 && greenAfter - greenBefore > 3000,
			`红 -${redBefore - redAfter}，绿 +${greenAfter - greenBefore}`,
		);
		check(
			"改粗细也作用在它身上（画出的像素变多了）",
			restyle.weightAfter > restyle.weightBefore,
			`细 ${restyle.weightBefore} 像素 → 粗 ${restyle.weightAfter} 像素`,
		);

		/*
		 * The caption box: wide enough for its placeholder when empty, tight to the text when not.
		 *
		 * Both halves of one complaint. A floor guessed in character counts squeezed a
		 * four-character placeholder into a one-character column, so it wrapped and stacked
		 * vertically; and an allowance added after the padding landed entirely on the right, so a
		 * finished caption sat with visible空 to the right of its last glyph.
		 */
		const caption = await evaluate<{
			empty: { width: number; lines: number; placeholder: number };
			filled: { width: number; text: number; padding: number };
		}>(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			document.querySelector('button[data-ly-tip="文字"]').click();
			await wait(400);
			const all = document.querySelectorAll("canvas");
			const canvas = all[all.length - 1];
			canvas.setPointerCapture = () => {};
			const send = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
				bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons, isPrimary: true,
			}));
			send("pointerdown", 340, 320, 1);
			await wait(60);
			send("pointerup", 340, 320, 0);
			await wait(700);

			const field = document.querySelector("textarea");
			if (!field) return { empty: { width: 0, lines: 0, placeholder: 0 }, filled: { width: 0, text: 0, padding: 0 } };
			const style = getComputedStyle(field);
			const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);

			// How wide the placeholder needs, measured with the field's own font.
			const probe = document.createElement("canvas").getContext("2d");
			probe.font = style.font;
			const placeholder = probe.measureText("输入文字").width;
			const emptyBox = field.getBoundingClientRect();
			// One line means it fits; more means it wrapped and stacked.
			const lines = Math.round(field.scrollHeight / (parseFloat(style.fontSize) * 1.35));

			// Now type, and see how much room is left past the last glyph.
			const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
			setter.call(field, "这是一句明显长于占位符的说明文字");
			field.dispatchEvent(new Event("input", { bubbles: true }));
			await wait(600);
			const after = document.querySelector("textarea");
			const filledBox = after.getBoundingClientRect();
			const textWidth = probe.measureText("这是一句明显长于占位符的说明文字").width;
			return {
				empty: { width: Math.round(emptyBox.width), lines, placeholder: Math.round(placeholder) },
				filled: { width: Math.round(filledBox.width), text: Math.round(textWidth), padding: Math.round(padding) },
			};
		})()`);

		process.stdout.write(
			`  空框 ${caption.empty.width}px（占位符需 ${caption.empty.placeholder}px，占 ${caption.empty.lines} 行）\n` +
				`  有字 ${caption.filled.width}px（文字 ${caption.filled.text}px + 内边距 ${caption.filled.padding}px）\n`,
		);
		check("空框放得下占位符，不换行", caption.empty.lines === 1, `${caption.empty.lines} 行`);
		check(
			"空框宽度确实容得下占位符",
			caption.empty.width >= caption.empty.placeholder,
			`${caption.empty.width} >= ${caption.empty.placeholder}`,
		);
		// The box may exceed text+padding only by a caret's worth — a few pixels, not a third of a glyph.
		const slack = caption.filled.width - caption.filled.text - caption.filled.padding;
		check("有字时右边只留一个光标的位置", slack >= 0 && slack <= 6, `多出 ${slack}px`);
		// And that this is a real fit rather than the floor happening to match: the text must be
		// wide enough that the floor is not what decided the width.
		check(
			"这段文字确实比占位符长，测的不是下限",
			caption.filled.text > caption.empty.placeholder * 1.5,
			`文字 ${caption.filled.text}px vs 占位符 ${caption.empty.placeholder}px`,
		);

		const shot = await call<{ data: string }>(
			(await targets()).find((t) => t.url.includes("screenshot-overlay"))!.webSocketDebuggerUrl!,
			"Page.captureScreenshot",
			{ format: "png" },
		);
		await writeFile(join(dir, "overlay.png"), Buffer.from(shot.data, "base64"));

		await evaluate(`(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true; })()`);
		await settle(600);
	}

	process.stdout.write(`\n截图：${dir}\n`);
} finally {
	await app.stop();
}

process.exit(failures === 0 ? 0 : 1);
