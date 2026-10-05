/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * The look and the streaming taken over from wJiaaa/Lyra, measured against the build before them.
 *
 * Run it twice with the same output directory: once from a checkout of the old commit with the label
 * `before`, once here with `after`. Both runs take the same screenshots and record the same streamed
 * reply; the `after` run reads the `before` numbers back and puts the two side by side, so the claim
 * "the reply streams more evenly" is a pair of measurements rather than an impression.
 *
 * The model is a local server that streams like a real one: a few characters at a time, about 150 a
 * second, through a thinking block, two tool calls and a long Markdown answer with bold, inline code,
 * a link, a list, a table and a code block — every shape a half-written stream can draw wrong.
 *
 * Measured per painted frame, in the page:
 *   - how often the answer's visible text got *shorter* (a half-written `**bold` or code fence redrawn),
 *   - whether new characters fade in (`.ly-fade-char`),
 *   - how far the transcript moved per frame while following the bottom.
 *
 * Usage: node --experimental-strip-types e2e/fork-ui-compare.ts <before|after> [outDir]
 * THEME=dark takes the screenshots only, on a dark profile.
 *
 * Shot with the macOS material off. A page screenshot or screencast frame has no window behind it:
 * the translucent sidebar comes out on white in a PNG and on black in the video, neither of which
 * is what the screen shows. The material is checked instead, by turning the switch in Appearance
 * on and off.
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const LABEL = process.argv[2] === "before" ? "before" : "after";
const OUT_DIR = process.argv[3] ?? join(homedir(), "Desktop", "Lyra界面移植测试");
const THEME = process.env.THEME === "dark" ? "dark" : "light";
const SHOTS_ONLY = THEME === "dark";
const PORT = 9893;
const MODEL_PORT = 9993;
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

const ANSWER = [
	"## 改动概览\n\n",
	"这一轮把 **配置读取** 拆成了两步：先读 `settings.json`，再按项目覆盖。改动集中在 `src/one.ts`，",
	"其余文件只是跟着改了导入路径。详细的约定见 [配置分层说明](https://example.com/layers)。\n\n",
	"### 为什么要拆\n\n",
	"- 原来一次读完，项目里的覆盖项会被 **全局设置** 盖掉；\n",
	"- 改完之后，项目的 `.lyra/config.json` 总是最后生效；\n",
	"- 读失败时保留上一次读到的值，而不是退回默认值。\n\n",
	"### 新的读取顺序\n\n",
	"```ts\n",
	"export async function loadSettings(project: string): Promise<Settings> {\n",
	"\tconst global = await readJson(join(home, \"settings.json\"));\n",
	"\tconst local = await readJson(join(project, \".lyra\", \"config.json\"));\n",
	"\t// 项目里的覆盖项最后合并，所以总是它说了算。\n",
	"\tconst merged = { ...DEFAULTS, ...global, ...local };\n",
	"\tif (!merged.providers?.length) {\n",
	"\t\tthrow new Error(\"没有可用的服务商\");\n",
	"\t}\n",
	"\tfor (const provider of merged.providers) {\n",
	"\t\tprovider.baseUrl = provider.baseUrl.replace(/\\/+$/, \"\");\n",
	"\t\tprovider.models = provider.models.filter((model) => model.enabled !== false);\n",
	"\t}\n",
	"\treturn freeze(merged);\n",
	"}\n",
	"```\n\n",
	"### 对比\n\n",
	"| 场景 | 之前 | 现在 |\n",
	"| --- | --- | --- |\n",
	"| 项目覆盖了审批模式 | 被全局设置盖掉 | 项目说了算 |\n",
	"| 设置文件写到一半 | 退回默认值 | 保留上一次的值 |\n",
	"| 服务商地址带斜杠 | 请求 404 | 自动去掉末尾斜杠 |\n\n",
	"最后跑了一遍 `pnpm test`，**全部通过**。如果你希望保留旧的读取顺序，可以在设置里把 `layered` 关掉。",
].join("");

