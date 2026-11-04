/**
 * A window snapped to half or a quarter of the screen, held in a running window.
 *
 * On the Windows test machine (1920×1080 at 125%) a half-screen snap is 768×816. The sidebar pushed
 * beside the content and left about 470px, four panels were stacked into 150px strips, and the side
 * chat's field and send button were below its bottom edge. Now the sidebar floats, the panels become
 * tabs when they do not fit as arranged, and no composer loses its send button. A wide window gets
 * the sidebar and the arrangement back as they were.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const MAC = process.platform === "darwin";
let app: RunningApp;

before(async () => {
	app = await startApp({ port: 9667, inspectPort: 9668, seed: seedInteractions });
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

async function press(key: string, code: string, keyCode: number, modifiers: number): Promise<void> {
	await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
}

/** The page's own size, by resizing the window's content area from the main process. */
async function contentSize(width: number, height: number): Promise<void> {
	await app.main(`(() => { const w = process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Lyra' && !w.webContents.getURL().includes('screenshot')); w.unmaximize(); w.setContentSize(${width}, ${height}); return true; })()`);
	await until(`Math.abs(innerWidth - ${width}) <= 2 && Math.abs(innerHeight - ${height}) <= 2`);
	await app.evaluate(`new Promise((resolve) => setTimeout(resolve, 500))`);
}

const SHAPE = `(() => {
	// Drawn panes are not inert. (data-dock-retained is sticky by design — once hidden, always marked — so it says nothing here.)
	const visible = [...document.querySelectorAll('[data-dock-pane]')].filter((e) => !e.hasAttribute('inert') && e.getBoundingClientRect().width > 0);
	// The send button is the composer shell's last button; both composers share .ly-composer, so go up from the field.
	const sendIn = (pane) => {
		const p = pane?.getBoundingClientRect();
		const shell = pane?.querySelector('textarea')?.closest('.ly-composer');
		const send = shell ? [...shell.querySelectorAll('button')].pop() : null;
		if (!p || !send) return null;
		const r = send.getBoundingClientRect();
		// What is drawn at the button's centre: a neighbour pane over it, or the cell's clip, answers something else.
		const x = r.x + r.width / 2, y = r.y + r.height / 2;
		const drawn = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight && send.contains(document.elementFromPoint(x, y));
		return { inside: drawn, x: Math.round(x), y: Math.round(y), paneBottom: Math.round(p.bottom) };
	};
	return {
		overlay: !!document.querySelector('[data-ly-nav-overlay]'),
		contentX: Math.round(document.querySelector('[data-ly-split-viewport]').getBoundingClientRect().x),
		visible: visible.map((e) => e.getAttribute('data-dock-pane')),
		tabs: document.querySelectorAll('[data-panel-tab]').length > 0,
		conversationSend: sendIn(document.querySelector('[data-dock-pane="conversation"]')),
		chatSend: sendIn(document.querySelector('[data-dock-pane="chat"]:not([inert])')),
	};
})()`;

type Shape = { overlay: boolean; contentX: number; visible: string[]; tabs: boolean; conversationSend: { inside: boolean } | null; chatSend: { inside: boolean } | null };

test("half and quarter screen: the sidebar floats, crowded panels become tabs, every send button stays on screen", async () => {
	const ctrl = 2, alt = 1, meta = 4;
	const mod = MAC ? meta : ctrl;
	await contentSize(1360, 840);
	// The Windows case: a terminal, Git and the side chat beside the conversation.
	await press("`", "Backquote", 192, ctrl);
	await until(`document.querySelector('[data-dock-pane="terminal"]:not([data-dock-retained])')`, 20_000);
	await press("r", "KeyR", 82, mod | 8);
	await until(`document.querySelector('[data-dock-pane="review"]:not([data-dock-retained])')`);
	await press("s", "KeyS", 83, mod | alt);
	await until(`document.querySelector('[data-dock-pane="chat"]:not([data-dock-retained])')`);
	const wide = await app.evaluate<Shape>(SHAPE);
	assert.equal(wide.overlay, false);
	assert.equal(wide.tabs, false, "a wide window draws the panels as arranged");
	assert.deepEqual([...wide.visible].sort(), ["chat", "conversation", "review", "terminal"]);

	await contentSize(768, 784);
	const half = await app.evaluate<Shape>(SHAPE);
	assert.equal(half.overlay, true, "the sidebar floats instead of pushing");
	assert.equal(half.tabs, true, "four panes that only fit as strips are drawn as tabs");
	assert.equal(half.visible.length, 2, `the conversation and the current panel: ${half.visible}`);
	assert.ok(half.conversationSend?.inside, `the conversation's send button is on screen: ${JSON.stringify(half.conversationSend)}`);
	assert.ok(half.chatSend?.inside, `the side chat's send button is on screen: ${JSON.stringify(half.chatSend)}`);

	await contentSize(768, 440);
	const quarter = await app.evaluate<Shape>(SHAPE);
	assert.equal(quarter.overlay, true);
	assert.ok(quarter.conversationSend?.inside, `quarter: the conversation's send button: ${JSON.stringify(quarter.conversationSend)}`);
	assert.ok(quarter.chatSend?.inside, `quarter: the side chat's send button: ${JSON.stringify(quarter.chatSend)}`);

	await contentSize(1360, 840);
	const back = await app.evaluate<Shape>(SHAPE);
	assert.deepEqual({ overlay: back.overlay, tabs: back.tabs, visible: [...back.visible].sort() }, { overlay: false, tabs: false, visible: ["chat", "conversation", "review", "terminal"] }, "widening gives the arrangement and the sidebar back");
	assert.ok(back.contentX > 200, "and the sidebar pushes the content again");
});
