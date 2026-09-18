/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 把「展开一个工具组」这一下录下来，连同点中那个按钮每一帧在哪。
 *
 * 数字（`jump-probe`）已经说清楚了：修之前点中的按钮会飞出视口 1952px。但数字说服不了眼睛，
 * 而这件事本来就是给眼睛看的。所以这里逐帧截屏，同时记下按钮此刻的位置——后面那半是关键：
 * 光有图，读图的人还得自己找按钮跑哪去了；带上坐标就能在图上把它圈出来，再画一条按下时的
 * 水平线，跑没跑一眼可见。
 *
 * 帧不是 rAF 逐帧（每张截图要走一次 CDP 往返，抓不到 60fps），而是按固定间隔采样。判据仍然
 * 由 `jump-probe` 给，这里只负责让人看见。
 *
 * 输出：`/tmp/lyra-rec-<tag>/frame-*.png` 和 `meta.json`。
 *
 * 用法：node --experimental-strip-types e2e/expand-recording.ts <tag>
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const TAG = process.argv[2] ?? "after";
const OUT = `/tmp/lyra-rec-${TAG}`;
const PORT = 9707;
const FRAMES = 10;
const EVERY_MS = 70;
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

const TOOL = "调用工具|使用了工具|Used \\d+ tool";

/** 那颗按钮此刻在视口的哪个方框里；不在页面上就是 null。 */
const WHERE = `(() => {
	const b = window.__btn;
	if (!b || !b.isConnected) return null;
	const r = b.getBoundingClientRect();
	return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
})()`;

async function shoot(index: number): Promise<{ i: number; at: number; box: { x: number; y: number; w: number; h: number } | null; scrollTop: number }> {
	const box = await evaluate<{ x: number; y: number; w: number; h: number } | null>(WHERE);
	const scrollTop = await evaluate<number>(
		`(() => { const el = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view'); return el ? Math.round(el.scrollTop) : -1; })()`,
	);
	const png = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `frame-${String(index).padStart(2, "0")}.png`), Buffer.from(png.data, "base64"));
	return { i: index, at: index * EVERY_MS, box, scrollTop };
}

async function main(): Promise<void> {
	await rm(OUT, { recursive: true, force: true });
	await mkdir(OUT, { recursive: true });
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		for (let i = 0; i < 10; i++) {
			const more = await evaluate<boolean>(`(() => {
				const b = [...document.querySelectorAll("button")].find((el) => /展开显示|Show \\d+ more/.test(el.innerText || ""));
				if (!b) return false;
				b.click();
				return true;
			})()`);
			if (!more) break;
			await new Promise((r) => setTimeout(r, 200));
		}
		const row = await evaluate<{ x: number; y: number } | null>(`(() => {
			const rows = [...document.querySelectorAll('[data-ly-row]')];
			/*
			 * 必须是同一个会话，找不到就失败。
			 *
			 * 这里本来有个退到第一行的兜底，结果修复前那一趟没找到目标行、真的退了——两排对比
			 * 图拍的是两个不同的会话，结论还在，但对照不严谨。
			 *
			 * 注入的代码里不写反引号：这段注释还要在外层模板串里活一遍，一个反引号就能截断它。
			 */
			const r0 = rows.find((r) => (r.innerText || '').includes('整理图片需求到文档'));
			if (!r0) return null;
			r0.scrollIntoView({ block: "center" });
			const r = r0.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`);
		if (!row) { console.log("侧边栏里没有那一行"); return; }
		for (const type of ["mousePressed", "mouseReleased"] as const) {
			await app.send("Input.dispatchMouseEvent", { type, x: row.x, y: row.y, button: "left", clickCount: 1 });
		}
		await until(`document.querySelectorAll('[data-ly-run]').length > 0`, 25000).catch(() => {});
		await new Promise((r) => setTimeout(r, 900));

		// 收起，让录的是展开那一下。
		await evaluate(`(() => {
			const b = [...document.querySelectorAll('button')].find((el) => new RegExp(${JSON.stringify(TOOL)}).test(el.innerText || ''));
			if (b && b.getAttribute('aria-expanded') === 'true') b.click();
			return true;
		})()`);
		await new Promise((r) => setTimeout(r, 800));

		// 抓住那颗按钮存起来：展开之后它上面的字会变，按文案再也找不回同一个节点。
		const at = await evaluate<{ x: number; y: number } | null>(`(() => {
			const b = [...document.querySelectorAll('button')].find((el) => new RegExp(${JSON.stringify(TOOL)}).test(el.innerText || ''));
			if (!b) return null;
			b.scrollIntoView({ block: "center" });
			window.__btn = b;
			const r = b.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`);
		if (!at) { console.log("找不到工具组按钮"); return; }
		await new Promise((r) => setTimeout(r, 500));

		const meta: unknown[] = [];
		meta.push(await shoot(0)); // 按下之前
		for (const type of ["mousePressed", "mouseReleased"] as const) {
			await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
		}
		for (let i = 1; i < FRAMES; i++) {
			await new Promise((r) => setTimeout(r, EVERY_MS));
			meta.push(await shoot(i));
		}
		await writeFile(join(OUT, "meta.json"), JSON.stringify({ tag: TAG, everyMs: EVERY_MS, click: at, frames: meta }, null, 2));
		console.log(`${TAG}: ${FRAMES} 帧写到 ${OUT}`);
		for (const m of meta as { i: number; at: number; box: { y: number } | null; scrollTop: number }[]) {
			console.log(`  ${String(m.at).padStart(4)}ms  按钮 y=${m.box ? m.box.y : "不在页面上"}  scrollTop=${m.scrollTop}`);
		}
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