type Step = { thinking: string } | { tool: string; args: Record<string, unknown> } | { text: string };
const SCRIPT: Step[][] = [
	[
		{ thinking: "先读一下配置读取的入口，再搜一下哪些地方直接读了 settings.json，确认改动范围。" },
		{ tool: "read", args: { path: "src/one.ts" } },
		{ tool: "grep", args: { pattern: "settings" } },
	],
	[{ text: ANSWER }],
];

function sse(res: ServerResponse, payload: Record<string, unknown>): void {
	res.write(`event: ${String(payload.type)}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** A few characters at a time, about 150 a second — the cadence a fast model streams at. */
async function trickle(res: ServerResponse, index: number, kind: "text" | "thinking", text: string): Promise<void> {
	const chars = Array.from(text);
	for (let at = 0; at < chars.length; ) {
		const size = 2 + Math.floor(Math.random() * 4);
		const piece = chars.slice(at, at + size).join("");
		at += size;
		sse(res, {
			type: "content_block_delta",
			index,
			delta: kind === "text" ? { type: "text_delta", text: piece } : { type: "thinking_delta", thinking: piece },
		});
		await pause(25);
	}
}

function startModel(): Server {
	let request = 0;
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", async () => {
			// The title request carries no tools; answering it from the script would eat a step.
			const titling = !body.includes('"tools"');
			const steps: Step[] = titling ? [{ text: "配置读取拆成两步" }] : SCRIPT[Math.min(request, SCRIPT.length - 1)];
			if (!titling) request++;
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			sse(res, { type: "message_start", message: { id: `msg_${request}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
			for (const [index, step] of steps.entries()) {
				await pause(titling ? 0 : 400);
				if ("text" in step) {
					sse(res, { type: "content_block_start", index, content_block: { type: "text", text: "" } });
					if (titling) sse(res, { type: "content_block_delta", index, delta: { type: "text_delta", text: step.text } });
					else await trickle(res, index, "text", step.text);
				} else if ("thinking" in step) {
					sse(res, { type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } });
					await trickle(res, index, "thinking", step.thinking);
					sse(res, { type: "content_block_delta", index, delta: { type: "signature_delta", signature: "sig" } });
				} else {
					sse(res, { type: "content_block_start", index, content_block: { type: "tool_use", id: `call_${request}_${index}`, name: step.tool, input: {} } });
					sse(res, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(step.args) } });
				}
				sse(res, { type: "content_block_stop", index });
			}
			const stop = steps.some((step) => "tool" in step) ? "tool_use" : "end_turn";
			sse(res, { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 400 } });
			sse(res, { type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "lyra-demo");
	const notes = join(home, "notes");
	await mkdir(join(project, "src"), { recursive: true });
	await mkdir(notes, { recursive: true });
	await writeFile(join(project, "src", "one.ts"), "export const one = 1\nexport function loadSettings() {\n\treturn readJson(\"settings.json\");\n}\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1,
		providers: [{
			id: "local", name: "Local", baseUrl: `http://127.0.0.1:${MODEL_PORT}`, api: "anthropic-messages", apiKey: "not-a-key", enabled: true,
			models: [{ id: "local/scripted", providerId: "local", modelId: "scripted", name: "Scripted", contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: true, supportsImages: false, supportsTools: true }],
		}],
		mcpServers: [],
		projects: [
			{ id: "demo", name: "lyra-demo", path: project, pinned: false, lastOpenedAt: 2 },
			{ id: "notes", name: "notes", path: notes, pinned: false, lastOpenedAt: 1 },
		],
		defaultModelId: "local/scripted",
		permissionMode: "full",
		thinking: "off",
		retryAttempts: 1,
		hooks: [],
		scheduledTasks: [],
		disabledPlugins: [],
		alwaysAllow: [],
		appearance: { theme: THEME, vibrancy: false },
	}));
}

