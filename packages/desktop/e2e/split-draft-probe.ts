/* oxlint-disable no-console -- probe CLI: what it prints is the evidence */
/**
 * Where text left for the composer lands when a split shows more than one screen.
 *
 * `setComposerDraft` fills one slot for the whole window, and every mounted composer took what was in
 * it. This opens a blank conversation, drags a finished one in beside it, presses a suggestion card on
 * the blank screen — once by mouse, once by keyboard with no press to focus that screen — and reads
 * what every screen's composer holds afterwards.
 *
 * Verdicts come from what the window painted: each screen's visible field on every frame from the
 * press on, which screen is drawn focused, where the caret is. Never from the store. Input is real CDP
 * mouse and keyboard, since a synthetic click skips the press that focuses a screen.
 *
 * Screenshots, recordings and the measured numbers land in ~/Desktop/分屏草稿测试/.
 *
 * Usage: node --experimental-strip-types e2e/split-draft-probe.ts <mouse|keyboard|all> <before|after>
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { landsOn } from "./lands-on.ts";
import { encode, frameGrabber, pause, type Frame } from "./record.ts";

const PORT = 9771;
const OUT = join(homedir(), "Desktop", "分屏草稿测试");
const [SCENE = "all", PHASE = "before"] = process.argv.slice(2);
const LABEL = PHASE === "after" ? "修复后" : "修复前";
const STAMP = (() => {
	const now = new Date();
	const two = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}-${two(now.getMinutes())}`;
})();

const A = { id: "draft-a", title: "甲会话", project: "alpha-app", branch: "main", ask: "甲会话的第一个问题", answer: "甲会话的回答。" };
const B = { id: "draft-b", title: "乙会话", project: "beta-lib", branch: "beta-work", ask: "乙会话的第一个问题", answer: "乙会话的回答。" };
/** The first suggestion card, as the zh-CN locale the fixture runs in names it. */
const CARD = { label: "探索并理解代码", prompt: "帮我梳理这个项目的整体架构：入口在哪里、核心模块怎么划分、数据是怎么流动的。" };
const BLANK = "@draft";
const CARD_SELECTOR = "[data-probe-card]";
const field = (key: string) => `[data-ly-split-pane="${key}"] .ly-composer-dock textarea`;

// ---------------------------------------------------------------------------
// A model that only counts: pressing a card must leave a draft, not start a turn.
// ---------------------------------------------------------------------------

function startModel(): Promise<{ port: number; asked: string[]; server: Server }> {
	const asked: string[] = [];
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
		req.on("end", () => {
			asked.push(raw.slice(0, 300));
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `probe-${asked.length}`, role: "assistant", content: [], usage: { input_tokens: 1, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: "探针" } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } });
			emit("message_stop", {});
			res.end();
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("model server did not bind");
			resolve({ port: address.port, asked, server });
		});
	});
}

// ---------------------------------------------------------------------------
// Two projects, one finished conversation in each — the same fixture as split-scope-probe.
// ---------------------------------------------------------------------------

/** The Command Line Tools git when present: a full Xcode whose licence nobody accepted refuses every git call. */
function gitEnv(): NodeJS.ProcessEnv {
	const clt = "/Library/Developer/CommandLineTools";
	return existsSync(clt) ? { ...process.env, DEVELOPER_DIR: clt } : process.env;
}

