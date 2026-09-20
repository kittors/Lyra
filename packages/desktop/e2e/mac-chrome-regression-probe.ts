/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * macOS 这一侧有没有被那次拆分碰到。
 *
 * 这次改的是 Windows/Linux：那条 header 和系统按钮从 44 换到 32，并给带子补了底色。macOS 一行
 * 都不该变——但两边挂在同一个常量上（`WINDOW_HEADER_HEIGHT` 同时管红绿灯的居中和 dock 里每个
 * 面板的标题栏），拆的时候最容易顺手把这一侧也带走。
 *
 * 单测已经断言过那几个常量的值，这里补它证不到的一半：**画出来**是不是还那么高。类名和常量都对
 * 而渲染结果不对，这种事出现过——量 `getBoundingClientRect`，不读 props。
 *
 * 用法：node --experimental-strip-types e2e/mac-chrome-regression-probe.ts
 */

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const PORT = 9738;
const EXPECTED = 44;
let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];

function check(what: string, ok: boolean, saw: string): void {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}  ——  ${saw}`);
}

const evaluate = <T>(expression: string): Promise<T> => app.evaluate<T>(expression);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(expression: string, ms = 30000): Promise<void> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(250);
	}
	throw new Error(`等不到：${expression}`);
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
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
		await until(`document.querySelector('[data-dock-pane="conversation"]')`, 30000);
		await pause(1500);

		console.log("\n【一】这台机器上不该出现 Windows 那条 header");
		const bar = await evaluate<number>(`document.querySelectorAll('[data-ly-window-header], .ly-window-header').length`);
		check("没有画出那条带子", bar === 0, `找到 ${bar} 条`);

		console.log("\n【二】dock 里每个面板的标题栏仍然是 44");
		const heads = await evaluate<{ kind: string; height: number }[]>(`[...document.querySelectorAll('[data-dock-header]')]
			.map((el) => ({ kind: el.dataset.dockHeader, height: Math.round(el.getBoundingClientRect().height * 100) / 100 }))`);
		if (heads.length === 0) {
			check("量到面板标题栏", false, "一个都没找到");
		} else {
			const wrong = heads.filter((head) => Math.abs(head.height - EXPECTED) > 0.5);
			check(
				`${heads.length} 个面板标题栏都是 ${EXPECTED}px`,
				wrong.length === 0,
				wrong.length === 0 ? heads.map((h) => `${h.kind}=${h.height}`).join("、") : `跑偏的：${wrong.map((h) => `${h.kind}=${h.height}`).join("、")}`,
			);
		}

		console.log("\n【三】分屏那一屏的标题栏也还是 44");
		const chrome = await evaluate<number[]>(`[...document.querySelectorAll('[data-ly-split-chrome]')]
			.map((el) => Math.round(el.getBoundingClientRect().height * 100) / 100)`);
		check(
			chrome.length > 0 ? `${chrome.length} 屏都是 ${EXPECTED}px` : "（这个窗口没有分屏，跳过）",
			chrome.every((height) => Math.abs(height - EXPECTED) <= 0.5),
			chrome.join("、") || "没有分屏",
		);

		console.log("\n【四】弹出一个面板窗口，它的带子也该是 44、且没有底色");
		const popped = await evaluate<boolean>(`(() => {
			const b = [...document.querySelectorAll('button')].find((el) => /^终端|^Terminal/.test(el.getAttribute('aria-label') || ''));
			if (!b) return false;
			b.click();
			return true;
		})()`);
		check("开出终端面板", popped, popped ? "点了工具条" : "找不到那颗按钮");
		await pause(1800);
		const out = await evaluate<boolean>(`(() => {
			const mark = document.querySelector('[data-ly-pop-out="terminal"]');
			if (!mark) return false;
			(mark.closest('button') || mark).click();
			return true;
		})()`);
		check("把它弹成窗口", out, out ? "点了「在新窗口打开」" : "那颗按钮不在");

		const end = Date.now() + 15000;
		let panel: { height: number; hasBar: boolean } | null = null;
		while (Date.now() < end && !panel) {
			for (const win of await app.windows()) {
				if (win.boot.kind !== "panel") continue;
				panel = await win
					.evaluate<{ height: number; hasBar: boolean } | null>(`(() => {
						const el = document.querySelector('[data-ly-panel-window-chrome]');
						if (!el) return null;
						return {
							height: Math.round(el.getBoundingClientRect().height * 100) / 100,
							hasBar: el.classList.contains('ly-window-header'),
						};
					})()`)
					.catch(() => null);
				if (panel) break;
			}
			if (!panel) await pause(400);
		}
		if (!panel) {
			check("量到面板窗口的带子", false, "那个窗口没画出来");
		} else {
			check(`面板窗口的带子是 ${EXPECTED}px`, Math.abs(panel.height - EXPECTED) <= 0.5, `${panel.height}px`);
			check("macOS 上不该有底色那一档", !panel.hasBar, panel.hasBar ? "带上了 ly-window-header" : "干净");
		}
	} finally {
		const passed = checks.filter((c) => c.ok).length;
		console.log(`\n${passed}/${checks.length} 项通过`);
		await app?.stop().catch(() => {});
		if (passed !== checks.length) process.exitCode = 1;
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
