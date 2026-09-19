/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 分屏到几屏之后，一个 tile 里还放得下面板——宽和高分别算。
 *
 * 底线有两个方向，之前只算了宽的那个，得出「纵向放得下」的结论，而那是在两屏左右分、每屏
 * 787px 高的前提下说的。屏一多，高度也会被切，两个方向就都可能不够。
 *
 *   conversation  420 宽 / 260 高
 *   panel         300 宽 / 150 高
 *   并排要        720 宽        上下叠要 410 高
 *
 * 所以这里对每种分屏形态量一遍 tile 的实际尺寸，再真去点一次「终端」，看落在哪：
 *
 *   落进这一屏     → 对。放不放得下都该落进去，放不下就画得挤
 *   弹成独立窗口   → ❌ 不该再发生。那条自动退路已经去掉了，见
 *                     `docs/architecture/split-window-conflicts.md` 第六节
 *   什么也没发生   → ❌ 点了没反应
 *
 * 窗口尺寸也压一遍：人说的「显示区域不足」既可能来自屏数，也可能来自窗口本身被拖小。
 *
 * 用法：node --experimental-strip-types e2e/tile-floors-probe.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9713;
const CONV = { w: 420, h: 260 };
const PANEL = { w: 300, h: 150 };
let app: RunningApp;

function evaluate<T>(expression: string): Promise<T> {
	return app.evaluate<T>(expression);
}