async function seed(home: string, modelPort: number): Promise<void> {
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const metas = [];
	const projects = [];
	for (const [index, one] of [A, B].entries()) {
		const cwd = join(home, one.project);
		const git = (...args: string[]) => promisify(execFile)("git", args, { cwd, env: gitEnv() });
		await mkdir(cwd, { recursive: true });
		await git("init", "-q", "-b", one.branch);
		await git("config", "user.email", "probe@example.com");
		await git("config", "user.name", "probe");
		await writeFile(join(cwd, "README.md"), `# ${one.project}\n`);
		await git("add", "README.md");
		await git("commit", "-qm", "seed");
		const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
		projects.push({ id: projectId, path: cwd, name: one.project, pinned: true, lastOpenedAt: 10 - index });
		const at = 1_790_000_000_000 + index * 60_000;
		const messages = [
			{ role: "user", content: [{ type: "text", text: one.ask }], timestamp: at },
			{ role: "assistant", content: [{ type: "text", text: one.answer }], api: "anthropic-messages", provider: "qa", model: "model", usage, stopReason: "stop", timestamp: at + 1 },
		];
		const meta = { id: one.id, title: one.title, projectId, projectName: one.project, cwd, createdAt: at, updatedAt: at + 1, modelId: "qa/model", messageCount: 2, usage, seq: 4 };
		metas.push(meta);
		await mkdir(join(home, "sessions", projectId), { recursive: true });
		// Outer seq starts at 1: a record at 0 is read past and the session never reaches the sidebar.
		await writeFile(
			join(home, "sessions", projectId, `${one.id}.jsonl`),
			[
				JSON.stringify({ seq: 1, ts: at, type: "meta", meta: { ...meta, seq: 0 } }),
				...messages.map((message, i) => JSON.stringify({ seq: i + 2, ts: at, type: "message", message })),
				JSON.stringify({ seq: 4, ts: at + 1, type: "meta", meta }),
			].join("\n") + "\n",
		);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "qa", name: "探针模型", api: "anthropic-messages", baseUrl: `http://127.0.0.1:${modelPort}`, apiKey: "test", enabled: true,
					models: [{ id: "qa/model", providerId: "qa", modelId: "model", name: "QA", contextWindow: 128000, maxOutputTokens: 4096, supportsImages: false, supportsTools: true, supportsThinking: false }],
				},
			],
			defaultModelId: "qa/model",
			mcpServers: [], hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			permissionMode: "full", thinking: "off", retryAttempts: 1, projectMemory: false,
			sync: { enabled: false, port: 4594, token: null },
			projects,
			uiLocale: "zh-CN",
			appearance: { theme: "light" },
		}),
	);
}

// ---------------------------------------------------------------------------
// Driving the window.
// ---------------------------------------------------------------------------

type Grabber = Awaited<ReturnType<typeof frameGrabber>>;
let app: RunningApp | undefined;
let g: Grabber;
let model: Awaited<ReturnType<typeof startModel>>;
/** The scene being recorded: a screenshot every ~100ms, encoded on shutdown at real-time pacing. */
let film: { scene: string; frames: Frame[]; rolling: boolean; done: Promise<void> } | undefined;
const checks: Array<{ scene: string; name: string; ok: boolean; measured: unknown }> = [];

function check(scene: string, name: string, ok: boolean, measured: unknown) {
	checks.push({ scene, name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} [${scene}] ${name}\n     ${JSON.stringify(measured)}`);
}

const js = <T>(expression: string) => g.evaluate<T>(expression);

async function until(expression: string, ms = 15000, what = expression): Promise<void> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await js<boolean>(`Boolean(${expression})`)) return;
		await pause(120);
	}
	throw new Error(`等不到：${what}`);
}

/** The centre of an element, after asking the page that a press there would land on it. */
async function centre(selector: string): Promise<{ x: number; y: number }> {
	return js(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) throw new Error('missing ' + ${JSON.stringify(selector)});
		el.scrollIntoView({ block: 'nearest' });
		const r = el.getBoundingClientRect();
		const x = r.x + r.width / 2, y = r.y + r.height / 2;
		${landsOn(selector)}
		return { x, y };
	})()`);
}

async function click(selector: string): Promise<void> {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, 15000, selector);
	const at = await centre(selector);
	await g.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await g.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 });
	await g.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 });
	await pause(180);
}

/** `text` makes it a key that types: Enter only activates a focused button when it carries "\r". */
async function key(name: string, code: number, text?: string): Promise<void> {
	await g.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code, ...(text ? { text, unmodifiedText: text } : {}) });
	await g.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
}

/** A picture of the window with the elements it is about outlined; the outline is removed again. */
async function shoot(index: string, what: string, marks: string[] = []): Promise<void> {
	await js(`(() => {
		for (const selector of ${JSON.stringify(marks)}) for (const el of document.querySelectorAll(selector)) {
			el.dataset.probeOutline = el.style.outline || ' ';
			el.style.outline = '2px solid #e5484d';
			el.style.outlineOffset = '-2px';
		}
	})()`);
	await pause(120);
	const shot = await g.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await js(`(() => {
		for (const el of document.querySelectorAll('[data-probe-outline]')) {
			el.style.outline = el.dataset.probeOutline.trim();
			el.style.outlineOffset = '';
			delete el.dataset.probeOutline;
		}
	})()`);
	const file = join(OUT, `${STAMP}_${LABEL}_${index}_${what}.png`);
	await writeFile(file, Buffer.from(shot.data, "base64"));
	console.log(`     截图 ${file}`);
}

