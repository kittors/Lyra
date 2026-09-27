/* oxlint-disable no-console -- probe CLI: what it prints is the evidence */
/**
 * The split-view scoping faults left after the first pass, reproduced in a real window.
 *
 *   rule        The 「要把这次纠正变成一条规则吗？」 card drew under every screen, and went away when focus moved.
 *   subagent    Closing a sub-agent from a screen the keyboard reached asked the focused conversation to close it.
 *   disclosure  A process block opened in one screen folded again when focus moved to another.
 *   changebar   The change counter under a screen opened the Git panel in the focused screen.
 *   hiccup      「继续」 under a failed turn, pressed from the keyboard, went to the focused conversation.
 *   revert      「撤回」 from the keyboard took back the focused conversation's message.
 *   edit        「编辑并重新发送」 from the keyboard rewrote the focused conversation.
 *
 * Same method as `split-scope-probe.ts`: verdicts come from what the window painted, from what the
 * fake model was asked (each request carries its conversation's working directory) and from what is
 * on disk — never from the store. Every press is a real CDP mouse or key event. The keyboard path is
 * `el.focus()` and an Enter: focus arrives the way Tab brings it, without the pointer press that
 * would have focused the screen first.
 *
 * Screenshots, recordings and the measured numbers land in ~/Desktop/分屏其余串台测试/.
 *
 * Usage: node --experimental-strip-types e2e/split-scope-rest-probe.ts <rule|subagent|disclosure|changebar|hiccup|revert|edit|all> <before|after>
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

const PORT = 9763;
const OUT = join(homedir(), "Desktop", "分屏其余串台测试");
const [SCENE = "all", PHASE = "before"] = process.argv.slice(2);
const LABEL = PHASE === "after" ? "修复后" : "修复前";
// Local wall-clock time in the file name, the way the other proof folders on the Desktop are named.
const STAMP = (() => {
	const now = new Date();
	const two = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}-${two(now.getMinutes())}`;
})();

interface Side {
	id: string;
	title: string;
	project: string;
	branch: string;
	ask: string;
	answer: string;
	/** Files left uncommitted in the project, so the change counter has something to count. */
	dirty: string[];
	projectId: string;
}

const A: Side = { id: "split-a", title: "甲会话", project: "alpha-app", branch: "main", ask: "甲会话的第一个问题", answer: "甲会话的回答。", dirty: ["README.md"], projectId: "" };
const B: Side = { id: "split-b", title: "乙会话", project: "beta-lib", branch: "beta-work", ask: "乙会话的第一个问题", answer: "乙会话的回答。", dirty: ["README.md", "lib.ts"], projectId: "" };

/** Said to 甲 to make the runtime offer a rule: it reads like a correction to the cheap pre-filter. */
const CORRECTION = "别用 var，以后都用 const";
const RULE_NAME = "probe-no-var";
/** Asks the model to delegate; each sub-agent is told one of these, which is how its requests are recognised. */
const DELEGATE = "派两个子智能体去找入口和配置";
const SUB_PROMPT = "子任务：";
/** Two, because the panel draws its roster (and each row's close button) only from two on. */
const SUBS = [
	{ description: "找入口", prompt: `${SUB_PROMPT}找入口文件` },
	{ description: "找配置", prompt: `${SUB_PROMPT}找配置文件` },
];
/** Makes the model answer with an HTTP 500, so the turn ends as a failed one. */
const FAIL = "这一句会让请求失败";
/** The sentence 「继续」 sends after a failure — `CARRY_ON_PROMPTS[1]`. */
const CARRY_ON = "继续，从中断的地方接着做。";
const EDITED = "乙会话改过的问题";

// ---------------------------------------------------------------------------
// A scripted model: answers by who is asking, and notes which project each request came from.
// ---------------------------------------------------------------------------

interface Asked {
	kind: "chat" | "title" | "classify" | "sub";
	/** The first thing said in the conversation the request belongs to. */
	first: string;
	/** The last thing a person said, skipping the runtime's trailing <env> block. */
	last: string;
	result: boolean;
	/** Which project's directory the request carries — the conversation it belongs to. */
	project: string | null;
}

function textOf(content: unknown): string[] {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];
	return content.flatMap((block: { type?: string; text?: unknown }) => (block?.type === "text" ? [String(block.text ?? "")] : []));
}

