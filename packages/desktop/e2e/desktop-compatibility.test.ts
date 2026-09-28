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

/** A light, empty profile: no projects, so the sidebar shows its empty hint. */
async function plainProfile(home: string, theme: "light" | "dark" = "light"): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 984, height: 684 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({ providers: [], mcpServers: [], hooks: [], sync: { enabled: false }, appearance: { theme } }));
}

/**
 * The pixels actually painted in a region, decoded by the page itself.
 *
 * Layout positions cannot show the faults below: they were identical to the hundredth of a pixel
 * while the painted icons moved and the corner stayed square. So these read the screenshot back —
 * a data URL drawn into a canvas is same-origin, and Node has no PNG decoder of its own. The clip
 * is in CSS pixels; what comes back is device pixels, `dpr` of them per CSS pixel.
 */
async function paintedPixels(app: RunningApp, clip: { x: number; y: number; width: number; height: number }): Promise<{ width: number; height: number; gray: number[]; rgb: number[][] }> {
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 } });
	return app.evaluate(`(async () => {
		const img = new Image(); img.src = 'data:image/png;base64,${shot.data}'; await img.decode();
		const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
		const g = canvas.getContext('2d'); g.drawImage(img, 0, 0);
		const px = g.getImageData(0, 0, img.width, img.height).data;
		const gray = [], rgb = [];
		for (let i = 0; i < px.length; i += 4) { gray.push((px[i] + px[i + 1] + px[i + 2]) / 3); rgb.push([px[i], px[i + 1], px[i + 2]]); }
		return { width: img.width, height: img.height, gray, rgb };
	})()`);
}

test("a pane's toolbar icons keep their pixel column wherever the sidebar's edge falls, at 125%", async (t) => {
	/*
	 * Opening or closing the sidebar walks the content area's left edge through fractional device
	 * pixels, and with `contain: paint` on the split section each icon snapped against that section's
	 * rounded origin: one device column left or right depending on the edge, icon by icon, which read
	 * as the toolbar shaking for the length of the slide. Held at a series of edges here, since a
	 * screenshot per animation frame is not something a test can ask for reliably.
	 */
	const app = await startApp({ port: 9598, scaleFactor: 1.25, seed: (home) => plainProfile(home) });
	try {
		await frames(app);
		// The three that were reported shaking; the toolbar also holds buttons that only show on hover.
		const toolbar = `[...document.querySelectorAll('[data-dock-header] button')].filter(b => /^(终端|浏览器|面板)/.test(b.getAttribute('aria-label') ?? '') && b.checkVisibility({ opacityProperty: true }))`;
		const icons = await app.evaluate<{ x: number; width: number }[]>(`${toolbar}.map(b => b.getBoundingClientRect()).map(r => ({ x: r.x, width: r.width })).sort((a, b) => a.x - b.x)`);
		assert.equal(icons.length, 3, `terminal, browser and panels are on the pane toolbar: ${JSON.stringify(icons)}`);
		const left = Math.floor(icons[0].x) - 4, right = Math.ceil(icons.at(-1)!.x + icons.at(-1)!.width) + 4;
		const top = await app.evaluate<number>(`Math.floor(document.querySelector('[data-dock-header] button').getBoundingClientRect().top) - 4`);
		const dpr = await app.evaluate<number>("devicePixelRatio");
		const edges = [0, -1, -2, -3, -5, -6, -7];
		const rows: { edge: number; layout: number[]; painted: number[] }[] = [];
		for (const edge of edges) {
			await app.evaluate(`(() => { const frame = document.querySelector('aside[data-pane="beside"]').parentElement; frame.style.transition = 'none'; frame.style.marginLeft = '${edge}px'; })()`);
			await frames(app, 4);
			const layout = await app.evaluate<number[]>(`${toolbar}.map(b => b.getBoundingClientRect().x).sort((a, b) => a - b)`);
			const image = await paintedPixels(app, { x: left, y: top, width: right - left, height: 36 });
			// The ink's x-centroid inside each icon's own cell, in device pixels from the clip's edge.
			const painted = icons.map((icon) => {
				const from = Math.round((icon.x - left) * dpr), to = Math.round((icon.x - left + icon.width) * dpr);
				let ink = 0, weighted = 0;
				for (let x = from; x < to; x++) for (let y = 0; y < image.height; y++) { const v = 255 - image.gray[y * image.width + x]; ink += v; weighted += v * x; }
				return Math.round((weighted / ink) * 100) / 100;
			});
			rows.push({ edge, layout, painted });
		}
		await app.evaluate(`(() => { const frame = document.querySelector('aside[data-pane="beside"]').parentElement; frame.style.marginLeft = ''; frame.style.transition = ''; })()`);
		t.diagnostic(JSON.stringify({ dpr, rows }));
		for (const row of rows) assert.deepEqual(row.layout, rows[0].layout, "the icons' layout does not move with the sidebar's edge");
		for (const [index] of icons.entries()) {
			const columns = new Set(rows.map((row) => row.painted[index]));
			assert.equal(columns.size, 1, `icon ${index} is painted on one column wherever the edge is: ${[...columns].join(", ")}`);
		}
	} finally { await app.stop(); }
});