/**
 * Drag a sidebar conversation onto the right edge of the workspace, the way a hand does it.
 *
 * Press, a nudge past the drag threshold, a pause, then the travel. Retried: the person at the
 * computer moving the real pointer cancels a carry.
 */
async function dragIntoSplit(id: string, count: number): Promise<void> {
	for (let attempt = 1; attempt <= 3; attempt++) {
		const from = await centre(`[data-ly-row="${id}"] > button`);
		const to = await js<{ x: number; y: number }>(`(() => { const r = document.querySelector('[data-ly-split-root]').getBoundingClientRect(); return { x: r.right - 28, y: r.y + r.height / 2 }; })()`);
		const move = (x: number, y: number) => g.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
		await g.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
		await pause(150);
		await g.send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 });
		await pause(80);
		for (let i = 1; i <= 4; i++) {
			await move(from.x + i * 3, from.y + i);
			await pause(30);
		}
		await pause(120);
		const start = { x: from.x + 12, y: from.y + 4 };
		for (let i = 1; i <= 24; i++) {
			await move(start.x + ((to.x - start.x) * i) / 24, start.y + ((to.y - start.y) * i) / 24);
			await pause(22);
		}
		await pause(250);
		await g.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", buttons: 0, clickCount: 1 });
		const opened = await until(`document.querySelector('[data-ly-split-root]')?.dataset.lySplitCount === '${count}'`, 5000).then(() => true, () => false);
		if (opened) {
			await pause(900);
			return;
		}
		console.log(`     分屏没打开，重拖第 ${attempt + 1} 次`);
		await key("Escape", 27);
		await pause(800);
	}
	throw new Error(`拖了三次都没把 ${id} 拖进分屏`);
}

/** Each screen as drawn: which conversation, whether it is the focused one, its composer's text, the caret. */
interface Screen {
	key: string;
	focused: boolean;
	text: string | null;
	caret: boolean;
	/** Composers of conversations this screen showed before, kept mounted and hidden. */
	retained: Array<string | null>;
}

const SCREENS = `[...document.querySelectorAll('[data-ly-split-pane]')].map((pane) => {
	const docks = [...pane.querySelectorAll('.ly-composer-dock')];
	const shown = docks.find((el) => el.checkVisibility());
	const input = shown ? shown.querySelector('textarea') : null;
	return {
		key: pane.getAttribute('data-ly-split-pane'),
		focused: pane.hasAttribute('data-ly-split-focused'),
		text: input ? input.value : null,
		caret: Boolean(input) && document.activeElement === input,
		retained: docks.filter((el) => el !== shown).map((el) => el.querySelector('textarea')?.value ?? null),
	};
})`;

const screens = () => js<Screen[]>(SCREENS);
/** Every field in the window holding the card's words, hidden ones and the side chat's included. */
const holders = () => js<number>(`[...document.querySelectorAll('textarea')].filter((el) => el.value.includes(${JSON.stringify(CARD.prompt)})).length`);

/**
 * Both screens' fields on every painted frame, locked to the two elements present at the start.
 *
 * Re-querying per frame would read whichever element matched that frame; holding the nodes means a
 * remount shows up as null instead of silently switching what is measured.
 */
const RECORD_FIELDS = `(() => {
	const pick = (key) => {
		const pane = document.querySelector('[data-ly-split-pane="' + key + '"]');
		const shown = pane ? [...pane.querySelectorAll('.ly-composer-dock')].find((el) => el.checkVisibility()) : null;
		return shown ? shown.querySelector('textarea') : null;
	};
	const blank = pick(${JSON.stringify(BLANK)});
	const other = pick(${JSON.stringify(B.id)});
	const log = [];
	window.__draftFrames = log;
	const started = performance.now();
	let last = '';
	const read = (el) => (el && el.isConnected ? el.value : null);
	const tick = () => {
		const now = { blank: read(blank), other: read(other) };
		const seen = JSON.stringify(now);
		if (seen !== last) {
			log.push({ ms: Math.round(performance.now() - started), blank: now.blank, other: now.other });
			last = seen;
		}
		if (performance.now() - started < 5000) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return Boolean(blank) && Boolean(other);
})()`;

