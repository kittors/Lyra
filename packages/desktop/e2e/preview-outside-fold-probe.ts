/* oxlint-disable no-console -- probe CLI: what it prints is the evidence */
/**
 * A page the agent made with `preview` stays on screen when the turn folds its process away.
 *
 * Reported 2026-10-12: 「给我画一个可爱的小狗」 — the model reasoned, called `preview` and answered,
 * and the turn folded its process into 「思考 1 次 · 生成预览」 with the page inside it. Folded, the
 * page was gone; the only way to see what was made was to open the reasoning. Pictures and browser
 * cards had been drawn after the fold since they landed — previews had not.
 *
 * Three ways of reaching that transcript, because each takes a different path through the code:
 *
 *   live      the turn as it happens — records come from the main process's tool events
 *   stored    the same conversation reopened — records rebuilt from the saved messages
 *   expanded  stored, under 设置 › 外观 › 工具调用 › 展开, where each run is a group line of its own
 *
 * And two about the card's height, which the move made visible: drawn outside the fold the card
 * mounts at once, and whether it then follows its page came down to timing.
 *
 *   slow      stored, with a page that cannot report its height for two seconds — a heavy page, or
 *             any page on a busy machine. The card gave up 1.5 s after mounting, took its default
 *             440 as the answer, remembered it, and from then on could only grow.
 *   reopen    stored, then the window reloaded: the card opens at the height it remembered, and
 *             must not move from it.
 *
 * Verdicts come from what the window painted: which element the page's frame sits in, where it is
 * relative to the fold line and the answer, and the card's height — which only follows the page's
 * own reported height if the page actually ran inside it — frame by frame from the card's mount.
 *
 *   node --experimental-strip-types e2e/preview-outside-fold-probe.ts [live,stored,expanded,slow,reopen] [before|after|<label>]
 *
 * Screenshots, recordings and the measured numbers land in ~/Desktop/Lyra预览不进折叠测试/.
 */

import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { landsOn } from "./lands-on.ts";
import { encode, frameGrabber, pause, type Frame } from "./record.ts";

