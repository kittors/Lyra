/* oxlint-disable no-console -- probe CLI that prints what the real window measured */
/**
 * How the window's one tooltip wraps a long label, measured in a real window.
 *
 * The case that started it: hovering a long filename chip showed its full name broken at the width
 * cap with a single letter left over — 「…notes.m」 above, 「d」 alone below. So this prints, for
 * every tooltip it opens, each line's text, how many characters the last line holds, and how far the
 * bubble sits from the window's left and right edges. A screenshot of each goes to the output folder.
 *
 * Cases: a long filename, a long path with directories, a long mixed Chinese and English sentence, a
 * tip with an explicit line break, a short button label, and a long label on a button pinned against
 * the window's left and right edges. Both themes.
 *
 * The labels that are not in the conversation are set on real buttons with `data-ly-tip`: what is
 * under test is how the one document-level tooltip lays out a string, not where the string comes
 * from.
 *
 * Usage: node --experimental-strip-types e2e/tooltip-wrap-probe.ts [screenshot dir] [file prefix]
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startApp, type RunningApp } from "./app.ts";
import { pause } from "./record.ts";
import { landsOn } from "./lands-on.ts";

const PORT = 9855;
const SCALE = 2;
const SESSION = "f11e11a0-0000-4000-8000-00000000000a";
const OUT = process.argv[2] ?? join(homedir(), "Desktop", "文件标签悬停测试", "提示气泡");
const TAG = process.argv[3] ?? "当前";

const LONG = "REQUIREMENTS_POLICY_PORTAL_v2_final_review_notes.md";
const PATH = "docs/issue/2026-09-16-2220-01-tasklist-false-paused-on-unfinished-plan.md";
// `pane.moveHint` with its label filled in: the longest real tooltip in the Chinese catalogue.
const SENTENCE = "移动文件：拖动或按方向键；垂直于排列方向的按键预览分屏，Enter 确认，Escape 取消";
// The shape of `timeline.entryTip`: a summary line and a duration line.
const MULTILINE = "#12 read · 读取 packages/desktop/src/features/conversation/Markdown.tsx 的前 200 行\n1.2s";

const REPLY = [
	`[${LONG}](${LONG}) 是这次需求的原始文档，先读它，再对照下面几份。`,
	"",
	`详细的排查记录在 [${PATH}](${PATH}) 里。`,
	"",
	"改动说明见 [README.md](README.md)。",
].join("\n");

let theme: "light" | "dark" = "light";

async function seed(home: string): Promise<void> {
	const cwd = join(home, "project");
	await mkdir(join(cwd, "docs", "issue"), { recursive: true });
	await writeFile(join(cwd, "README.md"), "# demo\n");
	await writeFile(join(cwd, LONG), "# requirements\n");
	await writeFile(join(cwd, PATH), "# issue\n");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const dir = join(home, "sessions", projectId);
	await mkdir(dir, { recursive: true });
	const now = Date.now();
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const meta = { id: SESSION, title: "提示气泡", cwd, projectId, projectName: "演示工程", createdAt: now, updatedAt: now, modelId: "qa/model", messageCount: 2, usage, seq: 0 };
	// The outer seq starts at 1: a record with 0 is read past, and the session never reaches the sidebar.
	const lines = [
		{ seq: 1, ts: now, type: "meta", meta },
		{ seq: 2, ts: now, type: "message", message: { role: "user", content: [{ type: "text", text: "把相关文件列一下" }], timestamp: now } },
		{ seq: 3, ts: now, type: "message", message: { role: "assistant", content: [{ type: "text", text: REPLY }], api: "anthropic-messages", provider: "qa", model: "model", usage, stopReason: "stop", timestamp: now } },
		{ seq: 4, ts: now, type: "meta", meta: { ...meta, seq: 3 } },
	];
	await writeFile(join(dir, `${SESSION}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
	// A fake provider that never gets a request; without one the reply is never rendered.
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			providers: [{ id: "qa", name: "探针", api: "anthropic-messages", baseUrl: "http://127.0.0.1:9", apiKey: "test", enabled: true, models: [{ id: "qa/model", providerId: "qa", modelId: "model", name: "QA", contextWindow: 128000, maxOutputTokens: 4096, supportsImages: true, supportsTools: true, supportsThinking: false }] }],
			defaultModelId: "qa/model",
			mcpServers: [],
			hooks: [],
			sync: { enabled: false },
			permissionMode: "full",
			appearance: { theme, reduceMotion: "off" },
			projects: [{ id: projectId, path: cwd, name: "演示工程", pinned: true, lastOpenedAt: now }],
			pinnedSessionIds: [],
		}),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 820 }));
}

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

interface TipShape {
	box: Box;
	lines: { text: string; width: number }[];
	view: { w: number; h: number };
	target: Box;
}

let app: RunningApp;

async function moveTo(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

/** Somewhere nothing reacts to hover, so the next hover is a fresh arrival. */
async function moveAway(): Promise<void> {
	await moveTo(640, 6);
	await pause(250);
}

