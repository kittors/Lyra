/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 清单第 8 条（动画可中断）和第 5 条（主线程不做重活），在真窗口里的判据。
 *
 * **可中断**：动画走到一半再点一次，应该从当前位置反向续上。做不到的表现是「回跳」——高度
 * 先蹦回终点再从头收，人眼看见的是闪一下。CSS `transition` 天然可中断；`animation` 不行，
 * 它要么播完要么从头再来，所以哪些地方用了 animation 就是哪些地方会回跳。
 *
 * 判据：把高度序列切成两段（第一次点击后、第二次点击后），看第二段起点和第一段终点差多少。
 * 续上的话两者相等；回跳的话会差出一大截。
 *
 * **主线程**：展开一个几百个节点的工具组，那一帧有多长。这是整段转录里最重的一次上屏，
 * 虚拟化救不了它——节点是真的要挂上去的。>100ms 就是人眼能看见的一顿。
 *
 * 用法：node --experimental-strip-types e2e/interrupt-probe.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9704;
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 30000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

/*
 * 逐帧记：滚动内容的总高、这一帧和上一帧隔了多久、以及点击落在第几帧。
 *
 * 高度用 scrollHeight 而不是某个元素的 box：展开的那一段撑开的是整条转录，而中间那些包装
 * 元素各有各的 overflow，量它们会漏。
 */
const TRACK = `(() => {
	const out = { frames: [], marks: [], done: false };
	window.__it = out;
	/*
	 * 容器要当场找，而且找不到得说出来。
	 *
	 * 第一版把它存成闭包里的一个变量，第二轮量到的高度全是 0——探针照样印了一个绿判定。
	 * 读不到就把 h 记成 null，报告那一端据此判空，而不是把 0 当成一个真实的高度。
	 */
	const view = () => document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view');
	out.found = Boolean(view());
	let last = performance.now();
	const tick = () => {
		const now = performance.now();
		const el = view();
		out.frames.push({ h: el ? el.scrollHeight : null, gap: Math.round((now - last) * 10) / 10 });
		last = now;
		if (!out.done) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	window.__mark = () => out.marks.push(out.frames.length);
	return true;
})()`;

interface Shot {
	frames: { h: number | null; gap: number }[];
	marks: number[];
	found: boolean;
}

async function clickAt(at: { x: number; y: number }): Promise<void> {
	await evaluate(`(() => { window.__mark && window.__mark(); return true; })()`);
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
}