test("the content area's corner under the window header is round, whatever is drawn in it", async (t) => {
	const app = await startApp({ port: 9598, scaleFactor: 1.25, seed: (home) => plainProfile(home) });
	try {
		await frames(app);
		const corner = await app.evaluate<{ x: number; y: number; band: string; content: string } | null>(`(() => {
			const main = document.querySelector('.ly-window-body > main');
			if (!main) return null;
			const r = main.getBoundingClientRect();
			return { x: r.x, y: r.y, band: getComputedStyle(main.parentElement).backgroundColor, content: getComputedStyle(main.querySelector('.ly-dock') ?? main).backgroundColor };
		})()`);
		if (!corner) { t.skip("macOS draws no header band, so the content area has no inner corner"); return; }
		const rgbOf = (css: string) => css.match(/\d+/g)!.slice(0, 3).map(Number);
		const image = await paintedPixels(app, { x: corner.x, y: corner.y, width: 12, height: 12 });
		const dpr = image.width / 12;
		const at = (x: number, y: number) => image.rgb[Math.floor(y * dpr) * image.width + Math.floor(x * dpr)];
		const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
		const outside = at(0, 0), inside = at(8, 8);
		t.diagnostic(JSON.stringify({ corner, outside, inside }));
		// The very corner is the band showing through; well inside the curve is the content itself.
		assert.ok(near(outside, rgbOf(corner.band)), `the corner shows the band's colour, not the content's: ${JSON.stringify({ outside, band: corner.band })}`);
		assert.ok(near(inside, rgbOf(corner.content)), `inside the curve is the content: ${JSON.stringify({ inside, content: corner.content })}`);
		assert.ok(!near(rgbOf(corner.band), rgbOf(corner.content)), "band and content differ, or the corner proves nothing");
	} finally { await app.stop(); }
});

/**
 * Which font files drew a node's text, asked over one connection of its own.
 *
 * The DOM agent's node ids belong to the session that handed them out, and `app.send` opens a
 * connection per call — so enabling it and querying through `send` answers "DOM agent needs to be
 * enabled first". Same pattern as the touch viewport in `definition-actions`.
 */
async function platformFonts(port: number, selector: string): Promise<{ familyName: string; postScriptName?: string; glyphCount: number }[]> {
	const targets: { url: string; webSocketDebuggerUrl?: string }[] = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
	const target = targets.find((entry) => entry.url.endsWith("/index.html"));
	assert.ok(target?.webSocketDebuggerUrl, "the main window is a debugging target");
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("font query connection failed")), { once: true });
	});
	let id = 0;
	const send = <T>(method: string, params = {}) => new Promise<T>((resolve, reject) => {
		const request = ++id;
		const listener = (event: MessageEvent) => {
			const message: { id?: number; error?: { message: string }; result?: T } = JSON.parse(String(event.data));
			if (message.id !== request) return;
			socket.removeEventListener("message", listener);
			if (message.error) reject(new Error(message.error.message)); else resolve(message.result as T);
		};
		socket.addEventListener("message", listener);
		socket.send(JSON.stringify({ id: request, method, params }));
	});
	try {
		await send("DOM.enable");
		await send("CSS.enable");
		const { root } = await send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1 });
		const { nodeId } = await send<{ nodeId: number }>("DOM.querySelector", { nodeId: root.nodeId, selector });
		const { fonts } = await send<{ fonts: { familyName: string; postScriptName?: string; glyphCount: number }[] }>("CSS.getPlatformFontsForNode", { nodeId });
		return fonts;
	} finally {
		socket.close();
	}
}

test("Chinese punctuation on Windows is drawn by the face drawing the Han around it, at the calibrated size", async (t) => {
	if (process.platform !== "win32") { t.skip("YaHei, SimSun and the Windows faces exist only on Windows"); return; }
	const app = await startApp({ port: 9598, seed: (home) => plainProfile(home) });
	try {
		await frames(app);
		// 「还没有会话。点击「新对话」开始。」: Han and full-width punctuation in one line of grey.
		await app.evaluate(`new Promise((resolve, reject) => { let n = 240; const step = () => {
			const hint = [...document.querySelectorAll('body *')].filter(e => e.checkVisibility() && [...e.childNodes].some(c => c.nodeType === 3 && c.textContent.includes('还没有会话'))).at(-1);
			if (hint) { hint.setAttribute('data-qa-hint', ''); resolve(); } else if (--n) requestAnimationFrame(step); else reject(new Error('no empty hint in the sidebar')); }; step(); })`);
		const fonts = await platformFonts(9598, "[data-qa-hint]");
		t.diagnostic(JSON.stringify(fonts));
		// A machine without YaHei (a bare CI image can be one) never reaches the Windows faces at all.
		if (!fonts.some((font) => /YaHei/.test(font.familyName))) { t.skip(`no YaHei on this machine: ${JSON.stringify(fonts)}`); return; }
		assert.equal(fonts.length, 1, `one face draws the whole line, punctuation included: ${JSON.stringify(fonts)}`);
		/*
		 * YaHei at 94%: its Han is a larger design than PingFang's, and `size-adjust` scales the
		 * advance with the outline, so a run of Han comes out at 0.94em a character. Unadjusted it
		 * is a full em, and the interface reads a size up again.
		 */
		const run = await app.evaluate<{ width: number; size: number; chars: number }>(`(() => {
			const el = [...document.querySelectorAll('body *')].find(e => e.checkVisibility() && e.childElementCount === 0 && /^[\\u4e00-\\u9fff]{4,}$/.test(e.textContent.trim()));
			const range = document.createRange(); range.selectNodeContents(el);
			return { width: range.getBoundingClientRect().width, size: parseFloat(getComputedStyle(el).fontSize), chars: el.textContent.trim().length };
		})()`);
		t.diagnostic(JSON.stringify(run));
		assert.ok(Math.abs(run.width / (run.chars * run.size) - 0.94) < 0.01, `Han is set at 94% of the em: ${JSON.stringify(run)}`);
	} finally { await app.stop(); }
});
