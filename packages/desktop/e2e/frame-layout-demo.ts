/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * The window frame after the reference layout, measured in the real window and recorded.
 *
 * Toolbar across the top (back, forward, the sidebar toggle, the one screen's title and panel
 * buttons), the icon rail, the sidebar as a card, and every screen a card below the toolbar. Then the
 * things that live inside that frame and broke before: split screens, dragging and popping out
 * panels, a conversation in a window of its own, the narrow window's drawer, and settings.
 *
 * Usage: build first (`pnpm --filter @lyra/desktop build`), then
 * `node --experimental-strip-types packages/desktop/e2e/frame-layout-demo.ts [light|dark] [outDir]`
 * Dark runs the same script and keeps only the screenshots that differ by theme.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type AppWindow, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const THEME = process.argv[2] === "dark" ? "dark" : "light";
const OUT = process.argv[3] ?? join(homedir(), "Desktop", "Lyra布局改版测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9877;
const W = 1280;
const H = 820;

const checks: { ok: boolean; what: string }[] = [];
function check(what: string, ok: boolean, saw: unknown) {
	checks.push({ ok, what });
	console.log(`   ${ok ? "✅" : "❌"} ${what}  ${JSON.stringify(saw)}`);
}

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const ANSWER = [
	"已经把配置读取拆成两步：先读默认值，再按项目覆盖。",
	"",
	"```ts",
	"const merged = { ...DEFAULTS, ...global, ...local };",
	"if (!merged.providers?.length) {",
	"\tthrow new Error(\"没有可用的服务商\");",
	"}",
	"return freeze(merged);",
	"```",
	"",
	"| 场景 | 之前 | 现在 |",
	"| --- | --- | --- |",
	"| 项目覆盖了审批模式 | 被全局设置盖掉 | 项目说了算 |",
	"| 服务商地址带斜杠 | 请求 404 | 自动去掉末尾斜杠 |",
	"",
	"最后跑了一遍 `pnpm test`，全部通过。",
].join("\n");
const SESSIONS = [
	{ id: "s-config", title: "配置读取拆成两步", q: "把配置读取拆成两步，项目设置最后合并", a: ANSWER, ago: 40 },
	{ id: "s-short", title: "123123", q: "123123", a: "收到。", ago: 5 },
	{ id: "s-third", title: "第三个会话", q: "第三个问题", a: "第三个回答。", ago: 30 },
	{ id: "s-fourth", title: "第四个会话", q: "第四个问题", a: "第四个回答。", ago: 20 },
];

async function seed(home: string) {
	const proj = join(home, "proj");
	await mkdir(proj, { recursive: true });
	await writeFile(join(proj, "README.md"), "# proj\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: W, height: H, x: 40, y: 40 }));
	await mkdir(join(home, "sessions", "e2e"), { recursive: true });
	for (const session of SESSIONS) {
		const at = Date.now() - session.ago * 60_000;
		const meta = { id: session.id, title: session.title, cwd: proj, projectId: "e2e", projectName: "proj", createdAt: at, updatedAt: at, modelId: "p/gpt-5.2", messageCount: 2, usage, seq: 3 };
		await writeFile(
			join(home, "sessions", "e2e", `${session.id}.jsonl`),
			[
				{ seq: 1, ts: at, type: "meta", meta },
				{ seq: 2, ts: at, type: "message", message: { role: "user", content: [{ type: "text", text: session.q }], timestamp: at } },
				{ seq: 3, ts: at, type: "message", message: { role: "assistant", content: [{ type: "text", text: session.a }], api: "openai-chat-completions", provider: "p", model: "gpt-5.2", usage, stopReason: "stop", timestamp: at } },
			].map((line) => JSON.stringify(line)).join("\n") + "\n",
		);
	}
	const model = { id: "p/gpt-5.2", providerId: "p", modelId: "gpt-5.2", name: "gpt-5.2", contextWindow: 128000, maxOutputTokens: 8192, supportsThinking: false, supportsImages: false, supportsTools: true };
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1,
		appearance: { theme: THEME, vibrancy: false },
		providers: [{ id: "p", name: "Local", api: "openai-chat-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "sk-x", enabled: true, models: [model] }],
		mcpServers: [],
		projects: [{ id: "e2e", name: "proj", path: proj, pinned: false, lastOpenedAt: 1 }],
		defaultModelId: "p/gpt-5.2",
		permissionMode: "auto",
		thinking: "off",
		hooks: [],
		scheduledTasks: [],
		disabledPlugins: [],
		alwaysAllow: [],
	}));
}

let app: RunningApp;
const frames: Frame[] = [];

const q = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
async function until(expression: string, ms = 15_000) {
	for (let i = 0; i < ms / 100; i++) {
		if (await app.evaluate(`Boolean(${expression})`)) return true;
		await pause(100);
	}
	throw new Error(`UI condition not reached: ${expression}`);
}
async function at(expression: string): Promise<{ x: number; y: number }> {
	await until(expression);
	return app.evaluate(`(()=>{const el=${expression};const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
}
async function click(expression: string, button: "left" | "right" = "left") {
	const p = await at(expression);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
	for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...p, button, clickCount: 1, buttons: type === "mousePressed" ? (button === "left" ? 1 : 2) : 0 });
}
async function key(code: string, keyName: string, modifiers = 0) {
	for (const type of ["keyDown", "keyUp"]) await app.send("Input.dispatchKeyEvent", { type, code, key: keyName, modifiers, windowsVirtualKeyCode: keyName === "[" ? 219 : keyName === "]" ? 221 : 27 });
}
async function hold(ms = 900) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const picture = await app.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
		frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
		await pause(Math.min(160, Math.max(0, end - Date.now())));
	}
}
async function shot(name: string, clip?: { x: number; y: number; width: number; height: number }) {
	const picture = await app.send<{ data: string }>("Page.captureScreenshot", clip ? { format: "png", clip: { ...clip, scale: 2 } } : { format: "png" });
	await writeFile(join(OUT, `${STAMP}_${THEME}_${name}.png`), Buffer.from(picture.data, "base64"));
}
const box = (selector: string) => app.evaluate<{ x: number; y: number; w: number; h: number } | null>(`(()=>{const el=${q(selector)};if(!el)return null;const r=el.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})()`);
const railCurrent = () => app.evaluate<string | null>(`${q("[data-ly-rail-item][aria-current=page]")}?.getAttribute("data-ly-rail-item") ?? null`);
const toolbarTitle = () => app.evaluate<string | null>(`${q("[data-ly-toolbar-title] [data-ly-screen-title]")}?.textContent ?? null`);
const screens = () => app.evaluate<number>(`Number(${q("[data-ly-split-root]")}?.getAttribute("data-ly-split-count") || 0)`);
const toolbarButton = (index: number) => `[...document.querySelectorAll("[data-ly-main-toolbar] button")][${index}]`;

/** Through the row's own menu (打开方式 › 分屏), the route people take; the probe needs no drag precision for it. */
async function splitWith(id: string) {
	await click(`${q(`[data-ly-row="${id}"]`)}`, "right");
	await pause(450);
	await click(`[...document.querySelectorAll('[role="menuitem"]')].find((el) => /打开方式/.test(el.textContent || ""))`);
	await pause(450);
	await click(`[...document.querySelectorAll('[role="menuitem"]')].find((el) => (el.textContent || "").trim() === "分屏")`);
	await pause(1400);
}

/** A dock pane carried by its grip: press on the grip, move and release on the window. No backticks in here. */
async function dragPane(kind: string, to: { x: number; y: number }) {
	return app.evaluate<boolean>(`(async () => {
		const grip = document.querySelector('[data-dock-grip="${kind}"]');
		if (!grip) return false;
		const b = grip.getBoundingClientRect();
		const from = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
		const send = (type, x, y) => (type === 'pointerdown' ? grip : window).dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
		const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		send('pointerdown', from.x, from.y);
		await frame();
		for (let i = 1; i <= 12; i++) { send('pointermove', from.x + (${to.x} - from.x) * i / 12, from.y + (${to.y} - from.y) * i / 12); await frame(); }
		send('pointerup', ${to.x}, ${to.y});
		await frame();
		return true;
	})()`);
}

async function otherWindow(kind: "panel" | "session"): Promise<AppWindow | null> {
	for (let i = 0; i < 40; i++) {
		const windows = await app.windows();
		const hit = windows.find((window) => window.boot?.kind === kind);
		if (hit) return hit;
		await pause(150);
	}
	return null;
}

async function main() {
	await mkdir(OUT, { recursive: true });
	app = await startApp({ port: PORT, seed });
	const stop = await startRecording(PORT, frames);
	try {
		await app.evaluate("document.fonts.ready");
		await until(`document.querySelectorAll("[data-ly-row]").length >= 4`);

		console.log("\n== A 单屏：标题在顶栏，卡片里没有标题栏");
		await click(q('[data-ly-row="s-config"]'));
		await until(`${q("[data-ly-toolbar-title]")}?.textContent.includes("配置读取拆成两步")`);
		await hold(900);
		const toolbar = await box("[data-ly-main-toolbar]");
		const panel = await box("[data-ly-frame-panel]");
		const nav = await box(".ly-nav-column");
		const card = await box(".ly-dock-card");
		const rail = await box("[data-ly-app-rail]");
		const title = await box("[data-ly-toolbar-title]");
		const rule = await box("[data-ly-toolbar-divider]");
		const content = await box('[data-dock-content="conversation"]');
		check("顶栏 40px 横贯窗口", toolbar?.y === 0 && toolbar.h === 40 && toolbar.w === W, toolbar);
		check("图标栏 48px，在顶栏下面", rail?.x === 0 && rail.w === 48 && rail.y === 40, rail);
		check("侧栏和内容在同一块面板里：贴着图标栏和顶栏，右、下各留 4px", panel?.x === 48 && panel.y === 40 && panel.w === W - 52 && panel.h === H - 44, panel);
		check("侧栏和对话之间只有一条线，没有间隙", Boolean(nav && card && card.x === nav.x + nav.w && card.y === panel!.y + 1), { nav, card });
		check("顶栏里是一小段短线，和侧栏的分隔线对齐、不连到下面", Boolean(rule && nav && rule.x === nav.x + nav.w - 1 && rule.h === 20 && rule.y === 10), { rule, navRight: nav && nav.x + nav.w });
		check("标题在短线之后、落在对话这一侧", Boolean(title && rule && title.x >= rule.x + 8 && title.x <= rule.x + 24 && title.y < 40), { title, rule });
		check("对话里不再留 44px 标题栏：转录从面板顶上开始", Boolean(content && card && Math.abs(content.y - card.y) <= 1), { content, card });
		await shot("01_单屏对话");

		console.log("\n== B 侧栏收起与展开：顶栏标题跟着卡片走");
		const samples = await app.evaluate<{ t: number; title: number; card: number }[]>(`(async () => {
			const out = [];
			const start = performance.now();
			${toolbarButton(2)}.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			while (performance.now() - start < 520) {
				await new Promise((r) => requestAnimationFrame(r));
				const title = document.querySelector("[data-ly-toolbar-title]")?.getBoundingClientRect().x ?? -1;
				out.push({ t: Math.round(performance.now() - start), title: Math.round(title), card: Math.round(document.querySelector(".ly-dock-card").getBoundingClientRect().x) });
			}
			return out;
		})()`);
		const end = samples.at(-1)!;
		const from = samples[0]!.card;
		// A slide passes through positions on the way; a jump goes from one end to the other in a frame.
		const between = new Set(samples.map((s) => s.card).filter((x) => x !== from && x !== end.card)).size;
		check("收起是滑过去的，不是一帧跳到位（中途经过的位置 ≥ 5 个）", between >= 5, { frames: samples.length, between, from, to: end.card });
		check("收起后对话贴着面板左边，标题退到按钮组之后", end.card === 49 && end.title > 150 && end.title < 220, end);
		await hold(700);
		await shot("02_侧栏收起");
		await click(toolbarButton(2));
		await hold(700);
		const reopened = await box(".ly-dock-card");
		check("再展开回到原位", reopened?.x === card?.x, { reopened, card });

		console.log("\n== C 图标栏与前进后退");
		await click(q('[data-ly-rail-item="pull-requests"]'));
		await hold(700);
		check("图标栏：拉取请求高亮", (await railCurrent()) === "pull-requests", await railCurrent());
		await click(q('[data-ly-rail-item="scheduled"]'));
		await hold(600);
		await click(q('[data-ly-rail-item="plugins"]'));
		await hold(900);
		check("图标栏：插件高亮，顶栏没有对话标题", (await railCurrent()) === "plugins" && (await toolbarTitle()) === null, { rail: await railCurrent(), title: await toolbarTitle() });
		await shot("03_插件页");
		await click(toolbarButton(0));
		await hold(600);
		const back1 = await railCurrent();
		await click(toolbarButton(0));
		await hold(600);
		const back2 = await railCurrent();
		await click(toolbarButton(0));
		await hold(800);
		const back3 = { rail: await railCurrent(), title: await toolbarTitle() };
		check("后退三次：插件 → 已安排 → 拉取请求 → 回到那段对话", back1 === "scheduled" && back2 === "pull-requests" && back3.rail === "chat" && back3.title === "配置读取拆成两步", { back1, back2, back3 });
		await click(toolbarButton(1));
		await hold(600);
		check("前进一次：回到拉取请求", (await railCurrent()) === "pull-requests", await railCurrent());
		await key("BracketRight", "]", 4);
		await hold(600);
		check("⌘] 再前进：已安排", (await railCurrent()) === "scheduled", await railCurrent());
		await key("BracketLeft", "[", 4);
		await hold(600);
		check("⌘[ 后退：拉取请求", (await railCurrent()) === "pull-requests", await railCurrent());
		await click(q('[data-ly-rail-item="chat"]'));
		await hold(800);

		console.log("\n== D 铃铛：通知列表");
		await click(q("[data-ly-notifications-button]"));
		await hold(700);
		const bell = await app.evaluate<{ open: boolean; empty: boolean }>(`({ open: ${q("[data-ly-notifications-button]")}.getAttribute("aria-expanded") === "true", empty: Boolean(${q("[data-ly-notifications-empty]")}) })`);
		check("铃铛按下去有反应：打开通知列表（没有待办时说没有）", bell.open && bell.empty, bell);
		await shot("04_通知");
		await key("Escape", "Escape");
		await hold(400);

		console.log("\n== E 分屏：每一屏自己的标题栏，卡片都在顶栏下面");
		await splitWith("s-short");
		await until(`${q("[data-ly-split-root]")}?.getAttribute("data-ly-split-count") === "2"`);
		await hold(1000);
		const split = await app.evaluate<{ cards: { x: number; y: number; w: number }[]; headers: { pad: string; top: number; inCard: boolean }[]; toolbarTitle: boolean }>(`(() => {
			const cards = [...document.querySelectorAll("[data-ly-split-pane] [data-dock-pane=conversation] .ly-dock-card")].map((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; }).sort((a, b) => a.x - b.x);
			const headers = [...document.querySelectorAll("[data-ly-split-chrome]")].map((el) => ({ pad: getComputedStyle(el).paddingLeft, top: Math.round(el.getBoundingClientRect().y), inCard: Boolean(el.closest("[data-ly-pane-slot=conversation]")) }));
			return { cards, headers, toolbarTitle: Boolean(document.querySelector("[data-ly-toolbar-title]")) };
		})()`);
		const gap = split.cards.length === 2 ? split.cards[1]!.x - (split.cards[0]!.x + split.cards[0]!.w) : -1;
		check("两屏：顶栏不再放标题，每屏各有标题栏、都在自己那一栏里", !split.toolbarTitle && split.headers.length === 2 && split.headers.every((h) => h.inCard), split);
		check("两屏都从顶栏下面开始，左边那屏不再给红绿灯让位", split.cards.every((c) => c.y === 41) && split.headers.every((h) => h.pad === "10px"), split);
		check("两屏之间只隔 1px 线（不再是两张卡片中间一道缝）", gap === 1, { gap });
		const seamLines = await app.evaluate<number>(`[...document.querySelectorAll(".ly-splitter-line")].filter((el) => getComputedStyle(el).opacity !== "0").length`);
		check("拖动条平时不画线，交界处不是两条线叠在一起", seamLines === 0, { visibleSplitterLines: seamLines });
		await shot("05_两屏");
		if (split.cards.length === 2) {
			const seam = split.cards[0]!.x + split.cards[0]!.w;
			await shot("05b_两屏交界放大", { x: seam - 90, y: 30, width: 180, height: 150 });
		}
		await splitWith("s-third");
		await splitWith("s-fourth");
		await hold(1000);
		check("四屏都摆得下", (await screens()) === 4, await screens());
		await shot("06_四屏");
		for (let i = 0; i < 3; i++) {
			await click(`${q("[data-ly-split-close]")}.closest("button")`);
			await pause(900);
		}
		await hold(800);
		check("关到只剩一屏：标题回到顶栏", (await screens()) === 1 && (await toolbarTitle()) !== null, { screens: await screens(), title: await toolbarTitle() });

		console.log("\n== F 面板：打开、拖动换位、弹出成窗口、收回");
		await click(`[...document.querySelectorAll("[data-ly-split-tools] button")].find((b) => /^终端/.test(b.getAttribute("aria-label") || ""))`);
		await until(`${q('[data-dock-pane="terminal"]')}?.checkVisibility()`);
		await hold(1100);
		const term0 = await box('[data-dock-pane="terminal"]');
		const titleWithPanel = await box("[data-ly-toolbar-title]");
		const termLine = await app.evaluate<boolean>(`Boolean(${q('[data-dock-pane="terminal"] .ly-dock-card')}?.matches("[data-edge-left], [data-edge-top]"))`);
		check("开着终端时标题仍在顶栏；终端和对话之间是一条线，不是另一张卡片", Boolean(titleWithPanel && card && titleWithPanel.x >= card.x && titleWithPanel.x <= card.x + 24) && termLine, { titleWithPanel, term0, termLine });
		await shot("07_终端");
		const dock = await box("[data-ly-split-pane]");
		const target = term0 && dock && term0.y > dock.y + dock.h / 2 ? { x: dock.x + dock.w - 60, y: dock.y + dock.h / 2 } : { x: (dock?.x ?? 0) + (dock?.w ?? 0) / 2, y: (dock?.y ?? 0) + (dock?.h ?? 0) - 40 };
		const dragged = await dragPane("terminal", target);
		await hold(1200);
		const term1 = await box('[data-dock-pane="terminal"]');
		check("终端能拖到另一侧", dragged && Boolean(term0 && term1 && (Math.abs(term1.x - term0.x) > 40 || Math.abs(term1.y - term0.y) > 40)), { term0, term1 });
		await shot("08_终端换位");
		const pagesBefore = (await app.windows()).length;
		await click(`${q('[data-ly-pop-out="terminal"]')}.closest("button")`);
		const panelWindow = await otherWindow("panel");
		await hold(1200);
		const gone = !(await app.evaluate<boolean>(`Boolean(${q('[data-dock-pane="terminal"]')}?.checkVisibility())`));
		check("终端弹成独立窗口，主窗口里腾空", Boolean(panelWindow) && gone, { windows: [pagesBefore, (await app.windows()).length], gone });
		if (panelWindow) {
			await panelWindow.evaluate(`(document.querySelector("[data-ly-restore-panel]")?.closest("button") ?? document.querySelector("[data-ly-restore-panel]"))?.click()`).catch(() => undefined);
			await pause(1600);
			await hold(600);
			const back = await app.evaluate<boolean>(`Boolean(${q('[data-dock-pane="terminal"]')}?.checkVisibility())`);
			check("从面板窗口点「收回」，终端回到原来那一屏", back, { back });
		}

		console.log("\n== G 会话在新窗口里打开");
		await click(q('[data-ly-row="s-third"]'), "right");
		await pause(450);
		await click(`[...document.querySelectorAll('[role="menuitem"]')].find((el) => /打开方式/.test(el.textContent || ""))`);
		await pause(450);
		await click(`[...document.querySelectorAll('[role="menuitem"]')].find((el) => (el.textContent || "").trim() === "新窗口")`);
		const sessionWindow = await otherWindow("session");
		await hold(900);
		if (sessionWindow) {
			await pause(1500);
			const seen = await sessionWindow.evaluate<{ title: string; header: number; frame: boolean }>(`({ title: document.querySelector("[data-ly-session-window-title]")?.textContent ?? "", header: Math.round(document.querySelector("[data-ly-session-window-chrome]")?.getBoundingClientRect().height ?? 0), frame: Boolean(document.querySelector(".ly-framed, [data-ly-app-rail]")) })`);
			check("新窗口是那段会话本身：没有图标栏和侧栏，自己的 44px 标题栏", seen.title.includes("第三个") && seen.header === 44 && !seen.frame, seen);
			const picture = await sessionWindow.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
			await writeFile(join(OUT, `${STAMP}_${THEME}_09_会话新窗口.png`), Buffer.from(picture.data, "base64"));
		} else {
			check("会话能在新窗口里打开", false, "no session window");
		}

		console.log("\n== H 窄窗口：没有图标栏，抽屉从顶栏下面开始");
		await app.send("Emulation.setDeviceMetricsOverride", { width: 700, height: H, deviceScaleFactor: 0, mobile: false });
		await hold(900);
		await click(toolbarButton(2));
		await hold(900);
		const narrow = await app.evaluate<{ rail: boolean; drawerTop: number; places: string[] }>(`({ rail: Boolean(${q("[data-ly-app-rail]")}), drawerTop: Math.round(${q('aside[data-pane="drawer"]')}?.getBoundingClientRect().y ?? -1), places: [...document.querySelectorAll('aside[data-pane="drawer"] button')].map((b) => b.textContent.trim()).filter((t) => ["拉取请求", "已安排", "插件"].includes(t)) })`);
		check("窄窗口收起图标栏，三个入口回到抽屉里，抽屉不被顶栏盖住", !narrow.rail && narrow.drawerTop === 40 && narrow.places.length === 3, narrow);
		await shot("10_窄窗口抽屉");
		await click(toolbarButton(2));
		await app.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 0, mobile: false });
		await hold(900);

		console.log("\n== I 设置：同一套外框");
		await click(q('[data-ly-rail-item="settings"]'));
		await until(q("[data-ly-settings] .ly-nav-column"));
		await hold(1000);
		const settingsFrame = await app.evaluate<{ rail: string | null; nav: number; main: number }>(`({ rail: ${q("[data-ly-settings] [data-ly-rail-item][aria-current=page]")}?.getAttribute("data-ly-rail-item") ?? null, nav: Math.round(${q("[data-ly-settings] .ly-nav-column")}.getBoundingClientRect().y), main: Math.round(${q("[data-ly-settings] main")}.getBoundingClientRect().y) })`);
		check("设置页也在同一块面板里：图标栏的设置高亮，导航和正文都从顶栏下面开始", settingsFrame.rail === "settings" && settingsFrame.nav === 41 && settingsFrame.main === 41, settingsFrame);
		await shot("11_设置");
		await click(toolbarButton(0));
		await hold(800);
		check("在设置页按后退，回到对话", (await railCurrent()) === "chat", await railCurrent());
	} finally {
		await stop();
		await app.stop();
	}
	const passed = checks.filter((c) => c.ok).length;
	await encode(frames, join(OUT, `${STAMP}_${THEME}_布局改版_${passed}of${checks.length}.mp4`), 12, 1500);
	console.log(`\n${passed}/${checks.length} passed → ${OUT}`);
	process.exitCode = passed === checks.length ? 0 : 1;
}

await main();
