import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { NATIVE_HEADER_HEIGHT, WINDOW_HEADER_HEIGHT } from "../shared/window-chrome.ts";
import { startApp, type RunningApp } from "./app.ts";
import { landsOn } from "./lands-on.ts";

async function frames(app: RunningApp, count = 24): Promise<void> {
	await app.evaluate(`new Promise(resolve => {
		let left = ${count}; const step = () => --left ? requestAnimationFrame(step) : resolve();
		requestAnimationFrame(step);
	})`);
}

async function click(app: RunningApp, selector: string): Promise<void> {
	const at = await app.evaluate<{ x: number; y: number }>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) throw new Error('missing control: ' + ${JSON.stringify(selector)});
		const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
		${landsOn(selector)}
		return { x, y };
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: 1 });
}

/**
 * Every control in the window's top rows sits on its row's centre line.
 *
 * Two rows, two heights — see `shared/window-chrome.ts`. Dock pane title bars are
 * `WINDOW_HEADER_HEIGHT` on every platform, so their controls centre half of that below each
 * pane's own top. The window's own row is not one number: Windows and Linux draw a header of
 * `NATIVE_HEADER_HEIGHT` and the sidebar toggle rides on it, while macOS has no header and the
 * toggle floats in the `WINDOW_HEADER_HEIGHT` corner the traffic lights centre on.
 *
 * The header's line is measured rather than assumed. When the band became 32px this compared the
 * toggle and the caption buttons with a hard-coded 22, and a comparison with a constant only says
 * which of the two happened to match it; measured, a band and buttons that disagree name each other.
 */
async function headerAlignment(app: RunningApp): Promise<void> {
	const geometry = await app.evaluate<{
		controls: number; maxError: number; drift: string[]; headerCenter: number; headerHeight: number | null;
		overlayCenter: number | null; overlayHeight: number | null;
	}>(`(() => {
		const errors = []; const drift = [];
		const measure = (el, center, name) => {
			if (!el) return;
			const r = el.getBoundingClientRect();
			if (!(r.height > 0 && r.right > 0 && r.left < innerWidth)) return;
			const error = Math.abs(r.y + r.height / 2 - center);
			errors.push(error);
			if (error > 0.5) drift.push(name + ': ' + (r.y + r.height / 2).toFixed(2) + ' vs ' + center.toFixed(2));
		};
		for (const pane of document.querySelectorAll('[data-dock-pane]')) {
			const center = pane.getBoundingClientRect().top + ${WINDOW_HEADER_HEIGHT / 2};
			const kind = pane.getAttribute('data-dock-pane');
			for (const icon of pane.querySelectorAll('[data-dock-header] svg')) measure(icon, center, kind + ' svg');
			for (const button of pane.querySelectorAll('[data-dock-header] button:not([data-dock-grip])')) measure(button, center, kind + ' ' + (button.getAttribute('aria-label') || 'button'));
		}
		const header = document.querySelector('[data-ly-window-header]');
		const band = header ? header.getBoundingClientRect() : null;
		const headerCenter = band ? band.top + band.height / 2 : ${WINDOW_HEADER_HEIGHT / 2};
		for (const button of document.querySelectorAll('button[aria-label*="侧边栏 "], button[aria-label*="设置导航 "]')) {
			const name = button.getAttribute('aria-label');
			measure(button, headerCenter, name); measure(button.querySelector('svg'), headerCenter, name + ' svg');
		}
		const overlay = navigator.windowControlsOverlay;
		const rect = overlay?.visible ? overlay.getTitlebarAreaRect() : null;
		return { controls: errors.length, maxError: Math.max(...errors), drift, headerCenter, headerHeight: band ? band.height : null,
			overlayCenter: rect ? rect.y + rect.height / 2 : null, overlayHeight: rect ? rect.height : null };
	})()`);
	assert.ok(geometry.controls >= 2, `header controls are visible: ${JSON.stringify(geometry)}`);
	// Chromium quantizes a card's 1px border at fractional DPI; allow at most half a CSS pixel.
	assert.ok(geometry.maxError <= 0.5, `header centre-line drift: ${JSON.stringify(geometry)}`);
	// `WindowHeader` is only ever drawn at the native height, whichever platform draws it.
	if (geometry.headerHeight !== null) {
		assert.ok(Math.abs(geometry.headerHeight - NATIVE_HEADER_HEIGHT) <= 0.5, `the header is ${NATIVE_HEADER_HEIGHT}px: ${JSON.stringify(geometry)}`);
	}
	if (geometry.overlayCenter !== null) {
		assert.ok(Math.abs(geometry.overlayCenter - geometry.headerCenter) <= 0.5, `native overlay shares the header centre line: ${JSON.stringify(geometry)}`);
	}
	if (process.platform === "win32") {
		/*
		 * The band and the caption buttons are one number: `titleBarOverlay.height` is told
		 * `NATIVE_HEADER_HEIGHT`, at creation and again on every theme change. A shorter band leaves
		 * the buttons poking out of it; a taller one floats them in a strip of empty space.
		 */
		assert.ok(geometry.headerHeight !== null && geometry.overlayHeight !== null
			&& Math.abs(geometry.overlayHeight - geometry.headerHeight) <= 0.5,
			`caption buttons are exactly as tall as the header: ${JSON.stringify(geometry)}`);
	}
}

