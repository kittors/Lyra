/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 窗口被拉大拉小的那一瞬，页面跟上了没有。
 *
 * 症状是拖窗口边的时候右边和下边先露出一块空白（或者旧内容的残影），过一会儿才补上。空白露的是
 * 窗口自己的 `backgroundColor`——原生的 frame 已经变了，而渲染进程还没画出新尺寸的那一帧。
 *
 * 这里要分清的是**滞后在哪一层**，因为两层的修法完全不同：
 *
 *   - `window.innerWidth` 本身就滞后 → Chromium 那边的 viewport 还没跟上，改渲染层没有用
 *   - `innerWidth` 立刻变了、但元素宽度滞后 → 是这个应用自己的重排慢，React state 绕了一圈
 *
 * 所以逐绘制帧同时记这两个数，外加 `document.documentElement` 的实际尺寸。逐帧而不是定时采样：
 * 这件事就发生在几帧之内，`setInterval` 取的样和屏幕上画出来的不是同一串数。
 *
 * 窗口尺寸从主进程改，因为那才是真的原生 resize——渲染层没有任何办法改自己的窗口。
 *
 * 用法：node --experimental-strip-types e2e/resize-lag-probe.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const PORT = 9677;
const INSPECT_PORT = 9678;

/** 主进程里够到主窗口。`getAllWindows()[0]` 不是它——见 `window-chrome-probe.ts` 的注释。 */
const WINDOW =
	'process._linkedBinding("electron_browser_window").BrowserWindow.getAllWindows()' +
	".filter((w) => !w.isDestroyed() && w.isVisible())" +
	".sort((a, b) => b.getBounds().width - a.getBounds().width)[0]";

let app: RunningApp;

interface Frame {
	at: number;
	inner: number;
	innerH: number;
	/** `<html>` 画出来的宽高，也就是页面真正铺满了多少。 */
	docW: number;
	docH: number;
	/** 侧边栏和面板容器，这两个是应用自己算宽度的地方。 */
	navW: number;
	dockW: number;
}

/*
 * 注入的代码里不写反引号：这段字符串还要在外层的模板串里活一遍，一个反引号就能把它截断。
 */
function record(ms: number): string {
	return `(() => new Promise((resolve) => {
		const out = [];
		const start = performance.now();
		const tick = () => {
			const at = performance.now() - start;
			const doc = document.documentElement.getBoundingClientRect();
			const nav = document.querySelector('[data-ly-nav], aside');
			const dock = document.querySelector('[data-dock-panes]');
			out.push({
				at: Math.round(at),
				inner: window.innerWidth,
				innerH: window.innerHeight,
				docW: Math.round(doc.width),
				docH: Math.round(doc.height),
				navW: nav ? Math.round(nav.getBoundingClientRect().width) : -1,
				dockW: dock ? Math.round(dock.getBoundingClientRect().width) : -1,
			});
			if (at < ${ms}) requestAnimationFrame(tick); else resolve(out);
		};
		requestAnimationFrame(tick);
	}))()`;
}

/** 第一个满足条件的帧的时刻，没有就返回 null。 */
function firstAt(frames: Frame[], ok: (f: Frame) => boolean): number | null {
	const hit = frames.find(ok);
	return hit ? hit.at : null;
}

async function measure(label: string, width: number, height: number): Promise<void> {
	// 先开始逐帧记，再改尺寸——反过来会漏掉最要命的头几帧。
	const recording = app.evaluate<Frame[]>(record(1500));
	await new Promise((r) => setTimeout(r, 60));
	await app.main(`${WINDOW}.setBounds({ width: ${width}, height: ${height} }, false)`);
	const frames = await recording;

	const settled = frames.at(-1)!;
	const innerAt = firstAt(frames, (f) => f.inner === settled.inner);
	const docAt = firstAt(frames, (f) => f.docW === settled.docW && f.docH === settled.docH);
	const dockAt = firstAt(frames, (f) => f.dockW === settled.dockW);

	console.log(`\n【${label} → ${width}×${height}】共 ${frames.length} 帧，跨 ${settled.at}ms`);
	console.log(`   最终：inner ${settled.inner}×${settled.innerH}  doc ${settled.docW}×${settled.docH}  nav ${settled.navW}  dock ${settled.dockW}`);
	console.log(`   innerWidth 到位：${innerAt}ms      文档尺寸到位：${docAt}ms      dock 宽度到位：${dockAt}ms`);

	/*
	 * 「文档比窗口小」的那些帧，就是屏幕上露白的那几帧。
	 *
	 * 反过来（文档比窗口大）是溢出，看起来是内容被裁掉而不是露白，一样要数。
	 */
	const short = frames.filter((f) => f.docW < f.inner - 1 || f.docH < f.innerH - 1);
	const over = frames.filter((f) => f.docW > f.inner + 1 || f.docH > f.innerH + 1);
	console.log(`   文档没铺满窗口的帧：${short.length}  ${short.length ? `（${short.map((f) => `${f.at}ms:${f.docW}×${f.docH}/${f.inner}×${f.innerH}`).slice(0, 6).join(" ")}）` : ""}`);
	console.log(`   文档超出窗口的帧：${over.length}  ${over.length ? `（${over.map((f) => `${f.at}ms:${f.docW}×${f.docH}/${f.inner}×${f.innerH}`).slice(0, 6).join(" ")}）` : ""}`);

	// 头十帧的原始数字，滞后长什么样只能靠看它。
	console.log(`   头十帧：${frames.slice(0, 10).map((f) => `${f.at}|${f.inner}×${f.innerH}|doc ${f.docW}×${f.docH}|dock ${f.dockW}`).join("  ")}`);
}