/** A caption pinned to the top of the window for the recording; it takes no pointer events. */
async function caption(text: string): Promise<void> {
	await js(`(() => {
		let tag = document.getElementById('probe-caption');
		if (!tag) {
			tag = document.createElement('div');
			tag.id = 'probe-caption';
			tag.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;padding:6px 14px;border-radius:999px;background:rgba(229,72,77,.92);color:#fff;font:600 13px -apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18)';
			document.body.appendChild(tag);
		}
		tag.textContent = ${JSON.stringify(`${LABEL} · `)} + ${JSON.stringify(text)};
	})()`);
	await pause(900);
}

async function boot(scene: string): Promise<void> {
	model = await startModel();
	app = await startApp({ port: PORT, seed: (home) => seed(home, model.port) });
	g = await frameGrabber(PORT);
	await until(`document.querySelector('[data-ly-row="${B.id}"]') && document.querySelector('[data-ly-row="${A.id}"]')`, 30000, "侧栏出现两段会话");
	await pause(600);
	const reel = { scene, frames: [] as Frame[], rolling: true, done: Promise.resolve() };
	reel.done = (async () => {
		while (reel.rolling) {
			try {
				reel.frames.push({ at: Date.now(), data: await g.shot() });
			} catch {
				return;
			}
			await pause(100);
		}
	})();
	film = reel;
}

async function shutdown(): Promise<void> {
	const reel = film;
	film = undefined;
	if (reel) {
		reel.rolling = false;
		await reel.done;
	}
	g?.close();
	await app?.stop();
	app = undefined;
	await closeListeningServer(model?.server);
	if (reel?.frames.length) {
		const file = join(OUT, `${STAMP}_${LABEL}_${reel.scene}.mp4`);
		await encode(reel.frames, file, 30, 2000);
		console.log(`     录像 ${file}`);
	}
}

// ---------------------------------------------------------------------------
// A suggestion card pressed on a split's blank screen.
// ---------------------------------------------------------------------------

