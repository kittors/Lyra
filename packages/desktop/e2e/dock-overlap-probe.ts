/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * The overhang, in a real window.
 *
 * `fitSizes` gives the first pane in a cramped row a box smaller than the pane may be drawn, and a
 * `min-width` draws it at its floor anyway — so it extends past its box and the pane beside it
 * covers the overhang. Only the browser can be asked whether that actually happened: the unit tests
 * see the boxes, and the whole point is that the drawn width is *not* the box.
 *
 * Which is also the thing to check rather than the geometry. If the conversation were merely made
 * narrow, its text would reflow into a column two words wide; what should happen is that it stays
 * laid out at 420 and has its right-hand side covered. Those two look similar in a screenshot and
 * are completely different to read, and the difference is measurable: the drawn width.
 *
 * Run: node --experimental-strip-types e2e/dock-overlap-probe.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9474;
const OUT = join(import.meta.dirname, "..", "..", "..", "test-results", "dock-overlap");

/*
 * A window whose dock is too narrow for three columns.
 *
 * The sidebar takes about 272, so 1080 leaves the dock near 800 — the reported width, where
 * 420 + 300 + 300 does not fit. Tall enough that the old code would have found a "fit" by rotating
 * the row, so a pass here is also the rotation not happening.
 */
const WINDOW = { width: 1080, height: 800 };

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
	// Park the pointer first: a screenshot catches whatever is hovered, and that is a picture of
	// the probe rather than of the layout.
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 8, y: 8, button: "none" });
	await pause(140);
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
};