async function findButton(pattern: string): Promise<{ x: number; y: number } | null> {
	return evaluate<{ x: number; y: number } | null>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => new RegExp(${JSON.stringify(pattern)}).test(el.innerText || ''));
		if (!b) return null;
		b.scrollIntoView({ block: "center" });
		const r = b.getBoundingClientRect();
		if (r.width === 0) return null;
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
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
		const row = await evaluate<{ x: number; y: number } | null>(`(() => {
			const rows = [...document.querySelectorAll('[data-ly-row]')];
			const r0 = rows.find((r) => (r.innerText || '').includes('整理图片需求到文档')) || rows[0];
			if (!r0) return null;
			r0.scrollIntoView({ block: "center" });
			const r = r0.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`);
		if (!row) return;
		for (const type of ["mousePressed", "mouseReleased"] as const) {
			await app.send("Input.dispatchMouseEvent", { type, x: row.x, y: row.y, button: "left", clickCount: 1 });
		}
		await until(`document.querySelectorAll('[data-ly-run]').length > 0`, 25000).catch(() => {});
		await new Promise((r) => setTimeout(r, 900));

		const TOOL = "调用工具|使用了工具|Used \\d+ tool";
		// 先确保是收起的。
		await evaluate(`(() => {
			const b = [...document.querySelectorAll('button')].find((el) => new RegExp(${JSON.stringify(TOOL)}).test(el.innerText || ''));
			if (b && b.getAttribute('aria-expanded') === 'true') b.click();
			return true;
		})()`);
		await new Promise((r) => setTimeout(r, 800));

		// ---- 第 5 条：展开那一帧有多长 ----
		let at = await findButton(TOOL);
		if (!at) { console.log("找不到工具组按钮"); return; }
		await evaluate(TRACK);
		await new Promise((r) => setTimeout(r, 80));
		await clickAt(at);
		await new Promise((r) => setTimeout(r, 1400));
		await evaluate(`(() => { window.__it.done = true; return true; })()`);
		const open = await evaluate<Shot>(`(() => ({ frames: window.__it.frames, marks: window.__it.marks, found: window.__it.found }))()`);
		const gaps = open.frames.slice(1).map((f) => f.gap);
		const openH = open.frames.map((f) => f.h).filter((h): h is number => h !== null);
		if (!open.found || openH.length < 4) { console.log("量不到滚动容器，清单 5 没有结论"); return; }
		const grew = Math.max(...openH) - Math.min(...openH);
		console.log(`\n### 清单 5：展开一个大工具组，主线程那一帧`);
		console.log(`  转录长高 ${grew}px`);
		console.log(`  最长一帧 ${Math.max(...gaps).toFixed(0)}ms，>32ms 的 ${gaps.filter((g) => g > 32).length} 帧，>100ms 的 ${gaps.filter((g) => g > 100).length} 帧`);
		console.log(`  判定：${Math.max(...gaps) > 100 ? "❌ 有一顿看得见" : Math.max(...gaps) > 32 ? "⚠️ 掉了帧但不到一顿" : "✅ 没掉帧"}`);

		// ---- 第 8 条：展开到一半再点，回不回跳 ----
		await new Promise((r) => setTimeout(r, 600));
		await evaluate(`(() => {
			const b = [...document.querySelectorAll('button')].find((el) => new RegExp(${JSON.stringify(TOOL)}).test(el.innerText || ''));
			if (b && b.getAttribute('aria-expanded') === 'true') b.click();
			return true;
		})()`);
		await new Promise((r) => setTimeout(r, 900));
		at = await findButton(TOOL);
		if (!at) return;
		await evaluate(TRACK);
		await new Promise((r) => setTimeout(r, 80));
		await clickAt(at);
		// 动画时长是 --ly-t-slow(340ms)，160ms 时正走到一半。
		await new Promise((r) => setTimeout(r, 160));
		await clickAt(at);
		await new Promise((r) => setTimeout(r, 1400));
		await evaluate(`(() => { window.__it.done = true; return true; })()`);
		const mid = await evaluate<Shot>(`(() => ({ frames: window.__it.frames, marks: window.__it.marks, found: window.__it.found }))()`);
		const heights = mid.frames.map((f) => f.h).filter((h): h is number => h !== null);
		if (!mid.found || heights.length < 4) {
			console.log(`\n### 清单 8：展开到一半再点\n  量不到滚动容器（found=${mid.found}，读到 ${heights.length} 个高度）——这一条没有结论`);
			return;
		}
		const second = mid.marks[1] ?? 0;
		if (!second || second >= mid.frames.length - 2) {
			console.log(`\n### 清单 8：展开到一半再点\n  没抓到第二次点击`);
			return;
		}
		const beforeSecond = mid.frames[second - 1]?.h ?? 0;
		const afterSecond = mid.frames[second + 1]?.h ?? 0;
		const peak = Math.max(...mid.frames.slice(second).map((f) => f.h).filter((h): h is number => h !== null));
		console.log(`\n### 清单 8：展开到一半再点（反向该从当前位置续上）`);
		console.log(`  第二次点击时高 ${beforeSecond}px，下一帧 ${afterSecond}px，之后最高冲到 ${peak}px`);
		console.log(`  回跳 ${Math.max(0, peak - beforeSecond)}px`);
		console.log(`  判定：${peak - beforeSecond > 24 ? "❌ 先蹦到终点再收，中途那一下是白走的" : "✅ 从当前位置反向续上"}`);
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