/**
 * 连续小幅改尺寸，模拟拖窗口边。
 *
 * 单次跳变和拖边框不是一条路径：拖边框是每一帧都来一次，滞后会不会累积、会不会一直有一块跟不上，
 * 只有连着改才看得出来。真正的拖边框还要再走一层 macOS 的 live resize，那个得驱动真实鼠标、会把
 * 用户的指针抢走——所以这里只到「连续 setBounds」为止，测的是渲染管线扛不扛得住连发。
 */
async function drag(): Promise<void> {
	const recording = app.evaluate<Frame[]>(record(2200));
	await new Promise((r) => setTimeout(r, 60));
	for (let w = 1200; w >= 800; w -= 25) {
		await app.main(`${WINDOW}.setBounds({ width: ${w}, height: 800 }, false)`);
		await new Promise((r) => setTimeout(r, 16));
	}
	const frames = await recording;

	const mismatched = frames.filter((f) => Math.abs(f.docW - f.inner) > 1);
	const worst = mismatched.reduce((m, f) => Math.max(m, Math.abs(f.docW - f.inner)), 0);
	console.log(`\n【连续拖拽 1200→800，每 16ms 一步】共 ${frames.length} 帧`);
	console.log(`   文档宽和窗口宽对不上的帧：${mismatched.length}/${frames.length}，最大差 ${worst}px`);
	console.log(`   过程中 inner 走过：${[...new Set(frames.map((f) => f.inner))].join(" → ")}`);
	if (mismatched.length) {
		console.log(`   对不上的前几帧：${mismatched.slice(0, 8).map((f) => `${f.at}ms doc ${f.docW}/win ${f.inner}`).join("  ")}`);
	}
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedInteractions, inspectPort: INSPECT_PORT });
	try {
		await app.evaluate(
			`new Promise((resolve,reject)=>{const end=performance.now()+20000;function tick(){if(document.querySelector('[data-ly-row="qa-short"] > button'))resolve();else if(performance.now()>end)reject(Error("boot"));else requestAnimationFrame(tick)}tick()})`,
		);
		await app.evaluate(`document.querySelector('[data-ly-row="qa-short"] > button').click()`);
		await new Promise((r) => setTimeout(r, 1500));

		await measure("缩小", 760, 620);
		await new Promise((r) => setTimeout(r, 800));
		await measure("放大", 1280, 900);
		await new Promise((r) => setTimeout(r, 800));
		await measure("再缩小", 900, 700);
		await new Promise((r) => setTimeout(r, 800));
		await drag();

		/*
		 * 再来一遍，这次窗口里装满东西。
		 *
		 * 空窗口量出来一帧不落，可真实用的时候窗口里有终端（xterm 自己挂 ResizeObserver 再 fit）、有
		 * 浏览器面板（`<webview>` 是独立进程，它的 resize 根本不在这个渲染进程的节奏里）、有 Git 面板。
		 * 这几样都是各自跟进的，谁慢一拍谁就是屏幕上那块跟不上的。
		 */
		console.log("\n════ 装满面板之后再测一遍 ════");
		for (const label of ["^终端", "^浏览器", "^Git|^源代码管理"]) {
			await app.evaluate(
				`(() => { const re = ${JSON.stringify(label)}; const b = [...document.querySelectorAll('button[aria-label]')].find((e) => new RegExp(re).test(e.getAttribute('aria-label') || '')); if (b) b.click(); return !!b; })()`,
			);
			await new Promise((r) => setTimeout(r, 1200));
		}
		console.log(`   窗口里现在有 ${await app.evaluate<number>(`document.querySelectorAll('[data-dock-pane]').length`)} 个面板`);
		await measure("满载·缩小", 800, 640);
		await new Promise((r) => setTimeout(r, 800));
		await measure("满载·放大", 1280, 880);
		await new Promise((r) => setTimeout(r, 800));
		await drag();
	} finally {
		await app?.stop().catch(() => {});
	}
}

main().catch(async (error) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