async function press(key: string, code: string, keyCode: number, modifiers: number): Promise<void> {
	const base = { modifiers, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
	await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
const META = 4;

interface Pane {
	kind: string;
	/** What the tree asked for, off the inline style — the *box*. */
	boxWidth: number;
	/** What the browser drew, after `min-width` had its say. */
	drawn: number;
	left: number;
	right: number;
	top: number;
	height: number;
	/** How wide the text inside is actually laid out, which is what reflow would change. */
	content: number;
}

/*
 * Box versus drawn, for every pane.
 *
 * No backticks in here: the string is interpolated into a template literal on the way to the
 * debugger, so a backtick would end it early.
 */
const READ = `(() => {
	const host = document.querySelector('[data-dock-panes]');
	if (!host) return 'no dock';
	const box = host.getBoundingClientRect();
	const panes = [...document.querySelectorAll('[data-dock-pane]')]
		.filter((el) => el.getAttribute('aria-hidden') !== 'true' && getComputedStyle(el).opacity !== '0')
		.map((el) => {
			const r = el.getBoundingClientRect();
			// The inline style is the share the tree asked for; the rect is what min-width produced.
			const declared = parseFloat(getComputedStyle(el).getPropertyValue('width'));
			const styleWidth = el.style.width;
			const asked = styleWidth.endsWith('%') ? (parseFloat(styleWidth) / 100) * box.width : declared;
			// Something with a width of its own inside the pane, to see whether the text reflowed.
			const inner = el.querySelector('.ly-dock-card') || el.firstElementChild;
			return {
				kind: el.getAttribute('data-dock-pane'),
				boxWidth: Math.round(asked),
				drawn: Math.round(r.width),
				left: Math.round(r.left - box.left),
				right: Math.round(r.right - box.left),
				top: Math.round(r.top - box.top),
				height: Math.round(r.height),
				content: inner ? Math.round(inner.getBoundingClientRect().width) : 0,
			};
		})
		.filter((p) => p.drawn > 0 && p.height > 0);
	return {
		dock: { width: Math.round(box.width), height: Math.round(box.height) },
		panes,
		fullWidth: panes.filter((p) => p.drawn >= Math.round(box.width) - 2).map((p) => p.kind),
	};
})()`;

interface Snapshot {
	dock: { width: number; height: number };
	panes: Pane[];
	fullWidth: string[];
}

const read = () => app.evaluate<Snapshot | string>(READ);

const show = (snap: Snapshot | string): string =>
	typeof snap === "string"
		? snap
		: snap.panes
				.map((p) => `${p.kind} box${p.boxWidth}/画${p.drawn} @${p.left}-${p.right} 高${p.height}`)
				.join(" | ");

const paneOf = (snap: Snapshot | string, kind: string): Pane | null =>
	typeof snap === "string" ? null : (snap.panes.find((p) => p.kind === kind) ?? null);

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
	console.log(`${ok ? "  ✔" : "  ✖"} ${what}`);
	if (!ok) failures.push(what);
};

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

	const start = await read();
	if (typeof start === "string") throw new Error(`读不到停靠面板：${start}`);
	console.log(`\ndock ${start.dock.width}x${start.dock.height}`);

	// The conversation alone, as the baseline for "did the text reflow".
	console.log("只有会话时:", show(start));

	console.log("\n[1] 开三个面板（⌘J 任务、⌘T 浏览器、⌘P 文件）");
	await press("j", "KeyJ", 74, META);
	await pause(900);
	await press("t", "KeyT", 84, META);
	await pause(900);
	await press("p", "KeyP", 80, META);
	await pause(1_300);
	await shot("01-three-panels");

	const three = await read();
	console.log("   ", show(three));
	if (typeof three === "string") throw new Error(three);

	const conversation = paneOf(three, "conversation");
	if (!conversation) throw new Error("找不到会话");

	// ── The row kept its shape ────────────────────────────────────────────────────────────────
	check(three.fullWidth.length === 0, `没有面板被拍成整宽的条（整宽的：${three.fullWidth.join(",") || "无"}）`);
	const panels = three.panes.filter((p) => p.kind !== "conversation");
	check(
		panels.every((p) => Math.abs(p.height - start.dock.height) < 4 || p.height >= start.dock.height / 2 - 4),
		`面板都是整列或半列，不是一叠窄条（高度：${panels.map((p) => p.height).join(",")}）`,
	);
	check(
		panels.every((p) => p.drawn >= 296),
		`每个面板都守住了 300 的地板（宽度：${panels.map((p) => p.drawn).join(",")}）`,
	);

	// ── The overhang: box smaller than drawn ─────────────────────────────────────────────────
	console.log("\n[2] 会话：box 被压小，但画出来仍是地板宽");
	check(
		conversation.boxWidth < 420 - 4,
		`它的 box 确实被压到了地板以下（box ${conversation.boxWidth}）`,
	);
	check(
		Math.abs(conversation.drawn - 420) < 4,
		`但画出来是 420 —— min-width 生效了（画 ${conversation.drawn}）`,
	);
	check(
		conversation.drawn > conversation.boxWidth + 4,
		`所以它伸出了自己的格子 ${conversation.drawn - conversation.boxWidth}px`,
	);

	// ── The text did not reflow ──────────────────────────────────────────────────────────────
	console.log("\n[3] 会话的内容没有重排 —— 这是「被盖住」和「被压窄」的分水岭");
	check(
		conversation.content > conversation.boxWidth + 4,
		`内容比 box 宽 ${conversation.content - conversation.boxWidth}px，说明没有缩进去重排`,
	);

	// ── And the next pane covers it ──────────────────────────────────────────────────────────
	console.log("\n[4] 右边的面板盖住了会话伸出来的那一截");
	const next = panels.sort((a, b) => a.left - b.left)[0];
	check(
		Boolean(next && next.left < conversation.right - 4),
		`${next?.kind} 从 ${next?.left} 开始，而会话画到 ${conversation.right} —— 重叠了 ${conversation.right - (next?.left ?? 0)}px`,
	);
	const covered = conversation.drawn - conversation.boxWidth;
	const overflow = 420 + 300 * 2 - start.dock.width;
	check(Math.abs(covered - overflow) < 6, `盖住的宽度就是溢出的宽度（盖 ${covered}，溢出 ${overflow}）`);

	// ── Widening gives it back ───────────────────────────────────────────────────────────────
	console.log("\n[5] 拉宽窗口 → 不再重叠；缩回去 → 又重叠（纯派生，没写存储）");
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1700, height: 820, deviceScaleFactor: 1, mobile: false });
	await pause(1_400);
	await shot("02-widened");
	const wide = await read();
	console.log("    拉宽:", show(wide));
	const wideConv = paneOf(wide, "conversation");
	check(
		Boolean(wideConv && wideConv.drawn <= wideConv.boxWidth + 4),
		`宽了以后会话不再伸出格子（box ${wideConv?.boxWidth}，画 ${wideConv?.drawn}）`,
	);

	await app.send("Emulation.setDeviceMetricsOverride", { width: WINDOW.width, height: WINDOW.height, deviceScaleFactor: 1, mobile: false });
	await pause(1_400);
	await shot("03-narrow-again");
	const narrow = await read();
	const narrowConv = paneOf(narrow, "conversation");
	check(
		Boolean(narrowConv && narrowConv.drawn > narrowConv.boxWidth + 4),
		`缩回去又伸出来了（box ${narrowConv?.boxWidth}，画 ${narrowConv?.drawn}）`,
	);
	await app.send("Emulation.clearDeviceMetricsOverride");
	await pause(900);

	// ── A reload changes nothing, because nothing about this is stored ───────────────────────
	console.log("\n[6] 重新加载：布局照旧（重叠是算出来的，不是存下来的）");
	await app.evaluate("location.reload()");
	await pause(5_000);
	await shot("04-after-reload");
	const back = await read();
	console.log("   ", show(back));
	const backConv = paneOf(back, "conversation");
	check(
		Boolean(backConv && Math.abs(backConv.drawn - 420) < 4),
		`会话还是画成 420（画 ${backConv?.drawn}）`,
	);
	check(
		typeof back !== "string" && back.fullWidth.length === 0,
		"而且仍然没有整宽的条",
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
