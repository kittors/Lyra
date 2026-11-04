/**
 * A window snapped to half or a quarter of the screen, held in a running window.
 *
 * On the Windows test machine (1920×1080 at 125%) a half-screen snap is 768×816. The sidebar pushed
 * beside the content and left about 470px, four panels were stacked into 150px strips, and the side
 * chat's field and send button were below its bottom edge. Now the sidebar floats, no panel is
 * pressed under its floor — the dock turns to tabs when it would be — and no composer loses its send
 * button. A wide window gets the sidebar and the arrangement back as they were; so does the default
 * 980px one, which first came out with its sidebar shut away.
 *
 * Sizes are the page's, by device-metrics emulation rather than by resizing the window: the CI
 * runners' screens are 1024×768, and a window cannot be made larger than the screen there.
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

/** The page's size, and the layout settled on it: twenty painted frames after the last resize. */
async function viewport(width: number, height: number): Promise<void> {
	await app.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 0, mobile: false });
	await until(`innerWidth === ${width} && innerHeight === ${height}`);
	await app.evaluate(`new Promise((resolve) => { let n = 20; const tick = () => (--n ? requestAnimationFrame(tick) : resolve(true)); requestAnimationFrame(tick); })`);
}

const SHAPE = `(() => {
	// Drawn panes are not inert. (data-dock-retained is sticky by design — once hidden, always marked — so it says nothing here.)
	const visible = [...document.querySelectorAll('[data-dock-pane]')].filter((e) => !e.hasAttribute('inert') && e.checkVisibility({ opacityProperty: true }) && e.getBoundingClientRect().width > 0);
	const floor = { conversation: 260, chat: 220 };
	// The send button is the composer shell's last button; both composers share .ly-composer, so go up from the field.
	const sendIn = (pane) => {
		const shell = pane?.querySelector('textarea')?.closest('.ly-composer');
		const send = shell ? [...shell.querySelectorAll('button')].pop() : null;
		if (!send) return null;
		const r = send.getBoundingClientRect();
		// What is drawn at the button's centre: a neighbour pane over it, or the cell's clip, answers something else.
		const x = r.x + r.width / 2, y = r.y + r.height / 2;
		return { inside: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight && send.contains(document.elementFromPoint(x, y)), x: Math.round(x), y: Math.round(y) };
	};
	return {
		overlay: !!document.querySelector('[data-ly-nav-overlay]'),
		contentX: Math.round(document.querySelector('[data-ly-split-viewport]').getBoundingClientRect().x),
		visible: visible.map((e) => e.getAttribute('data-dock-pane')),
		pressed: visible.filter((e) => e.getBoundingClientRect().height < (floor[e.getAttribute('data-dock-pane')] ?? 150) - 1).map((e) => e.getAttribute('data-dock-pane') + ':' + Math.round(e.getBoundingClientRect().height)),
		tabs: document.querySelectorAll('[data-panel-tab]').length > 0,
		conversationSend: sendIn(document.querySelector('[data-dock-pane="conversation"]')),
		chatSend: sendIn(visible.find((e) => e.getAttribute('data-dock-pane') === 'chat')),
	};
})()`;

type Send = { inside: boolean } | null;
type Shape = { overlay: boolean; contentX: number; visible: string[]; pressed: string[]; tabs: boolean; conversationSend: Send; chatSend: Send };

/** Every composer on screen still has its send button drawn; one in a background tab is not on screen. */
function sendable(shape: Shape, label: string): void {
	assert.ok(shape.conversationSend?.inside, `${label}: the conversation's send button is on screen: ${JSON.stringify(shape)}`);
	if (shape.visible.includes("chat")) assert.ok(shape.chatSend?.inside, `${label}: the side chat's send button is on screen: ${JSON.stringify(shape)}`);
}

test("half and quarter screen: the sidebar floats, no panel is pressed under its floor, every send button stays on screen", async (t) => {
	const ctrl = 2, alt = 1, meta = 4;
	const mod = MAC ? meta : ctrl;
	await viewport(1360, 840);
	// The Windows case: a terminal, Git and the side chat beside the conversation.
	await press("`", "Backquote", 192, ctrl);
	await until(`document.querySelector('[data-dock-pane="terminal"]:not([inert])')`, 20_000);
	await press("r", "KeyR", 82, mod | 8);
	await until(`document.querySelector('[data-dock-pane="review"]:not([inert])')`);
	await press("s", "KeyS", 83, mod | alt);
	await until(`document.querySelector('[data-dock-pane="chat"]:not([inert])')`);
	// Opened, then drawn: each pane fades and slides in, and a measure taken mid-way reads the motion.
	await app.evaluate(`new Promise((resolve) => setTimeout(resolve, 800))`);
	await viewport(1360, 840);
	const wide = await app.evaluate<Shape>(SHAPE);
	assert.equal(wide.overlay, false);
	assert.equal(wide.tabs, false, "a wide window draws the panels as arranged");
	assert.deepEqual([...wide.visible].sort(), ["chat", "conversation", "review", "terminal"], JSON.stringify(wide));

	await viewport(768, 816);
	const half = await app.evaluate<Shape>(SHAPE);
	assert.equal(half.overlay, true, "the sidebar floats instead of pushing");
	assert.ok(half.contentX < 100, `and leaves the content the window: ${half.contentX}`);
	assert.deepEqual(half.pressed, [], "no panel squeezed into a strip under its floor");
	sendable(half, "half");

	await viewport(768, 440);
	const quarter = await app.evaluate<Shape>(SHAPE);
	assert.equal(quarter.overlay, true);
	assert.deepEqual(quarter.pressed, [], "quarter: no panel under its floor");
	sendable(quarter, "quarter");

	t.diagnostic(JSON.stringify({ half, quarter }));

	// The default window: the sidebar pushes, as it always did.
	await viewport(980, 680);
	const standard = await app.evaluate<Shape>(SHAPE);
	assert.equal(standard.overlay, false, "the default 980px window keeps its sidebar beside the content");
	assert.ok(standard.contentX > 200, `pushed: ${standard.contentX}`);

	await viewport(1360, 840);
	const back = await app.evaluate<Shape>(SHAPE);
	assert.deepEqual({ overlay: back.overlay, tabs: back.tabs, visible: [...back.visible].sort() }, { overlay: false, tabs: false, visible: ["chat", "conversation", "review", "terminal"] }, "widening gives the arrangement and the sidebar back");
	assert.ok(back.contentX > 200, "and the sidebar pushes the content again");
});
