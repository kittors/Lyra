/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 大会话滚起来之后，掉不掉帧。
 *
 * 前面那些探针量的都是「点下去到第一帧」——那只是开头。人说的流畅是滚动时每一帧都按时到，而
 * 首帧很快、滚起来一顿一顿的会话，在首帧那个数字上看不出任何毛病。
 *
 * 判据是**帧间隔的分布**，不是平均值。平均 20ms 可以是「每帧都 20ms」，也可以是「大部分 8ms、
 * 每隔十帧卡一次 200ms」——前者顺，后者是人眼一眼就看见的顿挫，而两者平均数一样。所以这里记
 * 每一帧的间隔，然后数超过 32ms（丢了一帧）和超过 100ms（明显一顿）的有多少。
 *
 * 滚动用真实滚轮事件发给窗口，不是赋值 `scrollTop`：后者不走合成器，量不到真实的滚动路径。
 *
 * 用法：node --experimental-strip-types e2e/scroll-smooth-probe.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9702;
let app: RunningApp;

/** 图最多、体积最大的那几个。 */
const WANTED = ["对话窗口回弹跳动问题总结", "记录会话交互与输入框问题", "切换会话Item跳动问题", "整理图片需求到文档"];

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

const WATCH = `(() => {
	const out = { gaps: [], done: false, tops: [] };
	window.__ss = out;
	let last = performance.now();
	const el = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view');
	const tick = () => {
		const now = performance.now();
		out.gaps.push(Math.round((now - last) * 10) / 10);
		last = now;
		if (el) out.tops.push(Math.round(el.scrollTop));
		if (!out.done) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})()`;

async function openRow(title: string): Promise<boolean> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const rows = [...document.querySelectorAll('[data-ly-row]')];
		const row = rows.find((r) => (r.innerText || '').includes(${JSON.stringify(title)}));
		if (!row) return null;
		row.scrollIntoView({ block: "center" });
		const r = row.getBoundingClientRect();
		if (r.width === 0) return null;
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return false;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	await until(`document.querySelectorAll('[data-ly-run]').length > 0`, 25000).catch(() => {});
	await new Promise((r) => setTimeout(r, 700));
	return true;
}

/** 转录中央的一点，滚轮事件要发到那里才算落在转录上。 */
async function centre(): Promise<{ x: number; y: number } | null> {
	return evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view');
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
}

async function measure(title: string): Promise<void> {
	if (!(await openRow(title))) {
		console.log(`\n### ${title.slice(0, 28)}\n  侧边栏里没这一行`);
		return;
	}
	const spot = await centre();
	if (!spot) return;
	const height = await evaluate<number>(`(() => { const el = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view'); return el ? el.scrollHeight : 0; })()`);
	await evaluate(WATCH);
	// 一路往回滚：向上翻是把还没画过的历史带进来，最吃力的方向。
	for (let i = 0; i < 40; i++) {
		await app.send("Input.dispatchMouseEvent", {
			type: "mouseWheel", x: spot.x, y: spot.y, deltaX: 0, deltaY: -240, pointerType: "mouse",
		});
		await new Promise((r) => setTimeout(r, 55));
	}
	await new Promise((r) => setTimeout(r, 400));
	await evaluate(`(() => { if (window.__ss) window.__ss.done = true; return true; })()`);
	const shot = await evaluate<{ gaps: number[]; tops: number[] }>(`(() => ({ gaps: window.__ss.gaps, tops: window.__ss.tops }))()`);
	const gaps = shot.gaps.slice(1);
	if (!gaps.length) return;
	const sorted = [...gaps].sort((a, b) => a - b);
	const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0;
	const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
	const dropped = gaps.filter((g) => g > 32).length;
	const stalls = gaps.filter((g) => g > 100).length;
	const travelled = shot.tops.length ? Math.max(...shot.tops) - Math.min(...shot.tops) : 0;
	console.log(`\n### ${title.slice(0, 28)}`);
	console.log(`  转录高 ${(height / 1000).toFixed(1)}k px，这一趟滚了 ${travelled}px`);
	console.log(`  帧间隔   中位 ${p50}ms，p95 ${p95}ms，最长 ${sorted[sorted.length - 1]}ms`);
	console.log(`  掉帧     >32ms 的 ${dropped}/${gaps.length} 帧（${((dropped / gaps.length) * 100).toFixed(0)}%），>100ms 的 ${stalls} 次`);
	console.log(`  判定：${stalls > 0 ? "❌ 有明显一顿" : dropped / gaps.length > 0.2 ? "⚠️ 掉帧偏多" : "✅ 基本跟得上"}`);
}

/**
 * 往前翻一次，要卡多久。
 *
 * 转录是开窗渲染的，一次只挂 20 个轮次块；一个 353 条消息的会话打开时转录只有 2.1k px 高，剩下
 * 的全在「显示更早」后面。所以真正吃力的不是打开，是每按一次那个按钮——一轮里可以有几百个工具
 * 调用，二十轮一起挂上去，那一下是整段转录里最重的一帧。
 */
async function pageBack(title: string): Promise<void> {
	if (!(await openRow(title))) return;
	console.log(`\n### 往前翻：${title.slice(0, 26)}`);
	for (let round = 1; round <= 4; round++) {
		const at = await evaluate<{ x: number; y: number } | null>(`(() => {
			const b = document.querySelector('[data-ly-show-earlier]');
			if (!b) return null;
			b.scrollIntoView({ block: "center" });
			const r = b.getBoundingClientRect();
			if (r.width === 0) return null;
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`);
		if (!at) {
			console.log(`  第 ${round} 次：已经到头了，没有「显示更早」`);
			return;
		}
		await new Promise((r) => setTimeout(r, 250));
		await evaluate(WATCH);
		await new Promise((r) => setTimeout(r, 80));
		for (const type of ["mousePressed", "mouseReleased"] as const) {
			await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
		}
		await new Promise((r) => setTimeout(r, 1200));
		await evaluate(`(() => { if (window.__ss) window.__ss.done = true; return true; })()`);
		const shot = await evaluate<{ gaps: number[] }>(`(() => ({ gaps: window.__ss.gaps }))()`);
		const gaps = shot.gaps.slice(1);
		const worst = gaps.length ? Math.max(...gaps) : 0;
		const height = await evaluate<number>(`(() => { const el = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view'); return el ? el.scrollHeight : 0; })()`);
		const runs = await evaluate<number>(`document.querySelectorAll('[data-ly-run]').length`);
		console.log(
			`  第 ${round} 次：最长一帧 ${worst.toFixed(0)}ms ${worst > 100 ? "← 这一下是顿的" : ""}，` +
				`之后转录高 ${(height / 1000).toFixed(1)}k px，工具卡片 ${runs} 张`,
		);
	}
}

async function main(): Promise<void> {
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
		for (const title of WANTED) await measure(title);
		for (const title of WANTED.slice(0, 3)) await pageBack(title);

		const heap = await evaluate<{ used: number; total: number } | null>(
			`(() => performance.memory ? { used: Math.round(performance.memory.usedJSHeapSize / 1048576), total: Math.round(performance.memory.totalJSHeapSize / 1048576) } : null)()`,
		);
		if (heap) console.log(`\n开完这几个会话之后，渲染进程堆占用 ${heap.used} MB / ${heap.total} MB`);
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