function startModel(): Promise<{ port: number; asked: Asked[]; server: Server }> {
	const asked: Asked[] = [];
	let call = 0;
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
		req.on("end", () => {
			const body = JSON.parse(raw || "{}") as {
				system?: string | Array<{ text?: string }>;
				messages?: Array<{ role: string; content: unknown }>;
				tools?: Array<{ name: string }>;
			};
			const system = typeof body.system === "string" ? body.system : (body.system ?? []).map((block) => block.text ?? "").join("\n");
			const users = (body.messages ?? []).filter((message) => message.role === "user");
			const human = (content: unknown) => textOf(content).filter((text) => !text.trim().startsWith("<env>"));
			const first = human(users[0]?.content).join(" ");
			let last = "";
			for (const message of [...users].reverse()) {
				const said = human(message.content);
				if (said.length) {
					last = said.join(" ");
					break;
				}
			}
			const tail = users.at(-1)?.content;
			const result = Array.isArray(tail) && tail.some((block: { type?: string }) => block?.type === "tool_result");
			// The title request and the correction classifier carry no tools; a conversation turn offers todo_write.
			const chat = (body.tools ?? []).some((tool) => tool.name === "todo_write");
			const kind: Asked["kind"] = first.startsWith(SUB_PROMPT) ? "sub" : chat ? "chat" : system.includes("isCorrection") ? "classify" : "title";
			const project = raw.includes(`/${A.project}`) ? A.project : raw.includes(`/${B.project}`) ? B.project : null;
			asked.push({ kind, first, last, result, project });

			if (kind === "chat" && !result && last.includes(FAIL)) {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "探针让这一轮失败" } }));
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `probe-${++call}`, role: "assistant", content: [], usage: { input_tokens: 50, output_tokens: 0 } } });
			const say = (text: string) => {
				emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
				emit("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
				emit("content_block_stop", { index: 0 });
			};
			let stop = "end_turn";
			if (kind === "title") say("探针会话");
			else if (kind === "classify") {
				say(
					first.includes(CORRECTION)
						? JSON.stringify({ isCorrection: true, condition: "\\bvar\\s", scope: "text", name: RULE_NAME, body: "别用 var，统一用 const。" })
						: JSON.stringify({ isCorrection: false }),
				);
			} else if (kind === "sub") say(first.includes("配置") ? "配置在 lib.ts。" : "入口在 README.md。");
			else if (result) say("子任务做完了。");
			else if (last.includes(DELEGATE)) {
				stop = "tool_use";
				SUBS.forEach((one, index) => {
					emit("content_block_start", { index, content_block: { type: "tool_use", id: `call-${call}-${index}`, name: "task", input: {} } });
					emit("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify({ description: one.description, prompt: one.prompt, subagent_type: "explore" }) } });
					emit("content_block_stop", { index });
				});
			} else say(`已收到「${last.slice(0, 30)}」。这段对话的第一句是「${first.slice(0, 30)}」。`);
			emit("message_delta", { delta: { stop_reason: stop }, usage: { output_tokens: 12 } });
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
// Two projects with uncommitted work, one finished conversation in each, each with a tool call.
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
		for (const file of one.dirty) await writeFile(join(cwd, file), `# ${one.project} ${file}\n`);
		await git("add", ...one.dirty);
		await git("commit", "-qm", "seed");
		// Left uncommitted: 甲 one file, 乙 two — the counters under the two screens tell them apart.
		for (const file of one.dirty) await writeFile(join(cwd, file), `# ${one.project} ${file}\nchanged by the probe\n`);
		const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
		one.projectId = projectId;
		projects.push({ id: projectId, path: cwd, name: one.project, pinned: true, lastOpenedAt: 10 - index });
		const at = 1_790_000_000_000 + index * 60_000;
		const call = `${one.id}-call`;
		const messages = [
			{ role: "user", content: [{ type: "text", text: one.ask }], timestamp: at },
			{
				role: "assistant",
				content: [{ type: "text", text: `${one.title}先看一眼目录。` }, { type: "toolCall", id: call, name: "bash", arguments: { command: "ls" } }],
				api: "anthropic-messages", provider: "qa", model: "model", usage, stopReason: "toolUse", timestamp: at + 1,
			},
			{ role: "toolResult", toolCallId: call, toolName: "bash", content: [{ type: "text", text: one.dirty.join("\n") }], isError: false, timestamp: at + 2 },
			{ role: "assistant", content: [{ type: "text", text: one.answer }], api: "anthropic-messages", provider: "qa", model: "model", usage, stopReason: "stop", timestamp: at + 3 },
		];
		const last = messages.length + 2;
		const meta = { id: one.id, title: one.title, projectId, projectName: one.project, cwd, createdAt: at, updatedAt: at + 3, modelId: "qa/model", messageCount: messages.length, usage, seq: last };
		metas.push(meta);
		await mkdir(join(home, "sessions", projectId), { recursive: true });
		// Outer seq starts at 1: a record at 0 is read past and the session never reaches the sidebar.
		await writeFile(
			join(home, "sessions", projectId, `${one.id}.jsonl`),
			[
				JSON.stringify({ seq: 1, ts: at, type: "meta", meta: { ...meta, seq: 0 } }),
				...messages.map((message, i) => JSON.stringify({ seq: i + 2, ts: at, type: "message", message })),
				JSON.stringify({ seq: last, ts: at + 3, type: "meta", meta }),
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
			// No retries: a failed request gives up at once and leaves its record under the turn.
			permissionMode: "full", thinking: "off", retryAttempts: 1, projectMemory: false,
			// Both sub-agents at once: with thinking off the gate would otherwise run them one after the other.
			subAgentDelegation: "eager", maxConcurrentSubAgents: 2,
			sync: { enabled: false, port: 4595, token: null },
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
/** The scene being recorded: every ~100ms a screenshot, encoded on shutdown at real-time pacing. */
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

/** Like `until`, but answers instead of throwing: for waits whose not happening is the finding. */
async function within(expression: string, ms: number): Promise<boolean> {
	return until(expression, ms).then(() => true, () => false);
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

/** A key a React handler reads on keydown — the composer's and the message editor's Enter. */
async function key(name: string, code: number, modifiers = 0): Promise<void> {
	await g.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code, modifiers });
	await g.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code, modifiers });
}

/**
 * Reach a control the way the keyboard does and press Enter on it.
 *
 * Focus is moved without any pointer event — what Tab does — so the screen's own press-to-focus
 * never runs. Enter carries its character, which is what makes the browser activate a button.
 */
async function keyboardPress(selector: string): Promise<void> {
	await until(`document.querySelector(${JSON.stringify(selector)})`, 15000, selector);
	const focused = await js<boolean>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		el.focus();
		return document.activeElement === el;
	})()`);
	if (!focused) throw new Error(`键盘焦点落不到 ${selector} 上`);
	await pause(250);
	await g.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
	await g.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
	await pause(250);
}

/**
 * A picture of the window, with the elements it is about outlined.
 *
 * The outline is the probe's annotation, not the app's: it is drawn for the shot and removed again,
 * so the next measurement reads the untouched page.
 */
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
		if (await within(`document.querySelector('[data-ly-split-root]')?.dataset.lySplitCount === '${count}'`, 5000)) {
			await pause(900);
			return;
		}
		console.log(`     分屏没打开，重拖第 ${attempt + 1} 次`);
		await key("Escape", 27);
		await pause(800);
	}
	throw new Error(`拖了三次都没把 ${id} 拖进分屏`);
}

const pane = (side: Side) => `[data-ly-split-pane="${side.id}"]`;
const field = (side: Side) => `${pane(side)} textarea`;

/** Which screen has focus, as drawn. */
const focusedScreen = () => js<string | null>(`document.querySelector('[data-ly-split-pane][data-ly-split-focused]')?.getAttribute('data-ly-split-pane') ?? null`);

/** A screen's transcript as painted: its text, whitespace folded. */
const screenText = (side: Side) => js<string>(`(document.querySelector('${pane(side)} [data-ly-session]')?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);