const PORT = 9462;
const OUT = join(homedir(), "Desktop", "Lyra预览不进折叠测试");
const [SCENES = "live,stored,expanded,slow,reopen", PHASE = "after"] = process.argv.slice(2);
const LABEL = PHASE === "before" ? "修复前" : PHASE === "after" ? "修复后" : PHASE;
const STAMP = (() => {
	const now = new Date();
	const two = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}-${two(now.getMinutes())}`;
})();

const ASK = "给我画一个可爱的小狗。";
const TITLE = "柴柴小布丁";
const THOUGHT = "A visual representation of a cute puppy will be generated. The appropriate tool is identified for this task, enabling the creation of a small page the user can play with.";
const ANSWER = "画好了：一只叫柴柴小布丁的柴犬。把鼠标放到它头上，它会点头。";
/** The page's own height. The card follows it only if the page ran and reported it. */
const PAGE_HEIGHT = 360;
/** How long the answer is held after the page lands, so the running turn can be looked at. */
const HOLD_MS = 6000;
const SESSION = "probe-pup";

/** How long the slow scene's page holds its main thread before anything in it — the height reporter too — can run. */
const SLOW_MS = 2000;

/**
 * The page the model makes. `holdMs` blocks its main thread first, after the injected reporter is
 * set up and before it can say anything: the first height then arrives that much after the frame
 * started, which is what a heavy page, or a busy machine, does to it.
 */
const page = (holdMs = 0) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${TITLE}</title>${
	holdMs ? `<script>for(var until=Date.now()+${holdMs};Date.now()<until;);</script>` : ""
}<style>
*{box-sizing:border-box}
body{margin:0;height:${PAGE_HEIGHT}px;position:relative;display:grid;place-items:center;background:linear-gradient(160deg,#fff6e6,#ffe4c4);font-family:-apple-system,"PingFang SC",sans-serif;overflow:hidden}
.bubble{position:absolute;top:24px;left:50%;transform:translateX(-50%);background:#fff;border-radius:999px;padding:10px 22px;font-weight:600;font-size:15px;color:#7a4a1c;box-shadow:0 6px 18px rgba(160,90,20,.15);white-space:nowrap}
.bubble:after{content:"";position:absolute;bottom:-8px;left:50%;margin-left:-8px;border:8px solid transparent;border-top-color:#fff;border-bottom:0}
.dog{position:relative;width:200px;height:190px;margin-top:64px}
.ear{position:absolute;top:0;width:62px;height:72px;background:#f0953e;border-radius:12px 60px 6px 60px}
.ear.l{left:16px;transform:rotate(-14deg)}.ear.r{right:16px;transform:scaleX(-1) rotate(-14deg)}
.ear:after{content:"";position:absolute;inset:16px 14px 8px 18px;background:#f7b3b0;border-radius:inherit}
.head{position:absolute;top:30px;left:10px;width:180px;height:150px;background:#f0953e;border-radius:48% 48% 44% 44%;transform-origin:50% 90%}
.mask{position:absolute;left:28px;right:28px;bottom:0;height:88px;background:#fff7ee;border-radius:50% 50% 46% 46%}
.eye{position:absolute;top:62px;width:22px;height:24px;background:#2b1d14;border-radius:50%}
.eye.l{left:50px}.eye.r{right:50px}
.eye:after{content:"";position:absolute;top:5px;left:5px;width:7px;height:7px;background:#fff;border-radius:50%}
.nose{position:absolute;top:96px;left:50%;width:22px;height:15px;margin-left:-11px;background:#2b1d14;border-radius:50% 50% 60% 60%}
.cheek{position:absolute;top:100px;width:22px;height:13px;background:#ff9e9e;border-radius:50%;opacity:.75}
.cheek.l{left:28px}.cheek.r{right:28px}
.tongue{position:absolute;top:114px;left:50%;width:16px;height:17px;margin-left:-8px;background:#ff6f7d;border-radius:0 0 50% 50%}
.dog:hover .head{animation:nod .5s ease-in-out 2}
@keyframes nod{50%{transform:rotate(-6deg)}}
</style></head><body>
<div class="bubble">汪！我是${TITLE}，摸摸我的头呀~</div>
<div class="dog"><div class="ear l"></div><div class="ear r"></div><div class="head"><div class="mask"></div><div class="eye l"></div><div class="eye r"></div><div class="cheek l"></div><div class="cheek r"></div><div class="nose"></div><div class="tongue"></div></div></div>
</body></html>`;
const PUP = page();

// ---------------------------------------------------------------------------
// A relay speaking Chat Completions: reasoning, then a `preview` call, then an answer.
// ---------------------------------------------------------------------------

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function startRelay(): Promise<{ port: number; server: Server }> {
	const server = createServer(async (req, res) => {
		const body = await bodyOf(req);
		res.writeHead(200, { "content-type": "text/event-stream" });
		const send = (delta: Record<string, unknown>, finish: string | null = null) =>
			res.write(`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
		const end = (reason: string) => {
			send({}, reason);
			res.write(`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 } })}\n\n`);
			res.end("data: [DONE]\n\n");
		};
		const say = async (words: string) => {
			for (const piece of words.match(/.{1,3}/gu) ?? []) {
				send({ content: piece });
				await pause(40);
			}
			end("stop");
		};
		// The title request is the one with no tools.
		if (!Array.isArray(body.tools) || body.tools.length === 0) return say("画小狗");
		const messages = (body.messages ?? []) as { role: string }[];
		if (messages.some((message) => message.role === "tool")) {
			await pause(HOLD_MS);
			return say(ANSWER);
		}
		for (const piece of THOUGHT.match(/.{1,12}/gu) ?? []) {
			send({ reasoning_content: piece });
			await pause(25);
		}
		send({ role: "assistant", tool_calls: [{ index: 0, id: "call_pup", type: "function", function: { name: "preview", arguments: "" } }] });
		const args = JSON.stringify({ title: TITLE, html: PUP });
		for (let at = 0; at < args.length; at += 400) {
			send({ tool_calls: [{ index: 0, function: { arguments: args.slice(at, at + 400) } }] });
			await pause(10);
		}
		end("tool_calls");
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("the relay got no port");
			resolve({ port: address.port, server });
		});
	});
}

// ---------------------------------------------------------------------------
// A profile: one project, and for the stored scenes the finished conversation and its page on disk.
// ---------------------------------------------------------------------------

async function seed(home: string, relayPort: number, scene: string): Promise<void> {
	const cwd = join(home, "Lyra");
	await mkdir(cwd, { recursive: true });
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const usage = { input: 40, output: 12, cacheRead: 0, cacheWrite: 0, total: 52, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			uiLocale: "zh-CN", permissionMode: "full", projectMemory: false, thinking: "off", autoSummarizeTitle: false,
			mcpServers: [], hooks: [], sync: { enabled: false },
			appearance: { theme: "light", ...(scene === "expanded" ? { callChain: "expanded" } : {}) },
			projects: [{ id: projectId, path: cwd, name: "Lyra", pinned: true, lastOpenedAt: Date.now() }],
			defaultModelId: "relay/gemini-3.8-flash-high",
			providers: [{
				id: "relay", name: "中转站", api: "openai-chat-completions", baseUrl: `http://127.0.0.1:${relayPort}`, apiKey: "probe-key", enabled: true,
				models: [{ id: "relay/gemini-3.8-flash-high", providerId: "relay", modelId: "gemini-3.8-flash-high", name: "gemini-3.8-flash-high", contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: true, supportsImages: true, supportsTools: true }],
			}],
		}),
	);
	if (scene === "live") return;

	const at = Date.now() - 120_000;
	const reply = { api: "openai-chat-completions", provider: "relay", model: "gemini-3.8-flash-high", usage };
	const messages = [
		{ role: "user", content: [{ type: "text", text: ASK }], timestamp: at },
		{ role: "assistant", content: [{ type: "thinking", thinking: THOUGHT }, { type: "toolCall", id: "call_pup", name: "preview", arguments: { title: TITLE, html: PUP } }], ...reply, stopReason: "toolUse", timestamp: at + 1000, durationMs: 4000 },
		{ role: "toolResult", toolCallId: "call_pup", toolName: "preview", content: [{ type: "text", text: `预览已生成：${TITLE}（1 个文件）。用户可以直接在对话中看到并操作它。` }], details: { preview: { id: "pup1", sessionId: SESSION, title: TITLE, entry: "index.html" } }, isError: false, timestamp: at + 5200 },
		{ role: "assistant", content: [{ type: "text", text: ANSWER }], ...reply, stopReason: "stop", timestamp: at + 5400, durationMs: 2000 },
	];
	await mkdir(join(home, "previews", SESSION, "pup1"), { recursive: true });
	await writeFile(join(home, "previews", SESSION, "pup1", "index.html"), scene === "slow" ? page(SLOW_MS) : PUP);
	const last = messages.length + 2;
	const meta = { id: SESSION, title: "给我画一个 可爱的小狗。", projectId, projectName: "Lyra", cwd, createdAt: at, updatedAt: at + 7400, modelId: "relay/gemini-3.8-flash-high", messageCount: messages.length, usage, seq: last };
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	// Outer seq starts at 1: a record at 0 is read past by the importer's gate.
	await writeFile(
		join(home, "sessions", projectId, `${SESSION}.jsonl`),
		[
			JSON.stringify({ seq: 1, ts: at, type: "meta", meta: { ...meta, seq: 0 } }),
			...messages.map((message, i) => JSON.stringify({ seq: i + 2, ts: at, type: "message", message })),
			JSON.stringify({ seq: last, ts: at + 7400, type: "meta", meta }),
		].join("\n") + "\n",
	);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta]));
}

