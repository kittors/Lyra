/**
 * Interaction found wrong on the Windows test machine (2026-11-04), held in a running window.
 *
 * Each test states what was measured there before the fix. They run on every platform except the
 * Ctrl+W one, which is a Windows and Linux key; the cursor check forces the Windows attribute on a
 * Mac to read the Windows rule, and reads the Mac's own to show it did not change.
 *
 * One window for the whole file: each test puts back what it opened.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const MAC = process.platform === "darwin";
let app: RunningApp;

before(async () => {
	app = await startApp({ port: 9663, inspectPort: 9664, seed: seedInteractions });
	await until(`document.querySelector('[data-ly-row="qa-short"] > button')`);
	await app.evaluate(`document.querySelector('[data-ly-row="qa-short"] > button').click()`);
	await until(`document.querySelector('[data-dock-pane="conversation"] textarea')`);
});
after(async () => {
	await app?.stop();
});

async function until(expression: string, ms = 10_000): Promise<void> {
	await app.evaluate(`new Promise((resolve, reject) => { const end = performance.now() + ${ms}; (function tick() { if (${expression}) resolve(true); else if (performance.now() > end) reject(Error(${JSON.stringify(`timed out: ${expression}`)})); else requestAnimationFrame(tick); })(); })`);
}

/** Modifier bits as CDP counts them. */
const ALT = 1, CTRL = 2, META = 4;

async function press(key: string, code: string, keyCode: number, modifiers: number): Promise<void> {
	await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
}

async function clickAt(selector: string): Promise<void> {
	const at = await app.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
}

const PANES = `[...document.querySelectorAll('[data-dock-pane]')].filter((e) => !e.hasAttribute('data-dock-retained')).map((e) => e.getAttribute('data-dock-pane'))`;
const isOpen = (kind: string) => `!!document.querySelector('[data-dock-pane="${kind}"]:not([data-dock-retained])')`;

/**
 * Put a panel in the wanted state with its shortcut, only if it is not already there.
 *
 * Every test leaves the window as it found it in a `finally`, because a failed assertion that
 * skipped its own clean-up used to hand the next test an open panel — and that test's toggle then
 * closed it and failed for a reason that was not its own.
 */
async function setPanel(kind: string, open: boolean, toggle: () => Promise<void>): Promise<void> {
	if ((await app.evaluate<boolean>(isOpen(kind))) === open) return;
	await toggle();
	await until(open ? isOpen(kind) : `!${isOpen(kind)}`, 20_000);
}
const sideChatKey = () => press("s", "KeyS", 83, ALT | (MAC ? META : CTRL));
const tasksKey = () => press("j", "KeyJ", 74, MAC ? META : CTRL);
const terminalKey = () => press("`", "Backquote", 192, CTRL);

