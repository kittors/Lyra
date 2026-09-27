/* oxlint-disable no-console -- probe CLI that prints what the real window measured */
/**
 * The two exits that appear when a file link is hovered — open, and reveal in Finder — measured:
 * how big they are, whether they cover the filename, whether the text jumps.
 *
 * The complaint was that the icons are too small and awkward to use. "Small", "on top of the text"
 * and "hard to hit" are all measurable, so nothing here is concluded from a screenshot; every item
 * is a number:
 *
 *   - chip width and the filename's visible width, before and during hover
 *   - each button's box and icon size, and whether the button's centre actually lands on it
 *   - how many pixels the buttons (with whatever backs them) overlap the filename's *visible* text
 *   - whether the paragraph height and the position of the words after the chip change on hover
 *   - whether what floats out is clipped by the message row, which has paint containment, so
 *     anything that leaves it is never painted
 *
 * Every case is in one hand-written session, with no model involved: a long filename, a short one, a
 * Chinese label, one at a line break, one in a list, one on a message's first line. Both themes are
 * shot, and then a device without hover is checked for whether the exits are still there.
 *
 * Usage: node --experimental-strip-types e2e/file-link-hover-probe.ts [screenshot dir] [file prefix]
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startApp, type RunningApp } from "./app.ts";
import { encode, frameGrabber, pause, type Frame } from "./record.ts";
import { landsOn } from "./lands-on.ts";

const PORT = 9853;
const SESSION = "f11e11a0-0000-4000-8000-000000000001";
const OUT = process.argv[2] ?? join(homedir(), "Desktop", "文件标签悬停测试");
const TAG = process.argv[3] ?? "当前";

const LONG = "REQUIREMENTS_POLICY_PORTAL_v2_final_review_notes.md";
const SCALE = 2;

/*
 * The reply. Its first line is a file chip, so anything that floats upward hits the edge of the
 * message row first.
 *
 * The line-break paragraph is long on purpose, with chips at several points, so that whatever the
 * window width one of them lands near the end of a line; the probe picks the one closest to the edge.
 */
const REPLY = [
	`[${LONG}](${LONG}) 是这次需求的原始文档，先读它，再对照下面几份。`,
	"",
	"安装包在 [Lyra-0.9.8-x64.exe](Lyra-0.9.8-x64.exe)，改动说明见 [README.md](README.md)，实现细节写在 [实现说明](docs/result.md:12) 里。",
	"",
	`这一段故意写得很长，好让文件标签落到行尾换行的地方：需求文档里的三个约束逐条核对过了，第一条已经满足，第二条需要改配置，第三条要看 [docs/result.md](docs/result.md) 里的结论，另外 [README.md](README.md) 的安装步骤也要同步更新，最后别忘了 [${LONG}](${LONG}) 的签字页，以及安装包 [Lyra-0.9.8-x64.exe](Lyra-0.9.8-x64.exe) 的签名。`,
	"",
	"- 列表第一项：[docs/result.md](docs/result.md)",
	"- 列表第二项里的 [README.md](README.md) 标签",
	"",
	"最后一段是普通文字，用来比对行高。",
	"",
	"设计稿在 ![设计稿截图](https://example.com/design-review.png) 这里，远程图片在对话里画成链接。",
].join("\n");

/**
 * One window per theme: with the theme following the system, emulating the colour scheme over CDP
 * never reaches the app as a change event, so it cannot be switched in place.
 */
