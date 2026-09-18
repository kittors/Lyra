/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 分屏格子先算空位再放面板：2×2 里第二个面板弹出窗口，再回到原来的格子。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/session-split-place-demo.ts`
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { evaluateRenderer, startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra分屏落点测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9795;
const IDS = ["place-a", "place-b", "place-c", "place-d"] as const;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

async function seed(home: string): Promise<void> {
	const cwd = join(home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# place\n");
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const metas = [];
	for (const [index, id] of IDS.entries()) {
		const messages = [
			{ role: "user", content: [{ type: "text", text: `会话 ${id} 用来验证落点` }], timestamp: index * 10 },
			{ role: "assistant", content: [{ type: "text", text: `${id} 的回复。\n\n${"落点内容行。".repeat(8)}` }], api: "anthropic-messages", provider: "qa", model: "qa", usage, stopReason: "stop", timestamp: index * 10 + 1 },
		];
		const meta = {
			id,
			title: `落点 ${id.slice(-1).toUpperCase()}`,
			projectId,
			projectName: "落点项目",
			cwd,
			createdAt: 1 + index,
			updatedAt: 100 - index,
			modelId: "qa/model",
			messageCount: messages.length,
			usage,
			seq: 3,
		};
		metas.push(meta);
		await writeFile(
			join(home, "sessions", projectId, `${id}.jsonl`),
			[
				JSON.stringify({ type: "meta", meta, seq: 0, ts: 1 }),
				...messages.map((message, i) => JSON.stringify({ type: "message", message, seq: i + 1, ts: 1 })),
				JSON.stringify({ type: "meta", meta, seq: 3, ts: 2 }),
			].join("\n") + "\n",
		);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: projectId, path: cwd, name: "落点项目", pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4588, token: null },
			uiLocale: "zh-CN",
			appearance: { theme: "dark" },
		}),
	);
}

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

async function panelPageUrl(kind?: string): Promise<string | null> {
	const list = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())) as Array<{
		type: string;
		webSocketDebuggerUrl?: string;
	}>;
	for (const item of list) {
		if (item.type !== "page" || !item.webSocketDebuggerUrl) continue;
		const hit = await evaluateRenderer<boolean>(
			item.webSocketDebuggerUrl,
			kind
				? `document.querySelector("[data-ly-panel-window]")?.getAttribute("data-ly-panel-window")===${JSON.stringify(kind)}`
				: `document.documentElement.dataset.lyWindowKind==="panel"||Boolean(document.querySelector("[data-ly-panel-window]"))`,
		).catch(() => false);
		if (hit) return item.webSocketDebuggerUrl;
	}
	return null;
}

try {
	app = await startApp({ port: PORT, seed });
	const page = app;
	stopRecording = await startRecording(PORT, frames);
	await page.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 30_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await page.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function hold(ms = 900) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await page.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 80 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(180, Math.max(0, end - Date.now())));
		}
	}
	async function center(selector: string): Promise<{ x: number; y: number }> {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		return page.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	}
	async function click(selector: string) {
		const at = await center(selector);
		await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at, buttons: 0 });
		await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, buttons: 1, ...at });
		await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, buttons: 0, ...at });
	}
	async function pointOn(selector: string, where: "center" | "left" | "right" | "top" | "bottom"): Promise<{ x: number; y: number }> {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		return page.evaluate<{ x: number; y: number }>(`(()=>{
			const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
			const inset=28;
			if(${JSON.stringify(where)}==='left') return {x:r.x+inset,y:r.y+r.height/2};
			if(${JSON.stringify(where)}==='right') return {x:r.x+r.width-inset,y:r.y+r.height/2};
			if(${JSON.stringify(where)}==='top') return {x:r.x+r.width/2,y:r.y+inset};
			if(${JSON.stringify(where)}==='bottom') return {x:r.x+r.width/2,y:r.y+r.height-inset};
			return {x:r.x+r.width/2,y:r.y+r.height/2};
		})()`);
	}
	async function slide(from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, button: "left", buttons: 1 });
			await pause(20);
		}
	}
	async function dragTo(from: string, to: { x: number; y: number }) {
		const a = await center(from);
		await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...a, buttons: 0 });
		await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, buttons: 1, ...a });
		await slide(a, to);
		return to;
	}
	async function drop(at: { x: number; y: number }) {
		await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, buttons: 0, ...at });
	}
	async function tileState() {
		return page.evaluate<{
			count: number;
			browserInPane: number;
			windowBrowser: number;
			termInPane: number;
			convW: number;
			convH: number;
			chromeOver: boolean;
			grip: boolean;
		}>(`(()=>{
			const screen=document.querySelector('[data-ly-split-pane="${IDS[0]}"]');
			const slot=screen?.querySelector('[data-ly-pane-slot="conversation"]');
			const sr=slot?.getBoundingClientRect();
			const browser=screen?.querySelector('[data-dock-pane="browser"]');
			const br=browser?.checkVisibility()?browser.getBoundingClientRect():null;
			const chrome=screen?.querySelector('[data-ly-split-chrome]');
			const cr=chrome?.getBoundingClientRect();
			return {
				count:Number(document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')||0),
				browserInPane:[...document.querySelectorAll('[data-ly-split-pane="${IDS[0]}"] [data-dock-pane="browser"]')].filter((el)=>el.checkVisibility()).length,
				windowBrowser:[...document.querySelectorAll('[data-dock-pane="browser"]')].filter((el)=>el.checkVisibility()&&!el.closest('[data-ly-split-pane]')).length,
				termInPane:[...document.querySelectorAll('[data-ly-split-pane="${IDS[0]}"] [data-dock-pane="terminal"]')].filter((el)=>el.checkVisibility()).length,
				convW:sr?Math.round(sr.width):0,
				convH:sr?Math.round(sr.height):0,
				chromeOver:Boolean(cr&&br&&cr.left<br.right-8&&cr.right>br.left+8&&cr.top<br.bottom-8&&cr.bottom>br.top+8),
				grip:Boolean(screen?.querySelector('[data-dock-grip="browser"]')),
			};
		})()`);
	}

	await until(`document.querySelectorAll('[data-ly-row]').length>0`);
	if (await page.evaluate(`Boolean(document.querySelector('[data-ly-tab="chats"]'))`)) {
		await click('[data-ly-tab="chats"]');
		await hold(500);
	}
	await click(`[data-ly-row="${IDS[0]}"] > button`);
	await until(`document.querySelector('[data-ly-split-pane="${IDS[0]}"]')`);
	await hold(600);

	const first = await dragTo(`[data-ly-row="${IDS[1]}"] > button`, await pointOn("[data-ly-split-root]", "right"));
	await hold(300);
	await drop(first);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='2'`);
	const third = await dragTo(`[data-ly-row="${IDS[2]}"] > button`, await pointOn(`[data-ly-split-pane="${IDS[0]}"]`, "bottom"));
	await hold(300);
	await drop(third);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='3'`);
	const fourth = await dragTo(`[data-ly-row="${IDS[3]}"] > button`, await pointOn(`[data-ly-split-pane="${IDS[1]}"]`, "bottom"));
	await hold(300);
	await drop(fourth);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='4'`);
	await hold(800);
	check("2×2 is on screen", (await tileState()).count === 4, await tileState());

	await click(`[data-ly-split-pane="${IDS[0]}"] button[aria-label^="浏览器"]`);
	await until(`Boolean(document.querySelector('[data-ly-split-pane="${IDS[0]}"] [data-dock-pane="browser"]')?.checkVisibility())`);
	await hold(900);
	const opened = await tileState();
	check(
		"the first panel stays in that tile and leaves the conversation readable",
		opened.browserInPane === 1 && opened.windowBrowser === 0 && opened.convW >= 200 && opened.convH >= 240 && opened.grip && !opened.chromeOver,
		opened,
	);

	await click(`[data-ly-split-pane="${IDS[0]}"] button[aria-label^="终端"]`);
	let popped: string | null = null;
	for (let i = 0; i < 40; i++) {
		await pause(150);
		popped = await panelPageUrl("terminal");
		if (popped) break;
	}
	const afterSecond = await tileState();
	check(
		"a second panel opens as a window instead of crushing the chat",
		afterSecond.browserInPane === 1 && afterSecond.termInPane === 0 && afterSecond.convH >= 240 && afterSecond.convW >= 200 && Boolean(popped),
		{ ...afterSecond, popped: Boolean(popped) },
	);

	await click(`[data-ly-split-pane="${IDS[0]}"] [data-ly-pop-out="browser"]`);
	let browserWindow: string | null = null;
	for (let i = 0; i < 40; i++) {
		await pause(150);
		browserWindow = await panelPageUrl("browser");
		if (browserWindow) break;
	}
	const afterPop = await tileState();
	check(
		"the header can send the in-tile browser to a real window",
		afterPop.browserInPane === 0 && afterPop.convH === 0 && Boolean(browserWindow),
		{ ...afterPop, browserWindow: Boolean(browserWindow) },
	);

	if (browserWindow) {
		await evaluateRenderer(browserWindow, `document.querySelector("[data-ly-restore-panel]")?.click()`);
		await until(`Boolean(document.querySelector('[data-ly-split-pane="${IDS[0]}"] [data-dock-pane="browser"]')?.checkVisibility())`);
		await hold(900);
		const restored = await tileState();
		check(
			"restore puts the browser back in the same tile",
			restored.browserInPane === 1 && restored.windowBrowser === 0 && restored.convW >= 200 && restored.convH >= 240 && !restored.chromeOver,
			restored,
		);
	}
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_分屏落点_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
