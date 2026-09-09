/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 标注工具栏变宽之后，还在不在屏幕上。
 *
 * 这一条不是几何算错了——`toolbarPosition` 一直把右边界钳在视口内。问题在喂给它的数字：工具栏
 * 的尺寸是用一个 ref 回调量的，那种回调在元素挂载时跑一次，之后再不跑。而这根条不保持它初生
 * 时的宽度：选中一个图形，「删除选中」就加进这一行；换一把带属性的工具，那一组控件也跟着变。
 * 于是钳制拿着一根更窄的条去算，真正画出来的那根挂在屏幕外面。
 *
 * 报告说的「依然存在」正是这个意思：位置的算术早就修过了，喂给它的测量停在了第一帧。
 *
 * 所以这里量的不是函数，是**画出来的那根条**：进标注、画一个矩形（画完即选中，「删除选中」出
 * 现）、把条拖到右边缘，每一步都读一次 `getBoundingClientRect()`，看它有没有越过视口。
 *
 * 用法：node --experimental-strip-types e2e/toolbar-width-probe.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { call, evaluateRenderer, startApp } from "./app.ts";

const PORT = 9498;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seed(home: string): Promise<void> {
	await mkdir(join(home, "proj"), { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
}

const app = await startApp({ port: PORT, seed });

/*
 * The overlay is its own window, so it is its own CDP target.
 *
 * `app.evaluate` talks to the main renderer, and the capture overlay is not in it — a probe that
 * asks the main window about the toolbar is told, truthfully, that there is no toolbar.
 */
interface Overlay {
	run: (expression: string) => Promise<unknown>;
	/*
	 * Real input, not a synthesised event.
	 *
	 * `dispatchEvent(new PointerEvent(...))` is delivered but not trusted, and the selection
	 * gesture never starts from it — the overlay stays in its "nothing picked yet" state and there
	 * is no toolbar to measure. Every other probe in here that presses something goes through
	 * `Input.*` for the same reason.
	 */
	drag: (from: [number, number], via: [number, number][], to: [number, number]) => Promise<void>;
}

async function overlay(): Promise<Overlay> {
	for (let i = 0; i < 40; i++) {
		await pause(250);
		const list = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())) as {
			type: string;
			url: string;
			webSocketDebuggerUrl?: string;
		}[];
		const found = list.find((t) => t.type === "page" && t.url.includes("screenshot-overlay"));
		if (found?.webSocketDebuggerUrl) {
			const socket = found.webSocketDebuggerUrl;
			const mouse = (type: string, [x, y]: [number, number]) =>
				call<unknown>(socket, "Input.dispatchMouseEvent", {
					type,
					x,
					y,
					button: "left",
					buttons: type === "mouseReleased" ? 0 : 1,
					clickCount: 1,
				});
			return {
				run: (expression: string) => evaluateRenderer(socket, expression),
				drag: async (from, via, to) => {
					await mouse("mousePressed", from);
					for (const point of via) {
						await mouse("mouseMoved", point);
						await pause(40);
					}
					await mouse("mouseMoved", to);
					await pause(40);
					await mouse("mouseReleased", to);
				},
			};
		}
	}
	throw new Error("截图浮层窗口没有出现");
}

/** The bar's box, and whether any of it is off screen. */
const BAR = `(() => {
	const el = document.querySelector('[data-annotate-bar]');
	if (!el) return null;
	const r = el.getBoundingClientRect();
	return {
		left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
		vw: window.innerWidth,
		over: Math.round(Math.max(0, r.right - window.innerWidth) + Math.max(0, -r.left)),
	};
})()`;

interface Box { left: number; right: number; width: number; vw: number; over: number }

const problems: string[] = [];
const report = (stage: string, box: Box | null) => {
	if (!box) {
		problems.push(`${stage}：找不到工具栏`);
		console.log(`  ${stage.padEnd(16)} 找不到工具栏`);
		return;
	}
	const verdict = box.over > 0 ? `✗ 溢出 ${box.over}px` : "✓";
	console.log(`  ${stage.padEnd(16)} 宽 ${String(box.width).padStart(4)}  右缘 ${String(box.right).padStart(5)} / ${box.vw}  ${verdict}`);
	if (box.over > 0) problems.push(`${stage}：溢出 ${box.over}px`);
	return box;
};

try {
	await pause(2600);
	await app.evaluate(`window.lyra.screenshot.start()`);
	const { run, drag } = await overlay();
	await pause(900);

	// 拖一个贴着右边缘的选区——自动放置会把条右对齐到选区，这是最容易顶出去的位置。
	const view = (await run(`({ w: window.innerWidth, h: window.innerHeight })`)) as { w: number; h: number };
	await drag([view.w - 420, 200], [[view.w - 300, 300]], [view.w - 8, 460]);
	await pause(900);

	console.log("");
	const bare = (await run(BAR)) as Box | null;
	report("刚出现", bare);

	// 画一个矩形。画完即选中，于是「删除选中」加进这一行——报告里说的正是这一步。
	await run(`(() => {
		const tool = [...document.querySelectorAll('[data-capture="active"] button')].find((b) => /矩形|Rectangle|长方形|사각형|Прямоугольник/.test(b.getAttribute("aria-label") ?? b.getAttribute("data-ly-tip") ?? ""));
		if (tool) tool.click();
	})()`);
	await pause(500);
	await drag([view.w - 380, 240], [[view.w - 300, 300]], [view.w - 200, 380]);
	await pause(700);

	const drawn = (await run(BAR)) as Box | null;
	report("画了个矩形", drawn);
	if (bare && drawn && drawn.width <= bare.width) {
		console.log(`  （宽度没变：${bare.width} → ${drawn.width}，「删除选中」可能没出现，这一步没试到）`);
	}

	// 再把条拖到右边缘：拖完之后宽度还会变，而手动位置从前是拖完就不再钳的。
	await run(`(() => {
		const grip = document.querySelector('[data-capture="active"] [data-toolbar-grip], [data-capture="active"] [aria-label*="拖"]');
		if (!grip) return;
		const r = grip.getBoundingClientRect();
		const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		grip.dispatchEvent(new PointerEvent("pointerdown", { clientX: from.x, clientY: from.y, bubbles: true, pointerId: 3, isPrimary: true, button: 0 }));
		for (const step of [0.4, 0.7, 1]) {
			const x = from.x + (window.innerWidth - from.x) * step;
			window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: from.y, bubbles: true, pointerId: 3, isPrimary: true }));
		}
		window.dispatchEvent(new PointerEvent("pointerup", { clientX: window.innerWidth, clientY: from.y, bubbles: true, pointerId: 3, isPrimary: true, button: 0 }));
	})()`);
	await pause(700);
	report("拖到右边缘", (await run(BAR)) as Box | null);

	console.log(problems.length === 0 ? "\n工具栏始终在屏幕内\n" : `\n${problems.length} 处越界：\n${problems.map((p) => `  ✗ ${p}`).join("\n")}\n`);
	process.exitCode = problems.length === 0 ? 0 : 1;
} finally {
	await app.evaluate(`window.lyra.screenshot.cancel()`).catch(() => {});
	await app.stop();
}