let theme: "light" | "dark" = "light";

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(join(cwd, "docs"), { recursive: true });
	await writeFile(join(cwd, "README.md"), "# 演示工程\n");
	await writeFile(join(cwd, LONG), "# 需求\n");
	await writeFile(join(cwd, "docs", "result.md"), "# 结论\n");
	await writeFile(join(cwd, "Lyra-0.9.8-x64.exe"), Buffer.alloc(2048, 7));
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const dir = join(home, "sessions", projectId);
	await mkdir(dir, { recursive: true });

	const now = Date.now();
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const meta = { id: SESSION, title: "文件标签悬停", cwd, projectId, projectName: "演示工程", createdAt: now, updatedAt: now, modelId: "qa/model", messageCount: 2, usage, seq: 0 };
	// The outer seq starts at 1: a record with 0 is read past, and the session never reaches the sidebar.
	const lines = [
		{ seq: 1, ts: now, type: "meta", meta },
		{ seq: 2, ts: now, type: "message", message: { role: "user", content: [{ type: "text", text: "把相关文件列一下" }], timestamp: now } },
		{
			seq: 3,
			ts: now,
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: REPLY }], api: "anthropic-messages", provider: "qa", model: "model", usage, stopReason: "stop", timestamp: now },
		},
		{ seq: 4, ts: now, type: "meta", meta: { ...meta, seq: 3 } },
	];
	await writeFile(join(dir, `${SESSION}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

	/*
	 * A fake provider that never gets a request.
	 *
	 * Without any provider the window stays on its "no model provider configured" screen and the reply
	 * being measured is never rendered. The real settings are not copied: they hold the user's own
	 * things, and none of them are needed here.
	 */
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			providers: [
				{
					id: "qa",
					name: "探针",
					api: "anthropic-messages",
					baseUrl: "http://127.0.0.1:9",
					apiKey: "test",
					enabled: true,
					models: [{ id: "qa/model", providerId: "qa", modelId: "model", name: "QA", contextWindow: 128000, maxOutputTokens: 4096, supportsImages: true, supportsTools: true, supportsThinking: false }],
				},
			],
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

interface ChipState {
	index: number;
	label: string;
	chip: Box;
	/** The filename's box, where the ellipsis cuts. */
	name: Box;
	/** The filename's full width; equal to the visible width when nothing is cut. */
	nameFull: number;
	/** The visible text: the filename's box intersected with the text's Range. */
	text: Box | null;
	block: Box;
	paragraphHeight: number;
	/** Where the first character after the chip sits — it should not move on hover. */
	after: Box | null;
	/** The exits' container: the old backing strip, or the new bar's card. */
	bar: (Box & { opacity: number; visibility: string; clipped: boolean }) | null;
	buttons: {
		box: Box;
		icon: Box | null;
		opacity: number;
		visibility: string;
		pointer: string;
		label: string | null;
		tip: string | null;
		/** `elementFromPoint` at the button's centre lands on the button itself. */
		hit: boolean;
	}[];
	/** Horizontal pixels of visible text covered by the buttons, and by what backs them. */
	overlapButtons: number;
	overlapBar: number;
	/** The message row, whose paint containment is the clipping edge. */
	row: Box;
	/** Which side the bar went to; only the new structure has one. */
	side: string | null;
	dark: boolean;
}

/*
 * The measuring code injected into the page. No backticks and no newline escapes inside it: it lives
 * a second time inside the outer template string.
 */
const MEASURE = `
((index) => {
	const chips = [...document.querySelectorAll('[data-ly-file-link]')];
	const chip = chips[index];
	if (!chip) return null;
	const box = (b) => b ? { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } : null;
	const rect = (el) => el ? box(el.getBoundingClientRect()) : null;
	const opacityOf = (el) => {
		let value = 1;
		for (let node = el; node && node !== document.body; node = node.parentElement) value *= +getComputedStyle(node).opacity;
		return +value.toFixed(3);
	};
	const inter = (a, b) => {
		if (!a || !b) return 0;
		const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
		const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
		return w > 0 && h > 0 ? +w.toFixed(1) : 0;
	};
	const name = chip.querySelector('[data-ly-file-name]');
	const nameBox = rect(name);
	const range = document.createRange();
	range.selectNodeContents(name);
	const full = range.getBoundingClientRect();
	const visible = nameBox ? {
		x: Math.max(nameBox.x, full.x), y: Math.max(nameBox.y, full.y),
		w: Math.min(nameBox.x + nameBox.w, full.x + full.width) - Math.max(nameBox.x, full.x),
		h: Math.min(nameBox.y + nameBox.h, full.y + full.height) - Math.max(nameBox.y, full.y),
	} : null;
	const text = visible && visible.w > 0 ? { x: +visible.x.toFixed(1), y: +visible.y.toFixed(1), w: +visible.w.toFixed(1), h: +visible.h.toFixed(1) } : null;
	const block = chip.closest('p, li') || chip.parentElement;
	const row = chip.closest('.group\\\\/msg') || block;
	const rowBox = rect(row);
	let after = null;
	const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	let node;
	while ((node = walker.nextNode())) {
		if (chip.contains(node)) continue;
		if (!(chip.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
		if (!node.textContent.trim()) continue;
		const r = document.createRange();
		r.setStart(node, 0);
		r.setEnd(node, Math.min(1, node.textContent.length));
		after = box(r.getBoundingClientRect());
		break;
	}
	const bar = chip.querySelector('[data-ly-file-actions-bar]') || chip.querySelector('[data-ly-file-actions]');
	const barBox = rect(bar);
	const buttons = [...chip.querySelectorAll('button')].map((button) => {
		const b = rect(button);
		const s = getComputedStyle(button);
		const cx = b.x + b.w / 2;
		const cy = b.y + b.h / 2;
		const landed = document.elementFromPoint(cx, cy);
		return {
			box: b,
			icon: rect(button.querySelector('svg')),
			opacity: opacityOf(button),
			visibility: s.visibility,
			pointer: s.pointerEvents,
			label: button.getAttribute('aria-label'),
			tip: button.getAttribute('data-ly-tip'),
			hit: Boolean(landed && button.contains(landed)),
		};
	});
	const overlapButtons = buttons.reduce((sum, b) => sum + (b.opacity > 0.05 && b.visibility !== 'hidden' ? inter(b.box, text) : 0), 0);
	const barVisible = bar && getComputedStyle(bar).visibility !== 'hidden' && opacityOf(bar) > 0.05 && getComputedStyle(bar).backgroundImage + getComputedStyle(bar).backgroundColor !== 'nonergba(0, 0, 0, 0)';
	return {
		index,
		label: name ? name.textContent : '',
		chip: rect(chip),
		name: nameBox,
		nameFull: name ? +name.scrollWidth.toFixed(1) : 0,
		text,
		block: rect(block),
		paragraphHeight: +block.getBoundingClientRect().height.toFixed(1),
		after,
		bar: barBox ? { ...barBox, opacity: opacityOf(bar), visibility: getComputedStyle(bar).visibility, clipped: rowBox ? (barBox.y < rowBox.y - 0.5 || barBox.y + barBox.h > rowBox.y + rowBox.h + 0.5 || barBox.x < rowBox.x - 0.5 || barBox.x + barBox.w > rowBox.x + rowBox.w + 0.5) : false } : null,
		buttons,
		overlapButtons: +overlapButtons.toFixed(1),
		overlapBar: barVisible ? inter(barBox, text) : 0,
		row: rowBox,
		side: chip.getAttribute('data-ly-file-actions-side'),
		dark: document.documentElement.classList.contains('dark'),
	};
})(__INDEX__)
`;

let app: RunningApp;

async function measure(index: number): Promise<ChipState> {
	const state = await app.evaluate<ChipState | null>(MEASURE.replace("__INDEX__", String(index)));
	if (!state) throw new Error(`第 ${index} 枚文件标签不在页面上`);
	return state;
}

/**
 * Capture the whole window, then cut out the part wanted.
 *
 * Not `captureScreenshot`'s own `clip`: one capture with a clip clears the page's hover state — the
 * pointer has not moved, yet the `:hover` chain is empty and the bar fades. The old buttons sat
 * inside the chip, so the next pointer move hovered them again and nothing showed; the bar is outside
 * the chip, so by the time the pointer got there it was gone, and every "the bar vanished when the
 * pointer reached a button" came from the screenshot, not the app.
 */
async function crop(image: Buffer, clip: Box, out: string): Promise<void> {
	const view = await app.evaluate<{ w: number; h: number }>(`({ w: innerWidth, h: innerHeight })`);
	const x = Math.max(0, Math.round(clip.x * SCALE));
	const y = Math.max(0, Math.round(clip.y * SCALE));
	const w = Math.min(Math.round(clip.w * SCALE), view.w * SCALE - x);
	const h = Math.min(Math.round(clip.h * SCALE), view.h * SCALE - y);
	const input = join(tmpdir(), `lyra-file-link-${process.pid}-${Math.random().toString(36).slice(2)}.img`);
	await writeFile(input, image);
	try {
		await promisify(execFile)("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vf", `crop=${w}:${h}:${x}:${y}`, "-frames:v", "1", out]);
	} finally {
		await rm(input, { force: true });
	}
}

async function shot(file: string, clip: Box): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await crop(Buffer.from(data, "base64"), clip, join(OUT, file));
}

/** The area around a chip: out to the paragraph's edges, a line and more above and below, so the bar and tooltips are in frame. */
function around(state: ChipState): Box {
	const x = Math.max(0, Math.min(state.block.x, state.chip.x) - 16);
	const right = Math.max(state.block.x + state.block.w, state.chip.x + state.chip.w + 60) + 16;
	return { x, y: Math.max(0, state.chip.y - 64), w: right - x, h: state.chip.h + 128 };
}

async function moveTo(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

/** Move the pointer somewhere nothing reacts to hover: outside the text column, in blank space. */
async function moveAway(): Promise<void> {
	const spot = await app.evaluate<{ x: number; y: number }>(`(() => {
		const main = document.querySelector('.prose-dw').getBoundingClientRect();
		return { x: Math.min(window.innerWidth - 8, main.right + 40), y: Math.min(window.innerHeight - 140, main.top + 10) };
	})()`);
	await moveTo(spot.x, spot.y);
}

function describe(state: ChipState, phase: string): string {
	const truncated = state.nameFull - (state.name?.w ?? 0) > 0.5;
	const lines = [
		`  [${phase}] 胶囊 ${state.chip.w}×${state.chip.h}  文件名盒子 ${state.name?.w}px（全长 ${state.nameFull}px${truncated ? "，被截断" : ""}）  可见文字 ${state.text?.w ?? 0}px`,
	];
	if (state.bar) {
		lines.push(
			`           出口${state.side ? `浮条（${state.side === "below" ? "下方" : "上方"}）` : "容器"} ${state.bar.w}×${state.bar.h} @(${state.bar.x - state.chip.x >= 0 ? "+" : ""}${(state.bar.x - state.chip.x).toFixed(1)}, ${(state.bar.y - state.chip.y).toFixed(1)}) 相对胶囊  不透明度 ${state.bar.opacity}  ${state.bar.visibility}${state.bar.clipped ? "  ← 伸出消息行，会被裁掉" : ""}`,
		);
	}
	for (const [i, b] of state.buttons.entries()) {
		lines.push(
			`           按钮${i + 1}「${b.label}」 ${b.box.w}×${b.box.h}  图标 ${b.icon ? `${b.icon.w}×${b.icon.h}` : "无"}  不透明度 ${b.opacity}  ${b.visibility}  pointer-events:${b.pointer}  中心按得到它：${b.hit ? "是" : "否"}  tip：${b.tip ?? "无"}`,
		);
	}
	lines.push(`           按钮压住可见文字 ${state.overlapButtons}px，托底 / 浮条压住可见文字 ${state.overlapBar}px`);
	return lines.join("\n");
}

async function openSession(): Promise<number> {
	await pause(1200);
	// Open the session with a real mouse; a synthetic click does not open a session row.
	const row = `[data-ly-row="${SESSION}"]`;
	const point = await app.evaluate<{ x: number; y: number }>(
		`(() => { const el = document.querySelector(${JSON.stringify(row)}); const r = el.getBoundingClientRect(); const x = r.x + r.width / 2; const y = r.y + r.height / 2; ${landsOn(row)} return { x, y }; })()`,
	);
	await moveTo(point.x, point.y);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline && (await app.evaluate<number>(`document.querySelectorAll('[data-ly-file-link]').length`)) === 0) await pause(250);
	const count = await app.evaluate<number>(`document.querySelectorAll('[data-ly-file-link]').length`);
	if (count === 0) throw new Error("会话打开了，但一枚文件标签都没渲染出来");
	await moveAway();
	await pause(800);
	return count;
}

async function run(scheme: "light" | "dark", report: Record<string, unknown>): Promise<void> {
	theme = scheme;
	app = await startApp({ port: PORT, seed, scaleFactor: SCALE });
	const grabber = await frameGrabber(PORT);
	try {
		const count = await openSession();
		const dark = await app.evaluate<boolean>(`document.documentElement.classList.contains('dark')`);
		if (dark !== (scheme === "dark")) throw new Error(`主题应当是 ${scheme}，页面上却是 ${dark ? "dark" : "light"}`);
		const schemeName = scheme === "light" ? "浅色" : "深色";
		console.log(`\n========== ${schemeName}：页面上有 ${count} 枚文件标签 ==========`);

		// The chips worth a close look: the long name on the first line, a short one, the Chinese label, the one at a line end, the one in a list.
		const all: ChipState[] = [];
		for (let i = 0; i < count; i++) all.push(await measure(i));
		const lineEnd = all
			.filter((s) => s.block.w > 0 && s.index > 3)
			.map((s) => ({ s, gap: s.block.x + s.block.w - (s.chip.x + s.chip.w) }))
			.sort((a, b) => a.gap - b.gap)[0]?.s;
		const picks: { key: string; index: number }[] = [
			{ key: "长文件名-消息首行", index: 0 },
			{ key: "exe", index: 1 },
			{ key: "短文件名", index: 2 },
			{ key: "中文标签", index: 3 },
			...(lineEnd ? [{ key: "行尾", index: lineEnd.index }] : []),
			{ key: "列表", index: count - 1 },
		];
		console.log(`行尾那枚是第 ${lineEnd?.index} 枚「${lineEnd?.label}」，离段落右沿 ${lineEnd ? (lineEnd.block.x + lineEnd.block.w - lineEnd.chip.x - lineEnd.chip.w).toFixed(1) : "?"}px`);

		for (const pick of picks) {
			await app.evaluate(`document.querySelectorAll('[data-ly-file-link]')[${pick.index}].scrollIntoView({ block: 'center' })`);
			await moveAway();
			await pause(500);
			const rest = await measure(pick.index);
			// Hover the middle of the filename.
			const target = rest.text ?? rest.name;
			await moveTo(target.x + target.w / 2, target.y + target.h / 2);
			await pause(420);
			const hover = await measure(pick.index);
			console.log(`\n▸ 第 ${pick.index} 枚「${rest.label}」（${pick.key}）`);
			console.log(describe(rest, "静止"));
			console.log(describe(hover, "悬停"));
			const reflow = {
				chipWidth: +(hover.chip.w - rest.chip.w).toFixed(1),
				paragraph: +(hover.paragraphHeight - rest.paragraphHeight).toFixed(1),
				afterMoved: rest.after && hover.after ? +Math.hypot(hover.after.x - rest.after.x, hover.after.y - rest.after.y).toFixed(1) : 0,
				visibleText: +((hover.text?.w ?? 0) - (rest.text?.w ?? 0)).toFixed(1),
			};
			console.log(`           悬停前后：胶囊宽度 ${reflow.chipWidth >= 0 ? "+" : ""}${reflow.chipWidth}px，段落高度 ${reflow.paragraph >= 0 ? "+" : ""}${reflow.paragraph}px，后面那个字挪了 ${reflow.afterMoved}px，可见文字 ${reflow.visibleText >= 0 ? "+" : ""}${reflow.visibleText}px`);
			report[`${schemeName}/${pick.key}`] = { rest, hover, reflow };
			await shot(`${TAG}-${schemeName}-${pick.key}-悬停.png`, around(hover));

			// Rest on the first button until its tooltip shows.
			const first = hover.buttons[0];
			if (first && first.opacity > 0.5) {
				await moveTo(first.box.x + first.box.w / 2, first.box.y + first.box.h / 2);
				await pause(750);
				const onButton = await measure(pick.index);
				const tip = await app.evaluate<{ text: string; box: Box } | null>(`(() => { const t = document.querySelector('.ly-tooltip'); if (!t || t.hidden) return null; const r = t.getBoundingClientRect(); return { text: t.textContent, box: { x: r.x, y: r.y, w: r.width, h: r.height } }; })()`);
				if ((onButton.buttons[0]?.opacity ?? 0) < 0.5) {
					// When the bar did not stay, record what is under the pointer and where the hover chain ends, to tell the app's fault from a real mouse crossing the window.
					const why = await app.evaluate<unknown>(`(() => {
						const x = ${first.box.x + first.box.w / 2}, y = ${first.box.y + first.box.h / 2};
						const at = document.elementFromPoint(x, y);
						const chain = [...document.querySelectorAll(':hover')];
						let deep = null; for (const e of chain) if (!deep || deep.contains(e)) deep = e;
						const chip = document.querySelectorAll('[data-ly-file-link]')[${pick.index}];
						return { at: at ? at.outerHTML.slice(0, 120) : null, deepest: deep ? deep.outerHTML.slice(0, 120) : null, chipHover: chip.matches(':hover'), side: chip.dataset.lyFileActionsSide, x: chip.style.getPropertyValue('--ly-file-actions-x') };
					})()`);
					console.log(`           没留住，现场：${JSON.stringify(why)}`);
				}
				const hits = (a: Box, b: Box | null) => Boolean(b) && a.x < b!.x + b!.w && b!.x < a.x + a.w && a.y < b!.y + b!.h && b!.y < a.y + a.h;
				console.log(
					`           指针停在按钮1上：按钮仍可见 ${onButton.buttons[0]?.opacity}，提示「${tip?.text ?? "没出来"}」` +
						(tip ? `，在按钮${tip.box.y + tip.box.h <= onButton.buttons[0]!.box.y + 0.5 ? "上方" : "下方"}，压住标签：${hits(tip.box, onButton.chip) ? "是" : "否"}，压住浮条：${hits(tip.box, onButton.bar) ? "是" : "否"}` : ""),
				);
				if (pick.key === "短文件名" || pick.key === "长文件名-消息首行") await shot(`${TAG}-${schemeName}-${pick.key}-按钮提示.png`, around(onButton));
			}
			await moveAway();
			await pause(400);
			if (pick.key === "短文件名") await shot(`${TAG}-${schemeName}-${pick.key}-静止.png`, around(rest));
		}
		if (scheme === "dark") return;

		// Frame by frame: hover in, wait, leave. Read the bar's opacity and position on every frame while capturing, then assemble a video on real time.
		{
			await app.evaluate(`document.querySelectorAll('[data-ly-file-link]')[2].scrollIntoView({ block: 'center' })`);
			await moveAway();
			await pause(600);
			const base = await measure(2);
			await app.evaluate(`(() => {
				const chip = document.querySelectorAll('[data-ly-file-link]')[2];
				const button = chip.querySelector('button');
				const card = chip.querySelector('[data-ly-file-actions-bar]') || button;
				window.__frames = [];
				const t0 = performance.now();
				const tick = () => {
					let o = 1;
					for (let n = button; n && n !== chip; n = n.parentElement) o *= +getComputedStyle(n).opacity;
					const r = card.getBoundingClientRect();
					window.__frames.push({ t: Math.round(performance.now() - t0), o: +o.toFixed(3), vis: getComputedStyle(button).visibility, y: +r.y.toFixed(1), chipW: +chip.getBoundingClientRect().width.toFixed(1), hover: chip.matches(':hover') });
					if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			})()`);
			const target = base.text ?? base.name;
			const film: Frame[] = [];
			const grab = async (until: number) => {
				while (Date.now() < until) {
					const { data } = await grabber.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 92 });
					film.push({ at: Date.now(), data: Buffer.from(data, "base64") });
				}
			};
			await grab(Date.now() + 150);
			await grabber.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x + target.w * 0.3, y: target.y + target.h / 2 });
			await grab(Date.now() + 650);
			const spot = await app.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('.prose-dw').getBoundingClientRect(); return { x: Math.min(innerWidth - 8, r.right + 40), y: Math.min(innerHeight - 140, r.top + 10) }; })()`);
			await grabber.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...spot });
			await grab(Date.now() + 650);
			const log = await app.evaluate<{ t: number; o: number; vis: string; y: number; chipW: number; hover: boolean }[]>(`window.__frames`);
			const changes = log.filter((f, i) => i === 0 || f.o !== log[i - 1]!.o || f.vis !== log[i - 1]!.vis || f.y !== log[i - 1]!.y || f.chipW !== log[i - 1]!.chipW || f.hover !== log[i - 1]!.hover);
			console.log("\n▸ 逐帧（只列有变化的帧）：t(ms)  悬停  按钮1 有效不透明度  visibility  浮条 / 按钮 y  胶囊宽");
			for (const f of changes) console.log(`   ${String(f.t).padStart(5)}  ${f.hover ? "是" : "否"}  ${f.o.toFixed(2)}  ${f.vis.padEnd(7)}  ${f.y}  ${f.chipW}`);
			report.frames = log;
			const clip = around(base);
			const dir = join(OUT, `${TAG}-过渡帧`);
			await mkdir(dir, { recursive: true });
			const cropped: Frame[] = [];
			for (const [i, frame] of film.entries()) {
				const file = join(dir, `${String(i).padStart(2, "0")}-${frame.at - film[0]!.at}ms.png`);
				await crop(frame.data, clip, file);
				cropped.push({ at: frame.at, data: await readFile(file) });
			}
			await encode(cropped, join(OUT, `${TAG}-悬停过渡.mp4`), 30);
			console.log(`   连拍 ${film.length} 帧，已合成 ${TAG}-悬停过渡.mp4`);
		}

		/*
		 * Reaching the bar from where the pointer came in. Two routes, with the mouse events sent over
		 * the long-lived connection: a new WebSocket per step is slow enough that it measures the
		 * connection, not a hand.
		 *
		 *   Straight up: rest in the middle of a long filename, then move straight up onto a button once
		 *   the bar shows — the common case.
		 *   Read, then press: come in at the left end, read along the name to the right end, then go
		 *   back diagonally for the bar. The bar stays where the pointer came in, so most of this trip is
		 *   off the chip and only the grace period on leaving holds the bar.
		 */
		const longIndex = all.findIndex((s, i) => i > 0 && s.nameFull > s.name.w + 0.5);
		const route = async (name: string, enterAt: number, readTo: number | null, ms: number) => {
			await app.evaluate(`document.querySelectorAll('[data-ly-file-link]')[${longIndex}].scrollIntoView({ block: 'center' })`);
			await moveAway();
			await pause(500);
			const start = await measure(longIndex);
			const y = start.chip.y + start.chip.h / 2;
			let from = { x: start.chip.x + start.chip.w * enterAt, y };
			await grabber.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
			await pause(400);
			if (readTo !== null) {
				const to = { x: start.chip.x + start.chip.w * readTo, y };
				for (let i = 1; i <= 8; i++) {
					await grabber.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + ((to.x - from.x) * i) / 8, y });
					await pause(16);
				}
				from = to;
				await pause(200);
			}
			const shown = await measure(longIndex);
			const button = shown.buttons[0]!;
			const to = { x: button.box.x + button.box.w / 2, y: button.box.y + button.box.h / 2 };
			await app.evaluate(`(() => {
				const chip = document.querySelectorAll('[data-ly-file-link]')[${longIndex}];
				const button = chip.querySelector('button');
				window.__diag = { min: 1, lost: 0, detached: 0, strays: [] };
				const t0 = performance.now();
				const tick = () => {
					let o = 1;
					for (let n = button; n && n !== chip; n = n.parentElement) o *= +getComputedStyle(n).opacity;
					if (o < window.__diag.min) window.__diag.min = o;
					if (!chip.isConnected) window.__diag.detached++;
					if (!chip.matches(':hover')) {
						window.__diag.lost++;
						const chain = [...document.querySelectorAll(':hover')];
						let deep = null; for (const e of chain) if (!deep || deep.contains(e)) deep = e;
						const r = deep ? deep.getBoundingClientRect() : null;
						const tag = deep ? deep.tagName + (deep.className && deep.className.baseVal === undefined ? '.' + String(deep.className).split(' ')[0] : '') + (r ? '@' + Math.round(r.x) + ',' + Math.round(r.y) : '') : 'nothing';
						if (window.__diag.strays[window.__diag.strays.length - 1] !== tag) window.__diag.strays.push(tag);
					}
					if (performance.now() - t0 < ${ms + 500}) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			})()`);
			const steps = Math.max(4, Math.round(ms / 16));
			const t0 = Date.now();
			for (let i = 1; i <= steps; i++) {
				// Fast, then slow: a hand going for a small target covers the first half quickly and aims in the second.
				const k = 1 - (1 - i / steps) ** 2;
				await grabber.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
				const due = t0 + (ms * i) / steps;
				if (due > Date.now()) await pause(due - Date.now());
			}
			const took = Date.now() - t0;
			await pause(450);
			const landed = await measure(longIndex);
			const diag = await app.evaluate<{ min: number; lost: number; detached: number; strays: string[] }>(`window.__diag`);
			const distance = Math.hypot(to.x - from.x, to.y - from.y);
			console.log(
				`\n▸ ${name}：第 ${longIndex} 枚（${start.chip.w}px 宽），浮条在胶囊左边 +${(shown.bar!.x - shown.chip.x).toFixed(0)}px 处；指针走 ${distance.toFixed(0)}px 用了 ${took}ms，` +
					`途中 ${diag.lost} 帧不在胶囊上，按钮1 最低有效不透明度 ${diag.min.toFixed(2)}；落定后按钮1 不透明度 ${landed.buttons[0]?.opacity}、按得到：${landed.buttons[0]?.hit ? "是" : "否"}`,
			);
			if ((landed.buttons[0]?.opacity ?? 0) < 0.5) console.log(`           没留住，现场：节点脱离文档 ${diag.detached} 帧；不在胶囊上时悬停落在 ${diag.strays.slice(0, 6).join(" → ")}`);
			report[`route/${name}`] = { from, to, took, diag, landed };
			await moveAway();
			await pause(400);
		};
		await route("直上", 0.5, null, 120);
		await route("先读再点-快", 0.04, 0.96, 250);
		await route("先读再点-慢", 0.04, 0.96, 450);

		// A quick sweep: the pointer crosses a chip in under 50ms, and the bar should not appear.
		{
			await app.evaluate(`document.querySelectorAll('[data-ly-file-link]')[2].scrollIntoView({ block: 'center' })`);
			await moveAway();
			await pause(500);
			const chip = await measure(2);
			await app.evaluate(`(() => {
				const chip = document.querySelectorAll('[data-ly-file-link]')[2];
				const button = chip.querySelector('button');
				window.__sweep = 0;
				const t0 = performance.now();
				const tick = () => {
					let o = 1;
					for (let n = button; n && n !== chip; n = n.parentElement) o *= +getComputedStyle(n).opacity;
					if (o > window.__sweep) window.__sweep = o;
					if (performance.now() - t0 < 600) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			})()`);
			const y = chip.chip.y + chip.chip.h / 2;
			for (const x of [chip.chip.x - 20, chip.chip.x + chip.chip.w * 0.3, chip.chip.x + chip.chip.w * 0.7, chip.chip.x + chip.chip.w + 20]) {
				await grabber.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
				await pause(12);
			}
			await moveTo(chip.chip.x + chip.chip.w + 20, y + 60);
			await pause(600);
			const peak = await app.evaluate<number>(`window.__sweep`);
			console.log(`\n▸ 快速扫过「${chip.label}」：按钮1 最高有效不透明度 ${peak.toFixed(2)}${peak < 0.05 ? "（没冒出来）" : "（冒出来了）"}`);
			report.sweep = peak;
		}

		// Pressing the link focuses it, and the bar must not jump away from above the pointer because of it. Press, move away, then release, so no panel actually opens.
		{
			await app.evaluate(`document.querySelectorAll('[data-ly-file-link]')[6].scrollIntoView({ block: 'center' })`);
			await moveAway();
			await pause(500);
			const rest = await measure(6);
			const target = { x: rest.chip.x + rest.chip.w * 0.3, y: rest.chip.y + rest.chip.h / 2 };
			await grabber.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
			await pause(420);
			const before = await measure(6);
			await grabber.send("Input.dispatchMouseEvent", { type: "mousePressed", ...target, button: "left", clickCount: 1 });
			await pause(250);
			const pressed = await measure(6);
			const focused = await app.evaluate<boolean>(`document.activeElement === document.querySelectorAll('[data-ly-file-link]')[6].querySelector('a')`);
			const away = await app.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('.prose-dw').getBoundingClientRect(); return { x: Math.min(innerWidth - 8, r.right + 40), y: Math.min(innerHeight - 140, r.top + 10) }; })()`);
			await grabber.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...away, buttons: 1 });
			await grabber.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...away, button: "left", clickCount: 1 });
			await app.evaluate(`document.activeElement && document.activeElement.blur()`);
			const moved = before.bar && pressed.bar ? +(pressed.bar.x - before.bar.x).toFixed(1) : NaN;
			console.log(`\n▸ 鼠标按下链接：链接拿到焦点 ${focused ? "是" : "否"}；浮条横向挪了 ${moved}px（按下前在胶囊左边 +${before.bar ? (before.bar.x - before.chip.x).toFixed(0) : "?"}px）`);
			report.press = { focused, moved };
			await pause(400);
		}

		// Keyboard: focus the link, Tab into the two buttons in the bar, then Tab once more to leave.
		{
			await moveAway();
			await app.evaluate(`document.querySelectorAll('[data-ly-file-link]')[2].scrollIntoView({ block: 'center' })`);
			await pause(300);
			await app.evaluate(`document.querySelectorAll('[data-ly-file-link]')[2].querySelector('a').focus({ focusVisible: true })`);
			await pause(200);
			const tab = async () => {
				await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
				await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
				await pause(200);
				return app.evaluate<{ label: string | null; visible: boolean; inChip: boolean }>(`(() => {
					const chip = document.querySelectorAll('[data-ly-file-link]')[2];
					const el = document.activeElement;
					const button = chip.querySelector('button');
					let o = 1;
					for (let n = button; n && n !== chip; n = n.parentElement) o *= +getComputedStyle(n).opacity;
					return { label: el ? (el.getAttribute('aria-label') || el.textContent.slice(0, 20)) : null, visible: getComputedStyle(button).visibility === 'visible' && o > 0.95, inChip: chip.contains(el) };
				})()`);
			};
			const onLink = await measure(2);
			await shot(`${TAG}-浅色-键盘聚焦链接.png`, around(onLink));
			const first = await tab();
			if (first.inChip) await shot(`${TAG}-浅色-键盘Tab到按钮.png`, around(await measure(2)));
			const second = await tab();
			const third = await tab();
			console.log(
				`\n▸ 键盘：焦点在链接上时按钮1 有效不透明度 ${onLink.buttons[0]?.opacity}；Tab →「${first.label}」（出口看得见：${first.visible ? "是" : "否"}）；Tab →「${second.label}」（看得见：${second.visible ? "是" : "否"}）；Tab → 离开标签（${third.inChip ? "还在标签里" : "已离开"}，看得见：${third.visible ? "是" : "否"}）`,
			);
			report.tab = { onLink: onLink.buttons[0]?.opacity, first, second, third };
			await app.evaluate(`document.activeElement && document.activeElement.blur()`);
		}

		// The link a remote picture becomes in a conversation (the image fallback in Markdown.tsx, which also carries an ExternalLink).
		{
			const box = await app.evaluate<Box | null>(`(() => { const el = document.querySelector('.ly-md-image-link'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const p = el.closest('p').getBoundingClientRect(); return { x: p.x, y: p.y, w: p.width, h: p.height }; })()`);
			if (box) {
				await pause(300);
				const icon = await app.evaluate<{ icon: number; font: number }>(`(() => { const el = document.querySelector('.ly-md-image-link'); return { icon: el.querySelector('svg').getBoundingClientRect().width, font: parseFloat(getComputedStyle(el).fontSize) }; })()`);
				console.log(`\n▸ 远程图片链接：图标 ${icon.icon}px，字号 ${icon.font}px`);
				const p = await app.evaluate<Box>(`(() => { const r = document.querySelector('.ly-md-image-link').closest('p').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
				await shot(`${TAG}-浅色-远程图片链接.png`, { x: p.x - 16, y: p.y - 16, w: p.w + 32, h: p.h + 32 });
			}
		}

		/*
		 * A device without hover: are the exits still there?
		 *
		 * This Chromium cannot be made to match (hover: none) over CDP — media emulation, touch emulation
		 * and a reload were all tried, and matchMedia stayed false. So the question is asked another way:
		 * the stylesheet's block for such devices (the @media (hover: none) that mentions
		 * data-ly-file-actions) is switched to all as written, and what it actually paints is measured.
		 * Whether the media query matches is the browser's business; what needs checking is whether those
		 * rules paint the right thing once it does.
		 */
		const flipped = await app.evaluate<number>(`(() => {
			let n = 0;
			for (const sheet of document.styleSheets) {
				let rules;
				try { rules = sheet.cssRules; } catch { continue; }
				for (const rule of rules) {
					if (rule instanceof CSSMediaRule && rule.conditionText.includes('hover: none') && rule.cssText.includes('data-ly-file-actions')) {
						rule.media.mediaText = 'all';
						window.__touchRule = rule;
						n++;
					}
				}
			}
			return n;
		})()`);
		await moveAway();
		await app.evaluate(`document.querySelectorAll('[data-ly-file-link]')[2].scrollIntoView({ block: 'center' })`);
		await pause(500);
		console.log(`\n▸ 无悬停设备（样式表里找到 ${flipped} 段写给它的规则，已按匹配处理），指针不在上面：`);
		for (const index of [0, 2, 3]) {
			const touch = await measure(index);
			console.log(describe(touch, "触屏"));
			report[`touch/${index}`] = touch;
			if (index === 2) {
				await shot(`${TAG}-浅色-无悬停设备.png`, around(touch));
				const lines = await app.evaluate<{ withChip: number; plain: number }>(`(() => {
					const ps = [...document.querySelectorAll('.prose-dw p')];
					const one = (p) => { const r = document.createRange(); r.selectNodeContents(p); const rects = [...r.getClientRects()]; const tops = [...new Set(rects.map((x) => Math.round(x.top)))].sort((a, b) => a - b); return tops.length > 1 ? tops[1] - tops[0] : 0; };
					const withChip = ps.find((p) => p.querySelector('[data-ly-file-link]') && p.textContent.includes('README.md'));
					const plain = ps.find((p) => !p.querySelector('[data-ly-file-link]') && p.textContent.length > 10);
					return { withChip: withChip ? withChip.getBoundingClientRect().height : -1, plain: plain ? parseFloat(getComputedStyle(plain).lineHeight) : -1 };
				})()`);
				console.log(`           带标签那段高 ${lines.withChip.toFixed(1)}px，普通段落行高 ${lines.plain}px`);
			}
		}
		await app.evaluate(`window.__touchRule && (window.__touchRule.media.mediaText = '(hover: none)')`);
	} finally {
		grabber.close();
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