// ---------------------------------------------------------------------------
// Driving and reading the window.
// ---------------------------------------------------------------------------

type Grabber = Awaited<ReturnType<typeof frameGrabber>>;
let app: RunningApp | undefined;
let g: Grabber;
let relay: Awaited<ReturnType<typeof startRelay>> | undefined;
let film: { name: string; frames: Frame[]; rolling: boolean; done: Promise<void> } | undefined;
const checks: { scene: string; name: string; ok: boolean; measured: unknown }[] = [];

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

const within = (expression: string, ms: number) => until(expression, ms).then(() => true, () => false);

async function click(selector: string): Promise<void> {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, 15000, selector);
	const at = await js<{ x: number; y: number }>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		el.scrollIntoView({ block: 'nearest' });
		const r = el.getBoundingClientRect();
		const x = r.x + Math.min(r.width / 2, 120), y = r.y + r.height / 2;
		${landsOn(selector)}
		return { x, y };
	})()`);
	await g.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await g.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 });
	await g.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 });
	await pause(200);
}

/** Park the pointer in the window's top-left corner, so no hover state is in the pictures. */
const rest = () => g.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 640, y: 4 });

async function caption(text: string): Promise<void> {
	await js(`(() => {
		let tag = document.getElementById('probe-caption');
		if (!tag) {
			tag = document.createElement('div');
			tag.id = 'probe-caption';
			tag.style.cssText = 'position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;padding:6px 14px;border-radius:999px;background:rgba(229,72,77,.92);color:#fff;font:600 13px -apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18)';
			document.body.appendChild(tag);
		}
		tag.textContent = ${JSON.stringify(`${LABEL} · `)} + ${JSON.stringify(text)};
	})()`);
	await pause(1000);
}

async function shoot(scene: string, index: string, what: string): Promise<void> {
	await pause(300);
	const shot = await g.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${STAMP}_${LABEL}_${scene}_${index}_${what}.png`);
	await writeFile(file, Buffer.from(shot.data, "base64"));
	console.log(`     截图 ${file}`);
}