/*
 * What the bubble drew: its box, and its text split into the lines the browser actually made, by
 * asking each character where it landed. No backticks in here — it is a template inside a template.
 */
const SHAPE = `
(() => {
	const tip = document.querySelector('.ly-tooltip');
	const target = document.querySelector('[data-probe-target]');
	if (!tip || tip.hidden || !target) return null;
	const box = (r) => ({ x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
	const lines = [];
	const walker = document.createTreeWalker(tip, NodeFilter.SHOW_TEXT);
	let node;
	while ((node = walker.nextNode())) {
		for (let i = 0; i < node.textContent.length; i++) {
			const range = document.createRange();
			range.setStart(node, i);
			range.setEnd(node, i + 1);
			const r = range.getBoundingClientRect();
			if (!r.width && !r.height) continue;
			let line = lines.find((l) => Math.abs(l.top - r.top) < 4);
			if (!line) {
				line = { top: r.top, text: '', left: r.left, right: r.right };
				lines.push(line);
			}
			line.text += node.textContent[i];
			line.left = Math.min(line.left, r.left);
			line.right = Math.max(line.right, r.right);
		}
	}
	lines.sort((a, b) => a.top - b.top);
	return {
		box: box(tip.getBoundingClientRect()),
		lines: lines.map((l) => ({ text: l.text, width: +(l.right - l.left).toFixed(1) })),
		view: { w: innerWidth, h: innerHeight },
		target: box(target.getBoundingClientRect()),
	};
})()
`;

/**
 * Mark one element as the thing to hover, optionally giving it a label of our own, and return where
 * it is once any scrolling has settled.
 */