test("opening the side chat with its shortcut leaves the keyboard in its field", async () => {
	// Measured: focus stayed on the conversation's scroller, and typing went nowhere.
	try {
		await clickAt('[data-dock-pane="conversation"] .ly-scroll-view');
		await sideChatKey();
		await until(isOpen("chat"));
		await until(`document.activeElement === document.querySelector('[data-dock-pane="chat"] textarea')`, 3000);
		await app.send("Input.insertText", { text: "旁问" });
		assert.equal(await app.evaluate(`document.querySelector('[data-dock-pane="chat"] textarea').value`), "旁问");
	} finally {
		await app.evaluate(`(() => { const t = document.querySelector('[data-dock-pane="chat"] textarea'); if (!t) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
		await setPanel("chat", false, sideChatKey);
	}
});

test("a side chat that was already in the layout does not take the keyboard", async () => {
	// Only an `open` moves focus: re-drawing a dock that contains it must not.
	try {
		await setPanel("chat", true, sideChatKey);
		await clickAt('[data-dock-pane="conversation"] textarea');
		await app.evaluate(`new Promise((resolve) => setTimeout(resolve, 600))`);
		assert.equal(await app.evaluate(`document.activeElement === document.querySelector('[data-dock-pane="conversation"] textarea')`), true);
	} finally {
		await setPanel("chat", false, sideChatKey);
	}
});

test("resize handles show the system's cursors on Windows and keep macOS's", async () => {
	// Measured with GetCursorInfo: col-resize was Chromium's own faint bitmap; ew-resize was IDC_SIZEWE.
	try {
		await setPanel("tasks", true, tasksKey);
		await until(`document.querySelector('.ly-splitter')`);
		const read = `(() => { const s = document.querySelector('.ly-splitter'); const vertical = s.getBoundingClientRect().height > s.getBoundingClientRect().width; return { vertical, cursor: getComputedStyle(s).cursor }; })()`;
		const own = await app.evaluate<{ vertical: boolean; cursor: string }>(read);
		const platform = await app.evaluate<string>(`document.documentElement.dataset.lyPlatform`);
		const forced = await app.evaluate<{ vertical: boolean; cursor: string }>(`(() => { const html = document.documentElement; const was = html.dataset.lyPlatform; html.dataset.lyPlatform = 'win32'; try { return ${read}; } finally { html.dataset.lyPlatform = was; } })()`);
		assert.equal(forced.cursor, forced.vertical ? "ew-resize" : "ns-resize", "the Windows rule");
		if (platform === "win32") assert.equal(own.cursor, forced.cursor);
		else assert.equal(own.cursor, own.vertical ? "col-resize" : "row-resize", "other platforms keep the column and row cursors");
	} finally {
		await setPanel("tasks", false, tasksKey);
	}
});

test("the terminal's scrollbar is the app's 6px rounded mark", async () => {
	// Measured: xterm's own 14px square slider in its default grey, beside 6px rounded bars elsewhere.
	try {
		await setPanel("terminal", true, terminalKey);
		await until(`document.querySelector('[data-dock-pane="terminal"] .xterm-scrollable-element > .scrollbar.vertical > .slider')`, 20_000);
		const slider = await app.evaluate<{ width: string; radius: string; right: string }>(`(() => { const s = getComputedStyle(document.querySelector('[data-dock-pane="terminal"] .xterm-scrollable-element > .scrollbar.vertical > .slider')); return { width: s.width, radius: s.borderTopLeftRadius, right: s.right }; })()`);
		assert.equal(slider.width, "6px");
		assert.equal(slider.right, "2px");
		assert.ok(parseFloat(slider.radius) >= 3, `rounded, not square: ${slider.radius}`);
	} finally {
		await setPanel("terminal", false, terminalKey);
	}
});

test("a panel popped out stays in the main window until its own window is shown", async () => {
	// Measured on the Windows test machine: closed at the click, its window shown 2.8s later — nowhere in between.
	try {
		await setPanel("terminal", true, terminalKey);
		await until(`document.querySelector('[data-ly-pop-out="terminal"]')`, 20_000);
		// 'ready-to-show' is where main calls show(); its 'show' event can be dispatched a few ms after the window is already visible.
		await app.main(`(() => { globalThis.__shown = null; const B = process._linkedBinding('electron_browser_window').BrowserWindow; const seen = new Set(B.getAllWindows().map((w) => w.id)); const poll = setInterval(() => { for (const w of B.getAllWindows()) if (!seen.has(w.id)) { seen.add(w.id); if (w.isVisible()) globalThis.__shown ??= Date.now(); else w.once('ready-to-show', () => { globalThis.__shown ??= Date.now(); }); } }, 2); setTimeout(() => clearInterval(poll), 15000); return true; })()`);
		await app.evaluate(`(() => { window.__left = null; window.__note = null; const watch = () => { if (!window.__note && document.querySelector('[data-ly-pane-leaving]')) window.__note = Date.now(); if (!window.__left && !document.querySelector('[data-dock-pane="terminal"]:not([inert])')) window.__left = Date.now(); }; window.__watch = new MutationObserver(watch); window.__watch.observe(document.body, { subtree: true, childList: true, attributes: true }); return true; })()`);
		await clickAt('[data-ly-pop-out="terminal"]');
		await until(`window.__left !== null`, 20_000);
		const left = await app.evaluate<number>(`(window.__watch.disconnect(), window.__left)`);
		const note = await app.evaluate<number | null>(`window.__note`);
		const shown = await app.main<number | null>(`globalThis.__shown`);
		assert.ok(shown, "the panel's window was shown");
		assert.ok(note !== null, "the panel said it was moving while it waited");
		assert.ok(left >= shown, `the panel left ${shown - left}ms before its window was shown`);
	} finally {
		await app.main(`(async () => { for (const w of process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows()) { const b = await w.webContents.executeJavaScript('window.lyra?.bootWindow'); if (b?.kind === 'panel') w.close(); } return true; })()`);
		await app.evaluate(`new Promise((resolve) => setTimeout(resolve, 600))`);
	}
});

test("after one pop-out, the next takes a window that was built while nobody waited for it", async () => {
	// Measured on the Windows test machine: every pop-out window painted 3.0s after the click and drew its terminal at 5.2s.
	const spares = async () => (await app.windows()).filter((w) => w.boot.kind === "panel" && !w.boot.panelKind).map((w) => w.boot.id);
	const waitForSpare = async (other?: string) => {
		const end = Date.now() + 20_000;
		while (Date.now() < end) {
			const found = (await spares()).find((id) => id !== other);
			if (found) return found;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error("no spare panel window was built");
	};
	try {
		await setPanel("terminal", true, terminalKey);
		await until(`document.querySelector('[data-ly-pop-out="terminal"]')`, 20_000);
		await clickAt('[data-ly-pop-out="terminal"]');
		const spare = await waitForSpare();

		await setPanel("tasks", true, tasksKey);
		await until(`document.querySelector('[data-ly-pop-out="tasks"]')`, 20_000);
		await app.main(`(() => { globalThis.__shown = null; for (const w of process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows()) if (!w.isVisible()) w.once('show', () => { globalThis.__shown ??= Date.now(); }); globalThis.__clicked = Date.now(); return true; })()`);
		await clickAt('[data-ly-pop-out="tasks"]');
		let holder: Awaited<ReturnType<typeof app.windows>>[number] | undefined;
		for (const end = Date.now() + 10_000; !holder && Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 100))) {
			holder = (await app.windows()).find((w) => w.boot.panelKind === "tasks");
		}
		assert.ok(holder, "the tasks panel has a window");
		assert.equal(holder.boot.id, spare, "and it is the window that was waiting");
		const timing = await app.main<{ shown: number | null; clicked: number }>(`({ shown: globalThis.__shown, clicked: globalThis.__clicked })`);
		assert.ok(timing.shown, "the window was shown");
		assert.ok(timing.shown - timing.clicked < 1000, `shown ${timing.shown - timing.clicked}ms after the click`);
		const drawn = await holder.evaluate<boolean>(`new Promise((resolve) => { const end = performance.now() + 5000; (function tick() { if (document.querySelector('[data-ly-panel-window="tasks"] [data-ly-panel-window-title]')?.textContent.trim()) resolve(true); else if (performance.now() > end) resolve(false); else requestAnimationFrame(tick); })(); })`);
		assert.ok(drawn, "it draws the tasks panel it was given");
		assert.notEqual(await waitForSpare(spare), spare, "and another is built for the pop-out after");
	} finally {
		await app.main(`(async () => { for (const w of process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows()) { const b = await w.webContents.executeJavaScript('window.lyra?.bootWindow'); if (b?.kind === 'panel') w.close(); } return true; })()`);
		await app.evaluate(`new Promise((resolve) => setTimeout(resolve, 600))`);
	}
});

test("the chip carried to the right edge stays inside the window", async () => {
	// Measured: at the right edge the chip sat at x 1357.6 in a 1364px window, wholly off screen.
	const row = await app.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('[data-ly-row="qa-long"]').getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 }; })()`);
	const width = await app.evaluate<number>(`innerWidth`);
	const mouse = (type: string, x: number, y: number) => app.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
	await mouse("mouseMoved", row.x, row.y);
	await mouse("mousePressed", row.x, row.y);
	let chip: { left: number; right: number };
	try {
		for (let i = 1; i <= 12; i++) await mouse("mouseMoved", row.x + ((width - 10 - row.x) * i) / 12, row.y + i * 4);
		await until(`document.querySelector('[data-ly-split-ghost]')`);
		chip = await app.evaluate<{ left: number; right: number }>(`(() => { const r = document.querySelector('[data-ly-split-ghost]').getBoundingClientRect(); return { left: r.left, right: r.right }; })()`);
	} finally {
		// Back over the sidebar before letting go, so nothing is split.
		await mouse("mouseMoved", row.x, row.y);
		await mouse("mouseReleased", row.x, row.y);
	}
	assert.ok(chip.left >= 0 && chip.right <= width, `the chip spans ${Math.round(chip.left)}–${Math.round(chip.right)} in a ${width}px window`);
});

test("Ctrl+W closes the pane in front, then nothing — never the window", { skip: MAC ? "⌘W is macOS's own and unchanged" : false }, async () => {
	/*
	 * Measured: Ctrl+W in the composer put the whole window into the tray, which Windows 11 hides.
	 *
	 * This holds the renderer's half — the pane closes, then nothing does. A key sent through CDP
	 * never reaches Electron's menu accelerators, so the menu's half (no `close` role; its Ctrl+W
	 * only closes the small windows) is held by `test/app-menu.test.ts`, and was seen on the
	 * Windows machine with a real keyboard.
	 */
	const visible = () => app.main<boolean>(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().some((w) => w.isVisible() && !w.webContents.getURL().includes('screenshot'))`);
	await setPanel("tasks", true, tasksKey);
	await clickAt('[data-dock-pane="conversation"] textarea');
	await press("w", "KeyW", 87, CTRL);
	await app.evaluate(`new Promise((resolve) => setTimeout(resolve, 600))`);
	assert.equal(await visible(), true, "the window is still there after Ctrl+W");
	await until(`!${isOpen("tasks")}`);
	assert.deepEqual(await app.evaluate(PANES), ["conversation"]);
	// One screen with nothing beside its conversation: the key does nothing at all.
	await press("w", "KeyW", 87, CTRL);
	await app.evaluate(`new Promise((resolve) => setTimeout(resolve, 600))`);
	assert.equal(await visible(), true, "the window stayed with nothing left to close");
	assert.deepEqual(await app.evaluate(PANES), ["conversation"]);
});