for (const [scale, width, height, theme] of [
	[1, 380, 440, "dark"], [1.25, 768, 600, "light"],
	[1.5, 980, 640, "dark"], [2, 640, 480, "light"],
] as const) {
	test(`desktop controls and terminal remain reachable at ${scale * 100}% / ${width}×${height} / ${theme}`, async (t) => {
		const app = await startApp({ port: 9598, scaleFactor: scale, seed: async (home) => {
			const project = join(home, "project");
			await mkdir(project);
			await writeFile(join(home, "window.json"), JSON.stringify({ width, height }));
			await writeFile(join(home, "settings.json"), JSON.stringify({
				providers: [], mcpServers: [], hooks: [], sync: { enabled: false },
				appearance: { theme },
				projects: [{ id: "compatibility", path: project, name: "Windows 布局检查", pinned: true, lastOpenedAt: 1 }],
			}));
		} });
		try {
			await frames(app);
			await headerAlignment(app);
			const geometry = await app.evaluate<{
				width: number; height: number; dpr: number; overflow: number; composerVisible: boolean;
				controlsClear: boolean; overlayVisible: boolean; overlayRight: number; hints: string[];
			}>(`(() => {
				const overlay = navigator.windowControlsOverlay;
				const edge = overlay?.visible ? overlay.getTitlebarAreaRect().right : innerWidth;
				const header = document.querySelector('[data-ly-window-header]');
				const input = document.querySelector('textarea').getBoundingClientRect();
				// Caption buttons sit on the window header. Pane titles are the next row; their x
				// crossing the overlay edge is not a collision.
				const buttons = [...(header ?? document).querySelectorAll(header ? 'button' : '[data-dock-header] button')];
				return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
					overflow: document.documentElement.scrollWidth - innerWidth,
					composerVisible: input.left >= 0 && input.right <= innerWidth && input.bottom <= innerHeight && input.height > 20,
					controlsClear: buttons.every(b => {const r = b.getBoundingClientRect();return r.right <= edge && r.left >= 0;}),
					overlayVisible: overlay?.visible ?? false, overlayRight: edge,
					hints: [...document.querySelectorAll('[data-dock-header] button')].map(b => b.getAttribute('aria-label') ?? '') };
			})()`);
			t.diagnostic(JSON.stringify(geometry));
			assert.equal(geometry.overflow, 0);
			assert.ok(geometry.composerVisible, "composer fits inside the actual client area");
			assert.ok(geometry.controlsClear, "app buttons clear the native caption buttons");
			if (process.platform === "win32") {
				assert.ok(geometry.overlayVisible, "the native Windows overlay is present");
				assert.ok(Math.abs(geometry.dpr - scale) < 0.02);
				assert.ok(geometry.hints.some((hint) => hint === "浏览器 Ctrl+T"));
			}

			await app.evaluate("document.querySelector('textarea').focus()");
			await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
			await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
			const focus = await app.evaluate<{ visible: boolean; width: number; style: string; dpr: number }>(`(() => {
				const el = document.activeElement; const style = getComputedStyle(el);
				return { visible: el.matches('button:focus-visible'), width: parseFloat(style.outlineWidth),
					style: style.outlineStyle, dpr: devicePixelRatio };
			})()`);
			t.diagnostic(JSON.stringify(focus));
			// Chromium quantizes strokes to device pixels: 2 CSS px becomes 1.6 at 125% scaling.
			assert.ok(focus.visible && focus.style === "solid" && focus.width >= Math.floor(2 * focus.dpr) / focus.dpr - 0.01,
				"Tab gives the focused button a visible outline");

			await click(app, '[data-dock-header] button[aria-label^="终端 "]');
			await app.evaluate(`new Promise((resolve, reject) => {
				let remaining = 240; const step = () => {
					if (document.querySelector('[data-tab]') && document.querySelector('.xterm-screen')) resolve();
					else if (--remaining) requestAnimationFrame(step); else reject(new Error('terminal did not open'));
				}; step();
			})`);
			await frames(app);
			await headerAlignment(app);
			const terminal = await app.evaluate<{ visibleTabWidth: number; tabWidth: number; addHit: boolean; closeHit: boolean }>(`(() => {
				const header = document.querySelector('[data-dock-header="terminal"]');
				const tab = header.querySelector('[data-tab]'); const r = tab.getBoundingClientRect();
				const strip = tab.parentElement.getBoundingClientRect();
				const hit = label => { const b = header.querySelector('[aria-label="' + label + '"]');
					const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)); };
				return { visibleTabWidth: Math.max(0, Math.min(r.right, strip.right)-Math.max(r.left, strip.left)),
					tabWidth: r.width, addHit: hit('新建终端'), closeHit: hit('关闭终端') };
			})()`);
			t.diagnostic(JSON.stringify(terminal));
			assert.ok(terminal.visibleTabWidth >= terminal.tabWidth - 1, "the first terminal tab is fully reachable in every layout");
			assert.ok(terminal.addHit && terminal.closeHit);
			await click(app, '[data-dock-header="terminal"] button[aria-label="新建终端"]');
			await frames(app, 60);
			assert.equal(await app.evaluate("document.querySelectorAll('[data-tab]').length"), 2);
			await headerAlignment(app);
			await click(app, 'button[aria-label*="侧边栏 "]');
			await frames(app);
			await headerAlignment(app);
		} finally {
			try {
				const dir = process.env.LYRA_E2E_ARTIFACTS;
				if (dir) {
					await mkdir(dir, { recursive: true });
					const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
					await writeFile(join(dir, `desktop-${process.platform}-${scale}.png`), Buffer.from(shot.data, "base64"));
				}
			} finally {
				await app.stop();
			}
		}
	});
}


