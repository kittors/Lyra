/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 右侧面板的两种排法在真窗口里长什么样——边验边录。
 *
 * 标签页：终端、浏览器、Git 收在右边一栏，一次只显示一个；切标签不重建终端；拖分隔线改宽度。
 * 然后到 设置 › 外观 › 面板 切到「分栏」，同样三个面板各占一格；再切回来。
 *
 * 用法：node --experimental-strip-types e2e/panel-tabs-demo.ts [标签] [输出目录]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const LABEL = process.argv[2] ?? "after";
const OUT_DIR = process.argv[3] ?? join(homedir(), "Desktop", "Lyra面板标签页测试");
const PORT = 9493;
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(join(project, "src"), { recursive: true });
	await writeFile(join(project, "src", "one.ts"), "export const one = 1\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1320, height: 860, x: 0, y: 0 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1,
		providers: [],
		mcpServers: [],
		projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
		permissionMode: "full",
		thinking: "off",
		retryAttempts: 1,
		hooks: [],
		scheduledTasks: [],
		disabledPlugins: [],
		alwaysAllow: [],
	}));
}

const checks: { ok: boolean; what: string }[] = [];
function check(what: string, ok: boolean, saw: unknown) {
	checks.push({ ok, what });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${JSON.stringify(saw)}`}`);
}

interface DockState {
	visible: { kind: string; left: number; width: number }[];
	mounted: string[];
	tabs: string[];
	selected: string | null;
	subheader: string[];
	terminalAlive: boolean;
}

let app: RunningApp | undefined;
const frames: Frame[] = [];
let shot = 0;

