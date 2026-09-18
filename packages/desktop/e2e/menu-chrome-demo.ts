/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 下拉和右键共用一张 16px 卡片、6px 四边留白、10px 同心激活行、36px 行高。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/menu-chrome-demo.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra菜单圆角测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9779;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

type Chrome = {
	left: number;
	right: number;
	top: number;
	bottom: number;
	card: number;
	item: number;
	row: number;
	width: number;
	hint: boolean;
};

const capsule = (chrome: Chrome) =>
	chrome.card >= 14 &&
	chrome.card <= 18 &&
	chrome.item >= 8 &&
	chrome.item <= 12 &&
	chrome.row >= 34 &&
	chrome.row <= 38;

const sides = (chrome: Chrome) =>
	Math.abs(chrome.left - chrome.right) <= 1 && chrome.left >= 5 && chrome.left <= 8;

const even = (chrome: Chrome) =>
	capsule(chrome) && sides(chrome) && Math.abs(chrome.top - chrome.left) <= 1;

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "README.md"), "# proj\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "off",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4579, token: null },
		}),
	);
}

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

try {
	app = await startApp({ port: PORT, seed });
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 20_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await app!.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function click(selector: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		await app!.evaluate(
			`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`,
		);
		const at = await app!.evaluate<[number, number]>(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`,
		);
		for (const type of ["mousePressed", "mouseReleased"]) {
			await app!.send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
		}
	}
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}
	async function measure(): Promise<Chrome> {
		return app!.evaluate<Chrome>(`(() => {
			const pop = document.querySelector("[data-ly-popover]");
			const item = pop?.querySelector(".ly-item");
			if (!pop || !item) return { left: 0, right: 0, top: 0, bottom: 0, card: 0, item: 0, row: 0, width: 0, hint: false };
			const p = pop.getBoundingClientRect();
			const r = item.getBoundingClientRect();
			return {
				left: Math.round(r.left - p.left),
				right: Math.round(p.right - r.right),
				top: Math.round(r.top - p.top),
				bottom: Math.round(p.bottom - r.bottom),
				card: Math.round(parseFloat(getComputedStyle(pop).borderRadius)),
				item: Math.round(parseFloat(getComputedStyle(item).borderRadius)),
				row: Math.round(r.height),
				width: Math.round(p.width),
				hint: Boolean([...item.querySelectorAll("span")].some((el) => /[⌘⌃⌥⇧]/.test(el.textContent || ""))),
			};
		})()`);
	}

	const project = await app.evaluate<[number, number]>(`(() => {
		const row = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("proj"));
		if (!row) return [0, 0];
		const box = row.getBoundingClientRect();
		row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: box.left + 40, clientY: box.top + 10 }));
		return [box.left + 40, box.top + 10];
	})()`);
	await until(`Boolean(document.querySelector("[data-ly-popover] .ly-item"))`);
	const first = await app.evaluate<[number, number]>(`(() => {
		const item = document.querySelector("[data-ly-popover] .ly-item");
		const box = item.getBoundingClientRect();
		return [box.x + box.width / 2, box.y + box.height / 2];
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: first[0], y: first[1] });
	await pause(200);
	const projectMenu = await measure();
	check("project menu is a 16px card with concentric rows", even(projectMenu) && projectMenu.width >= 180 && projectMenu.width <= 230, {
		...projectMenu,
		click: project,
	});
	await hold(1400);

	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
	await pause(300);

	if (
		!(await app.evaluate(
			`Boolean([...document.querySelectorAll("nav button")].find((b) => /返回工作区/.test(b.textContent || "")))`,
		))
	) {
		await click(".ly-sidebar-foot button");
		await until(`Boolean(document.querySelector("nav button"))`);
		await pause(400);
	}
	await app.evaluate(`(() => {
		const nav = [...document.querySelectorAll("nav button")].find((b) => (b.textContent || "").trim() === "智能体");
		if (nav) nav.click();
	})()`);
	await until(`Boolean([...document.querySelectorAll("h1")].find((h) => (h.textContent || "").includes("智能体")))`);
	await pause(500);
	await app.evaluate(`(() => {
		const more = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").includes("更多操作"));
		more?.click();
	})()`);
	await until(`Boolean(document.querySelector("[data-ly-popover] .ly-item"))`);
	const agentItem = await app.evaluate<[number, number]>(`(() => {
		const item = document.querySelector("[data-ly-popover] .ly-item");
		const box = item.getBoundingClientRect();
		return [box.x + box.width / 2, box.y + box.height / 2];
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: agentItem[0], y: agentItem[1] });
	await pause(200);
	const agentMenu = await measure();
	check("agent overflow menu uses the same card geometry", even(agentMenu) && agentMenu.width >= 180 && agentMenu.width <= 230, agentMenu);
	await hold(1600);

	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
	await pause(300);

	await app.evaluate(`(() => {
		const back = [...document.querySelectorAll("nav button")].find((b) => /返回工作区/.test(b.textContent || ""));
		back?.click();
	})()`);
	await until(`Boolean(document.querySelector('[data-dock-pane="conversation"]'))`);
	await pause(400);

	await click('button[aria-label="面板"]');
	await until(`Boolean(document.querySelector("[data-ly-popover] .ly-item"))`);
	const panelItem = await app.evaluate<[number, number]>(`(() => {
		const items = [...document.querySelectorAll("[data-ly-popover] .ly-item")];
		const item = items[items.length - 1] ?? items[0];
		const box = item.getBoundingClientRect();
		return [box.x + box.width / 2, box.y + box.height / 2];
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: panelItem[0], y: panelItem[1] });
	await pause(200);
	const panelMenu = await measure();
	check(
		"panel menu uses the same concentric rows and keeps shortcuts",
		capsule(panelMenu) && sides(panelMenu) && panelMenu.hint && panelMenu.width >= 210 && panelMenu.width <= 260,
		panelMenu,
	);
	await hold(1600);

	await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:"light"}});})()`);
	await until(`document.documentElement.style.colorScheme==="light"`);
	await pause(400);
	const panelLight = await measure();
	check("panel menu keeps the same geometry in light theme", capsule(panelLight) && sides(panelLight) && panelLight.hint, panelLight);
	await hold(1600);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_菜单圆角_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
