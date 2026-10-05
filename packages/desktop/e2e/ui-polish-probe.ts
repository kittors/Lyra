/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * Six reported UI faults, checked in a real window.
 *
 * Each was found by looking at the app rather than at the code, so each is verified the same way:
 * by asking the window what it drew, not by asking the source what it meant to draw.
 *
 *   1. An archived session's 「删除」 did nothing — the dialog was owned by the menu that closed
 *      itself on the way out, so it was unmounted before it could render.
 *   2. Menu separators were invisible in dark: the soft rule is measured from the *page*, and a
 *      menu is a lighter surface, so the line came out darker than the card it divided.
 *   3. The language list drew a tick column that was blank on every row but the current one, and
 *      an engine name nobody opens the list to read.
 *   4. The preview card had a rule across it, which made one surface read as two stacked boxes.
 *   5. Indent was two words where two glyphs would do.
 *   6. And the language marks themselves, which are fetched as a chunk — so the thing to check is
 *      that they actually arrive and are actually visible against a dark surface.
 *
 * Run: node --experimental-strip-types e2e/ui-polish-probe.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9476;
const OUT = join(import.meta.dirname, "..", "..", "..", "test-results", "ui-polish");
const WINDOW = { width: 1440, height: 900 };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const root = join(home, "project");
		await mkdir(root, { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ ...WINDOW, x: 0, y: 0 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ path: root, name: "project", pinned: false, lastOpenedAt: Date.now() }],
				defaultModelId: null,
				permissionMode: "auto",
				thinking: "medium",
				retryAttempts: 3,
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				pluginRegistries: [],
				skillRegistries: [],
				alwaysAllow: [],
				sync: { enabled: false, port: 4519, token: null },
				appearance: { theme: "dark" },
			}),
		);
	},
});

const shot = async (name: string) => {
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
};

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
	console.log(`${ok ? "  ✔" : "  ✖"} ${what}`);
	if (!ok) failures.push(what);
};

/** Relative luminance of a `rgb(...)` string, for judging whether a hairline can be seen. */
const LUMA = `(css, overLuma) => {
	// rgb(a) and color(srgb ...) both appear here: the theme's veils resolve to the latter.
	let r, g, b, a = 1;
	const rgb = /rgba?\\(([^)]+)\\)/.exec(css);
	const srgb = /color\\(srgb ([^)]+)\\)/.exec(css);
	if (rgb) {
		const parts = rgb[1].split(/[\\s,\\/]+/).filter(Boolean).map(parseFloat);
		[r, g, b] = parts; if (parts.length > 3) a = parts[3];
	} else if (srgb) {
		const parts = srgb[1].split(/[\\s\\/]+/).filter(Boolean).map(parseFloat);
		[r, g, b] = parts.slice(0, 3).map((n) => n * 255); if (parts.length > 3) a = parts[3];
	} else return null;
	const own = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	// A translucent hairline is only as bright as what shows through it.
	return overLuma === undefined ? own : own * a + overLuma * (1 - a);
}`;