async function until(expression: string, ms = 20000): Promise<void> {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+${ms};function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`,
	);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openFirstRow(): Promise<void> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const row = document.querySelector('[data-ly-row]');
		if (!row) return null;
		row.scrollIntoView({ block: 'center' });
		const r = row.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	await until(`document.querySelector('[data-dock-pane="conversation"]') !== null`).catch(() => {});
	await wait(900);
}

async function splitOnce(rowIndex: number): Promise<string> {
	return evaluate<string>(`(async () => {
		const row = document.querySelectorAll('[data-ly-row]')[${rowIndex}];
		if (!row) return 'no row';
		const r = row.getBoundingClientRect();
		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + r.height / 2) }));
		await new Promise((res) => setTimeout(res, 400));
		const open = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => /打开方式/.test(el.innerText || ''));
		if (!open) return 'no submenu';
		open.click();
		await new Promise((res) => setTimeout(res, 400));
		const hit = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => (el.innerText || '').trim() === '分屏');
		if (!hit) return 'no item';
		if (hit.disabled) return 'disabled';
		hit.click();
		return 'clicked';
	})()`);
}

interface Tile { w: number; h: number }

async function tiles(): Promise<Tile[]> {
	return evaluate<Tile[]>(
		`[...document.querySelectorAll('[data-ly-split-pane]')].map((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })`,
	);
}

async function panelWindows(): Promise<string[]> {
	return evaluate<string[]>(`(async () => {
		if (!window.lyra?.windows?.list) return [];
		const r = await window.lyra.windows.list();
		return (r.panels || []).map((p) => p.kind + "@" + p.scope);
	})()`);
}

/** 在第 n 屏点终端，返回它去了哪。 */
async function tryTerminal(tileIndex: number): Promise<string> {
	const before = await panelWindows();
	const clicked = await evaluate<boolean>(`(() => {
		const tile = document.querySelectorAll('[data-ly-split-pane]')[${tileIndex}];
		if (!tile) return false;
		const b = [...tile.querySelectorAll('header button')].find((el) => /终端/.test(el.getAttribute('aria-label') || ''));
		if (!b) return false;
		b.click();
		return true;
	})()`);
	if (!clicked) return "找不到终端按钮";
	await wait(1600);
	const where = await evaluate<string | null>(`(() => {
		const el = document.querySelector('[data-dock-pane="terminal"]');
		if (!el) return null;
		if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
		const tile = el.closest('[data-ly-split-pane]');
		const r = el.getBoundingClientRect();
		return (tile ? 'tile' : 'window-dock') + " " + Math.round(r.width) + "x" + Math.round(r.height);
	})()`);
	if (where) return "落进 " + where;
	const after = await panelWindows();
	const fresh = after.filter((p) => !before.includes(p));
	// 这两条现在都是失败。窗口只由人来开，而点一颗面板按钮不是「我要第二个窗口」的意思。
	if (fresh.length) return "❌ 弹成独立窗口 " + fresh.join(",");
	return "❌ 什么也没发生";
}

/**
 * 把上一轮留下的终端彻底清掉——tile 里那份和弹出去的那个窗口都要。
 *
 * 只点主窗口里的「关闭终端」是不够的：终端一旦弹成独立窗口，主窗口里就没有那颗按钮了，而
 * 面板窗口还开着。下一轮再点「终端」时 isPopped 为真，只会把那个窗口叫到前面来——主窗口的
 * DOM 一点没变，探针于是报「什么也没发生」。第一版就是这样量出一个假的死局。
 */
async function closeTerminal(): Promise<void> {
	await evaluate(`(async () => {
		const b = [...document.querySelectorAll('button')].find((el) => /关闭终端/.test(el.getAttribute('aria-label') || ''));
		if (b) b.click();
		if (window.lyra?.windows?.list && window.lyra?.windows?.closePanel) {
			const r = await window.lyra.windows.list();
			for (const p of r.panels || []) {
				if (p.kind === 'terminal') await window.lyra.windows.closePanel({ kind: p.kind, scope: p.scope });
			}
		}
		return true;
	})()`);
	await wait(900);
}

function verdict(t: Tile): string {
	const wideEnough = t.w >= CONV.w + PANEL.w;
	const tallEnough = t.h >= CONV.h + PANEL.h;
	if (wideEnough && tallEnough) return "并排和上下都放得下";
	if (tallEnough) return `只能上下叠（宽 ${t.w} < ${CONV.w + PANEL.w}）`;
	if (wideEnough) return `只能并排（高 ${t.h} < ${CONV.h + PANEL.h}）`;
	return `两个方向都不够（要 ${CONV.w + PANEL.w}x${CONV.h + PANEL.h}，只有 ${t.w}x${t.h}）`;
}

async function report(label: string): Promise<void> {
	const list = await tiles();
	console.log(`\n### ${label}：${list.length} 屏`);
	for (const [i, t] of list.entries()) console.log(`  第 ${i + 1} 屏 ${t.w}x${t.h}  —— ${verdict(t)}`);
	if (!list.length) return;
	// 上一轮的残留先清干净，否则这一轮点「终端」只是把旧窗口叫到前面来。
	await closeTerminal();
	const leftover = await panelWindows();
	if (leftover.length) console.log(`  ⚠️ 还有残留的面板窗口：${leftover.join(",")}`);
	const got = await tryTerminal(0);
	console.log(`  在第 1 屏点「终端」：${got}`);
	await closeTerminal();
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await wait(600);
		await openFirstRow();
		const view = await evaluate<{ w: number; h: number }>(`({ w: window.innerWidth, h: window.innerHeight })`);
		console.log(`窗口 ${view.w}x${view.h}；并排要 ${CONV.w + PANEL.w} 宽，上下叠要 ${CONV.h + PANEL.h} 高`);

		await report("单屏");
		for (let n = 2; n <= 4; n++) {
			const r = await splitOnce(n - 1);
			await wait(1600);
			if (r !== "clicked") { console.log(`\n分到第 ${n} 屏失败：${r}`); break; }
			await report(`${n} 屏`);
		}

		/*
		 * 再把窗口压窄一遍。
		 *
		 * 人说的「显示区域不足」不止来自屏数，也来自把窗口拖小。`setDeviceMetricsOverride` 是
		 * 唯一能从测试里改视口的路子——`window.resizeTo` 对 Electron 窗口无效。
		 */
		console.log(`\n──── 把窗口压到 900x600 再看一遍 ────`);
		await app.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 600, deviceScaleFactor: 0, mobile: false });
		await wait(1200);
		await report("窄窗口 + 现有分屏");
		await app.send("Emulation.clearDeviceMetricsOverride", {});
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