try {
	await mkdir(OUT_DIR, { recursive: true });
	app = await startApp({ port: PORT, seed });
	const d = driver(app);
	const capture = async (name: string) => {
		const { data } = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		await writeFile(join(OUT_DIR, `${STAMP}_${LABEL}_${String(++shot).padStart(2, "0")}_${name}.png`), Buffer.from(data, "base64"));
	};
	// 从看得见的东西取证：哪些 pane 没被隐藏、在哪儿、多宽；标签条上有哪些标签、选中的是哪个。
	const state = () => app!.evaluate<DockState>(`(() => {
		const panes = [...document.querySelectorAll("[data-dock-pane]")].filter((p) => p.dataset.dockPane !== "conversation");
		const shown = panes.filter((p) => !p.inert && getComputedStyle(p).opacity !== "0");
		const strip = shown[0]?.querySelector('[role="tablist"][aria-label="面板标签"]');
		return {
			visible: shown.map((p) => { const r = p.getBoundingClientRect(); return { kind: p.dataset.dockPane, left: Math.round(r.left), width: Math.round(r.width) }; }),
			mounted: panes.map((p) => p.dataset.dockPane),
			tabs: [...(strip?.querySelectorAll("[data-panel-tab]") ?? [])].map((t) => t.dataset.panelTab),
			selected: strip?.querySelector('[aria-selected="true"]')?.closest("[data-panel-tab]")?.dataset.panelTab ?? null,
			subheader: shown.map((p) => p.querySelector("[data-dock-subheader]")?.dataset.dockSubheader).filter(Boolean),
			terminalAlive: Boolean(document.querySelector("[data-demo-shell]")?.isConnected),
		};
	})()`);
	const quick = (index: number) => app!.evaluate(`(() => { document.querySelectorAll("[data-ly-panel-quick] button")[${index}]?.click(); })()`);

	await d.until(`document.querySelector("main textarea") && document.querySelectorAll("[data-ly-panel-quick] button").length >= 3`, 60000);
	const stop = await startRecording(PORT, frames);
	await pause(1000);
	await capture("没开面板");

	// 终端、浏览器、Git，按工具栏上的顺序一个个开。
	await quick(0);
	await d.until(`document.querySelector('[data-dock-pane="terminal"] .xterm')`, 20000);
	await app.evaluate(`document.querySelector('[data-dock-pane="terminal"] .xterm').setAttribute("data-demo-shell", "")`);
	await pause(1000);
	// 浏览器从标签条的「+」里开。
	const plus = await app.evaluate<{ gap: number | null } | null>(`(async () => {
		const pane = document.querySelector('[data-dock-pane="terminal"]');
		const button = pane.querySelector('button[aria-label="添加面板"]');
		const last = [...pane.querySelectorAll("[data-panel-tab]")].at(-1);
		if (!button || !last) return null;
		button.setAttribute("data-demo-plus", "");
		return { gap: Math.round(button.getBoundingClientRect().left - last.getBoundingClientRect().right) };
	})()`);
	await d.click("[data-demo-plus]");
	await pause(900);
	const offered = await app.evaluate<string[]>(`[...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent.trim())`);
	await capture("标签页_加号菜单");
	check("「+」紧跟在最后一个标签后面", plus !== null && plus.gap !== null && plus.gap >= 0 && plus.gap <= 8, plus);
	check("「+」菜单列出没开的面板，不列已开的终端", offered.some((t) => t.startsWith("浏览器")) && !offered.some((t) => t.startsWith("终端")), offered);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim().startsWith("浏览器")).setAttribute("data-demo-add", "")`);
	await d.click("[data-demo-add]");
	await pause(1000);
	const added = await state();
	check("从「+」开出浏览器标签并切过去", added.visible[0]?.kind === "browser" && JSON.stringify(added.tabs) === JSON.stringify(["terminal", "browser"]), added);
	await quick(2);
	await pause(1200);
	const three = await state();
	console.log("开了三个：", three);
	await capture("标签页_三个面板");
	check("标签页：只看得见一个面板，就是最后开的 Git", three.visible.length === 1 && three.visible[0].kind === "review", three.visible);
	check("标签条上三个标签，按打开的顺序", JSON.stringify(three.tabs) === JSON.stringify(["terminal", "browser", "review"]), three.tabs);
	check("选中的标签是 Git", three.selected === "review", three.selected);
	check("后台的终端、浏览器还挂着", ["terminal", "browser"].every((k) => three.mounted.includes(k)), three.mounted);

	// 点「终端」标签。
	await app.evaluate(`(() => { const shown = [...document.querySelectorAll("[data-dock-pane]")].find((p) => !p.inert && p.dataset.dockPane === "review"); shown.querySelector('[data-panel-tab="terminal"] [role="tab"]').setAttribute("data-demo-tab", ""); })()`);
	await d.click("[data-demo-tab]");
	await pause(1000);
	const term = await state();
	console.log("切到终端：", term);
	await capture("标签页_切到终端");
	check("切到终端：看得见的换成终端，位置和宽度不变", term.visible.length === 1 && term.visible[0].kind === "terminal" && term.visible[0].left === three.visible[0].left && term.visible[0].width === three.visible[0].width, { term: term.visible, before: three.visible });
	check("终端还是原来那一个，没被重建", term.terminalAlive, term.terminalAlive);
	check("终端自己的子标签挪到标签条下面一行", term.subheader.includes("terminal"), term.subheader);

	// 工具栏上按「浏览器」：它开着但在后台，按下去是切过去。
	await quick(1);
	await pause(1000);
	const browser = await state();
	await capture("标签页_工具栏切到浏览器");
	check("工具栏按后台标签是切过去，不是关掉", browser.visible[0]?.kind === "browser" && browser.tabs.length === 3, browser);

	// 拖分隔线，标签栏变宽。
	const splitter = await app.evaluate<{ x: number; y: number } | null>(`(() => { const s = document.querySelector("[data-dock-panes] .ly-splitter"); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	if (splitter) {
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...splitter });
		await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...splitter, button: "left", clickCount: 1 });
		for (let step = 1; step <= 10; step++) {
			await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: splitter.x - step * 12, y: splitter.y, button: "left", buttons: 1 });
			await pause(30);
		}
		await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: splitter.x - 120, y: splitter.y, button: "left", clickCount: 1 });
	}
	await pause(900);
	const wider = await state();
	await capture("标签页_拖宽");
	check("拖分隔线能改标签栏宽度", Boolean(splitter) && (wider.visible[0]?.width ?? 0) > (browser.visible[0]?.width ?? 0) + 60, { splitter, before: browser.visible, after: wider.visible });

	// 关掉当前标签（浏览器），落到它右边的 Git。
	await app.evaluate(`(() => { const shown = [...document.querySelectorAll("[data-dock-pane]")].find((p) => !p.inert && p.dataset.dockPane === "browser"); shown.querySelector('[data-panel-tab="browser"] button[aria-label]').setAttribute("data-demo-close", ""); })()`);
	await d.click("[data-demo-close]");
	await pause(1000);
	const closed = await state();
	await capture("标签页_关掉浏览器");
	check("关掉当前标签，落到右边那个", closed.visible[0]?.kind === "review" && JSON.stringify(closed.tabs) === JSON.stringify(["terminal", "review"]), closed);
	await quick(1);
	await pause(1000);

	// 设置 › 外观 › 面板 → 分栏。
	const openAppearance = () => app!.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const hit = (text) => { const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text); el?.click(); return Boolean(el); };
		if (!hit("外观")) { document.querySelector(".ly-sidebar-foot button")?.click(); await wait(1300); if (!hit("外观")) return false; }
		await wait(1000);
		return true;
	})()`);
	const pick = (label: string) => app!.evaluate<boolean>(`(async () => {
		const row = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent?.trim() === "面板")?.closest("div:has(button)");
		row?.scrollIntoView({ block: "center" });
		await new Promise((r) => setTimeout(r, 500));
		const button = [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === ${JSON.stringify(label)});
		button?.click();
		await new Promise((r) => setTimeout(r, 700));
		return Boolean(button);
	})()`);
	const back = () => app!.evaluate(`(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("返回工作区"))?.click(); await new Promise((r) => setTimeout(r, 1500)); })()`);

	check("设置里找得到外观页", await openAppearance(), "no 外观");
	const picked = await pick("分栏");
	await capture("设置_面板_分栏");
	check("面板那一行能选「分栏」", picked, picked);
	await back();
	await pause(900);
	const split = await state();
	console.log("分栏：", split);
	await capture("分栏_三个面板");
	check("分栏：三个面板各占一格、都看得见", split.visible.length === 3 && new Set(split.visible.map((v) => `${v.left}:${v.width}`)).size >= 2, split.visible);
	check("分栏：没有面板标签条", split.tabs.length === 0, split.tabs);
	check("切排法不重建终端", split.terminalAlive, split.terminalAlive);

	await openAppearance();
	await pick("标签页");
	await back();
	await pause(900);
	const again = await state();
	await capture("切回标签页");
	check("切回标签页：又只看得见一个", again.visible.length === 1 && again.tabs.length === 3, again);
	await pause(800);
	await stop();

	const passed = checks.filter((c) => c.ok).length;
	await encode(frames, join(OUT_DIR, `${STAMP}_${LABEL}_面板标签页_${passed}of${checks.length}.mp4`));
	console.log(`\n${passed}/${checks.length} 通过，输出在 ${OUT_DIR}`);
	if (passed !== checks.length) process.exitCode = 1;
} finally {
	await app?.stop();
}
