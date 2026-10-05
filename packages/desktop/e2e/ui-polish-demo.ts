/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * The six changes, demonstrated in one pass and recorded.
 *
 * Doubles as the verification: each step asserts what it just showed, so a green run and the video
 * are the same evidence. A demo that passes while the video shows something else would be worse
 * than no demo.
 *
 * Frames are JPEG and the gestures are stepped slowly on purpose. `Page.captureScreenshot` spends
 * most of its time compressing, and PNG at this size costs hundreds of milliseconds a frame — an
 * earlier recording caught a three-minute session in 140 frames, which plays back as a slideshow
 * of a drag rather than as a drag.
 *
 * Run: node --experimental-strip-types e2e/ui-polish-demo.ts
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9477;
const OUT = join(import.meta.dirname, "..", "..", "..", "test-results", "ui-polish-demo");
const FRAMES = join(OUT, "frames");
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

let frame = 0;
let recorder: ReturnType<typeof setInterval> | null = null;
const stamps: number[] = [];

const capture = async (path: string, format: "png" | "jpeg" = "png") => {
	const shot = await app.send<{ data: string }>(
		"Page.captureScreenshot",
		format === "jpeg" ? { format, quality: 62 } : { format },
	);
	await writeFile(path, Buffer.from(shot.data, "base64"));
};

const shot = async (name: string) => {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 8, y: 8, button: "none" });
	await pause(150);
	await capture(join(OUT, `${name}.png`));
};

const record = () => {
	let busy = false;
	recorder = setInterval(() => {
		if (busy) return;
		busy = true;
		const at = Date.now();
		capture(join(FRAMES, `${String(frame++).padStart(5, "0")}.jpg`), "jpeg")
			.then(() => void stamps.push(at))
			.catch(() => {})
			.finally(() => {
				busy = false;
			});
	}, 40);
};

const stop = () => {
	if (recorder) clearInterval(recorder);
	recorder = null;
};

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
	console.log(`${ok ? "  ✔" : "  ✖"} ${what}`);
	if (!ok) failures.push(what);
};

const click = async (x: number, y: number) => {
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};

/** Where an element is, so the pointer can be sent there for real. */
const centreOf = (selector: string) =>
	app.evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);