async function sceneCard(path: "mouse" | "keyboard"): Promise<void> {
	const scene = path;
	const how = path === "mouse" ? "鼠标" : "键盘";
	await boot(`建议卡片_${how}路径`);
	try {
		await caption(`在「${A.project}」里新建一个空白对话`);
		await click(`button[aria-label="在「${A.project}」里新建会话"]`);
		await until(`document.querySelector('[data-ly-split-pane="${BLANK}"] [data-ly-chat-surface="empty"]')`, 10000, "空白对话");
		await caption(`把「${B.title}」（${B.project}）拖进右边分屏，焦点落在它上面`);
		await dragIntoSplit(B.id, 2);
		await until(`document.querySelector(${JSON.stringify(field(B.id))})?.checkVisibility()`, 10000, "乙会话的输入框");
		const tagged = await js<boolean>(`(() => {
			const cards = [...document.querySelectorAll('[data-ly-split-pane="${BLANK}"] [data-ly-chat-surface="empty"] button')];
			const card = cards.find((el) => el.textContent.includes(${JSON.stringify(CARD.label)}));
			if (card) card.setAttribute('data-probe-card', '');
			return Boolean(card);
		})()`);
		if (!tagged) throw new Error("空白屏上找不到建议卡片");

		const before = await screens();
		console.log(`     按卡片之前：${JSON.stringify(before)}`);
		const otherBefore = before.find((screen) => screen.key === B.id);
		const blankBefore = before.find((screen) => screen.key === BLANK);
		check(scene, "按卡片之前：焦点在右边的乙会话，两个输入框都是空的", Boolean(otherBefore?.focused && !blankBefore?.focused && otherBefore.text === "" && blankBefore?.text === ""), { blank: blankBefore, other: otherBefore });
		await shoot(path === "mouse" ? "01" : "03", `${how}路径_按卡片前_焦点在右边乙会话`, [CARD_SELECTOR, `[data-ly-split-pane="${B.id}"][data-ly-split-focused]`]);

		if (!(await js<boolean>(RECORD_FIELDS))) throw new Error("逐帧记录没找到两个输入框");
		if (path === "mouse") {
			await caption(`鼠标点左边空白屏上的「${CARD.label}」`);
			await click(CARD_SELECTOR);
		} else {
			await caption(`键盘把焦点移到左边的「${CARD.label}」上（没有鼠标按下），按回车`);
			// Keyboard only: focus arrives without a pointer press, the way Tab brings it.
			await js(`document.querySelector(${JSON.stringify(CARD_SELECTOR)}).focus()`);
			await pause(300);
			const stillOther = await js<boolean>(`Boolean(document.querySelector('[data-ly-split-pane="${B.id}"][data-ly-split-focused]'))`);
			check(scene, "键盘移焦点之后、按回车之前：分屏焦点还在右边（没有按下，屏没切过来）", stillOther, { focusedIsOther: stillOther });
			await key("Enter", 13, "\r");
		}
		await pause(1800);

		const after = await screens();
		const frames = await js<Array<{ ms: number; blank: string | null; other: string | null }>>("window.__draftFrames");
		const count = await holders();
		console.log(`     按卡片之后：${JSON.stringify(after)}`);
		console.log(`     逐帧（两个输入框的值，变化才记）：${JSON.stringify(frames)}`);
		const blank = after.find((screen) => screen.key === BLANK);
		const other = after.find((screen) => screen.key === B.id);
		const leaked = frames.filter((frame) => frame.other?.includes(CARD.prompt));
		check(scene, "左边空白屏的输入框里是卡片那句话", blank?.text === CARD.prompt, { blank: blank?.text });
		check(scene, "右边乙会话的输入框还是空的", other?.text === "", { other: other?.text });
		check(scene, "逐帧：乙会话的输入框一帧也没出现过这句话", leaked.length === 0, { framesWithIt: leaked.length, firstAt: leaked[0]?.ms ?? null });
		check(scene, "整个窗口只有一个输入框装着这句话（收起的、侧边聊天的都算）", count === 1, { holders: count });
		check(scene, "光标在左边空白屏的输入框里", Boolean(blank?.caret) && !other?.caret, { blankCaret: blank?.caret, otherCaret: other?.caret });
		check(scene, "左边空白屏成了焦点屏（和鼠标按下的结果一样）", Boolean(blank?.focused) && !other?.focused, { blankFocused: blank?.focused, otherFocused: other?.focused });
		check(scene, "没有向模型发任何请求（卡片只放草稿，不开跑）", model.asked.length === 0, { requests: model.asked.length });
		await caption(
			other?.text?.includes(CARD.prompt)
				? `结果：这句话也进了右边「${B.title}」的输入框`
				: blank?.text === CARD.prompt ? "结果：只落进了左边空白屏自己的输入框" : "结果：左边没收到",
		);
		await shoot(path === "mouse" ? "02" : "04", `${how}路径_按卡片后_两屏输入框`, [field(BLANK), field(B.id)]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	await mkdir(OUT, { recursive: true });
	const scenes: Record<string, () => Promise<void>> = {
		mouse: () => sceneCard("mouse"),
		keyboard: () => sceneCard("keyboard"),
	};
	const run = SCENE === "all" ? Object.keys(scenes) : [SCENE];
	for (const name of run) {
		const scene = scenes[name];
		if (!scene) throw new Error(`没有这个场景：${name}`);
		console.log(`\n== ${name}（${LABEL}）`);
		try {
			await scene();
		} catch (error) {
			check(name, "场景跑完", false, String((error as Error)?.stack ?? error));
		}
	}
	const passed = checks.filter((one) => one.ok).length;
	const file = join(OUT, `${STAMP}_${LABEL}_${SCENE}_${passed}of${checks.length}.json`);
	await writeFile(file, JSON.stringify(checks, null, 2));
	console.log(`\n${passed}/${checks.length} 通过  ${file}`);
	if (passed !== checks.length) process.exitCode = 1;
}

await main().catch(async (error) => {
	console.error(error);
	await shutdown().catch(() => {});
	process.exitCode = 1;
});