interface Box {
	top: number;
	bottom: number;
	height: number;
}

interface Reading {
	/** Frames running the page, anywhere in the window. */
	pages: number;
	/** The first of them is laid out, opaque and at least a hundred pixels tall. */
	painted: boolean;
	/** It sits inside the turn's process block — the thing that folds. */
	inProcess: boolean | null;
	/** It sits inside a run's group line — the other thing that folds. */
	inGroup: boolean | null;
	open: string | null;
	line: string | null;
	running: boolean;
	lineBox: Box | null;
	cardBox: Box | null;
	answerBox: Box | null;
	/** The call rows drawn inside the process block. */
	rows: string[];
	/** Frames drawn inside the process block. */
	insidePages: number;
}

const READ = `(() => {
	const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; };
	const frames = [...document.querySelectorAll('main iframe')].filter((f) => f.title === ${JSON.stringify(TITLE)});
	const frame = frames[0];
	const block = document.querySelector('[data-ly-turn-process]');
	const toggle = block ? block.querySelector('button[aria-expanded]') : null;
	const answer = [...document.querySelectorAll('[data-ly-transcript-rows] *')].find((el) => el.children.length === 0 && el.textContent.includes(${JSON.stringify(ANSWER.slice(0, 8))}));
	const card = frame ? frame.parentElement.parentElement : null;
	return {
		pages: frames.length,
		painted: Boolean(frame && frame.checkVisibility() && getComputedStyle(frame).opacity === '1' && frame.getBoundingClientRect().height >= 100),
		inProcess: frame ? Boolean(frame.closest('[data-ly-turn-process]')) : null,
		inGroup: frame ? Boolean(frame.closest('[data-ly-run]')) : null,
		open: toggle ? toggle.getAttribute('aria-expanded') : null,
		line: toggle ? toggle.textContent.replace(/\\s+/g, ' ').trim() : null,
		running: Boolean(document.querySelector('[data-ly-turn-process="running"]')),
		lineBox: box(toggle),
		cardBox: box(card),
		answerBox: box(answer),
		rows: block ? [...block.querySelectorAll('[data-ly-tool]')].map((row) => row.textContent.replace(/\\s+/g, ' ').trim()) : [],
		insidePages: block ? block.querySelectorAll('iframe').length : 0,
	};
})()`;

const read = () => js<Reading>(READ);

/**
 * A log of the card's life, kept by the window itself from before the card exists — for a reload,
 * from before the app's own code runs (`Page.addScriptToEvaluateOnNewDocument`).
 *
 * The height verdict alone cannot say why a card ended at 440: whether the page loaded late, never
 * reported, or reported after the card had stopped listening. So the window notes the frame being
 * mounted and loaded, every height the page posts, every height the card writes down as settled,
 * and — once per painted frame — the card's height and the page's opacity, which is also what
 * catches a card that dips and comes back.
 */