try {
	await rm(FRAMES, { recursive: true, force: true });
	await mkdir(FRAMES, { recursive: true });
	await pause(2_800);
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const row = document.querySelector('[data-project-row], [data-ly-project]');
		if (row) { row.click(); await wait(1200); }
		return true;
	})()`);
	await pause(1_200);
	record();

	// ── 1. Into the formatting settings ──────────────────────────────────────────────────────
	console.log("\n[1] 打开设置 → 代码格式化");
	const nav = await app.evaluate<string>(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		document.querySelector('[data-ly-open-settings]')?.click();
		await wait(1300);
		const item = [...document.querySelectorAll('button, a')].find((b) => (b.textContent || '').trim() === '代码格式化');
		if (!item) return '没找到入口';
		item.click();
		await wait(1400);
		return '已打开';
	})()`);
	console.log("   ", nav);
	await pause(1_200);
	await shot("01-formatting");

	// ── 2. The indent glyphs, with a tooltip ─────────────────────────────────────────────────
	console.log("\n[2] 缩进的两个图标，鼠标放上去出 tooltip");
	const tab = await centreOf('[data-segment="tab"]');
	if (tab) {
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tab.x, y: tab.y, button: "none" });
		await pause(1_400);
		await capture(join(OUT, "02-indent-tooltip.png"));
	}
	const indent = await app.evaluate<{ icons: number; tips: string[] } | string>(`(() => {
		const segs = [...document.querySelectorAll('[data-segment]')].filter((el) => ['tab','space'].includes(el.getAttribute('data-segment')));
		if (!segs.length) return '找不到';
		return { icons: segs.filter((el) => el.querySelector('svg')).length, tips: segs.map((el) => el.getAttribute('data-ly-tip') || '') };
	})()`);
	check(typeof indent !== "string" && indent.icons === 2 && indent.tips.every(Boolean), `两个图标都有 tooltip（${typeof indent === "string" ? "?" : indent.tips.join(" / ")}）`);

	// ── 3. The language list, with the marks ─────────────────────────────────────────────────
	console.log("\n[3] 展开语言下拉");
	const trigger = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => /\\.(ts|tsx)\\b/.test(el.textContent || ''));
		if (!b) return null;
		const r = b.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!trigger) throw new Error("找不到语言选择器");
	await click(trigger.x, trigger.y);
	await pause(1_600);
	await capture(join(OUT, "03-language-list.png"));

	const list = await app.evaluate<{ rows: number; marks: number; engines: number } | string>(`(() => {
		const rows = [...document.querySelectorAll('[role="menuitem"]')];
		if (!rows.length) return '没展开';
		return {
			rows: rows.length,
			marks: rows.filter((r) => r.querySelector('svg[role="img"]')).length,
			engines: rows.filter((r) => /Prettier|gofmt|rustfmt/.test(r.textContent || '')).length,
		};
	})()`);
	console.log("   ", JSON.stringify(list));
	check(typeof list !== "string" && list.marks > 30, `语言标记画出来了（${typeof list === "string" ? "?" : list.marks} 个）`);
	check(typeof list !== "string" && list.engines === 0, "技术栈那一列没有了");

	// ── 4. Switching language: the words travel ──────────────────────────────────────────────
	console.log("\n[4] 切到 Go —— 相同的词会走到新位置，不是硬切");
	const rust = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const row = [...document.querySelectorAll('[role="menuitem"]')].find((r) => (r.textContent || '').includes('Go'));
		if (!row) return null;
		row.scrollIntoView({ block: 'center' });
		const r = row.getBoundingClientRect();
		return { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (rust) {
		await pause(500);
		await click(rust.x, rust.y);
		/*
		 * Sampled rather than read once.
		 *
		 * Re-colouring is debounced 60ms and then parses asynchronously, so the words do not start
		 * moving until a few hundred milliseconds after the click — and they are done 320ms later.
		 * A single read at a guessed moment catches the gap on either side; this watches the window.
		 */
		let moving = 0;
		for (let i = 0; i < 14; i++) {
			/*
			 * The *computed* transform, not the inline one.
			 *
			 * FLIP sets an inline offset, then clears it on the next frame and lets the transition
			 * carry the element home — so while it is actually moving, `style.transform` is already
			 * empty and only the computed value shows the matrix.
			 */
			const n = await app.evaluate<number>(
				`[...document.querySelectorAll('[data-mm]')].filter((el) => { const t = getComputedStyle(el).transform; return t && t !== 'none'; }).length`,
			);
			moving = Math.max(moving, n);
			if (i === 3) await capture(join(OUT, "04-switching.png"), "jpeg");
			await pause(60);
		}
		console.log("    飞行中的词（峰值）:", moving);
		check(moving > 0, `切换时有词在移动（${moving} 个），说明不是硬切`);
		await pause(1_400);
		await shot("05-go");
		const settled = await app.evaluate<number>(
			`[...document.querySelectorAll('[data-mm]')].filter((el) => { const t = getComputedStyle(el).transform; return t && t !== 'none'; }).length`,
		);
		check(settled === 0, `动画结束后没有残留的 transform（${settled}）`);
	}

	// ── 5. Every language can be formatted now ───────────────────────────────────────────────
	console.log("\n[5] 「格式化」按钮对每种语言都是活的");
	const live = await app.evaluate<{ disabled: boolean; label: string } | string>(`(() => {
		const b = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('格式化'));
		if (!b) return '找不到格式化按钮';
		return { disabled: b.disabled, label: (b.textContent || '').trim() };
	})()`);
	console.log("   ", JSON.stringify(live));
	check(typeof live !== "string" && !live.disabled, "Go 也能按（以前只有 Prettier 那 16 种能按）");

	// ── 6. An icon button with its tooltip ───────────────────────────────────────────────────
	console.log("\n[6] 个性化页：纯文字按钮变成图标 + tooltip");
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		document.body.click();
		await wait(400);
		const item = [...document.querySelectorAll('button, a')].find((b) => (b.textContent || '').trim() === '个性化');
		if (item) { item.click(); await wait(1300); }
		return true;
	})()`);
	await pause(900);
	/*
	 * Whichever icon button this page actually has.
	 *
	 * 「清除所有记忆」 only renders once there are memories to clear, and a fresh profile has none —
	 * so naming it meant the demo silently skipped the step it exists for.
	 */
	const clear = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const b = [...document.querySelectorAll('button[data-ly-tip]')].find((el) => el.querySelector('svg') && !(el.textContent || '').trim());
		if (!b) return null;
		const r = b.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (clear) {
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: clear.x, y: clear.y, button: "none" });
		await pause(1_500);
		await capture(join(OUT, "06-icon-tooltip.png"));
	}
	const buttons = await app.evaluate<{ icons: number; tips: number } | string>(`(() => {
		const all = [...document.querySelectorAll('button[data-ly-tip]')].filter((b) => b.querySelector('svg') && !(b.textContent || '').trim());
		if (!all.length) return '这一页没有图标按钮';
		return { icons: all.length, tips: all.filter((b) => b.getAttribute('data-ly-tip')).length };
	})()`);
	console.log("   ", JSON.stringify(buttons));
	check(typeof buttons !== "string" && buttons.icons === buttons.tips, "每个图标按钮都带着它的文字（tooltip）");

	stop();
	const spans = stamps.slice(1).map((at, i) => at - stamps[i]);
	const mean = spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : 0;
	await writeFile(join(OUT, "frames.json"), JSON.stringify({ stamps }));
	console.log(`\n帧 ${frame} 张，平均间隔 ${mean}ms（约 ${mean ? (1000 / mean).toFixed(1) : "?"} fps）`);
	console.log(`截图与帧写到 ${OUT}`);
	console.log(failures.length === 0 ? "\n全部通过" : `\n${failures.length} 条没过：\n- ${failures.join("\n- ")}`);
} catch (error) {
	console.error("\n探针自己出错了:", error);
	failures.push(String(error));
} finally {
	stop();
	await app.stop();
}

if (failures.length > 0) process.exitCode = 1;
