/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 窗口只由人来开——在真窗口里验，边验边录。
 *
 * 单测钉的是「不调用 `windows.openPanel`」，跑在 happy-dom 里，用的是摆好的尺寸。这里补它证
 * 不到的那几段：`useBoxSize` 要真的量到一个变窄的视口才会重新算，弹出去的那个窗口是不是空的
 * 只有那个窗口自己能回答，而「按钮在不在」是画出来的结果而不是一个布尔。
 *
 * 三件事，对应 `docs/architecture/split-window-conflicts.md` 第六、七节：
 *
 *   一、把窗口压到 800 宽——夹在 compact 阈值 760 和「会话 420 + 面板 300」之间，正是从前
 *       必弹的那一段。面板要还在 dock 里，主进程的窗口列表要还是空的。
 *   二、把侧边聊天弹出去，那个窗口里不能是「需要一个会话」——那句话等于 `useSide.sessionId`
 *       还是 null，也就是 `attach` 没跑过，输入框收了字一条也发不出去。
 *   三、浏览器不该有「在新窗口打开」那颗按钮，而终端该有。
 *
 * 判据取自 DOM 和主进程的窗口列表，不问 store——store 说的是「我们以为怎样」。
 *
 * 用法：node --experimental-strip-types e2e/window-policy-demo.ts [输出目录]
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type AppWindow, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra窗口策略测试");
const PORT = 9731;
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

/** 夹在 compact（<760）和「并排要 720」之间：从前这一段必弹窗。 */
const NARROW = { width: 800, height: 700 };
const WIDE = { width: 1440, height: 900 };

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string): void {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

const evaluate = <T>(expression: string): Promise<T> => app.evaluate<T>(expression);

/** 主进程认的那份窗口列表。渲染进程的 store 可能落后一拍，这个不会。 */
async function nativeWindows(): Promise<string[]> {
	return (await app.windows()).map((w) => `${w.boot.kind}${w.boot.panelKind ? `:${w.boot.panelKind}` : ""}`);
}

/** dock 里此刻画着哪些面板。`data-dock-pane` 是两个 dock 共用的记号。 */
async function panesOnScreen(): Promise<string[]> {
	return evaluate<string[]>(`[...document.querySelectorAll('[data-dock-pane]')]
		.filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
		.map((el) => el.dataset.dockPane)`);
}

/** 按 aria-label 点右上角工具条那排按钮。 */
async function toolbar(label: RegExp): Promise<boolean> {
	return evaluate<boolean>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => ${label}.test(el.getAttribute('aria-label') || ''));
		if (!b) return false;
		b.click();
		return true;
	})()`);
}

/**
 * 从「面板」菜单里开一个面板。
 *
 * 工具条上只有三颗按钮（`QUICK` = 终端、浏览器、Git），其余的在这个溢出菜单里——第一版探针
 * 拿正则去工具条上找「侧边聊天」，自然找不到，报出来却像是「那颗按钮不见了」这么一条产品
 * 缺陷。菜单才是它的入口。
 */
async function fromPanelMenu(label: RegExp): Promise<boolean> {
	const opened = await evaluate<boolean>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => (el.getAttribute('aria-label') || '') === '面板');
		if (!b) return false;
		b.click();
		return true;
	})()`);
	if (!opened) return false;
	await pause(600);
	return evaluate<boolean>(`(() => {
		const hit = [...document.querySelectorAll('[role="menuitem"], [data-ly-popover] button')]
			.find((el) => ${label}.test((el.innerText || '').trim()));
		if (!hit || hit.disabled) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return false; }
		hit.click();
		return true;
	})()`);
}

async function resize(size: { width: number; height: number }): Promise<void> {
	await app.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 0, mobile: false });
	await pause(1400);
}