/** Open 甲, then carry 乙 in beside it: two screens, focus on 乙. */
async function splitAB(): Promise<void> {
	await caption(`打开「${A.title}」（${A.project}）`);
	await click(`[data-ly-row="${A.id}"] > button`);
	await until(`document.querySelector('${field(A)}')`, 10000, "甲会话打开");
	await caption(`把「${B.title}」（${B.project}）拖进右边分屏，焦点落在乙上`);
	await dragIntoSplit(B.id, 2);
}

/** A person clicking into a screen's composer: the press that focuses the screen. */
async function focusByMouse(side: Side): Promise<void> {
	await click(field(side));
	await until(`document.querySelector('${pane(side)}[data-ly-split-focused]')`, 8000, `焦点切到 ${side.title}`);
	await pause(1200);
}

/** What the conversation holds on disk, read through the app's own bridge. */
const onDisk = (side: Side) =>
	js<string[]>(`(async () => {
		const snapshot = await window.lyra.sessions.transcript(${JSON.stringify(side.projectId)}, ${JSON.stringify(side.id)});
		return (snapshot?.messages ?? []).filter((m) => m.role === 'user').map((m) => (m.displayText ?? m.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ')).slice(0, 60));
	})()`);

/**
 * A caption for the recording, pinned to the top of the window.
 *
 * The probe's annotation, not the app's: `pointer-events: none`, so every hit test the steps make
 * still answers with the app's own element underneath.
 */
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
	// A beat per step, so a person watching can follow it.
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
// rule: the offer to keep a correction.
// ---------------------------------------------------------------------------

