/* oxlint-disable no-console -- probe CLI: what it prints is the evidence */
/**
 * The last split-view scoping faults, reproduced in a real window.
 *
 *   side      The side chat under a screen without focus named the focused conversation's model and
 *             effort as the ones its next question would follow.
 *   capsule   A conversation capsule pressed by keyboard on a screen without focus replaced the
 *             focused screen, not the one it was pressed on.
 *   picker    The composer's project menu on a blank screen reached by keyboard ticked the focused
 *             conversation's project, and a project chosen there started 新对话 from the focused
 *             conversation — which in a split closes the other screens, the blank one included.
 *   delivery  The delivery review in a screen without focus named its files from the focused
 *             project, and opening a review in one screen closed the one another screen had open.
 *   fork      A conversation forked from the trajectory panel of a screen reached by keyboard
 *             replaced the focused screen, not the one the panel was in.
 *   popout    A file opened from a Files panel popped out of a screen opened in the screen with
 *             focus, not in the screen the panel came from.
 *
 * Same method as `split-scope-more-probe.ts`: verdicts come from what the window painted, from what
 * the fake model was asked and from what is on disk — never from the store. Every press is a real
 * CDP mouse or key event. The keyboard path is `el.focus()` and a key: focus arrives the way Tab
 * brings it, without the pointer press that would have focused the screen first.
 *
 * Screenshots, recordings and the measured numbers land in ~/Desktop/分屏串台收尾测试/.
 *
 * Usage: node --experimental-strip-types e2e/split-scope-tail-probe.ts <side|capsule|picker|delivery|fork|popout|all> <before|after>
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

const PORT = 9774;
const OUT = join(homedir(), "Desktop", "分屏串台收尾测试");
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
	/** A folder under the profile; for a project-less conversation, one under its scratch root. */
	project: string;
	/** Null for the conversation that is not in a project. */
	branch: string | null;
	ask: string;
	answer: string;
	dirty: string[];
	model: string;
	projectId: string;
}

const A: Side = { id: "split-a", title: "甲会话", project: "alpha-app", branch: "main", ask: "甲会话的第一个问题", answer: "甲会话的回答。", dirty: ["README.md", "app.ts"], model: "qa/model-2", projectId: "" };
const B: Side = { id: "split-b", title: "乙会话", project: "beta-lib", branch: "beta-work", ask: "乙会话的第一个问题", answer: "乙会话的回答。", dirty: ["README.md", "lib.ts"], model: "qa/model", projectId: "" };
/** Not in any project: its directory sits under the scratch root, the way 「不在项目中工作」 files it. */
const C: Side = { id: "split-c", title: "丙闲聊", project: "workspaces/chat-c", branch: null, ask: "丙闲聊的第一个问题", answer: "丙闲聊的回答。", dirty: [], model: "qa/model", projectId: "" };

const MODELS = [
	{ id: "qa/model", name: "QA" },
	{ id: "qa/model-2", name: "QA 2" },
];

/** Makes the model edit a file in the asking conversation's project: that turn gets a delivery record. */
const EDIT = "改一下文件";
/** What the side chat is asked in the side scene, so its request can be picked out. */
const SIDE_ASK = "侧边聊天：这个会话用的是哪个模型？";

// ---------------------------------------------------------------------------
// A scripted model: answers by who is asking, and notes which project and model each request names.
// ---------------------------------------------------------------------------

