/**
 * A popped-out panel's header is its window's title bar: most of it has to move the window, and
 * everything in it you can press has to stay pressable.
 *
 * The terminal broke the first half. Its tab strip is `flex-1` and was `no-drag` as a whole, which
 * is harmless in the dock — on Windows a pane header there is not a drag region — but carried into
 * a panel window it took every empty pixel of the title bar. On the Windows test machine 4 of 82
 * points along it answered `HTCAPTION`; dragging moved nothing and a double-click did not maximise.
 * Git and the conversation window, whose headers are plain text, answered 62 of 82.
 *
 * Measured from the page the way Chromium builds the region: every element whose `app-region` is
 * `drag` or `no-drag`, in document order, each one overriding what came before it where it covers.
 * Sampled along the middle of the header's content box, so the traffic lights on macOS and the
 * system caption buttons on Windows (which sit in the header's padding) are not counted either way.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startApp, type AppWindow, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

/** Every panel kind that can be popped out — all of them but the browser, whose `detach` is `none`. */
const KINDS = ["terminal", "review", "files", "file", "chat", "subagents", "tasks", "trajectory", "delivery"];
const SESSION = "qa-short";

let app: RunningApp;
before(async () => {
	app = await startApp({ port: 9661, inspectPort: 9662, seed: seedInteractions });
});
after(async () => {
	await app?.stop();
});

const MEASURE = `(() => {
	const header = document.querySelector('[data-ly-panel-window-chrome]');
	if (!header) return null;
	const hs = getComputedStyle(header);
	const box = header.getBoundingClientRect();
	const left = box.left + parseFloat(hs.paddingLeft);
	const right = box.right - parseFloat(hs.paddingRight);
	const y = box.top + box.height / 2;
	const regions = [];
	for (const el of document.querySelectorAll('*')) {
		const cs = getComputedStyle(el);
		const value = cs.appRegion || cs.webkitAppRegion;
		if (value !== 'drag' && value !== 'no-drag') continue;
		const r = el.getBoundingClientRect();
		if (!r.width || !r.height) continue;
		regions.push({ r, drag: value === 'drag' });
	}
	const draggable = (x, yy) => {
		let drag = false;
		for (const g of regions) if (x >= g.r.left && x < g.r.right && yy >= g.r.top && yy < g.r.bottom) drag = g.drag;
		return drag;
	};
	let drag = 0, total = 0;
	for (let x = left; x < right; x += 2) { total++; if (draggable(x, y)) drag++; }
	const blocked = [...header.querySelectorAll('button')]
		.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && getComputedStyle(b).pointerEvents !== 'none' && getComputedStyle(b).visibility !== 'hidden'; })
		.filter((b) => { const r = b.getBoundingClientRect(); return draggable(r.left + r.width / 2, r.top + r.height / 2); })
		.map((b) => b.getAttribute('aria-label') || b.textContent.trim() || b.outerHTML.slice(0, 60));
	return { share: drag / total, width: Math.round(right - left), blocked };
})()`;

async function panelWindow(kind: string): Promise<AppWindow> {
	const end = Date.now() + 20_000;
	while (Date.now() < end) {
		const found = (await app.windows()).find((w) => w.boot.kind === "panel" && w.boot.panelKind === kind);
		// The header is what is measured, so wait for the panel to have drawn into it, not for the window.
		if (found && (await found.evaluate<boolean>(`(() => { const t = document.querySelector('[data-ly-panel-window-title]'); return !!t && (t.childElementCount > 0 || t.textContent.trim().length > 0); })()`).catch(() => false))) return found;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	throw new Error(`no panel window for ${kind}`);
}

async function closePanel(kind: string): Promise<void> {
	// By what the window draws: a spare window's argv says no panel even after it was given one.
	await app.main(`(async () => { for (const w of process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows()) { const held = await w.webContents.executeJavaScript('document.querySelector("[data-ly-panel-window]")?.getAttribute("data-ly-panel-window") ?? null'); if (held === ${JSON.stringify(kind)}) { w.close(); break; } } })()`);
	const end = Date.now() + 10_000;
	while (Date.now() < end && (await app.windows()).some((w) => w.boot.kind === "panel" && w.boot.panelKind === kind)) await new Promise((resolve) => setTimeout(resolve, 150));
}

test("every pop-out panel keeps its title bar draggable and its controls pressable", async () => {
	for (const kind of KINDS) {
		const opened = await app.evaluate<{ ok: boolean }>(`window.lyra.windows.openPanel({ kind: ${JSON.stringify(kind)}, scope: ${JSON.stringify(SESSION)}, sessionId: ${JSON.stringify(SESSION)} })`);
		assert.ok(opened.ok, `${kind}: the panel window opened`);
		const win = await panelWindow(kind);
		// Two frames for late layout (the terminal's strip scrolls its tab into view after mounting).
		await win.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
		const measured = await win.evaluate<{ share: number; width: number; blocked: string[] } | null>(MEASURE);
		assert.ok(measured, `${kind}: the panel window has a header`);
		assert.ok(measured.share >= 0.6, `${kind}: ${Math.round(measured.share * 100)}% of a ${measured.width}px title bar moves the window`);
		assert.deepEqual(measured.blocked, [], `${kind}: every control in the title bar can still be pressed`);
		await closePanel(kind);
	}
});