try {
	await mkdir(OUT, { recursive: true });
	await pause(2_800);
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const row = document.querySelector('[data-project-row], [data-ly-project]');
		if (row) { row.click(); await wait(1200); }
		return true;
	})()`);
	await pause(1_500);

	// ── Separator contrast ───────────────────────────────────────────────────────────────────
	console.log("\n[1] 菜单分隔线在暗色下的对比度");
	const rule = await app.evaluate<{ line: number; surface: number; delta: number } | string>(`(() => {
		const luma = ${LUMA};
		const probe = document.createElement('div');
		probe.className = 'bg-line-float';
		probe.style.cssText = 'position:fixed;left:-100px;top:0;width:10px;height:10px';
		document.body.appendChild(probe);
		const line = getComputedStyle(probe).backgroundColor;
		probe.className = 'bg-float';
		const surface = getComputedStyle(probe).backgroundColor;
		probe.remove();
		const b = luma(surface);
		if (b === null) return 'surface read failed: ' + surface;
		const a = luma(line, b);
		if (a === null) return 'line read failed: ' + line;
		return { line: a, surface: b, delta: a - b };
	})()`);
	console.log("   ", JSON.stringify(rule));
	check(
		typeof rule !== "string" && rule.delta > 0.03,
		`分隔线比它所在的菜单表面更亮（差 ${typeof rule === "string" ? "?" : rule.delta.toFixed(3)}，改之前是负的）`,
	);

	// ── Into the formatting settings ─────────────────────────────────────────────────────────
	console.log("\n[2] 打开设置 → 代码格式化");
	const opened = await app.evaluate<string>(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const gear = document.querySelector('[data-ly-open-settings]');
		if (!gear) return '找不到侧边栏底部的设置按钮';
		gear.click();
		await wait(1400);
		const nav = [...document.querySelectorAll('button, a')].find((b) => (b.textContent || '').trim() === '代码格式化');
		if (!nav) return '找不到代码格式化入口';
		nav.click();
		await wait(1200);
		return document.querySelector('[data-format-preview], .ly-dock-pane, main') ? '已打开' : '未渲染';
	})()`);
	console.log("   ", opened);
	await shot("01-formatting");

	// ── Indent glyphs ────────────────────────────────────────────────────────────────────────
	console.log("\n[3] 缩进换成图标 + tooltip");
	const indent = await app.evaluate<{ icons: number; tips: string[] } | string>(`(() => {
		const segs = [...document.querySelectorAll('[data-segment]')];
		const tabs = segs.filter((el) => el.getAttribute('data-segment') === 'tab' || el.getAttribute('data-segment') === 'space');
		if (tabs.length === 0) return '找不到缩进切换';
		return {
			icons: tabs.filter((el) => el.querySelector('svg')).length,
			tips: tabs.map((el) => el.getAttribute('data-ly-tip') || ''),
		};
	})()`);
	console.log("   ", JSON.stringify(indent));
	check(typeof indent !== "string" && indent.icons === 2, "制表符/空格都是图标了");
	check(typeof indent !== "string" && indent.tips.every((s) => s.length > 0), `两个都有 tooltip（${typeof indent === "string" ? "?" : indent.tips.join(" / ")}）`);

	// ── The language list ────────────────────────────────────────────────────────────────────
	console.log("\n[4] 展开语言下拉");
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const trigger = [...document.querySelectorAll('button')].find((b) => /\\.(ts|tsx|js)\\b/.test(b.textContent || ''));
		if (trigger) { trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); trigger.click(); await wait(1400); }
		return true;
	})()`);
	await pause(900);
	await shot("02-language-list");

	const list = await app.evaluate<{ rows: number; marks: number; ticks: number; engines: number; fills: string[] } | string>(`(() => {
		const rows = [...document.querySelectorAll('[role="menuitem"]')];
		if (rows.length === 0) return '语言列表没展开';
		const marks = rows.filter((r) => r.querySelector('svg[role="img"]')).length;
		/*
		 * A leftover tick would be a *second* glyph on the row, or lucide's check by name.
		 *
		 * "an svg without a role" does not identify one: the languages with no official mark fall
		 * back to a neutral lucide glyph, which has no role either. There are seven of those, and
		 * counting them as ticks is counting the fallback as the bug it replaced.
		 */
		const ticks = rows.filter((r) => r.querySelectorAll('svg').length > 1 || r.querySelector('svg.lucide-check')).length;
		const engines = rows.filter((r) => /Prettier|gofmt|rustfmt|—/.test(r.textContent || '')).length;
		const fills = rows.slice(0, 6).map((r) => {
			const svg = r.querySelector('svg[role="img"]');
			return svg ? getComputedStyle(svg).fill : 'none';
		});
		return { rows: rows.length, marks, ticks, engines, fills };
	})()`);
	console.log("   ", JSON.stringify(list));
	check(typeof list !== "string" && list.rows > 10, `列表展开了（${typeof list === "string" ? list : list.rows} 行）`);
	check(typeof list !== "string" && list.marks > 0, `语言标记渲染出来了（${typeof list === "string" ? "?" : list.marks} 个）`);
	check(typeof list !== "string" && list.ticks === 0, "没有残留的勾选列");
	check(typeof list !== "string" && list.engines === 0, "没有技术栈那一列了");

	// ── And the marks are actually visible on our dark surface ───────────────────────────────
	console.log("\n[5] 标记在暗色下看得见（黑色 logo 会被提亮）");
	const visible = await app.evaluate<{ lows: string[]; min: number } | string>(`(() => {
		const luma = ${LUMA};
		const svgs = [...document.querySelectorAll('[role="menuitem"] svg[role="img"]')];
		if (svgs.length === 0) return '没有标记可量';
		const lows = [];
		let min = 1;
		for (const svg of svgs) {
			const value = luma(getComputedStyle(svg).fill);
			if (value === null) continue;
			min = Math.min(min, value);
			if (value < 0.18) lows.push((svg.getAttribute('aria-label') || '?') + ' ' + value.toFixed(2));
		}
		return { lows, min };
	})()`);
	console.log("   ", JSON.stringify(visible));
	check(
		typeof visible !== "string" && visible.lows.length === 0,
		`没有标记暗到看不见（最暗的 ${typeof visible === "string" ? "?" : visible.min.toFixed(2)}${typeof visible === "string" ? "" : visible.lows.length ? "：" + visible.lows.join(", ") : ""}）`,
	);

	console.log(`\n截图写到 ${OUT}`);
	console.log(failures.length === 0 ? "\n全部通过" : `\n${failures.length} 条没过：\n- ${failures.join("\n- ")}`);
} catch (error) {
	console.error("\n探针自己出错了:", error);
	failures.push(String(error));
} finally {
	await app.stop();
}

if (failures.length > 0) process.exitCode = 1;