async function target(selector: string, label?: string): Promise<Box> {
	await app.evaluate(`(() => {
		document.querySelector('[data-probe-target]')?.removeAttribute('data-probe-target');
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) throw new Error('no element for ' + ${JSON.stringify(selector)});
		el.setAttribute('data-probe-target', '');
		${label === undefined ? "" : `el.setAttribute('data-ly-tip', ${JSON.stringify(label)});`}
		el.scrollIntoView({ block: 'center', inline: 'nearest' });
	})()`);
	await pause(300);
	return app.evaluate<Box>(`(() => { const r = document.querySelector('[data-probe-target]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
}

/**
 * A button that is always on screen, carries a tip, and sits in the middle band of the window, so a
 * long label on it shows how the bubble wraps when no edge is pushing it.
 */
async function middleButton(): Promise<string> {
	return app.evaluate<string>(`(() => {
		const all = [...document.querySelectorAll('button[data-ly-tip]')].filter((el) => {
			if (el.closest('[data-ly-file-link]') || el.closest('[data-ly-hover-reveal]')) return false;
			const r = el.getBoundingClientRect();
			const mid = r.x + r.width / 2;
			return r.width > 0 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && mid > innerWidth * 0.3 && mid < innerWidth * 0.8 && r.top > 60 && r.bottom < innerHeight - 20;
		});
		if (!all.length) throw new Error('no always-visible button with a tip in the middle of the window');
		document.querySelector('[data-probe-middle]')?.removeAttribute('data-probe-middle');
		all[0].setAttribute('data-probe-middle', '');
		return '[data-probe-middle]';
	})()`);
}

async function hover(box: Box): Promise<TipShape> {
	await moveAway();
	const x = box.x + box.w / 2;
	const y = box.y + box.h / 2;
	await app.evaluate(`(() => { const x = ${x}, y = ${y}; const el = document.querySelector('[data-probe-target]'); ${landsOn("the probe target")} })()`);
	await moveTo(x, y);
	// The tooltip's own delay (420ms) plus its entrance (150ms), with room to spare.
	await pause(900);
	const shape = await app.evaluate<TipShape | null>(SHAPE);
	if (!shape) throw new Error("the tooltip never appeared");
	return shape;
}

/**
 * Capture the whole window, then crop. `captureScreenshot` with a `clip` clears the page's hover
 * state, and with it the tooltip.
 */
async function shot(file: string, around: Box): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const view = await app.evaluate<{ w: number; h: number }>(`({ w: innerWidth, h: innerHeight })`);
	const x = Math.max(0, Math.round(around.x * SCALE));
	const y = Math.max(0, Math.round(around.y * SCALE));
	const w = Math.min(Math.round(around.w * SCALE), view.w * SCALE - x);
	const h = Math.min(Math.round(around.h * SCALE), view.h * SCALE - y);
	const input = join(tmpdir(), `lyra-tip-${process.pid}-${Math.random().toString(36).slice(2)}.png`);
	await writeFile(input, Buffer.from(data, "base64"));
	try {
		await promisify(execFile)("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vf", `crop=${w}:${h}:${x}:${y}`, "-frames:v", "1", join(OUT, file)]);
	} finally {
		await rm(input, { force: true });
	}
}

/** The tooltip and its target together, with a margin — or out to the window's edge when it is near one. */
function frame(shape: TipShape, pad = 28): Box {
	const left = Math.min(shape.box.x, shape.target.x) - pad;
	const top = Math.min(shape.box.y, shape.target.y) - pad;
	const right = Math.max(shape.box.x + shape.box.w, shape.target.x + shape.target.w) + pad;
	const bottom = Math.max(shape.box.y + shape.box.h, shape.target.y + shape.target.h) + pad;
	const x = left < 60 ? 0 : left;
	const r = shape.view.w - right < 60 ? shape.view.w : right;
	return { x, y: Math.max(0, top), w: r - x, h: bottom - Math.max(0, top) };
}

function describe(name: string, shape: TipShape): void {
	const last = shape.lines[shape.lines.length - 1];
	const widths = shape.lines.map((line) => line.width);
	const spread = widths.length > 1 ? Math.max(...widths) - Math.min(...widths) : 0;
	console.log(
		`\n▸ ${name}：气泡 ${shape.box.w}×${shape.box.h}，${shape.lines.length} 行，最后一行 ${last ? [...last.text].length : 0} 个字符，` +
			`行宽差 ${spread.toFixed(1)}px；离窗口左边 ${shape.box.x.toFixed(1)}px、右边 ${(shape.view.w - shape.box.x - shape.box.w).toFixed(1)}px`,
	);
	for (const line of shape.lines) console.log(`     「${line.text}」 ${line.width}px`);
}

async function openSession(): Promise<void> {
	await pause(1200);
	const row = `[data-ly-row="${SESSION}"]`;
	const point = await app.evaluate<{ x: number; y: number }>(
		`(() => { const el = document.querySelector(${JSON.stringify(row)}); const r = el.getBoundingClientRect(); const x = r.x + r.width / 2; const y = r.y + r.height / 2; ${landsOn(row)} return { x, y }; })()`,
	);
	await moveTo(point.x, point.y);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline && (await app.evaluate<number>(`document.querySelectorAll('[data-ly-file-link]').length`)) < 3) await pause(250);
	await pause(800);
}

async function run(scheme: "light" | "dark", report: Record<string, unknown>): Promise<void> {
	theme = scheme;
	app = await startApp({ port: PORT, seed, scaleFactor: SCALE });
	try {
		await openSession();
		const name = scheme === "light" ? "浅色" : "深色";
		console.log(`\n========== ${name} ==========`);
		// The path chip is the one whose tip names a directory; the filename chip is the first one.
		const pathChip = await app.evaluate<string>(`(() => {
			const link = [...document.querySelectorAll('[data-ly-file-link] a')].find((a) => (a.getAttribute('data-ly-tip') || '').includes('/'));
			link.setAttribute('data-probe-path', '');
			return '[data-probe-path]';
		})()`);
		const middle = await middleButton();
		const cases: { key: string; selector: string; label?: string }[] = [
			{ key: "长文件名", selector: "[data-ly-file-link] a" },
			{ key: "长路径", selector: pathChip },
			{ key: "中文长句", selector: middle, label: SENTENCE },
			{ key: "两行提示", selector: middle, label: MULTILINE },
		];
		for (const item of cases) {
			const shape = await hover(await target(item.selector, item.label));
			describe(item.key, shape);
			report[`${name}/${item.key}`] = shape;
			await shot(`${TAG}-${name}-${item.key}.png`, frame(shape));
		}

		// A short label: the first button in the README chip's hover bar, reached through the chip.
		await app.evaluate(`[...document.querySelectorAll('[data-ly-file-link] a')].find((a) => a.textContent.includes('README.md')).scrollIntoView({ block: 'center' })`);
		await pause(300);
		const chip = await app.evaluate<Box>(`(() => {
			const link = [...document.querySelectorAll('[data-ly-file-link] a')].find((a) => a.textContent.includes('README.md'));
			const r = link.getBoundingClientRect();
			return { x: r.x, y: r.y, w: r.width, h: r.height };
		})()`);
		await moveAway();
		await moveTo(chip.x + chip.w / 2, chip.y + chip.h / 2);
		await pause(450);
		const button = await app.evaluate<Box>(`(() => {
			document.querySelector('[data-probe-target]')?.removeAttribute('data-probe-target');
			const link = [...document.querySelectorAll('[data-ly-file-link]')].find((l) => l.textContent.includes('README.md'));
			const b = link.querySelector('button');
			b.setAttribute('data-probe-target', '');
			const r = b.getBoundingClientRect();
			return { x: r.x, y: r.y, w: r.width, h: r.height };
		})()`);
		await moveTo(button.x + button.w / 2, button.y + button.h / 2);
		await pause(900);
		const short = await app.evaluate<TipShape | null>(SHAPE);
		if (short) {
			describe("短按钮", short);
			report[`${name}/短按钮`] = short;
			await shot(`${TAG}-${name}-短按钮.png`, frame(short));
		} else console.log("\n▸ 短按钮：提示没出来");

		/*
		 * The window's edges. Nothing real sits flush against them in this layout — the nearest things
		 * with tips are 30px to 200px in — so a 22px button is pinned 2px from each side for the
		 * duration. What is under test is the one tooltip's clamping, not the button.
		 */
		for (const edge of ["右边缘", "左边缘"] as const) {
			const selector = await app.evaluate<string>(`(() => {
				document.querySelector('[data-probe-edge]')?.remove();
				const el = document.createElement('button');
				el.type = 'button';
				el.setAttribute('data-probe-edge', '');
				el.style.cssText = 'position:fixed;top:45%;width:22px;height:22px;z-index:9999;border-radius:6px;background:var(--color-accent);${edge === "右边缘" ? "right:2px" : "left:2px"}';
				document.body.appendChild(el);
				return '[data-probe-edge]';
			})()`);
			const shape = await hover(await target(selector, PATH));
			describe(`${edge}（${PATH.length} 个字符的路径）`, shape);
			report[`${name}/${edge}`] = shape;
			await shot(`${TAG}-${name}-${edge}.png`, frame(shape));
		}
		await app.evaluate(`document.querySelector('[data-probe-edge]')?.remove()`);
	} finally {
		await app.stop();
	}
}

async function main() {
	await mkdir(OUT, { recursive: true });
	const report: Record<string, unknown> = {};
	try {
		await run("light", report);
		await run("dark", report);
		await writeFile(join(OUT, `${TAG}-量测.json`), JSON.stringify(report, null, 2));
		console.log(`\n截图和数据在 ${OUT}`);
	} catch (error) {
		console.error(error instanceof Error ? error.stack : error);
		process.exitCode = 1;
	}
}

await main();