const TRACE = `(() => {
	if (window.__previewTrace) return;
	const title = ${JSON.stringify(TITLE)};
	const t0 = performance.now();
	const events = [];
	window.__previewTrace = events;
	const at = () => Math.round(performance.now() - t0);
	const ours = (node) => node.nodeType === 1 && (node.matches('iframe') ? [node] : [...node.querySelectorAll('iframe')]).some((f) => f.title === title);
	const frames = () => [...document.querySelectorAll('main iframe')].filter((f) => f.title === title);
	new MutationObserver((list) => {
		for (const change of list) {
			for (const node of change.addedNodes) if (ours(node)) events.push({ t: at(), kind: 'mount' });
			for (const node of change.removedNodes) if (ours(node)) events.push({ t: at(), kind: 'unmount' });
		}
	}).observe(document, { childList: true, subtree: true });
	addEventListener('load', (event) => {
		if (event.target && event.target.tagName === 'IFRAME' && event.target.title === title) events.push({ t: at(), kind: 'load' });
	}, true);
	addEventListener('message', (event) => {
		const h = event.data && event.data.__dwPreviewHeight;
		if (typeof h === 'number') events.push({ t: at(), kind: 'report', h, mine: frames().some((f) => f.contentWindow === event.source) });
	}, true);
	const write = Storage.prototype.setItem;
	Storage.prototype.setItem = function (key, value) {
		if (String(key).startsWith('ly-preview-height:')) events.push({ t: at(), kind: 'remember', h: Number(value) });
		return write.call(this, key, value);
	};
	let last = '';
	const tick = () => {
		const frame = frames()[0];
		const h = frame ? Math.round(frame.parentElement.parentElement.getBoundingClientRect().height) : null;
		const op = frame ? Math.round(Number(getComputedStyle(frame).opacity) * 100) / 100 : null;
		if (h + '/' + op !== last) {
			last = h + '/' + op;
			events.push({ t: at(), kind: 'frame', h, op });
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
})()`;

interface TraceEvent {
	t: number;
	kind: "mount" | "unmount" | "load" | "report" | "remember" | "frame";
	h?: number | null;
	op?: number | null;
	mine?: boolean;
}

const traced = () => js<TraceEvent[]>("window.__previewTrace || []");

/** One line per event, timed from the frame's first mount — what a reader of the log needs to see the race. */
function timeline(events: TraceEvent[]): string {
	const start = events.find((one) => one.kind === "mount")?.t ?? 0;
	return events
		.map((one) => {
			const t = String(one.t - start).padStart(6);
			if (one.kind === "frame") return `${t}ms  frame     card ${one.h ?? "-"}  opacity ${one.op ?? "-"}`;
			if (one.kind === "report") return `${t}ms  report    ${one.h}${one.mine ? "" : "（不是这张卡片的 iframe 发的）"}`;
			if (one.kind === "remember") return `${t}ms  remember  ${one.h}`;
			return `${t}ms  ${one.kind}`;
		})
		.join("\n");
}

/** The page has loaded and the card has settled on a height — or it never will. */
const pageSettled = `(() => {
	const frame = [...document.querySelectorAll('main iframe')].find((f) => f.title === ${JSON.stringify(TITLE)});
	return Boolean(frame && getComputedStyle(frame).opacity === '1');
})()`;

/** What a folded, finished turn has to look like. */
function judgeFolded(scene: string, seen: Reading) {
	check(scene, "折叠行是收着的", seen.open === "false", { open: seen.open, line: seen.line });
	check(scene, "收着的时候，预览页面画在对话里", seen.pages === 1 && seen.painted, { pages: seen.pages, painted: seen.painted });
	check(scene, "页面不在任何一层折叠里（过程块、工具组都不在）", seen.inProcess === false && seen.inGroup === false, { inProcess: seen.inProcess, inGroup: seen.inGroup });
	const ordered = Boolean(seen.lineBox && seen.cardBox && seen.answerBox && seen.lineBox.bottom <= seen.cardBox.top && seen.cardBox.bottom <= seen.answerBox.top);
	check(scene, "从上到下：折叠行 → 预览 → 回答", ordered, { line: seen.lineBox, card: seen.cardBox, answer: seen.answerBox });
	// The card follows the page's own reported height only when the page actually ran inside it.
	const tall = seen.cardBox?.height ?? 0;
	check(scene, `页面在卡片里真的跑起来了：卡片高度跟着页面（${PAGE_HEIGHT}px 上下），不是量不到时的 440`, Math.abs(tall - PAGE_HEIGHT) <= 12, { card: tall });
}

