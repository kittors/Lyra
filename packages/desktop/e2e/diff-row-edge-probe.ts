/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 文件行的右端，在真窗口里量一遍。
 *
 * 单测量的是类名——`absolute` 在不在、`delay` 写对没有。类名对不等于画出来对：`absolute` 的
 * 参照系是最近的 `relative` 祖先，写错一层就飘到别处去了，而那种错误任何一条类名断言都看不见。
 * 所以这里量的是 `getBoundingClientRect`：数字的右边缘、按钮的右边缘、行容器的右边缘，三条线
 * 到底对没对齐。
 *
 * 还量一次时序：指针压上去之后逐帧记 opacity，看「数字让位」和「按钮到场」是不是错开的。
 * 按帧记而不是采样——采样会漏掉中间那几十毫秒，而那正是这次要验的东西。
 *
 * 用法：node --experimental-strip-types e2e/diff-row-edge-probe.ts
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";
import { encode, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra文件行右端测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

const PORT = 9734;
let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];

function check(what: string, ok: boolean, saw: string): void {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}  ——  ${saw}`);
}

const evaluate = <T>(expression: string): Promise<T> => app.evaluate<T>(expression);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(expression: string, ms = 20000): Promise<void> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(250);
	}
	throw new Error(`等不到：${expression}`);
}

/**
 * 打开 Git 面板——右上角工具条上那一颗。
 *
 * 认 `^Git ` 而不是 `Git`：侧边栏里一个标题带 "GitHub Pull Request" 的会话，它的归档按钮
 * 的 aria-label 里也有这三个字母，而它排在前面。第一版探针点的就是那一颗，然后报「Git 面板
 * 没开起来」——看着像产品缺陷。
 */
async function openGit(): Promise<boolean> {
	return evaluate<boolean>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => /^Git\\s/.test(el.getAttribute('aria-label') || ''));
		if (!b) return false;
		b.click();
		return true;
	})()`);
}

interface Edges {
	row: number;
	counts: number;
	actions: number;
	countsOpacity: number;
	actionsOpacity: number;
}

/**
 * 三条右边缘，外加两个此刻的不透明度。
 *
 * 认行靠 `data-dock-pane="review"` 里的 `.group\\/row`——Git 面板可能和别的面板同时开着，
 * 而别处也有长得像的行。
 */
async function edgesOf(): Promise<Edges | null> {
	return evaluate<Edges | null>(`(() => {
		const pane = document.querySelector('[data-dock-pane="review"]');
		if (!pane) return null;
		const row = [...pane.querySelectorAll('div')].find((el) => el.classList.contains('group/row'));
		if (!row) return null;
		const line = row.querySelector('.relative');
		if (!line) return null;
		const counts = [...line.querySelectorAll('*')].find((el) => el.classList.contains('tabular-nums'));
		const actions = [...line.children].find((el) => el.classList.contains('absolute'));
		if (!counts || !actions) return null;
		return {
			row: Math.round(line.getBoundingClientRect().right * 100) / 100,
			counts: Math.round(counts.getBoundingClientRect().right * 100) / 100,
			actions: Math.round(actions.getBoundingClientRect().right * 100) / 100,
			countsOpacity: Number(getComputedStyle(counts).opacity),
			actionsOpacity: Number(getComputedStyle(actions).opacity),
		};
	})()`);
}

/** 把真实指针移到那一行上，或者移开。 */
async function pointAt(onRow: boolean): Promise<void> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const pane = document.querySelector('[data-dock-pane="review"]');
		if (!pane) return null;
		const row = [...pane.querySelectorAll('div')].find((el) => el.classList.contains('group/row'));
		if (!row) return null;
		const r = row.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) throw new Error("找不到文件行");
	// 移开时落到面板顶部的空白上，不是落到另一行上——那会把另一行点亮。
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: onRow ? at.x : 12, y: onRow ? at.y : 12 });
}

