/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 一个一百多张图的会话，**第一次**打开要付多少钱。
 *
 * 这是人真正遇到的那一次：图还内联在 jsonl 里，显示缓存没有，缩略图一张都没算过。之前几个探针
 * 量的都是第二次以后——`seedFromReal` 把整个 `~/.lyra` 复制过来，连缓存一起，于是量到的是热的。
 *
 * 所以跑之前先清三样：显示缓存（`*.display.json`）、外置出来的图（`session-media/`）、缩略图
 * （`session-media/thumbs/`）。然后打开那个会话、从头滚到尾，把每一张图都带进视口。
 *
 * 判据还是主进程答不答话：渲染进程每 25ms 打一次最便宜的 IPC，记最长的一次往返。主进程被占住
 * 的那段时间里整个应用是哑的——窗口不动、菜单不开、别的会话也点不开，而这正是「卡」。
 *
 * 用法：node --experimental-strip-types e2e/cold-images-probe.ts
 */

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9703;
/** 本机图最多的那个：109 张，61 MB。 */
const TARGET = "对话窗口回弹跳动问题总结";
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

/** 把这个 profile 弄成「从来没打开过任何会话」的样子。 */
async function makeCold(home: string): Promise<void> {
	await rm(join(home, "session-media"), { recursive: true, force: true });
	const root = join(home, "sessions");
	let caches = 0;
	for (const dir of await readdir(root, { withFileTypes: true }).catch(() => [])) {
		if (!dir.isDirectory()) continue;
		for (const name of await readdir(join(root, dir.name)).catch(() => [])) {
			if (!name.endsWith(".display.json")) continue;
			await rm(join(root, dir.name, name), { force: true });
			caches++;
		}
	}
	console.log(`清掉 ${caches} 份显示缓存，外置的图和缩略图整个删掉——现在是真冷的`);
}

const WATCH = `(() => {
	const out = { pings: [], gaps: [], done: false, start: performance.now() };
	window.__cold = out;
	let last = performance.now();
	const tick = () => {
		const now = performance.now();
		out.gaps.push(Math.round(now - last));
		last = now;
		if (!out.done) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	(async () => {
		while (!out.done) {
			const at = performance.now();
			try { await window.lyra.sessions.running('probe-ping'); } catch (e) {}
			out.pings.push(Math.round(performance.now() - at));
			await new Promise((r) => setTimeout(r, 25));
		}
	})();
	return true;
})()`;

async function main(): Promise<void> {
	app = await startApp({
		port: PORT,
		seed: async (home) => {
			await seedFromReal(home);
			await makeCold(home);
		},
	});
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

		const at = await evaluate<{ x: number; y: number } | null>(`(() => {
			const rows = [...document.querySelectorAll('[data-ly-row]')];
			const row = rows.find((r) => (r.innerText || '').includes(${JSON.stringify(TARGET)}));
			if (!row) return null;
			row.scrollIntoView({ block: "center" });
			const r = row.getBoundingClientRect();
			if (r.width === 0) return null;
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`);
		if (!at) {
			console.log(`侧边栏里没有「${TARGET}」`);
			return;
		}

		await evaluate(WATCH);
		const clickedAt = Date.now();
		for (const type of ["mousePressed", "mouseReleased"] as const) {
			await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
		}
		await until(`document.querySelectorAll('[data-ly-run]').length > 0`, 40000).catch(() => {});
		const firstPaint = Date.now() - clickedAt;

		// 把整段转录走一遍，每一张图都带进视口——图是懒加载的，不路过就不会有人去取。
		const spot = await evaluate<{ x: number; y: number } | null>(`(() => {
			const el = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view');
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`);
		if (spot) {
			await evaluate(`(() => { const el = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view'); if (el) el.scrollTop = 0; return true; })()`);
			for (let i = 0; i < 60; i++) {
				await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: spot.x, y: spot.y, deltaX: 0, deltaY: 300, pointerType: "mouse" });
				await new Promise((r) => setTimeout(r, 45));
			}
		}
		await new Promise((r) => setTimeout(r, 1500));
		await evaluate(`(() => { if (window.__cold) window.__cold.done = true; return true; })()`);

		const shot = await evaluate<{ pings: number[]; gaps: number[] }>(
			`(() => ({ pings: window.__cold.pings, gaps: window.__cold.gaps }))()`,
		);
		const painted = await evaluate<{ total: number; ok: number }>(`(() => {
			const all = [...document.querySelectorAll('img')].filter((el) => (el.currentSrc || el.src || '').indexOf('ly-media:') === 0);
			return { total: all.length, ok: all.filter((el) => el.complete && el.naturalWidth > 0).length };
		})()`);
		const pings = [...shot.pings].sort((a, b) => a - b);
		const gaps = shot.gaps.slice(1);
		const stalls = gaps.filter((g) => g > 100).length;
		console.log(`\n════ 第一次打开「${TARGET}」════`);
		console.log(`  点下去到转录出现   ${firstPaint}ms`);
		console.log(`  缩略图             画出来 ${painted.ok}/${painted.total} 张`);
		console.log(`  主进程 ping        中位 ${pings[Math.floor(pings.length / 2)] ?? 0}ms，p95 ${pings[Math.floor(pings.length * 0.95)] ?? 0}ms，最慢 ${pings[pings.length - 1] ?? 0}ms`);
		console.log(`  主进程哑掉的次数   >100ms 的 ${pings.filter((p) => p > 100).length} 次，>300ms 的 ${pings.filter((p) => p > 300).length} 次`);
		console.log(`  渲染进程           最长一帧 ${gaps.length ? Math.max(...gaps) : 0}ms，>100ms 的 ${stalls} 次`);
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