/**
 * Frame by frame from the mount: the card's height goes from where it starts to where it ends, and
 * nowhere else.
 *
 * The final height alone passed while the card dipped to 256 — the dog cut off at the chin — and
 * grew back to 362 in front of whoever was looking. One way only, with a pixel of slack for rounding.
 */
function judgeFrames(scene: string, events: TraceEvent[]) {
	const heights = events.flatMap((one) => (one.kind === "frame" && typeof one.h === "number" ? [one.h] : []));
	const first = heights[0] ?? 0;
	const last = heights.at(-1) ?? 0;
	const shrinking = last <= first;
	let reached = first;
	let turned = false;
	for (const h of heights) {
		if (shrinking ? h > reached + 1 : h < reached - 1) turned = true;
		reached = shrinking ? Math.min(reached, h) : Math.max(reached, h);
	}
	const past = heights.some((h) => h < Math.min(first, last) - 1 || h > Math.max(first, last) + 1);
	check(scene, "逐帧：卡片高度从挂上到落定只朝一个方向走，没有先缩过头再长回来", heights.length > 0 && !turned && !past, { frames: heights.length, path: turns(heights) });
}

/** The heights a card passed through, kept where it changed direction: 440 → 256 → 362 rather than eighty numbers. */
function turns(heights: number[]): number[] {
	const path: number[] = [];
	for (const h of heights) {
		const [a, b] = path.slice(-2);
		if (path.length >= 2 && (b - a) * (h - b) >= 0) path[path.length - 1] = h;
		else if (path.at(-1) !== h) path.push(h);
	}
	return path;
}

/** Opened, the fold holds a row for the call and no second copy of the page. */
function judgeOpen(scene: string, seen: Reading) {
	check(scene, "折叠行打开了", seen.open === "true", { open: seen.open });
	// The whole row and nothing else: a row clicked open as well reads 「生成预览 柴柴小布丁参数{…}结果…」, and a
	// substring match let exactly that through while the probe's own second click was opening it.
	check(scene, `打开后，折叠里是一行「生成预览 ${TITLE}」`, seen.rows.some((row) => row === `生成预览 ${TITLE}`), { rows: seen.rows.map((row) => row.slice(0, 80)) });
	check(scene, "打开后，折叠里没有第二份页面，整个窗口仍只有一份", seen.insidePages === 0 && seen.pages === 1, { inside: seen.insidePages, pages: seen.pages });
}

