/**
 * Keyboard habits a Windows user brings, held in a running window (found 2026-11-04).
 *
 * Menus answered only Escape; Ctrl+N, Ctrl+, and Ctrl+Tab did nothing; Alt+click on a sidebar row
 * was an ordinary click. On a Mac the same keys are ⌘N, ⌘, and ⌃Tab, and ⌥+click — the file runs
 * on both. One window for the whole file: each test puts back what it changed.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const MAC = process.platform === "darwin";
const ALT = 1, CTRL = 2, META = 4, SHIFT = 8;
const PRIMARY = MAC ? META : CTRL;
let app: RunningApp;

/** The interaction fixture, with nine models: the model menu grows its search field from eight. */
async function seed(home: string): Promise<void> {
	await seedInteractions(home);
	const file = join(home, "settings.json");
	const settings = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
	settings.providers = [{
		id: "qa", name: "隔离测试模型", api: "anthropic-messages", baseUrl: "http://127.0.0.1:9", apiKey: "test", enabled: true,
		models: Array.from({ length: 9 }, (_, i) => ({ id: `qa/m${i}`, providerId: "qa", modelId: `m${i}`, name: `测试模型 ${i + 1}`, contextWindow: 128000, maxOutputTokens: 4096, supportsImages: false, supportsTools: true, supportsThinking: false })),
	}];
	settings.defaultModelId = "qa/m0";
	await writeFile(file, JSON.stringify(settings));
}

before(async () => {
	app = await startApp({ port: 9665, seed });
	await until(`document.querySelector('[data-ly-row="qa-short"] > button')`);
	await clickAt('[data-ly-row="qa-short"] > button');
	await until(`document.querySelector('[data-ly-split-pane="qa-short"] [data-dock-pane="conversation"] textarea')`);
});
after(async () => {
	await app?.stop();
});

async function until(expression: string, ms = 10_000): Promise<void> {
	await app.evaluate(`new Promise((resolve, reject) => { const end = performance.now() + ${ms}; (function tick() { if (${expression}) resolve(true); else if (performance.now() > end) reject(Error(${JSON.stringify(`timed out: ${expression}`)})); else requestAnimationFrame(tick); })(); })`);
}

async function press(key: string, code: string, keyCode: number, modifiers = 0): Promise<void> {
	// Enter has to carry its character, or no keypress follows and a focused button is never activated.
	const down = key === "Enter" ? { type: "keyDown", text: "\r" } : { type: "rawKeyDown" };
	await app.send("Input.dispatchKeyEvent", { ...down, key, code, windowsVirtualKeyCode: keyCode, modifiers });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
}
const arrow = (key: "ArrowDown" | "ArrowUp" | "ArrowRight" | "ArrowLeft") => press(key, key, { ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, ArrowLeft: 37 }[key]);

async function clickAt(selector: string, modifiers = 0, button: "left" | "right" = "left"): Promise<void> {
	const at = await app.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button, clickCount: 1, modifiers });
}

const SCREENS = `[...document.querySelectorAll('[data-ly-split-pane]')].map((p) => p.getAttribute('data-ly-split-pane'))`;
const focusedText = `(document.activeElement?.textContent || '').trim()`;

async function backToOneScreen(): Promise<void> {
	for (const id of await app.evaluate<string[]>(SCREENS)) {
		if (id === "qa-short") continue;
		const close = `[data-ly-split-chrome="${id}"] button[aria-label="关闭此屏"]`;
		if (await app.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(close)})`)) await clickAt(close);
	}
	await until(`${SCREENS}.length === 1`);
}

test("a mouse-opened menu is walked with the arrows; → opens 打开方式 and Enter picks 分屏", async () => {
	try {
		// Another conversation's menu: the one already on screen has nowhere else to split into.
		await clickAt('[data-ly-row="qa-long"] > button', 0, "right");
		await until(`document.querySelector('[role=menu] [role=menuitem]')`);
		await arrow("ArrowDown");
		assert.equal(await app.evaluate(`document.activeElement?.getAttribute('role')`), "menuitem", "↓ moved into the menu");
		for (let i = 0; i < 12 && (await app.evaluate<string>(focusedText)) !== "打开方式"; i++) await arrow("ArrowDown");
		assert.equal(await app.evaluate(focusedText), "打开方式");
		await arrow("ArrowRight");
		await until(`(document.activeElement?.textContent || '').trim() === '分屏'`, 3000);
		await press("Enter", "Enter", 13);
		await until(`${SCREENS}.length === 2`);
	} finally {
		await press("Escape", "Escape", 27);
		await backToOneScreen();
	}
});

test("in the model menu the caret stays in its search field while the arrows move a highlight", async () => {
	try {
		await clickAt('[data-ly-split-pane="qa-short"] button[aria-label="选择模型"]');
		await until(`document.querySelector('.ly-menu-search input') === document.activeElement`);
		await arrow("ArrowDown");
		const lit = await app.evaluate<{ field: boolean; lit: number }>(`({ field: document.activeElement === document.querySelector('.ly-menu-search input'), lit: document.querySelectorAll('[data-ly-active="true"]').length })`);
		assert.deepEqual(lit, { field: true, lit: 1 });
	} finally {
		await press("Escape", "Escape", 27);
		await until(`!document.querySelector('.ly-menu-search input')`);
	}
});

test(`${MAC ? "⌘," : "Ctrl+,"} opens the settings and ${MAC ? "⌘N" : "Ctrl+N"} a new conversation, from anywhere`, async () => {
	try {
		await clickAt('[data-ly-split-pane="qa-short"] [data-dock-pane="conversation"] textarea');
		await press(",", "Comma", 188, PRIMARY);
		await until(`document.querySelector('[data-ly-open-settings]')?.getAttribute('data-ly-open-settings') === '' || document.querySelector('[data-ly-settings-shell], [data-ly-settings]')`);
		// From the settings page itself: a new conversation, and back to the chat to show it.
		await press("n", "KeyN", 78, PRIMARY);
		await until(`${SCREENS}.includes('@draft')`);
	} finally {
		await clickAt('[data-ly-row="qa-short"] > button');
		await until(`${SCREENS}.join() === 'qa-short'`);
	}
});

test("Ctrl+Tab and Ctrl+Shift+Tab walk to the next and back", async () => {
	try {
		await clickAt('[data-ly-split-pane="qa-short"] [data-dock-pane="conversation"] textarea');
		await press("Tab", "Tab", 9, CTRL);
		await until(`${SCREENS}.join() === 'qa-long'`);
		await press("Tab", "Tab", 9, CTRL | SHIFT);
		await until(`${SCREENS}.join() === 'qa-short'`);
	} finally {
		await backToOneScreen();
	}
});

test(`${MAC ? "⌥" : "Alt"}+click on a sidebar row opens it beside the screen in use`, async () => {
	try {
		await clickAt('[data-ly-row="qa-long"] > button', ALT);
		await until(`${SCREENS}.length === 2`);
		assert.deepEqual((await app.evaluate<string[]>(SCREENS)).sort(), ["qa-long", "qa-short"]);
	} finally {
		await backToOneScreen();
	}
});