/** 逐帧记 opacity，直到两边都停下来。 */
async function traceFrames(ms: number): Promise<{ counts: number; actions: number }[]> {
	return evaluate<{ counts: number; actions: number }[]>(`new Promise((resolve) => {
		const pane = document.querySelector('[data-dock-pane="review"]');
		const row = [...pane.querySelectorAll('div')].find((el) => el.classList.contains('group/row'));
		const line = row.querySelector('.relative');
		const counts = [...line.querySelectorAll('*')].find((el) => el.classList.contains('tabular-nums'));
		const actions = [...line.children].find((el) => el.classList.contains('absolute'));
		const frames = [];
		const end = performance.now() + ${ms};
		function tick() {
			frames.push({
				counts: Number(getComputedStyle(counts).opacity),
				actions: Number(getComputedStyle(actions).opacity),
			});
			if (performance.now() < end) requestAnimationFrame(tick);
			else resolve(frames);
		}
		requestAnimationFrame(tick);
	})`);
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	const frames: Frame[] = [];
	const stopRecording = await startRecording(PORT, frames);
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		// 开一个会话，Git 面板才有仓库可读。
		const at = await evaluate<{ x: number; y: number } | null>(`(() => {
			const row = document.querySelector('[data-ly-row]');
			if (!row) return null;
			const r = row.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`);
		if (at) {
			for (const type of ["mousePressed", "mouseReleased"] as const) {
				await app.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
			}
		}
		await pause(2500);

		check("打开 Git 面板", await openGit(), "点了工具条上那一颗");
		await until(`document.querySelector('[data-dock-pane="review"]')`, 20000);
		// 扫仓库要时间，等到行真的出现为止——固定等几秒会在慢机器上假红。
		await until(`[...document.querySelector('[data-dock-pane="review"]').querySelectorAll('div')].some((el) => el.classList.contains('group/row'))`, 30000)
			.catch(() => {});

		const rows = await evaluate<number>(`(() => {
			const pane = document.querySelector('[data-dock-pane="review"]');
			return pane ? [...pane.querySelectorAll('div')].filter((el) => el.classList.contains('group/row')).length : 0;
		})()`);
		if (rows === 0) {
			const saw = await evaluate<string>(`(() => {
				const pane = document.querySelector('[data-dock-pane="review"]');
				return (pane?.innerText ?? "(没有面板)").replace(/\\s+/g, " ").slice(0, 200);
			})()`);
			check("这个仓库里有改动的文件", false, `面板里写着：${saw}`);
			return;
		}
		check("Git 面板里有文件行", true, `${rows} 行`);

		console.log("\n【一】指针不在那一行：数字要贴到最右，按钮不许占地方");
		await pointAt(false);
		await pause(600);
		const idle = await edgesOf();
		if (!idle) { check("量到三条右边缘", false, "读不到"); return; }
		const idleGap = Math.round((idle.row - idle.counts) * 100) / 100;
		check("数字贴着行的右边缘（只剩 pr-1 的 4px）", idleGap <= 5, `数字右边缘距行右边缘 ${idleGap}px`);
		check("此刻按钮是透明的", idle.actionsOpacity < 0.05, `opacity=${idle.actionsOpacity}`);

		console.log("\n【二】指针压上去：按钮站在数字刚才的位置，同样贴右");
		await pointAt(true);
		await pause(900);
		const hot = await edgesOf();
		if (!hot) { check("量到三条右边缘", false, "读不到"); return; }
		const hotGap = Math.round((hot.row - hot.actions) * 100) / 100;
		check("按钮贴着行的右边缘", hotGap <= 5, `按钮右边缘距行右边缘 ${hotGap}px`);
		check("两者右边缘对齐（同一条线）", Math.abs(hot.actions - idle.counts) <= 1.5, `按钮 ${hot.actions} vs 数字 ${idle.counts}`);
		check("数字已经让位", hot.countsOpacity < 0.05, `opacity=${hot.countsOpacity}`);

		console.log("\n【三】时序：让位的先走，到场的后来，中间不该并排亮着");
		await pointAt(false);
		await pause(700);
		const tracing = traceFrames(700);
		await pause(60);
		await pointAt(true);
		const traced = await tracing;
		const both = traced.filter((f) => f.counts > 0.35 && f.actions > 0.35).length;
		const peak = Math.max(...traced.map((f) => Math.min(f.counts, f.actions)));
		check("没有两个同时清晰可见的帧", both === 0, `${traced.length} 帧里有 ${both} 帧两边都 >0.35，最高重叠 ${Math.round(peak * 100) / 100}`);

		// 给录像留几趟看得清的来回：进、停、出、停。
		for (let lap = 0; lap < 3; lap++) {
			await pointAt(true);
			await pause(1100);
			await pointAt(false);
			await pause(1100);
		}
	} finally {
		await stopRecording();
		const passed = checks.filter((c) => c.ok).length;
		const out = join(OUT_DIR, `${STAMP}_文件行右端让位_${passed}of${checks.length}.mp4`);
		await app?.stop().catch(() => {});
		if (frames.length > 0) await encode(frames, out, 60, 1200);
		console.log(`\n${passed}/${checks.length} 项通过`);
		console.log(frames.length > 0 ? `视频：${out}` : "没有采到帧，视频没生成");
		if (passed !== checks.length) process.exitCode = 1;
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