async function boot(scene: string): Promise<void> {
	relay = await startRelay();
	const port = relay.port;
	app = await startApp({ port: PORT, seed: (home) => seed(home, port, scene) });
	g = await frameGrabber(PORT);
	await until(`document.querySelector('main textarea')`, 30000, "输入框");
	await js("document.fonts.ready");
	await js(TRACE);
	await rest();
	await pause(800);
	const reel = { name: scene, frames: [] as Frame[], rolling: true, done: Promise.resolve() };
	reel.done = (async () => {
		while (reel.rolling) {
			try {
				reel.frames.push({ at: Date.now(), data: await g.shot() });
			} catch {
				// A reloading page has no frame to give for a moment; only the scene ending stops the reel.
				if (!reel.rolling) return;
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
		// Bounded: a screenshot asked for while the page was reloading can go unanswered, and the reel would wait on it forever.
		await Promise.race([reel.done, pause(3000)]);
	}
	g?.close();
	const home = app?.home;
	await app?.stop();
	app = undefined;
	if (home) await rm(home, { recursive: true, force: true });
	await closeListeningServer(relay?.server);
	relay = undefined;
	if (reel?.frames.length) {
		const passed = checks.filter((one) => one.scene === reel.name && one.ok).length;
		const total = checks.filter((one) => one.scene === reel.name).length;
		const file = join(OUT, `${STAMP}_${LABEL}_${reel.name}_预览与折叠_${passed}of${total}.mp4`);
		await encode(reel.frames, file, 30, 2000);
		console.log(`     录像 ${file}`);
	}
}

/** What the opened fold turned out to hold, for the caption. */
function inside(seen: Reading): string {
	if (seen.insidePages > 0) return "页面在折叠里面";
	return seen.rows.some((row) => row.includes("生成预览")) ? `里面是一行「${seen.rows.find((row) => row.includes("生成预览"))}」，页面在折叠外面` : "里面没有这次调用";
}

/**
 * Open the process line — and, under the expanded layout, the run's own group line inside it.
 *
 * Only there, and only the group's own line. In the default layout the run is no line at all, and
 * the one button left matching "something folded inside a run" was the preview's own call row:
 * clicked, it opened the call's arguments and result, which is not what opening the fold shows.
 */
async function openFold(group: boolean): Promise<void> {
	await click('[data-ly-turn-process] button[aria-expanded="false"]');
	await pause(700);
	if (group) {
		await click('[data-ly-turn-process] [data-ly-run] button[aria-expanded="false"]:not([data-ly-tool] button)');
		await pause(700);
	}
	await rest();
}

// ---------------------------------------------------------------------------
// Scenes.
// ---------------------------------------------------------------------------

async function sceneLive(): Promise<void> {
	const scene = "live";
	await boot(scene);
	try {
		await caption(`发一句「${ASK}」：模型先想一下，再调用 preview 做一个页面`);
		await click("main textarea");
		await g.send("Input.insertText", { text: ASK });
		await pause(500);
		await g.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
		await g.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
		await rest();
		await until(`document.querySelector('[data-ly-turn-process]')`, 30000, "过程块");
		// The answer is held back, so this is the turn still running with the page already made.
		const landed = await within(pageSettled, HOLD_MS - 1000);
		const running = await read();
		console.log(`     跑着的时候：${JSON.stringify(running)}`);
		await caption(landed ? "回答还没来：过程收成一行在跑，页面已经画在它下面" : "回答还没来：页面在哪？");
		await shoot(scene, "01", "还在跑_页面已出现");
		check(scene, "还在跑的时候，过程是收着的", running.running && running.open === "false", { running: running.running, open: running.open, line: running.line });
		check(scene, "还在跑的时候，页面已经画出来了，不用打开过程", running.pages === 1 && running.painted && running.inProcess === false, { pages: running.pages, painted: running.painted, inProcess: running.inProcess });

		await until(`[...document.querySelectorAll('[data-ly-transcript-rows] *')].some((el) => el.children.length === 0 && el.textContent.includes(${JSON.stringify(ANSWER.slice(0, 8))}))`, 30000, "回答");
		await until(`!document.querySelector('[data-ly-turn-process="running"]')`, 15000, "这一轮跑完");
		await pause(1200);
		const done = await read();
		console.log(`     跑完：${JSON.stringify(done)}`);
		const events = await traced();
		console.log(timeline(events));
		await caption(done.pages && !done.inProcess ? "跑完了：过程收成一行，页面和回答都在它外面" : "跑完了：过程收成一行，页面跟着收进去了");
		await shoot(scene, "02", "跑完_收着");
		check(scene, "折叠行写的是「思考 1 次 · 生成预览」", /思考 1 次/.test(done.line ?? "") && /生成预览/.test(done.line ?? ""), { line: done.line });
		judgeFolded(scene, done);
		judgeFrames(scene, events);

		await caption("打开过程，看看里面");
		await openFold(false);
		const opened = await read();
		console.log(`     打开：${JSON.stringify(opened)}`);
		await caption(inside(opened));
		await shoot(scene, "03", "打开过程");
		judgeOpen(scene, opened);
		await pause(1200);
	} finally {
		await shutdown();
	}
}

/** Open the seeded conversation from the sidebar, and give its page time to settle. */
async function openStored(): Promise<Reading> {
	await click(`[data-ly-row="${SESSION}"] > button`);
	await until(`document.querySelector('[data-ly-turn-process]')`, 15000, "过程块");
	await within(pageSettled, 6000);
	await pause(900);
	await rest();
	return read();
}

async function sceneStored(scene: "stored" | "expanded"): Promise<void> {
	await boot(scene);
	try {
		await caption(scene === "expanded" ? "工具调用设成「展开」，重新打开这段对话" : "重新打开这段对话（记录是从存下来的消息里重建的）");
		const folded = await openStored();
		const events = await traced();
		console.log(`     收着：${JSON.stringify(folded)}`);
		console.log(timeline(events));
		await caption(folded.pages && !folded.inProcess ? "过程收成一行，页面画在它下面" : "过程收成一行：页面跟着收进去了");
		await shoot(scene, "01", "收着");
		judgeFolded(scene, folded);
		judgeFrames(scene, events);

		await caption("打开过程，看看里面");
		await openFold(scene === "expanded");
		const opened = await read();
		console.log(`     打开：${JSON.stringify(opened)}`);
		await caption(inside(opened));
		await shoot(scene, "02", "打开过程");
		judgeOpen(scene, opened);
		await pause(1200);
	} finally {
		await shutdown();
	}
}

async function sceneSlow(): Promise<void> {
	const scene = "slow";
	await boot(scene);
	try {
		await caption(`页面开头先忙 ${SLOW_MS / 1000} 秒才说得出自己多高（重页面，或者机器正忙）`);
		const folded = await openStored();
		const events = await traced();
		console.log(`     收着：${JSON.stringify(folded)}`);
		console.log(timeline(events));
		const height = folded.cardBox?.height ?? 0;
		await caption(Math.abs(height - PAGE_HEIGHT) <= 12 ? `页面晚了 ${SLOW_MS / 1000} 秒才报高度，卡片照样跟着它（${height}px）` : `页面晚了 ${SLOW_MS / 1000} 秒才报高度，卡片卡在 ${height}px`);
		await shoot(scene, "01", "晚报高度");
		judgeFolded(scene, folded);
		judgeFrames(scene, events);
		await pause(1200);
	} finally {
		await shutdown();
	}
}

async function sceneReopen(): Promise<void> {
	const scene = "reopen";
	await boot(scene);
	try {
		await caption("打开这段对话，等卡片量好高度并记下来");
		const first = await openStored();
		const remembered = await js<string | null>(`localStorage.getItem('ly-preview-height:${SESSION}/pup1')`);
		console.log(`     第一次：卡片 ${first.cardBox?.height}，记下的高度 ${remembered}`);
		await caption(`记下的高度是 ${remembered}px，重新载入窗口`);
		// Installed ahead of the app's own code, so the reopened card is watched from its very first frame.
		// Electron runs a script registered this way only once the Page domain is on — without it, silently nothing.
		await g.send("Page.enable", {});
		await g.send("Page.addScriptToEvaluateOnNewDocument", { source: TRACE });
		await g.send("Page.reload", {});
		await pause(1500);
		await until(`document.querySelector('main textarea')`, 30000, "输入框");
		if (!(await js<boolean>(`Boolean(document.querySelector('[data-ly-turn-process]'))`))) await click(`[data-ly-row="${SESSION}"] > button`);
		await until(`document.querySelector('[data-ly-turn-process]')`, 15000, "过程块");
		await within(pageSettled, 6000);
		await pause(1500);
		await rest();
		const again = await read();
		const events = await traced();
		console.log(`     重开：${JSON.stringify(again)}`);
		console.log(timeline(events));
		const height = again.cardBox?.height ?? 0;
		await caption(turns(events.flatMap((one) => (one.kind === "frame" && typeof one.h === "number" ? [one.h] : []))).length > 1 ? "重开：卡片从记下的高度先缩了一下，又长回来" : `重开：卡片一出来就是记下的 ${height}px，一帧都没动`);
		await shoot(scene, "01", "重开");
		check(scene, "重开后页面画在对话里", again.pages === 1 && again.painted, { pages: again.pages, painted: again.painted });
		check(scene, `重开后卡片还是页面的高度（${PAGE_HEIGHT}px 上下）`, Math.abs(height - PAGE_HEIGHT) <= 12, { card: height, remembered });
		judgeFrames(scene, events);
		await pause(1200);
	} finally {
		await shutdown();
	}
}

async function main(): Promise<void> {
	await mkdir(OUT, { recursive: true });
	const scenes: Record<string, () => Promise<void>> = {
		live: sceneLive,
		stored: () => sceneStored("stored"),
		expanded: () => sceneStored("expanded"),
		slow: sceneSlow,
		reopen: sceneReopen,
	};
	for (const name of SCENES.split(",")) {
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
	const file = join(OUT, `${STAMP}_${LABEL}_${SCENES.replaceAll(",", "+")}_${passed}of${checks.length}.json`);
	await writeFile(file, JSON.stringify(checks, null, 2));
	console.log(`\n${passed}/${checks.length} 通过  ${file}`);
	if (passed !== checks.length) process.exitCode = 1;
}

await main().catch(async (error) => {
	console.error(error);
	await shutdown().catch(() => {});
	process.exitCode = 1;
});