test("a regular window reflows the dock without losing panes or overwriting the saved layout", async (t) => {
	const app = await startApp({ port: 9598, seed: async (home) => {
		const project = join(home, "project"); await mkdir(project);
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1200, height: 800 }));
		await writeFile(join(home, "settings.json"), JSON.stringify({ providers: [], mcpServers: [], hooks: [], sync: { enabled: false },
			projects: [{ id: "responsive", path: project, name: "布局恢复验证", pinned: true, lastOpenedAt: 1 }] }));
	} });
	try {
		// CI displays can clamp the native window; compare the same layout viewport before and after.
		await app.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false }); await frames(app);
		await click(app, '[data-dock-header] button[aria-label^="终端 "]');
		await app.evaluate(`new Promise((resolve,reject)=>{let n=240;const step=()=>{if(document.querySelector('.xterm-screen'))resolve();else if(--n)requestAnimationFrame(step);else reject(new Error('terminal did not open'));};step();})`);
		await frames(app);
		await app.evaluate(`document.querySelector('.xterm-screen').setAttribute('data-qa-preserved','')`);
		const measure = () => app.evaluate<{ conversation: { left: number; top: number; width: number; height: number }; terminal: { left: number; top: number; width: number; height: number }; saved: string | null; sameTerminal: boolean }>(`(()=>{
			const box=kind=>{const r=document.querySelector('[data-dock-pane="'+kind+'"]').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};
			return {conversation:box('conversation'),terminal:box('terminal'),saved:localStorage.getItem('dw:panedock:@draft'),sameTerminal:!!document.querySelector('.xterm-screen[data-qa-preserved]')};
		})()`);
		const wide = await measure();
		assert.ok(wide.saved?.includes("terminal"), "the original layout is persisted before resizing");
		await app.send("Emulation.setDeviceMetricsOverride", { width: 770, height: 576, deviceScaleFactor: 1, mobile: false }); await frames(app);
		const narrow = await measure();
		assert.ok(narrow.conversation.width >= 420 && narrow.conversation.height >= 260);
		assert.ok(narrow.terminal.width >= 300 && narrow.terminal.height >= 150);
		// A pair that cannot hold both floors side by side turns into a column — see `fitTree`
		// and `COLUMN_LIMIT`. Overlap-in-row is for more than two columns, not this 770 case.
		assert.ok(Math.abs(narrow.terminal.left - narrow.conversation.left) < 1);
		assert.ok(Math.abs(narrow.terminal.top - narrow.conversation.top - narrow.conversation.height) < 1);
		assert.equal(narrow.saved, wide.saved); assert.equal(narrow.sameTerminal, true);
		const splitter = await app.evaluate<{ x: number; y: number; hit: boolean }>(`(()=>{const e=document.querySelector('.ly-dock [role="separator"]'),r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y))};})()`);
		assert.equal(splitter.hit, true, "the splitter stays on the responsive boundary and can be hit");
		assert.ok(Math.abs(splitter.y - narrow.terminal.top) < 1);
		const directory = process.env.LYRA_E2E_ARTIFACTS;
		if (directory) {
			await mkdir(directory, { recursive: true });
			const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
			await writeFile(join(directory, "dock-responsive-narrow.png"), Buffer.from(shot.data, "base64"));
		}
		await app.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false }); await frames(app);
		const restored = await measure();
		t.diagnostic(JSON.stringify({ wide, narrow, splitter, restored }));
		assert.equal(restored.saved, wide.saved); assert.equal(restored.sameTerminal, true);
		for (const kind of ["conversation", "terminal"] as const) {
			assert.ok(Math.abs(restored[kind].width - wide[kind].width) < 1);
			assert.ok(Math.abs(restored[kind].left - wide[kind].left) < 1);
			assert.equal(restored[kind].top, wide[kind].top);
		}
		/*
		 * Nor does a look at another page. The conversations' screens are put away behind the plugin
		 * catalogue, not torn down: inside `RetainedViews` its `Activity` ran every effect's cleanup,
		 * and the terminal was disposed while the catalogue was up and rebuilt on the way back
		 * (ADR-0023, point 8).
		 */
		await app.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '插件' && b.checkVisibility()).setAttribute('data-qa-nav', '')`);
		await click(app, "[data-qa-nav]"); await frames(app);
		assert.equal(await app.evaluate(`Boolean(document.querySelector('[data-ly-solo-screen]')?.checkVisibility())`), true, "the catalogue is up");
		assert.equal(await app.evaluate(`Boolean(document.querySelector('.xterm-screen[data-qa-preserved]'))`), true, "and the terminal behind it is the same one");
	} finally { await app.stop(); }
});