/** Installed before the reply starts; reads the page once per painted frame until told to stop. */
const WATCH = `(() => {
	const m = { frames: 0, lens: [], drops: 0, maxDrop: 0, fadeFrames: 0, maxFade: 0, steps: [], stop: false };
	window.__cmp = m;
	let lastLen = 0;
	let lastTop = null;
	const answer = () => [...document.querySelectorAll('[data-dock-pane="conversation"] .prose-dw')]
		.filter((el) => !el.closest(".ly-user-bubble") && !el.closest("[data-ly-turn-process]") && el.checkVisibility());
	function tick() {
		if (m.stop) return;
		m.frames++;
		const len = answer().reduce((n, el) => n + el.innerText.length, 0);
		if (len < lastLen) { m.drops++; m.maxDrop = Math.max(m.maxDrop, lastLen - len); }
		if (len !== lastLen) m.lens.push(len);
		lastLen = len;
		const fading = document.querySelectorAll('[data-dock-pane="conversation"] .ly-fade-char').length;
		if (fading > 0) m.fadeFrames++;
		m.maxFade = Math.max(m.maxFade, fading);
		const scroller = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view');
		if (scroller) {
			const top = scroller.scrollTop;
			if (lastTop !== null && top > lastTop) m.steps.push(Math.round((top - lastTop) * 10) / 10);
			lastTop = top;
		}
		requestAnimationFrame(tick);
	}
	requestAnimationFrame(tick);
	return true;
})()`;

type Metrics = { frames: number; updates: number; drops: number; maxDrop: number; fadeFrames: number; maxFade: number; moves: number; p50: number; p90: number; maxStep: number; bigSteps: number };

function summarise(raw: { frames: number; lens: number[]; drops: number; maxDrop: number; fadeFrames: number; maxFade: number; steps: number[] }): Metrics {
	const steps = [...raw.steps].sort((a, b) => a - b);
	const at = (q: number) => (steps.length ? steps[Math.min(steps.length - 1, Math.floor(q * steps.length))] : 0);
	return {
		frames: raw.frames,
		updates: raw.lens.length,
		drops: raw.drops,
		maxDrop: raw.maxDrop,
		fadeFrames: raw.fadeFrames,
		maxFade: raw.maxFade,
		moves: steps.length,
		p50: at(0.5),
		p90: at(0.9),
		maxStep: steps.length ? steps[steps.length - 1] : 0,
		// A jump of a whole line or more in one frame is what reads as 「一行一顿」.
		bigSteps: steps.filter((step) => step >= 18).length,
	};
}

const checks: { ok: boolean; what: string }[] = [];
function check(what: string, ok: boolean, saw: unknown) {
	checks.push({ ok, what });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${JSON.stringify(saw)}`}`);
}

let app: RunningApp | undefined;
const model = startModel();
const frames: Frame[] = [];
let shot = 0;

