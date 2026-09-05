import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

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
		const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: 1 });
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
			const geometry = await app.evaluate<{
				width: number; height: number; dpr: number; overflow: number; composerVisible: boolean;
				controlsClear: boolean; overlayVisible: boolean; overlayRight: number; hints: string[];
			}>(`(() => {
				const overlay = navigator.windowControlsOverlay;
				const edge = overlay?.visible ? overlay.getTitlebarAreaRect().right : innerWidth;
				const input = document.querySelector('textarea').getBoundingClientRect();
				const buttons = [...document.querySelectorAll('[data-dock-header] button')];
				return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
					overflow: document.documentElement.scrollWidth - innerWidth,
					composerVisible: input.left >= 0 && input.right <= innerWidth && input.bottom <= innerHeight && input.height > 20,
					controlsClear: buttons.every(b => {const r = b.getBoundingClientRect();return r.right <= edge && r.left >= 0;}),
					overlayVisible: overlay?.visible ?? false, overlayRight: edge,
					hints: buttons.map(b => b.getAttribute('aria-label') ?? '') };
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
			// Wide layouts can divide into narrow panes; a single compact pane has room for the entire tab.
			if (geometry.width < 760) assert.ok(terminal.visibleTabWidth >= terminal.tabWidth - 1, "the first terminal tab is fully reachable");
			assert.ok(terminal.addHit && terminal.closeHit);
			await click(app, '[data-dock-header="terminal"] button[aria-label="新建终端"]');
			await frames(app, 60);
			assert.equal(await app.evaluate("document.querySelectorAll('[data-tab]').length"), 2);
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
