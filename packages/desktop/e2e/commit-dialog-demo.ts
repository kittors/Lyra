/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 提交弹窗，在真窗口里走一遍，边验边录。
 *
 * 单测量的是 DOM：遮罩在不在、分支那一行可不可点、新分支是不是到提交那一刻才建。类名和结构对
 * 不等于画出来对——`Overlay` 是 portal + `position: fixed`，一层 `transform` 祖先就能让"居中"
 * 落到别处去，而那种错误任何一条结构断言都看不见。所以这里量 `getBoundingClientRect`：卡片的
 * 中心是不是窗口的中心，遮罩是不是真的铺满。
 *
 * 用法：node --experimental-strip-types e2e/commit-dialog-demo.ts [输出目录]
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";
import { encode, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra提交弹窗测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9741;

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

/** 真鼠标——`.click()` 在这个界面里打不开好几样东西。 */
async function clickAt(selector: string): Promise<boolean> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return false;
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", {
			type, ...at,
			...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
		});
	}
	return true;
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);
	try {
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		const row = await evaluate<{ x: number; y: number } | null>(`(() => {
			const el = document.querySelector('[data-ly-row]');
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`);
		if (row) {
			for (const type of ["mousePressed", "mouseReleased"] as const) {
				await app.send("Input.dispatchMouseEvent", { type, ...row, button: "left", clickCount: 1 });
			}
		}
		await pause(2500);

		// Git 面板：认 `^Git `，别认 `Git`——侧边栏里带 "GitHub" 的会话标题会排在前面。
		const opened = await evaluate<boolean>(`(() => {
			const b = [...document.querySelectorAll('button')].find((el) => /^Git\\s/.test(el.getAttribute('aria-label') || ''));
			if (!b) return false;
			b.click();
			return true;
		})()`);
		check("打开 Git 面板", opened, opened ? "点了工具条" : "找不到那颗按钮");
		await until(`document.querySelector('[data-dock-pane="review"]')`, 20000);
		await pause(2500);

		console.log("\n【一】打开提交弹窗：它该在屏幕正中，背后压暗");
		/*
		 * 认 `data-ly-sync="push"`，不认文字。
		 *
		 * 这颗按钮的 aria-label 是「已与 origin/main 同步」或「N 个提交尚未推送」——跟着仓库状态
		 * 和界面语言变。第一版探针拿 /提交|commit/ 去匹配，一条都对不上，报出来像是入口没了。
		 */
		const viaToolbar = await clickAt('[data-ly-sync="push"]');
		check("点开提交入口", viaToolbar, viaToolbar ? "点了同步区那一颗" : "没找到入口");
		await until(`document.querySelector('[data-ly-commit-dialog]')`, 15000).catch(() => {});

		const box = await evaluate<{ scrim: boolean; cardX: number; cardY: number; winX: number; winY: number } | null>(`(() => {
			const scrim = document.querySelector('[data-ly-overlay]');
			const card = document.querySelector('[data-ly-modal]');
			if (!scrim || !card) return null;
			const s = scrim.getBoundingClientRect();
			const c = card.getBoundingClientRect();
			return {
				scrim: Math.round(s.width) >= window.innerWidth - 1 && Math.round(s.height) >= window.innerHeight - 1,
				cardX: Math.round(c.left + c.width / 2),
				cardY: Math.round(c.top + c.height / 2),
				winX: Math.round(window.innerWidth / 2),
				winY: Math.round(window.innerHeight / 2),
			};
		})()`);
		if (!box) {
			check("弹窗画出来了", false, "找不到遮罩或卡片");
			return;
		}
		check("遮罩铺满整个窗口", box.scrim, "是");
		// 居中允许几像素误差：卡片有边框和阴影，内容高度也会让它在竖向上略有偏移。
		check(
			"卡片落在窗口正中",
			Math.abs(box.cardX - box.winX) <= 4 && Math.abs(box.cardY - box.winY) <= 8,
			`卡片中心 (${box.cardX}, ${box.cardY}) vs 窗口中心 (${box.winX}, ${box.winY})`,
		);
		await pause(1400);

		console.log("\n【二】分支那一行能点开，里面有本地分支和「新分支」");
		const picked = await clickAt("[data-ly-branch-picker]");
		check("分支那一行可点", picked, picked ? "点开了" : "它还是个不能点的标签");
		await pause(900);
		const menu = await evaluate<string>(`(() => {
			const items = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].map((el) => (el.innerText || '').trim()).filter(Boolean);
			return items.join(" / ");
		})()`);
		check("菜单里有「新分支」", menu.includes("新分支"), menu || "（菜单是空的）");
		await pause(1200);

		console.log("\n【三】选「新分支」：换成输入框，而且不该当场建分支");
		const chose = await evaluate<boolean>(`(() => {
			const hit = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')].find((el) => /新分支/.test(el.innerText || ''));
			if (!hit) return false;
			hit.click();
			return true;
		})()`);
		check("点了「新分支」", chose, chose ? "点了" : "菜单里没有它");
		await pause(900);
		const field = await evaluate<boolean>(`Boolean(document.querySelector('[data-ly-new-branch]'))`);
		check("分支那一行换成了输入框", field, field ? "是" : "还是原来那一行");

		// 真的打几个字，让录像看得见。
		await evaluate(`(() => {
			const el = document.querySelector('[data-ly-new-branch]');
			if (!el) return;
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
			setter.call(el, 'feature/demo');
			el.dispatchEvent(new Event('input', { bubbles: true }));
		})()`);
		await pause(1600);

		const branches = await evaluate<string[]>(`(async () => {
			const list = await window.lyra.git.branches(${JSON.stringify(process.cwd())});
			return list.local;
		})()`).catch(() => [] as string[]);
		check(
			"仓库里还没有这个分支（到提交那一刻才建）",
			!branches.includes("feature/demo"),
			branches.length ? `本地分支：${branches.join("、")}` : "（读不到分支列表，跳过）",
		);

		// 收回这一步，别在录像结束时留着一个半填的状态。
		await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
		await pause(1400);
	} finally {
		await stop();
		const passed = checks.filter((c) => c.ok).length;
		const out = join(OUT_DIR, `${STAMP}_提交弹窗_${passed}of${checks.length}.mp4`);
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