try {
	await mkdir(OUT_DIR, { recursive: true });
	app = await startApp({ port: PORT, seed });
	const d = driver(app);
	const capture = async (name: string) => {
		const { data } = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		await writeFile(join(OUT_DIR, `${STAMP}_${LABEL}_${THEME}_${String(++shot).padStart(2, "0")}_${name}.png`), Buffer.from(data, "base64"));
	};
	const read = <T>(expression: string) => app!.evaluate<T>(expression);

	await d.until(`document.querySelector("main textarea")`, 60000);
	await pause(1500);
	await capture("欢迎页");

	if (LABEL === "after" && !SHOTS_ONLY) {
		const look = await read<Record<string, string | number | boolean>>(`(() => {
			const root = getComputedStyle(document.documentElement);
			const body = getComputedStyle(document.body);
			const composer = document.querySelector("main .ly-composer");
			const field = document.querySelector("main textarea");
			const send = [...document.querySelectorAll("main button")].find((b) => b.className.includes("ly-composer-icon") && b.className.includes("bg-ink"));
			const heading = document.querySelector('[data-ly-chat-surface="empty"] h1');
			return {
				ink: root.getPropertyValue("--color-ink").trim().toLowerCase(),
				font: body.fontFamily,
				weight: body.fontWeight,
				chips: document.querySelectorAll(".ly-draft-chip").length,
				headingSize: heading ? getComputedStyle(heading).fontSize : "",
				composerInHero: Boolean(composer && composer.closest('[data-ly-chat-surface="empty"]')),
				composerRadius: composer ? getComputedStyle(composer).borderRadius : "",
				fieldMin: field ? getComputedStyle(field).minHeight : "",
				sendRadius: send ? getComputedStyle(send).borderRadius : "",
				vibrancy: document.documentElement.dataset.vibrancy ?? "",
				bodyBg: getComputedStyle(document.body).backgroundColor,
				menuRadius: root.getPropertyValue("--radius-menu").trim(),
				menuRow: root.getPropertyValue("--ly-menu-row").trim(),
			};
		})()`);
		console.log("观感：", look);
		check("正文墨色是 #262626", look.ink === "#262626", look.ink);
		check("界面字体是标点、汉字两个别名接系统字体栈", String(look.font).includes("Lyra Punct") && String(look.font).includes("system-ui"), look.font);
		check("正文字重 400", look.weight === "400", look.weight);
		check("欢迎页：标题 30px，输入框在标题下方，下面一排四枚建议", look.headingSize === "30px" && look.composerInHero === true && look.chips === 4, look);
		check("输入框卡片 16px 圆角，空框两行（40px 加上下内边距 24px）", look.composerRadius === "16px" && look.fieldMin === "64px", look);
		check("发送键实心墨色、8px 方圆角", look.sendRadius === "8px", look.sendRadius);
		check("毛玻璃能关：关着时主窗口有标记、页面不透明", look.vibrancy === "off" && look.bodyBg !== "rgba(0, 0, 0, 0)", look);
		check("菜单卡 8px、行高 32px", look.menuRadius === "8px" && look.menuRow === "32px", look);
	}

	const stop = SHOTS_ONLY ? null : await startRecording(PORT, frames);
	await pause(600);
	await d.type("把配置读取拆成两步，项目里的覆盖项最后生效");
	await pause(300);
	if (!SHOTS_ONLY) await read(WATCH);
	await d.submit();

	// The answer starts once the tools have run; take the middle of it.
	await d.until(`[...document.querySelectorAll('[data-dock-pane="conversation"] .prose-dw')].some((el) => el.innerText.includes("为什么要拆"))`, 60000);
	await pause(2600);
	await capture("流式输出中");
	await d.settled(90000);
	await pause(1500);
	await capture("回答完成");

	if (!SHOTS_ONLY) {
		const raw = await read<{ frames: number; lens: number[]; drops: number; maxDrop: number; fadeFrames: number; maxFade: number; steps: number[] }>(`(() => { window.__cmp.stop = true; return window.__cmp; })()`);
		const metrics = summarise(raw);
		console.log("流式：", metrics);
		await writeFile(join(OUT_DIR, `metrics-${LABEL}.json`), JSON.stringify(metrics, null, 2));
		if (LABEL === "after") {
			const before = JSON.parse(await readFile(join(OUT_DIR, "metrics-before.json"), "utf8").catch(() => "null")) as Metrics | null;
			console.log("对照（之前 → 之后）：");
			if (before) {
				for (const key of Object.keys(metrics) as (keyof Metrics)[]) console.log(`   ${key.padEnd(10)} ${String(before[key]).padStart(6)} → ${metrics[key]}`);
			}
			check("回答写到一半时屏幕上的字从不倒退（半截 Markdown 不闪）", metrics.drops === 0, metrics);
			check("新出的字逐个淡入", metrics.fadeFrames > 30 && metrics.maxFade > 0, metrics);
			check("跟随底部时没有一帧跳一整行（≥18px）", metrics.bigSteps === 0, metrics);
			if (before) {
				check("之前会倒退的，现在不倒退", before.drops > 0 ? metrics.drops < before.drops : true, { before: before.drops, after: metrics.drops });
				check("跟随底部的每一步更小：p90 比之前低", metrics.p90 < before.p90, { before: before.p90, after: metrics.p90 });
			}
			const chain = await read<{ process: boolean; open: string | null; rail: boolean; rows: number }>(`(() => {
				const proc = document.querySelector("main [data-ly-turn-process]");
				const button = proc?.querySelector(":scope > button");
				return { process: Boolean(proc), open: button?.getAttribute("aria-expanded") ?? null, rail: Boolean(proc?.querySelector("[data-ly-process-rail]")), rows: document.querySelectorAll("main [data-ly-tool]").length };
			})()`);
			console.log("调用链：", chain);
			check("这一轮的过程收成一行、默认收着", chain.process && chain.open === "false", chain);
		}
	}

	// Back to the top with a real wheel — assigning scrollTop would not leave follow-bottom — then
	// open the turn's process to show the call chain.
	const middle = await read<{ x: number; y: number }>(`(() => { const r = document.querySelector('[data-dock-pane="conversation"] .ly-scroll-view').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	for (let i = 0; i < 8; i++) {
		await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: middle.x, y: middle.y, deltaX: 0, deltaY: -900 });
		await pause(60);
	}
	await pause(700);
	await read(`(() => { const b = document.querySelector("main [data-ly-turn-process] > button"); if (b && b.getAttribute("aria-expanded") === "false") b.click(); return true; })()`);
	await pause(900);
	await capture("展开过程");

	// The model menu, from the composer.
	await d.markByText(`/Scripted/`, "data-cmp-model");
	await d.click("[data-cmp-model]").catch(() => {});
	await pause(900);
	await capture("模型菜单");
	await d.key("Escape", 27);
	await pause(500);

	// Settings: appearance, then models.
	await d.click(".ly-sidebar-foot button").catch(() => {});
	await pause(1200);
	await d.markByText(`/^外观$/`, "data-cmp-nav");
	await d.click("[data-cmp-nav]").catch(() => {});
	await pause(1200);
	await capture("设置_外观");
	if (LABEL === "after" && !SHOTS_ONLY) {
		// The material switch, pressed for real: on makes the page clear for the window's material to
		// show through, off puts the opaque sidebar back.
		const flip = () => read<boolean>(`(() => {
			const title = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent?.trim() === "毛玻璃侧边栏");
			const row = title?.closest("div:has([role=switch])");
			const toggle = row?.querySelector("[role=switch]");
			toggle?.click();
			return Boolean(toggle);
		})()`);
		const material = () => read<{ mark: string; body: string; html: string }>(`(() => ({ mark: document.documentElement.dataset.vibrancy ?? "", body: getComputedStyle(document.body).backgroundColor, html: document.documentElement.style.background }))()`);
		const found = await flip();
		await pause(900);
		const on = await material();
		await flip();
		await pause(900);
		const off = await material();
		console.log("毛玻璃：", { on, off });
		check("外观里打开毛玻璃：页面透明，窗口材质透上来", found && on.mark === "on" && on.body === "rgba(0, 0, 0, 0)" && on.html === "transparent", on);
		check("再关掉：恢复不透明", off.mark === "off" && off.body !== "rgba(0, 0, 0, 0)", off);
	}
	await d.markByText(`/^模型设置$/`, "data-cmp-nav");
	await d.click("[data-cmp-nav]").catch(() => {});
	await pause(1200);
	await capture("设置_模型");

	if (stop) {
		await stop();
		const passed = checks.filter((c) => c.ok).length;
		const tail = LABEL === "after" ? `_${passed}of${checks.length}` : "";
		await encode(frames, join(OUT_DIR, `${STAMP}_${LABEL}_流式输出与界面${tail}.mp4`));
	}
	if (checks.length) {
		const passed = checks.filter((c) => c.ok).length;
		console.log(`\n${passed}/${checks.length} 通过，输出在 ${OUT_DIR}`);
		if (passed !== checks.length) process.exitCode = 1;
	} else console.log(`\n截图与录像在 ${OUT_DIR}`);
} finally {
	await app?.stop();
	await closeListeningServer(model);
}