/** Visible 「保存到项目」 buttons in a screen: one per card drawn there. */
const RULE_CARDS = (side: Side) => js<number>(`[...document.querySelectorAll('${pane(side)} button[aria-label="保存到项目"]')].filter((el) => el.checkVisibility()).length`);
const RULE_CARD_MARK = `button[aria-label="保存到项目"]`;

async function sceneRule(): Promise<void> {
	const scene = "rule";
	await boot("规则建议卡片");
	try {
		await splitAB();
		await caption(`点左边「${A.title}」，纠正它一句：${CORRECTION}`);
		await focusByMouse(A);
		await g.send("Input.insertText", { text: CORRECTION });
		await pause(200);
		await key("Enter", 13);
		const deadline = Date.now() + 20000;
		while (!model.asked.some((one) => one.kind === "classify" && one.first.includes(CORRECTION)) && Date.now() < deadline) await pause(150);
		const offered = await within(`[...document.querySelectorAll('${RULE_CARD_MARK}')].some((el) => el.checkVisibility())`, 10000);
		await pause(1200);
		const first = { a: await RULE_CARDS(A), b: await RULE_CARDS(B), focused: await focusedScreen() };
		console.log(`     模型收到：${JSON.stringify(model.asked)}`);
		check(scene, "甲被纠正后出现了规则建议卡片", offered, first);
		check(scene, "焦点在甲：卡片只画在甲屏，乙屏没有", first.a === 1 && first.b === 0, first);
		await caption(first.b > 0 ? `乙屏也画出了「${A.title}」的规则卡片` : "卡片只在甲屏");
		await shoot("01", "甲刚被纠正_两屏的规则卡片", [`${pane(A)} ${RULE_CARD_MARK}`, `${pane(B)} ${RULE_CARD_MARK}`]);

		await caption(`点右边「${B.title}」的输入框，焦点换到乙`);
		await focusByMouse(B);
		const moved = { a: await RULE_CARDS(A), b: await RULE_CARDS(B), focused: await focusedScreen() };
		check(scene, "焦点换到乙：甲屏的卡片还在，乙屏仍然没有", moved.a === 1 && moved.b === 0, moved);
		await caption(moved.a === 0 ? "焦点一走，甲屏的卡片没了——还没回答就丢了" : "焦点换到乙，甲屏的卡片还在");
		await shoot("02", "焦点换到乙_两屏的规则卡片", [`${pane(A)} ${RULE_CARD_MARK}`, `${pane(B)} ${RULE_CARD_MARK}`]);

		if (moved.a === 0) {
			check(scene, "键盘在甲屏按「保存到项目」：规则存进甲的项目", false, { skipped: "甲屏已经没有卡片可按" });
			return;
		}
		await caption("键盘把焦点移到甲屏卡片的「保存到项目」（没有鼠标按下），回车");
		await keyboardPress(`${pane(A)} ${RULE_CARD_MARK}`);
		const file = (side: Side) => join(app!.home, side.project, ".lyra", "rules", `${RULE_NAME}.md`);
		const end = Date.now() + 6000;
		while (!existsSync(file(A)) && !existsSync(file(B)) && Date.now() < end) await pause(150);
		await pause(800);
		const saved = { alpha: existsSync(file(A)), beta: existsSync(file(B)), cardsA: await RULE_CARDS(A), cardsB: await RULE_CARDS(B), focused: await focusedScreen() };
		check(scene, "键盘在甲屏按「保存到项目」：规则存进甲的项目，乙的项目里没有", saved.alpha && !saved.beta, saved);
		check(scene, "存完之后两屏都没有卡片", saved.cardsA === 0 && saved.cardsB === 0, saved);
		await caption(saved.alpha ? `规则存进了 ${A.project}/.lyra/rules/` : saved.beta ? `规则存进了乙的项目 ${B.project}` : "什么也没存下");
		await shoot("03", "键盘保存之后", [pane(A)]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// subagent: closing a delegated run from its own screen's panel.
// ---------------------------------------------------------------------------

const ROSTER_ROWS = (side: Side) => js<number>(`[...document.querySelectorAll('${pane(side)} [data-dock-pane="subagents"] [data-sub-tab]')].filter((el) => el.checkVisibility()).length`);
const DISMISS = (side: Side) => `${pane(side)} [data-dock-pane="subagents"] button[aria-label="关闭 ${SUBS[0].description}"]`;

async function sceneSubagent(): Promise<void> {
	const scene = "subagent";
	await boot("子智能体关闭");
	try {
		await caption(`打开「${A.title}」，让它派两个子智能体`);
		await click(`[data-ly-row="${A.id}"] > button`);
		await until(`document.querySelector('${field(A)}')`, 10000, "甲会话打开");
		await click(field(A));
		await g.send("Input.insertText", { text: DELEGATE });
		await pause(200);
		await key("Enter", 13);
		await until(`document.querySelector('${pane(A)} [data-ly-subagent-bar]')`, 30000, "输入框上方的子智能体条");
		// Only what the verdict needs: the whole summary carries usage and answers and buries the log.
		const listed = async () => js<Array<{ description: string; status: string }>>(`window.lyra.subAgents.list(${JSON.stringify(A.id)}).then((list) => list.map((one) => ({ description: one.description, status: one.status })))`);
		const end = Date.now() + 30000;
		while (!((await listed()).length === SUBS.length && (await listed()).every((one) => one.status !== "running")) && Date.now() < end) await pause(300);
		await within(`!document.querySelector('${pane(A)} [data-ly-run="running"]')`, 20000);
		if (!(await within(`document.querySelector('${pane(A)} [data-dock-pane="subagents"] [data-sub-tab]')?.checkVisibility()`, 2000))) {
			await caption("点子智能体条，打开甲屏的子智能体面板");
			await click(`${pane(A)} [data-ly-subagent-bar]`);
			await until(`document.querySelector('${pane(A)} [data-dock-pane="subagents"] [data-sub-tab]')?.checkVisibility()`, 8000, "甲屏的子智能体面板");
		}
		await pause(800);
		await caption(`把「${B.title}」拖进右边分屏，焦点落在乙上`);
		await dragIntoSplit(B.id, 2);
		await pause(800);
		const before = { rows: await ROSTER_ROWS(A), main: await listed(), focused: await focusedScreen() };
		console.log(`     分屏后甲的名单：${JSON.stringify(before)}`);
		check(scene, "分屏后：甲屏的子智能体面板里是甲派的两个", before.rows === SUBS.length && before.main.length === SUBS.length, before);
		await shoot("04", "焦点在乙_甲屏的子智能体面板", [`${pane(A)} [data-dock-pane="subagents"]`]);

		await caption(`键盘把焦点移到甲屏面板里「${SUBS[0].description}」那一格的「关闭」（没有鼠标按下），回车`);
		await keyboardPress(DISMISS(A));
		await within(`!document.querySelector('${DISMISS(A)}')`, 4000);
		await pause(800);
		const after = { rows: await ROSTER_ROWS(A), main: await listed(), focused: await focusedScreen() };
		console.log(`     按下之后：${JSON.stringify(after)}`);
		const gone = !after.main.some((one) => one.description === SUBS[0].description);
		check(scene, "键盘在甲屏按「关闭」：甲的那个子智能体从名单上拿掉（主进程和面板都是）", gone && after.main.length === SUBS.length - 1 && after.rows === 0, after);
		await caption(gone ? `甲的「${SUBS[0].description}」关掉了` : `按了没反应——「关闭」问的是焦点那个「${B.title}」`);
		await shoot("05", "键盘关闭之后_甲屏的子智能体面板", [`${pane(A)} [data-dock-pane="subagents"]`]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// disclosure: a process block opened in one screen, while focus moves between screens.
// ---------------------------------------------------------------------------

const PROCESS = (side: Side) => `${pane(side)} [data-ly-turn-process="done"]`;
const PROCESS_TOGGLE = (side: Side) => `${PROCESS(side)} button[aria-expanded]`;

/** Whether a screen's process block is drawn open: the flag, and the painted height of what it folds. */
const OPEN_STATE = (side: Side) => `(() => {
	const block = document.querySelector('${PROCESS(side)}');
	if (!block) return 'none';
	const body = block.lastElementChild;
	const tall = body ? Math.round(body.getBoundingClientRect().height) : -1;
	return (block.hasAttribute('data-ly-turn-open') ? 'open' : 'shut') + ':' + tall;
})()`;

async function openStates(): Promise<{ a: string; b: string; focused: string | null }> {
	return { a: await js<string>(OPEN_STATE(A)), b: await js<string>(OPEN_STATE(B)), focused: await focusedScreen() };
}

const isOpen = (state: string) => state.startsWith("open:") && Number(state.split(":")[1]) > 8;

async function sceneDisclosure(): Promise<void> {
	const scene = "disclosure";
	await boot("过程块展开状态");
	try {
		await splitAB();
		// Every painted frame from here on, so a fold that flashes by is still on the record.
		await js(`(() => {
			window.__probeOpen = [];
			let last = '';
			const tick = () => {
				const now = 'A=' + ${OPEN_STATE(A)} + ' B=' + ${OPEN_STATE(B)};
				if (now !== last) { window.__probeOpen.push({ at: Math.round(performance.now()), state: now }); last = now; }
				window.__probeOpenRaf = requestAnimationFrame(tick);
			};
			tick();
		})()`);
		await caption(`鼠标点开左边「${A.title}」的过程块`);
		await click(PROCESS_TOGGLE(A));
		await within(`document.querySelector('${PROCESS(A)}')?.hasAttribute('data-ly-turn-open')`, 4000);
		await pause(900);
		const opened = await openStates();
		check(scene, "鼠标点开甲的过程块：甲屏展开", isOpen(opened.a), opened);
		await shoot("06", "鼠标点开甲的过程块", [PROCESS(A)]);

		await caption(`点右边「${B.title}」的输入框，焦点换到乙`);
		await focusByMouse(B);
		const moved = await openStates();
		check(scene, "焦点换到乙：甲屏的过程块仍然展开", isOpen(moved.a), moved);
		await caption(isOpen(moved.a) ? "甲屏的过程块还开着" : "焦点一走，甲屏的过程块自己收起来了");
		await shoot("07", "焦点换到乙_甲屏的过程块", [PROCESS(A)]);

		await caption(`点左边「${A.title}」的输入框，焦点回到甲；再用键盘点开右边乙的过程块`);
		await focusByMouse(A);
		if (!(await js<boolean>(`document.querySelector('${PROCESS(B)}')?.hasAttribute('data-ly-turn-open')`))) await keyboardPress(PROCESS_TOGGLE(B));
		await within(`document.querySelector('${PROCESS(B)}')?.hasAttribute('data-ly-turn-open')`, 4000);
		await pause(900);
		const keyed = await openStates();
		check(scene, "键盘点开乙的过程块（焦点在甲）：乙屏展开", isOpen(keyed.b), keyed);
		await shoot("08", "键盘点开乙的过程块_焦点在甲", [PROCESS(B)]);

		await caption(`点右边「${B.title}」的输入框，焦点换到乙`);
		await focusByMouse(B);
		const back = await openStates();
		check(scene, "焦点换到乙：乙屏刚点开的过程块仍然展开", isOpen(back.b), back);
		await caption(isOpen(back.b) ? "乙屏的过程块还开着" : "焦点一到乙，乙屏刚点开的过程块反而收起来了");
		await shoot("09", "焦点换到乙_乙屏的过程块", [PROCESS(B)]);

		const frames = await js<Array<{ at: number; state: string }>>(`(() => { cancelAnimationFrame(window.__probeOpenRaf); return window.__probeOpen; })()`);
		console.log(`     逐帧：${JSON.stringify(frames)}`);
		// After each one was opened, a frame showing it shut again is a fold nobody asked for.
		const openedA = frames.findIndex((frame) => /A=open:(?!0\b)/.test(frame.state));
		const foldsA = openedA < 0 ? [] : frames.slice(openedA).filter((frame) => frame.state.includes("A=shut"));
		check(scene, "甲的过程块点开之后，没有一帧画成收起", openedA >= 0 && foldsA.length === 0, { openedAt: openedA, folds: foldsA.slice(0, 4) });
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// changebar: the counter of uncommitted changes under a screen that does not have focus.
// ---------------------------------------------------------------------------

const COUNTER = (side: Side) => `${pane(side)} button[data-ly-tip*="未提交"]`;

/** Which screen shows the Git panel, and what the Git panel in each screen lists. */
const GIT_STATE = `(() => {
	const read = (key) => {
		const panel = [...document.querySelectorAll('[data-ly-split-pane="' + key + '"] [data-dock-pane="review"]')].find((el) => el.checkVisibility());
		return panel ? panel.textContent.replace(/\\s+/g, ' ').trim().slice(0, 400) : null;
	};
	return { a: read('${A.id}'), b: read('${B.id}') };
})()`;

async function sceneChangebar(): Promise<void> {
	const scene = "changebar";
	await boot("改动统计开Git面板");
	try {
		await splitAB();
		await caption(`点左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		await until(`document.querySelector('${COUNTER(B)}')?.checkVisibility()`, 10000, "乙屏的改动统计");
		await shoot("10", "焦点在甲_两屏的改动统计", [COUNTER(A), COUNTER(B)]);

		await caption(`键盘把焦点移到右边「${B.title}」的改动统计（没有鼠标按下），回车`);
		await keyboardPress(COUNTER(B));
		await within(`[...document.querySelectorAll('[data-dock-pane="review"]')].some((el) => el.checkVisibility())`, 5000);
		await pause(2500);
		const keyed = { ...(await js<{ a: string | null; b: string | null }>(GIT_STATE)), focused: await focusedScreen() };
		console.log(`     Git 面板：${JSON.stringify(keyed)}`);
		check(scene, "键盘按乙屏的改动统计：Git 面板开在乙屏，甲屏没有", keyed.b !== null && keyed.a === null, { inA: keyed.a !== null, inB: keyed.b !== null, focused: keyed.focused });
		check(scene, "乙屏的 Git 面板列的是乙的改动（lib.ts）", Boolean(keyed.b?.includes("lib.ts")), { b: keyed.b });
		await caption(keyed.a !== null ? "Git 面板开在了焦点所在的甲屏" : keyed.b?.includes("lib.ts") ? "Git 面板开在乙屏，列的是乙的改动" : "Git 面板开在乙屏，但列的不是乙的改动");
		await shoot("11", "键盘按乙的改动统计之后", ['[data-dock-pane="review"]']);

		// The panel has to go on showing its own screen's repository while focus moves about.
		await caption(`点右边乙，再点回左边甲——乙屏的 Git 面板要一直是乙的`);
		if (keyed.b === null) await click(COUNTER(B));
		await focusByMouse(B);
		await focusByMouse(A);
		await pause(2000);
		const moved = { ...(await js<{ a: string | null; b: string | null }>(GIT_STATE)), focused: await focusedScreen() };
		console.log(`     焦点回到甲之后：${JSON.stringify(moved)}`);
		check(scene, "焦点回到甲：乙屏的 Git 面板仍是乙的改动", Boolean(moved.b?.includes("lib.ts")), { b: moved.b, focused: moved.focused });
		await shoot("12", "焦点回到甲_乙屏的Git面板", ['[data-dock-pane="review"]']);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// hiccup: 「继续」 under a turn that failed, in the screen without focus.
// ---------------------------------------------------------------------------

const NEXT = (side: Side) => `${pane(side)} [data-hiccup="gave_up"] [data-resume-continue]`;

async function sceneHiccup(): Promise<void> {
	const scene = "hiccup";
	await boot("失败后继续");
	try {
		await caption(`打开「${B.title}」，发一句会让请求失败的话`);
		await click(`[data-ly-row="${B.id}"] > button`);
		await until(`document.querySelector('[data-ly-split-pane="${B.id}"] textarea')`, 10000, "乙会话打开");
		await click(`[data-ly-split-pane="${B.id}"] textarea`);
		await g.send("Input.insertText", { text: FAIL });
		await pause(200);
		await key("Enter", 13);
		await until(`document.querySelector('${NEXT(B)}')`, 30000, "乙的失败记录和「继续」");
		await pause(800);
		await caption(`把「${A.title}」拖进右边分屏，焦点落在甲上`);
		await dragIntoSplit(A.id, 2);
		await pause(800);
		await shoot("13", "焦点在甲_乙屏的失败记录", [`${pane(B)} [data-hiccup]`]);

		await caption(`键盘把焦点移到左边乙的「继续」（没有鼠标按下），回车`);
		const count = model.asked.length;
		await keyboardPress(NEXT(B));
		const end = Date.now() + 15000;
		while (!model.asked.slice(count).some((one) => one.kind === "chat" && one.last.includes(CARRY_ON)) && Date.now() < end) await pause(150);
		await pause(3000);
		const request = model.asked.slice(count).find((one) => one.kind === "chat" && one.last.includes(CARRY_ON));
		console.log(`     模型收到：${JSON.stringify(model.asked.slice(count))}`);
		check(scene, "模型收到的「继续」属于乙会话（乙的项目、乙的第一句）", request?.project === B.project && request.first === B.ask, request ?? null);
		const texts = { a: await screenText(A), b: await screenText(B) };
		check(scene, "回复画在乙屏，甲屏没有多出「继续」的回复", texts.b.includes(`已收到「${CARRY_ON.slice(0, 10)}`) && !texts.a.includes(`已收到「${CARRY_ON.slice(0, 10)}`), { a: texts.a.slice(-160), b: texts.b.slice(-160) });
		await caption(request?.project === B.project ? "「继续」发给了乙会话" : `「继续」发给了焦点所在的「${A.title}」`);
		await shoot("14", "键盘按乙的继续之后", [pane(A), pane(B)]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// revert and edit: the two actions under a message a person sent.
// ---------------------------------------------------------------------------

async function sceneRevert(): Promise<void> {
	const scene = "revert";
	await boot("键盘撤回");
	try {
		await splitAB();
		await caption(`点左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		await shoot("15", "撤回前_焦点在甲", [`${pane(B)} [data-message-undo]`]);

		await caption(`键盘把焦点移到右边「${B.title}」那条消息的「撤回」（没有鼠标按下），回车`);
		await keyboardPress(`${pane(B)} [data-message-undo]`);
		await pause(2500);
		const dialog = await js<boolean>(`Boolean(document.querySelector('[data-ly-modal]'))`);
		const shown = { a: await screenText(A), b: await screenText(B) };
		const disk = { a: await onDisk(A), b: await onDisk(B) };
		console.log(`     撤回后：${JSON.stringify({ dialog, disk, a: shown.a.slice(0, 160), b: shown.b.slice(0, 160) })}`);
		check(scene, "甲会话一个字没动（屏上和盘上都还有甲的问题）", shown.a.includes(A.ask) && disk.a.includes(A.ask), { screen: shown.a.slice(0, 120), disk: disk.a });
		check(scene, "撤回落在乙会话（乙的问题从屏上和盘上拿掉）", !shown.b.includes(B.ask) && !disk.b.includes(B.ask), { screen: shown.b.slice(0, 120), disk: disk.b, dialog });
		await caption(disk.a.includes(A.ask) ? (disk.b.includes(B.ask) ? "什么也没撤回" : "撤回的是乙自己的消息") : `撤回的是焦点所在的「${A.title}」的消息`);
		await shoot("16", "键盘撤回之后", [pane(A), pane(B)]);
	} finally {
		await shutdown();
	}
}

async function sceneEdit(): Promise<void> {
	const scene = "edit";
	await boot("键盘编辑重发");
	try {
		await splitAB();
		await caption(`点左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		await caption(`键盘把焦点移到右边「${B.title}」那条消息的「编辑并重新发送」，回车`);
		await keyboardPress(`${pane(B)} button[aria-label="编辑并重新发送"]`);
		const editor = `${pane(B)} [data-question-index="0"] textarea`;
		await until(`document.querySelector('${editor}')`, 5000, "乙屏的消息编辑框");
		await js(`(() => { const el = document.querySelector('${editor}'); el.focus(); el.select(); })()`);
		await g.send("Input.insertText", { text: EDITED });
		await pause(300);
		await shoot("17", "键盘编辑乙的消息_发送前", [editor]);
		await caption("回车重新发送");
		const count = model.asked.length;
		await key("Enter", 13);
		const end = Date.now() + 15000;
		while (!model.asked.slice(count).some((one) => one.kind === "chat" && one.last.includes(EDITED)) && Date.now() < end) await pause(150);
		await pause(3000);
		const request = model.asked.slice(count).find((one) => one.kind === "chat" && one.last.includes(EDITED));
		const shown = { a: await screenText(A), b: await screenText(B) };
		const disk = { a: await onDisk(A), b: await onDisk(B) };
		console.log(`     模型收到：${JSON.stringify(model.asked.slice(count))}\n     盘上：${JSON.stringify(disk)}`);
		check(scene, "重发的这一轮属于乙会话（请求带的是乙的项目）", request?.project === B.project, request ?? null);
		check(scene, "甲会话一个字没动（屏上和盘上都还是甲的问题）", shown.a.includes(A.ask) && !shown.a.includes(EDITED) && disk.a.includes(A.ask) && !disk.a.includes(EDITED), { screen: shown.a.slice(0, 160), disk: disk.a });
		check(scene, "乙会话换成了改过的问题", shown.b.includes(EDITED) && disk.b.includes(EDITED) && !disk.b.includes(B.ask), { screen: shown.b.slice(0, 160), disk: disk.b });
		await caption(request?.project === B.project ? "改的是乙自己的消息" : `改写、重发的是焦点所在的「${A.title}」`);
		await shoot("18", "键盘编辑重发之后", [pane(A), pane(B)]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	await mkdir(OUT, { recursive: true });
	const scenes: Record<string, () => Promise<void>> = {
		rule: sceneRule,
		subagent: sceneSubagent,
		disclosure: sceneDisclosure,
		changebar: sceneChangebar,
		hiccup: sceneHiccup,
		revert: sceneRevert,
		edit: sceneEdit,
	};
	const run = SCENE === "all" ? Object.keys(scenes) : SCENE.split(",");
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
	const file = join(OUT, `${STAMP}_${LABEL}_${SCENE.replaceAll(",", "+")}_${passed}of${checks.length}.json`);
	await writeFile(file, JSON.stringify(checks, null, 2));
	console.log(`\n${passed}/${checks.length} 通过  ${file}`);
	if (passed !== checks.length) process.exitCode = 1;
}

await main().catch(async (error) => {
	console.error(error);
	await shutdown().catch(() => {});
	process.exitCode = 1;
});