/** 那个面板窗口，等到它的界面真的画出来为止——`bootWindow` 答得上来时 React 还没挂。 */
async function panelWindowOf(kind: string, ms = 15000): Promise<AppWindow | null> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const hit = (await app.windows()).find((w) => w.boot.kind === "panel" && w.boot.panelKind === kind);
		if (hit && (await hit.evaluate<boolean>(`Boolean(document.querySelector('[data-ly-restore-panel]'))`).catch(() => false))) return hit;
		await pause(400);
	}
	return null;
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	const d = driver(app);
	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);

	try {
		await d.until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await resize(WIDE);
		await d.click("[data-ly-row]");
		await d.until(`document.querySelector('[data-dock-pane="conversation"]')`, 30000);
		await pause(1200);

		console.log("\n【一】把窗口压窄，面板不该自己跑出去");
		await toolbar(/终端|Terminal/);
		await pause(1600);
		const before = await panesOnScreen();
		check("先把终端开在 dock 里", before.includes("terminal"), before.join("、") || "（一个面板都没有）");
		await pause(900);

		await resize(NARROW);
		const after = await panesOnScreen();
		const windowsNow = await nativeWindows();
		check("压到 800 宽之后终端还在 dock 里", after.includes("terminal"), after.join("、") || "（面板没了）");
		check("没有凭空多出一个窗口", windowsNow.filter((w) => w !== "primary").length === 0, windowsNow.join("、"));
		await pause(1200);

		// 再压一档：这一档连 compact 都进了，面板仍然不该变成窗口。
		await resize({ width: 700, height: 620 });
		const windowsNarrower = await nativeWindows();
		check("再窄一档也没有新窗口", windowsNarrower.filter((w) => w !== "primary").length === 0, windowsNarrower.join("、"));
		await resize(WIDE);
		await pause(1200);

		console.log("\n【二】侧边聊天弹出去之后，里面不能是「需要一个会话」");
		const chatOpened = await fromPanelMenu(/侧边聊天/);
		check("从「面板」菜单里开出侧边聊天", chatOpened, "菜单里没找到这一项");
		await pause(1500);
		const withChat = await panesOnScreen();
		check("侧边聊天画在 dock 里", withChat.includes("chat"), withChat.join("、") || "（没画出来）");
		const popped = await evaluate<boolean>(`(() => {
			const mark = document.querySelector('[data-ly-pop-out="chat"]');
			if (!mark) return false;
			(mark.closest('button') || mark).click();
			return true;
		})()`);
		check("侧边聊天有「在新窗口打开」可点", popped, "那颗按钮没找到");
		const chatWindow = await panelWindowOf("chat");
		check("侧边聊天的面板窗口开起来了", Boolean(chatWindow), "等不到那个窗口画出来");
		if (chatWindow) {
			await pause(1500);
			const inside = await chatWindow.evaluate<{ text: string; composer: boolean }>(`({
				text: (document.body.innerText || '').slice(0, 400),
				composer: Boolean(document.querySelector('textarea')),
			})`);
			// 「需要一个会话」正是 sessionId 为 null 时画的那句——attach 没跑过的样子。
			check("窗口里不是「需要一个会话」", !/需要一个会话|needs a conversation|Open a conversation/i.test(inside.text), inside.text.split("\n").slice(0, 3).join(" / "));
			check("窗口里有能打字的输入框", inside.composer, "连输入框都没画出来");
		}
		await pause(1200);

		console.log("\n【三】浏览器不给「在新窗口打开」，终端给");
		await toolbar(/浏览器|Browser/);
		await pause(1800);
		const buttons = await evaluate<{ browser: boolean; terminal: boolean }>(`({
			browser: Boolean(document.querySelector('[data-ly-pop-out="browser"]')),
			terminal: Boolean(document.querySelector('[data-ly-pop-out="terminal"]')),
		})`);
		check("浏览器没有那颗按钮", !buttons.browser, "它还在——<webview> 搬过去只会重新加载");
		check("终端仍然有那颗按钮", buttons.terminal, "连能搬的面板也不给搬了");
		await pause(1800);
	} finally {
		await stop();
		console.log(`\n采到 ${frames.length} 帧，正在合成…`);
	}

	const passed = checks.filter((c) => c.ok).length;
	const out = join(OUT_DIR, `${STAMP}_窗口只由人来开_${passed}of${checks.length}.mp4`);
	await app.stop();
	if (frames.length > 0) await encode(frames, out, 60, 1200);

	console.log(`\n${passed}/${checks.length} 项通过`);
	console.log(frames.length > 0 ? `视频：${out}` : "没有采到帧，视频没生成");
	if (passed !== checks.length) process.exitCode = 1;
}

main().catch(async (error: unknown) => {
	console.error(error);
	await app?.stop().catch(() => {});
	process.exitCode = 1;
});