interface Asked {
	kind: "chat" | "title";
	first: string;
	last: string;
	result: boolean;
	project: string | null;
	model: string | null;
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
			const body = JSON.parse(raw || "{}") as { model?: string; messages?: Array<{ role: string; content: unknown }>; tools?: Array<{ name: string }> };
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
			// The title request carries no tools; a conversation turn offers todo_write.
			const kind: Asked["kind"] = (body.tools ?? []).some((tool) => tool.name === "todo_write") ? "chat" : "title";
			const project = raw.includes(`/${A.project}`) ? A.project : raw.includes(`/${B.project}`) ? B.project : raw.includes(`/${C.project}`) ? C.project : null;
			asked.push({ kind, first, last, result, project, model: body.model ?? null });

			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			const begin = (input: number) => emit("message_start", { message: { id: `probe-${++call}`, role: "assistant", content: [], usage: { input_tokens: input, output_tokens: 0 } } });
			const end = (stop: string) => {
				emit("message_delta", { delta: { stop_reason: stop }, usage: { output_tokens: 12 } });
				emit("message_stop", {});
				res.end();
			};
			const say = (text: string) => {
				emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
				emit("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
				emit("content_block_stop", { index: 0 });
			};

			if (kind === "title") {
				begin(50);
				say("探针会话");
				end("end_turn");
				return;
			}
			if (!result && last.includes(EDIT) && project && project !== C.project) {
				// A new file in the asking project, so the finished turn has something to deliver. New
				// because `write` over an existing file is refused until the session has read it.
				const file = `delivered-${project}.ts`;
				begin(300);
				emit("content_block_start", { index: 0, content_block: { type: "tool_use", id: `call-${call}`, name: "write", input: {} } });
				emit("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ path: file, content: `// ${project} ${file}\nexport const edited = "${project}";\n` }) } });
				emit("content_block_stop", { index: 0 });
				end("tool_use");
				return;
			}
			begin(50);
			if (result) say("改好了。");
			else say(`已收到「${last.slice(0, 30)}」。`);
			end("end_turn");
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
// Two projects with uncommitted work, one conversation in each, and one conversation that is in no
// project at all.
// ---------------------------------------------------------------------------

/** The Command Line Tools git when present: a full Xcode whose licence nobody accepted refuses every git call. */
function gitEnv(): NodeJS.ProcessEnv {
	const clt = "/Library/Developer/CommandLineTools";
	return existsSync(clt) ? { ...process.env, DEVELOPER_DIR: clt } : process.env;
}

const git = (cwd: string, ...args: string[]) => promisify(execFile)("git", args, { cwd, env: gitEnv() });

async function seed(home: string, modelPort: number, scene: string): Promise<void> {
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const metas = [];
	const projects = [];
	for (const [index, one] of [A, B, C].entries()) {
		const cwd = join(home, one.project);
		await mkdir(cwd, { recursive: true });
		if (one.branch) {
			await git(cwd, "init", "-q", "-b", one.branch);
			await git(cwd, "config", "user.email", "probe@example.com");
			await git(cwd, "config", "user.name", "probe");
			for (const file of one.dirty) await writeFile(join(cwd, file), `# ${one.project} ${file}\n`);
			await git(cwd, "add", ...one.dirty);
			await git(cwd, "commit", "-qm", "seed");
		}
		const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
		one.projectId = projectId;
		if (one.branch) projects.push({ id: projectId, path: cwd, name: one.project, pinned: true, lastOpenedAt: 10 - index });
		const at = 1_790_000_000_000 + index * 60_000;
		// 乙's first question referred to 丙 with @, in the capsule scene: the message carries a capsule for it.
		const refs = scene === "capsule" && one === B ? { sessionRefs: [{ id: C.id, title: C.title }] } : {};
		const asked = { role: "user", content: [{ type: "text", text: one.ask }], timestamp: at, ...refs };
		const answered = { role: "assistant", content: [{ type: "text", text: one.answer }], api: "anthropic-messages", provider: "qa", model: one.model.split("/")[1], usage, stopReason: "stop", timestamp: at + 1 };
		const messages: object[] = [asked, answered];
		const last = messages.length + 2;
		const updatedAt = at + messages.length;
		// 甲 thinks hard in the side scene, so the two conversations' efforts say different things.
		const thinking = scene === "side" && one === A ? { thinking: "high" } : {};
		const meta = { id: one.id, title: one.title, projectId, projectName: one.branch ? one.project : "Chat", cwd, createdAt: at, updatedAt, modelId: one.model, messageCount: messages.length, usage, seq: last, ...thinking };
		metas.push(meta);
		await mkdir(join(home, "sessions", projectId), { recursive: true });
		// Outer seq starts at 1: a record at 0 is read past and the session never reaches the sidebar.
		await writeFile(
			join(home, "sessions", projectId, `${one.id}.jsonl`),
			[
				JSON.stringify({ seq: 1, ts: at, type: "meta", meta: { ...meta, seq: 0 } }),
				...messages.map((message, i) => JSON.stringify({ seq: i + 2, ts: at, type: "message", message })),
				JSON.stringify({ seq: last, ts: updatedAt, type: "meta", meta }),
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
					models: MODELS.map((model) => ({ id: model.id, providerId: "qa", modelId: model.id.split("/")[1], name: model.name, contextWindow: 128000, maxOutputTokens: 4096, supportsImages: false, supportsTools: true, supportsThinking: true })),
				},
			],
			defaultModelId: "qa/model",
			mcpServers: [], hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			permissionMode: "full", thinking: "off", retryAttempts: 1, projectMemory: false,
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

async function within(expression: string, ms: number): Promise<boolean> {
	return until(expression, ms).then(() => true, () => false);
}

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

async function key(name: string, code: number, modifiers = 0): Promise<void> {
	await g.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code, modifiers });
	await g.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code, modifiers });
}

/**
 * Reach a control the way the keyboard does and press Enter on it.
 *
 * Focus is moved without any pointer event — what Tab does — so the screen's own press-to-focus
 * never runs. Enter carries its character, which is what makes the browser activate a button.
 * `find` is an expression naming the element, for a control a selector cannot reach by its text.
 */
async function keyboardPress(selector: string, find = `document.querySelector(${JSON.stringify(selector)})`): Promise<void> {
	await until(find, 15000, selector);
	const focused = await js<boolean>(`(() => {
		const el = ${find};
		el.focus();
		return document.activeElement === el;
	})()`);
	if (!focused) throw new Error(`键盘焦点落不到 ${selector} 上`);
	await pause(250);
	await g.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
	await g.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
	await pause(250);
}

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

/** Drag a sidebar conversation onto the right edge of the workspace, the way a hand does it. */
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
const focusedScreen = () => js<string | null>(`document.querySelector('[data-ly-split-pane][data-ly-split-focused]')?.getAttribute('data-ly-split-pane') ?? null`);

async function open(side: Side): Promise<void> {
	await caption(`打开「${side.title}」（${side.branch ? side.project : "不在项目中"}）`);
	await click(`[data-ly-row="${side.id}"] > button`);
	await until(`document.querySelector('${field(side)}')`, 10000, `${side.title}打开`);
}

/** Open 甲, then carry 乙 in beside it: two screens, focus on 乙. */
async function splitAB(): Promise<void> {
	await open(A);
	await caption(`把「${B.title}」（${B.project}）拖进右边分屏，焦点落在乙上`);
	await dragIntoSplit(B.id, 2);
}

async function focusByMouse(side: Side): Promise<void> {
	await click(field(side));
	await until(`document.querySelector('${pane(side)}[data-ly-split-focused]')`, 8000, `焦点切到 ${side.title}`);
	await pause(1200);
}

/** Type into a screen's composer after a press on it, and send. */
async function say(side: Side, text: string): Promise<void> {
	await focusByMouse(side);
	await g.send("Input.insertText", { text });
	await pause(200);
	await key("Enter", 13);
}

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

async function boot(scene: string, title: string, rows: Side[] = [A, B]): Promise<void> {
	model = await startModel();
	app = await startApp({ port: PORT, seed: (home) => seed(home, model.port, scene) });
	g = await frameGrabber(PORT);
	await until(rows.map((side) => `document.querySelector('[data-ly-row="${side.id}"]')`).join(" && "), 30000, "侧栏出现会话");
	await pause(600);
	const reel = { scene: title, frames: [] as Frame[], rolling: true, done: Promise.resolve() };
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


/** The screens left to right, and which one has focus. */
const SCREENS = `(() => ({
	keys: [...document.querySelectorAll('[data-ly-split-pane]')].map((el) => el.getAttribute('data-ly-split-pane')),
	focused: document.querySelector('[data-ly-split-pane][data-ly-split-focused]')?.getAttribute('data-ly-split-pane') ?? null,
}))()`;
type Screens = { keys: string[]; focused: string | null };

/** A row of an open menu, by its text: an expression, for `keyboardPress`. */
const menuRow = (test: string) => `[...document.querySelectorAll('[role="menuitem"]')].find((el) => ${test})`;

// ---------------------------------------------------------------------------
// side: the model and effort the side chat under a screen without focus says it will follow.
// ---------------------------------------------------------------------------

const SIDE_PANE = (side: Side) => `${pane(side)} [data-dock-pane="chat"]`;
const SIDE_MODEL = (side: Side) => `${SIDE_PANE(side)} button[aria-label="侧边聊天模型"]`;
const SIDE_EFFORT = (side: Side) => `${SIDE_PANE(side)} button[aria-label^="推理强度"]`;
const SIDE_READ = `(() => ({
	model: document.querySelector('${SIDE_MODEL(B)}')?.textContent.trim() ?? null,
	effort: document.querySelector('${SIDE_EFFORT(B)}')?.getAttribute('aria-label') ?? null,
}))()`;

async function sceneSide(): Promise<void> {
	const scene = "side";
	await boot(scene, "侧边聊天的模型");
	try {
		await splitAB();
		await caption(`在右边「${B.title}」的标题栏打开「面板」菜单，选「侧边聊天」（甲：QA 2、推理强度高；乙：QA、推理强度关）`);
		await keyboardPress(`${pane(B)} button[data-ly-toolbar-button][aria-label="面板"]`);
		await keyboardPress("菜单里的「侧边聊天」", menuRow(`el.textContent.trim().startsWith('侧边聊天')`));
		await until(`document.querySelector('${SIDE_MODEL(B)}')?.checkVisibility()`, 8000, "乙屏的侧边聊天");
		await pause(1200);
		const onB = { ...(await js<{ model: string | null; effort: string | null }>(SIDE_READ)), focused: await focusedScreen() };
		console.log(`     焦点在乙：${JSON.stringify(onB)}`);
		check(scene, "焦点在乙（对照）：乙屏的侧边聊天跟随乙的模型 QA、推理强度关", onB.model === "QA" && onB.effort === "推理强度：关", onB);

		await caption(`点左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		const onA = { ...(await js<{ model: string | null; effort: string | null }>(SIDE_READ)), focused: await focusedScreen() };
		console.log(`     焦点在甲：${JSON.stringify(onA)}`);
		check(scene, "焦点在甲：乙屏的侧边聊天仍跟随乙的模型 QA（不是甲的 QA 2）", onA.model === "QA", onA);
		check(scene, "焦点在甲：乙屏的侧边聊天仍是乙的推理强度「关」（不是甲的「高」）", onA.effort === "推理强度：关", onA);
		await caption(onA.model === "QA" ? "乙屏的侧边聊天讲乙：QA、推理强度关" : `乙屏的侧边聊天说它跟随「${onA.model}」、${onA.effort}——那是甲的`);
		await shoot("01", "焦点在甲_乙屏侧边聊天的模型和推理强度", [SIDE_MODEL(B), SIDE_EFFORT(B), `${pane(A)} button[aria-label="选择模型"]`]);

		await caption(`键盘在右边侧边聊天的模型按钮上回车（没有鼠标按下），看「跟随主会话」那一行`);
		await keyboardPress(SIDE_MODEL(B));
		await until(menuRow(`el.textContent.startsWith('跟随主会话')`), 6000, "侧边聊天的模型菜单");
		await pause(500);
		const follow = await js<string | null>(`${menuRow(`el.textContent.startsWith('跟随主会话')`)}?.textContent ?? null`);
		check(scene, "焦点在甲：乙屏侧边聊天菜单里「跟随主会话」写的是乙的模型 QA", follow === "跟随主会话QA", { follow });
		await shoot("02", "乙屏侧边聊天的模型菜单", ['[role="menuitem"][data-selected="true"]', `[role="menuitem"]`]);
		await key("Escape", 27);
		await pause(400);

		await caption(`键盘在右边侧边聊天里问一句（没有鼠标按下）——模型收到的请求用的是谁的模型`);
		const field = `${SIDE_PANE(B)} textarea`;
		await js(`document.querySelector('${field}').focus()`);
		await pause(200);
		await g.send("Input.insertText", { text: SIDE_ASK });
		await pause(200);
		await key("Enter", 13);
		const deadline = Date.now() + 15000;
		while (Date.now() < deadline && !model.asked.some((one) => one.last === SIDE_ASK)) await pause(200);
		const request = model.asked.find((one) => one.last === SIDE_ASK);
		console.log(`     侧边聊天的请求：${JSON.stringify(request)}`);
		check(scene, "侧边聊天实际发出的请求用的是乙的模型（显示错的时候，发出去的也一直是对的）", request?.model === B.model.split("/")[1], { model: request?.model ?? null });
		await pause(1500);
		await shoot("03", "乙屏侧边聊天发出去之后", [SIDE_PANE(B)]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// capsule: a conversation capsule on a message in the screen without focus.
// ---------------------------------------------------------------------------

const CAPSULE = `${pane(B)} button[data-ly-tip="点击切换至该会话"]`;

async function sceneCapsule(path: "keyboard" | "mouse"): Promise<void> {
	const scene = `capsule-${path}`;
	await boot("capsule", path === "keyboard" ? "会话胶囊_键盘路径" : "会话胶囊_鼠标路径", [A, B, C]);
	try {
		await splitAB();
		await caption(`点左边「${A.title}」的输入框，焦点换到甲。乙的第一句话用 @ 引用了「${C.title}」`);
		await focusByMouse(A);
		const before = await js<Screens>(SCREENS);
		console.log(`     按下前：${JSON.stringify(before)}`);
		await shoot(path === "keyboard" ? "04" : "06", `${path === "keyboard" ? "键盘" : "鼠标"}路径_按下前_乙屏消息上的会话胶囊`, [CAPSULE]);
		if (path === "keyboard") {
			await caption(`键盘把焦点移到右边乙屏消息上的「${C.title}」胶囊（没有鼠标按下），回车`);
			await keyboardPress(CAPSULE);
		} else {
			await caption(`鼠标点右边乙屏消息上的「${C.title}」胶囊`);
			await click(CAPSULE);
		}
		await until(`document.querySelector('[data-ly-split-pane="${C.id}"]')`, 10000, "丙出现在分屏里");
		await pause(1500);
		const after = await js<Screens>(SCREENS);
		console.log(`     按下后：${JSON.stringify(after)}`);
		const right = after.keys.join(",") === `${A.id},${C.id}` && after.focused === C.id;
		check(scene, `${path === "keyboard" ? "键盘" : "鼠标"}：丙换掉的是按下胶囊的乙屏（左边的甲还在），焦点落在丙上`, right, { before, after });
		await caption(right ? "丙开在按下的那一屏（乙屏），甲屏还在" : `丙换掉了${after.keys[0] === C.id ? "左边有焦点的甲屏" : "别的屏"}`);
		await shoot(path === "keyboard" ? "05" : "07", `${path === "keyboard" ? "键盘" : "鼠标"}路径_按下后`, [`[data-ly-split-pane="${C.id}"]`]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// picker: the project menu on a blank screen reached by keyboard.
// ---------------------------------------------------------------------------

const DRAFT = `[data-ly-split-pane="@draft"]`;
/** The composer's project chip in a screen, by the project it names: an expression. */
const chip = (screen: string, name: string) => `[...document.querySelectorAll('${screen} button')].find((el) => el.textContent.trim() === '${name}')`;
const TICKED = `[...document.querySelectorAll('[role="menuitem"][data-selected="true"]')].map((el) => el.getAttribute('data-ly-tip'))`;

async function scenePicker(path: "keyboard" | "mouse"): Promise<void> {
	const scene = `picker-${path}`;
	await boot("picker", path === "keyboard" ? "项目菜单_键盘路径" : "项目菜单_鼠标路径");
	try {
		await caption(`在「${A.project}」里新建一个空白对话`);
		await click(`button[aria-label="在「${A.project}」里新建会话"]`);
		await until(`document.querySelector('${DRAFT} textarea')`, 10000, "空白对话");
		await caption(`把「${B.title}」（${B.project}）拖进右边分屏，焦点落在它上面`);
		await dragIntoSplit(B.id, 2);
		const before = await js<Screens>(SCREENS);
		console.log(`     分屏：${JSON.stringify(before)}`);
		await until(chip(DRAFT, A.project), 5000, "左边空白对话的项目按钮");
		if (path === "keyboard") {
			await caption(`键盘把焦点移到左边空白对话的项目按钮「${A.project}」（没有鼠标按下），回车`);
			await keyboardPress("左屏的项目按钮", chip(DRAFT, A.project));
		} else {
			await caption(`鼠标点左边空白对话的项目按钮「${A.project}」`);
			const at = await js<{ x: number; y: number }>(`(() => { const el = ${chip(DRAFT, A.project)}; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
			await g.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
			await g.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 });
			await g.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 });
		}
		await until(`document.querySelector('[role="menuitem"][data-ly-tip]')`, 6000, "项目菜单");
		await pause(600);
		const ticked = await js<string[]>(TICKED);
		console.log(`     勾选：${JSON.stringify(ticked)}`);
		check(scene, `${path === "keyboard" ? "键盘" : "鼠标"}：左屏的项目菜单勾的是左屏自己的项目 ${A.project}`, ticked.length === 1 && ticked[0].endsWith(`/${A.project}`), { ticked });
		await caption(ticked[0]?.endsWith(`/${A.project}`) ? `菜单勾的是左屏的 ${A.project}` : `菜单勾的是右边乙的 ${B.project}`);
		await shoot(path === "keyboard" ? "08" : "10", `${path === "keyboard" ? "键盘" : "鼠标"}路径_左屏的项目菜单`, ['[role="menuitem"][data-selected="true"]']);

		await caption(`在菜单里选「${B.project}」——左边这段空白对话换到 ${B.project}`);
		if (path === "keyboard") await keyboardPress(`菜单里的「${B.project}」`, menuRow(`el.textContent.trim() === '${B.project}'`));
		else {
			const at = await js<{ x: number; y: number }>(`(() => { const el = ${menuRow(`el.textContent.trim() === '${B.project}'`)}; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
			await g.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
			await g.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 });
			await g.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 });
		}
		await pause(2000);
		const after = await js<Screens & { count: string | null; draftChip: string | null }>(`(() => ({
			...${SCREENS},
			count: document.querySelector('[data-ly-split-root]')?.dataset.lySplitCount ?? null,
			draftChip: ${chip(DRAFT, B.project)}?.textContent.trim() ?? null,
		}))()`);
		console.log(`     选了之后：${JSON.stringify(after)}`);
		check(scene, `${path === "keyboard" ? "键盘" : "鼠标"}：选了之后仍是两屏，右边的「${B.title}」还在`, after.keys.includes(B.id) && after.keys.length === 2, after);
		check(scene, `${path === "keyboard" ? "键盘" : "鼠标"}：左边空白对话换到了 ${B.project}`, after.keys.includes("@draft") && after.draftChip === B.project, after);
		await caption(after.keys.includes(B.id) ? `左边空白对话换到 ${B.project}，右边乙还在` : `分屏被整个重置：乙屏没了，只剩一段 ${B.project} 里的新对话`);
		await shoot(path === "keyboard" ? "09" : "11", `${path === "keyboard" ? "键盘" : "鼠标"}路径_选了项目之后`, [DRAFT]);
	} finally {
		await shutdown();
	}
}

/** A real press on whatever `find` names, in the main window or in another one. */
async function clickFound(find: string, win: { evaluate: <T>(expression: string) => Promise<T>; send: <T>(method: string, params?: Record<string, unknown>) => Promise<T> } = { evaluate: js, send: g.send }): Promise<void> {
	const at = await win.evaluate<{ x: number; y: number }>(`(() => { const el = ${find}; if (!el) throw new Error('missing'); el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	await win.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await win.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 });
	await win.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 });
	await pause(250);
}

// ---------------------------------------------------------------------------
// delivery: the delivery review in each of two screens.
// ---------------------------------------------------------------------------

const REVIEW = (side: Side) => `${pane(side)} [data-turn-delivery] button[data-ly-tip="审核全部文件改动"]`;
/** The file names each screen's delivery panel draws, as read. */
const DELIVERY_READ = `(() => {
	const read = (key) => {
		const panel = [...document.querySelectorAll('[data-ly-split-pane="' + key + '"] [data-dock-pane="delivery"]')].find((el) => el.checkVisibility());
		if (!panel) return null;
		return [...panel.querySelectorAll('section[data-delivery-diff]')].map((section) => section.querySelector('span.min-w-0')?.textContent ?? '');
	};
	return { a: read('${A.id}'), b: read('${B.id}') };
})()`;
type Reviews = { a: string[] | null; b: string[] | null };
const delivered = (side: Side) => `delivered-${side.project}.ts`;

async function sceneDelivery(): Promise<void> {
	const scene = "delivery";
	await boot("delivery", "文件变更面板");
	try {
		await splitAB();
		await caption(`左边「${A.title}」让模型新写一个文件`);
		await say(A, `甲：${EDIT}`);
		await until(`document.querySelector('${REVIEW(A)}')`, 25000, "甲屏的文件变更卡片");
		await caption(`右边「${B.title}」也让模型新写一个文件`);
		await say(B, `乙：${EDIT}`);
		await until(`document.querySelector('${REVIEW(B)}')`, 25000, "乙屏的文件变更卡片");
		await pause(800);

		await caption(`鼠标点左边甲屏卡片上的「审核」`);
		await click(REVIEW(A));
		await until(`document.querySelector('${pane(A)} [data-dock-pane="delivery"] section[data-delivery-diff]')`, 8000, "甲屏的文件变更面板");
		await pause(1000);
		const first = { ...(await js<Reviews>(DELIVERY_READ)), focused: await focusedScreen() };
		console.log(`     甲屏打开审核：${JSON.stringify(first)}`);
		check(scene, "焦点在甲（对照）：甲屏的文件变更列的是甲的文件，按甲的项目截成相对路径", first.a?.join() === delivered(A), first);
		await shoot("12", "甲屏打开文件变更", [`${pane(A)} [data-dock-pane="delivery"]`]);

		await caption(`键盘在右边乙屏卡片上的「审核」回车（没有鼠标按下，焦点还在甲）`);
		await keyboardPress(REVIEW(B));
		await until(`document.querySelector('${pane(B)} [data-dock-pane="delivery"] section[data-delivery-diff]')`, 8000, "乙屏的文件变更面板");
		await pause(1500);
		const both = { ...(await js<Reviews>(DELIVERY_READ)), focused: await focusedScreen() };
		console.log(`     乙屏打开审核之后：${JSON.stringify(both)}`);
		check(scene, `焦点在甲：乙屏的文件变更按乙的项目截成相对路径（${delivered(B)}）`, both.b?.join() === delivered(B), both);
		check(scene, "乙屏打开文件变更之后，甲屏的文件变更还开着、仍是甲的文件", both.a?.join() === delivered(A), both);
		const said = both.b?.[0] ?? "";
		await caption(both.a === null ? `甲屏的文件变更被关掉了；乙屏写成「${said}」` : `两屏各是各的文件变更；乙屏写成「${said}」`);
		await shoot("13", "焦点在甲_乙屏打开文件变更之后", [`${pane(A)} [data-dock-pane="delivery"]`, `${pane(B)} [data-dock-pane="delivery"]`]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// fork: a conversation forked from the trajectory panel of the screen without focus.
// ---------------------------------------------------------------------------

const TRACE = `${pane(B)} [data-dock-pane="trajectory"]`;
const TRACE_ACTIONS = `${TRACE} [data-trace-inspector-header] button[aria-label="记录操作"]`;
const FORK_ROW = menuRow(`el.textContent.trim() === '从这里分叉'`);

async function sceneFork(path: "keyboard" | "mouse"): Promise<void> {
	const scene = `fork-${path}`;
	await boot("fork", path === "keyboard" ? "轨迹分叉_键盘路径" : "轨迹分叉_鼠标路径");
	try {
		await splitAB();
		await caption(`在右边「${B.title}」的标题栏打开「面板」菜单，选「轨迹」`);
		await keyboardPress(`${pane(B)} button[data-ly-toolbar-button][aria-label="面板"]`);
		await keyboardPress("菜单里的「轨迹」", menuRow(`el.textContent.trim().startsWith('轨迹')`));
		await until(`document.querySelector('${TRACE} button[data-trace-entry]')`, 12000, "乙屏的轨迹记录");
		await pause(800);
		await caption(`选中乙轨迹里的第一条记录`);
		await keyboardPress("乙屏轨迹的第一条记录", `document.querySelector('${TRACE} button[data-trace-entry]')`);
		await until(`document.querySelector('${TRACE_ACTIONS}')`, 6000, "记录的检查器");
		await caption(`点左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		const before = await js<Screens>(SCREENS);
		console.log(`     分叉前：${JSON.stringify(before)}`);
		await shoot(path === "keyboard" ? "14" : "16", `${path === "keyboard" ? "键盘" : "鼠标"}路径_分叉前_乙屏选中的记录`, [TRACE_ACTIONS]);
		if (path === "keyboard") {
			await caption(`键盘在右边乙屏的「记录操作」上回车，再在「从这里分叉」上回车（没有鼠标按下）`);
			await keyboardPress(TRACE_ACTIONS);
			await until(FORK_ROW, 5000, "记录操作菜单");
			await keyboardPress("从这里分叉", FORK_ROW);
		} else {
			await caption(`鼠标点右边乙屏的「记录操作」，再点「从这里分叉」`);
			await click(TRACE_ACTIONS);
			await until(FORK_ROW, 5000, "记录操作菜单");
			await clickFound(FORK_ROW);
		}
		const known = JSON.stringify([A.id, B.id]);
		await until(`[...document.querySelectorAll('[data-ly-split-pane]')].some((el) => !${known}.includes(el.getAttribute('data-ly-split-pane')))`, 12000, "分叉出来的会话上屏");
		await pause(1500);
		const after = await js<Screens & { title: string | null }>(`(() => {
			const now = ${SCREENS};
			const fresh = now.keys.find((key) => !${known}.includes(key));
			return { ...now, title: document.querySelector('[data-ly-row="' + fresh + '"]')?.textContent.trim() ?? null };
		})()`);
		console.log(`     分叉后：${JSON.stringify(after)}`);
		const forked = after.keys.find((key) => key !== A.id && key !== B.id);
		const right = after.keys.join(",") === `${A.id},${forked}` && after.focused === forked;
		check(scene, `${path === "keyboard" ? "键盘" : "鼠标"}：分叉出来的会话换掉的是轨迹所在的乙屏（左边的甲还在），焦点落在它上面`, right, { before, after });
		await caption(right ? "分叉出来的会话开在轨迹所在的乙屏，甲屏还在" : "分叉出来的会话换掉了左边有焦点的甲屏");
		await shoot(path === "keyboard" ? "15" : "17", `${path === "keyboard" ? "键盘" : "鼠标"}路径_分叉之后`, [`[data-ly-split-pane="${forked}"]`]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// popout: a file opened from a Files panel popped out of the screen without focus.
// ---------------------------------------------------------------------------

/** Which screens show the file pane, and what it shows. */
const FILE_PANES = `(() => [...document.querySelectorAll('[data-ly-split-pane] [data-dock-pane="file"]')].filter((el) => el.checkVisibility()).map((el) => ({
	screen: el.closest('[data-ly-split-pane]').getAttribute('data-ly-split-pane'),
	title: el.querySelector('[data-dock-header="file"]')?.textContent.trim() ?? null,
	text: (el.querySelector('.cm-content')?.textContent ?? el.textContent).replace(/\\s+/g, ' ').trim().slice(0, 80),
})))()`;
type FilePane = { screen: string; title: string | null; text: string };

async function scenePopout(): Promise<void> {
	const scene = "popout";
	await boot("popout", "弹出的文件面板");
	try {
		await splitAB();
		await caption(`在右边「${B.title}」的标题栏打开「面板」菜单，选「文件」`);
		await keyboardPress(`${pane(B)} button[data-ly-toolbar-button][aria-label="面板"]`);
		await keyboardPress("菜单里的「文件」", menuRow(`/^文件(?!内容)/.test(el.textContent.trim())`));
		await until(`document.querySelector('${pane(B)} [data-dock-pane="files"] [role="treeitem"][data-path$="/lib.ts"]')`, 10000, "乙屏的文件面板");
		await pause(800);
		await caption(`把乙屏的文件面板弹到一个独立窗口里`);
		await click(`${pane(B)} [data-dock-pane="files"] button[aria-label="在新窗口中打开"]`);
		let panel: Awaited<ReturnType<RunningApp["windows"]>>[number] | undefined;
		const deadline = Date.now() + 15000;
		while (!panel && Date.now() < deadline) {
			const found = (await app!.windows()).find((one) => one.boot.kind === "panel" && one.boot.panelKind === "files");
			if (found && (await found.evaluate<boolean>(`Boolean(document.querySelector('[data-ly-restore-panel]') && document.querySelector('[role="treeitem"][data-path$="/lib.ts"]'))`))) panel = found;
			else await pause(200);
		}
		if (!panel) throw new Error("文件面板窗口没有画出来");
		console.log(`     面板窗口：${JSON.stringify(panel.boot)}`);
		await caption(`点主窗口左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		const before = await js<FilePane[]>(FILE_PANES);
		console.log(`     点文件之前：${JSON.stringify(before)}`);
		await caption(`在弹出的文件窗口里点「lib.ts」——它来自乙屏，是 ${B.project} 的文件`);
		await clickFound(`document.querySelector('[role="treeitem"][data-path$="/lib.ts"]')`, panel);
		await within(`document.querySelector('[data-ly-split-pane] [data-dock-pane="file"]')?.checkVisibility()`, 8000);
		await pause(2000);
		const after = await js<FilePane[]>(FILE_PANES);
		console.log(`     点文件之后：${JSON.stringify(after)}`);
		check(scene, "文件开在弹出面板原来所在的乙屏，不是有焦点的甲屏", after.length === 1 && after[0].screen === B.id, { before, after });
		check(scene, `打开的是点的那个文件：${B.project} 的 lib.ts`, after.some((one) => one.text.includes(`# ${B.project} lib.ts`)), { after });
		await caption(after[0]?.screen === B.id ? "文件开在乙屏，内容是乙的 lib.ts" : `文件面板开在了${after[0]?.screen === A.id ? "有焦点的甲屏" : "别处"}，内容：${after[0]?.text.slice(0, 30) ?? "无"}`);
		await shoot("18", "点弹出窗口里的文件之后_主窗口", ['[data-ly-split-pane] [data-dock-pane="file"]']);
		const shot = await panel.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		const file = join(OUT, `${STAMP}_${LABEL}_19_弹出的文件窗口.png`);
		await writeFile(file, Buffer.from(shot.data, "base64"));
		console.log(`     截图 ${file}`);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	await mkdir(OUT, { recursive: true });
	const scenes: Record<string, () => Promise<void>> = {
		side: sceneSide,
		capsule: async () => {
			await sceneCapsule("keyboard");
			await sceneCapsule("mouse");
		},
		picker: async () => {
			await scenePicker("keyboard");
			await scenePicker("mouse");
		},
		delivery: sceneDelivery,
		fork: async () => {
			await sceneFork("keyboard");
			await sceneFork("mouse");
		},
		popout: scenePopout,
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
