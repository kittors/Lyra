/* oxlint-disable no-console -- probe CLI: what it prints is the evidence */
/**
 * Split-view scoping faults found by the website's screenshot script, reproduced in a real window.
 *
 *   target   A message typed into a split's blank screen went to whichever conversation had focus.
 *   project  The project row above a screen's composer followed the focused conversation.
 *   running  A conversation running a command, once split beside another, drew the command as failed.
 *   theme    The built-in terminal's colours lagged a theme switch.
 *
 * Verdicts come from what the window painted (text, icon classes, computed colours) and from what
 * the fake model was asked — never from the store, which only says where we think things went.
 * Everything is driven with real CDP mouse and keyboard input: a synthetic `.click()` does not open
 * a sidebar row, and a pointer press is exactly what hides the keyboard-only half of these faults.
 *
 * Screenshots and the measured numbers land in ~/Desktop/分屏问题测试/.
 *
 * Usage: node --experimental-strip-types e2e/split-scope-probe.ts <target|project|running|theme|all> <before|after>
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { landsOn } from "./lands-on.ts";
import { encode, frameGrabber, pause, type Frame } from "./record.ts";

const PORT = 9761;
const OUT = join(homedir(), "Desktop", "分屏问题测试");
const [SCENE = "all", PHASE = "before"] = process.argv.slice(2);
const LABEL = PHASE === "after" ? "修复后" : "修复前";
// Local wall-clock time in the file name, the way the other proof folders on the Desktop are named.
const STAMP = (() => {
	const now = new Date();
	const two = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}-${two(now.getMinutes())}`;
})();

const A = { id: "split-a", title: "甲会话", project: "alpha-app", branch: "main", ask: "甲会话的第一个问题", answer: "甲会话的回答。" };
const B = { id: "split-b", title: "乙会话", project: "beta-lib", branch: "beta-work", ask: "乙会话的第一个问题", answer: "乙会话的回答。" };
/** A command that keeps printing, so the turn stays in its tool call for as long as the probe needs. */
const LONG_COMMAND = "for i in $(seq 1 150); do echo tick $i; sleep 1; done";

// ---------------------------------------------------------------------------
// A scripted model: answers by who is asking, so the transcript says where each message went.
// ---------------------------------------------------------------------------

interface Asked {
	chat: boolean;
	/** The first thing said in the conversation the request belongs to. */
	first: string;
	/** The last thing a person said, skipping the runtime's trailing <env> block. */
	last: string;
	result: boolean;
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
			const body = JSON.parse(raw || "{}") as { messages?: Array<{ role: string; content: unknown }>; tools?: Array<{ name: string }> };
			const users = (body.messages ?? []).filter((message) => message.role === "user");
			// The title request carries no tools; a conversation turn always offers todo_write.
			const chat = (body.tools ?? []).some((tool) => tool.name === "todo_write");
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
			asked.push({ chat, first, last, result });

			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `probe-${++call}`, role: "assistant", content: [], usage: { input_tokens: 50, output_tokens: 0 } } });
			const say = (text: string) => {
				emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
				emit("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
				emit("content_block_stop", { index: 0 });
			};
			let stop = "end_turn";
			if (!chat) say("探针会话");
			else if (result) say("命令结束。");
			else if (last.includes("跑命令")) {
				stop = "tool_use";
				emit("content_block_start", { index: 0, content_block: { type: "tool_use", id: `call-${call}`, name: "bash", input: {} } });
				emit("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command: LONG_COMMAND, timeout: 300000 }) } });
				emit("content_block_stop", { index: 0 });
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
// Two projects, one finished conversation in each.
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
			sync: { enabled: false, port: 4593, token: null },
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

async function click(selector: string, button: "left" | "right" = "left"): Promise<void> {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, 15000, selector);
	const at = await centre(selector);
	await g.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await g.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button, buttons: button === "left" ? 1 : 2, clickCount: 1 });
	await g.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button, buttons: 0, clickCount: 1 });
	await pause(180);
}

async function key(name: string, code: number, modifiers = 0): Promise<void> {
	await g.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code, modifiers });
	await g.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code, modifiers });
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
 * Press, a nudge past the drag threshold, a pause, then the travel — the same gesture the website
 * script uses. Retried: the person at the computer moving the real pointer cancels a carry.
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

/** Each screen as drawn: which conversation it is, whether it has focus, its composer's project row, its text. */
interface Screen {
	key: string;
	focused: boolean;
	project: string | null;
	branch: string | null;
	text: string;
}

const SCREENS = `[...document.querySelectorAll('[data-ly-split-pane]')].map((pane) => {
	const dock = [...pane.querySelectorAll('.ly-composer-dock')].find((el) => el.checkVisibility());
	const chip = (name) => dock?.querySelector('button:has([class*="lucide-' + name + '"])')?.getAttribute('data-ly-tip') ?? null;
	return {
		key: pane.getAttribute('data-ly-split-pane'),
		focused: pane.hasAttribute('data-ly-split-focused'),
		project: chip('folder') ?? chip('message-square'),
		branch: chip('git-branch'),
		text: pane.textContent.replace(/\\s+/g, ' ').trim().slice(0, 600),
	};
})`;

const screens = () => js<Screen[]>(SCREENS);
const rows = () => js<Array<{ id: string; text: string }>>(`[...document.querySelectorAll('[data-ly-row]')].map((row) => ({ id: row.getAttribute('data-ly-row'), text: row.textContent.trim().slice(0, 40) }))`);

/**
 * A caption for the recording, pinned to the bottom of the window.
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
// target: a message typed into a split's blank screen.
// ---------------------------------------------------------------------------

async function sceneTarget(path: "mouse" | "keyboard"): Promise<void> {
	const scene = `target-${path}`;
	await boot(path === "mouse" ? "消息去向_鼠标路径" : "消息去向_键盘路径");
	try {
		// A blank conversation in alpha, then the finished beta conversation dragged in beside it.
		await caption(`在「${A.project}」里新建一个空白对话`);
		await click(`button[aria-label="在「${A.project}」里新建会话"]`);
		await until(`document.querySelector('[data-ly-split-pane="@draft"] textarea')`, 10000, "空白对话");
		await caption(`把「${B.title}」（${B.project}）拖进右边分屏，焦点落在它上面`);
		await dragIntoSplit(B.id, 2);
		const opened = await screens();
		console.log(`     分屏后：${JSON.stringify(opened.map(({ key, focused }) => ({ key, focused })))}`);
		const words = path === "mouse" ? "鼠标路径：这句话属于左边的新对话" : "键盘路径：这句话属于左边的新对话";
		const field = `[data-ly-split-pane="@draft"] textarea`;
		await caption(path === "mouse" ? "鼠标点左边新对话的输入框，打一句话" : "键盘把焦点移进左边输入框（没有鼠标按下），打一句话");
		if (path === "mouse") await click(field);
		// Keyboard only: focus arrives without a pointer press, the way Tab brings it.
		else await js(`document.querySelector(${JSON.stringify(field)}).focus()`);
		await g.send("Input.insertText", { text: words });
		await pause(300);
		await shoot(path === "mouse" ? "01" : "03", `${path === "mouse" ? "鼠标" : "键盘"}路径_发送前_左屏是新对话`, [field]);
		await caption("回车发送");
		await key("Enter", 13);
		const deadline = Date.now() + 20000;
		while (!model.asked.some((one) => one.chat && one.last.includes(words)) && Date.now() < deadline) await pause(150);
		await pause(3000);
		const after = await screens();
		const listed = await rows();
		const request = model.asked.find((one) => one.chat && one.last.includes(words));
		const created = listed.filter((row) => row.id !== A.id && row.id !== B.id);
		const beta = after.find((screen) => screen.key === B.id);
		const fresh = after.find((screen) => screen.key !== B.id);
		console.log(`     发送后各屏：${JSON.stringify(after.map(({ key, focused, text }) => ({ key, focused, text: text.slice(0, 160) })))}`);
		console.log(`     侧栏：${JSON.stringify(listed)}`);
		console.log(`     模型收到：${JSON.stringify(model.asked)}`);
		check(scene, "模型收到的这一轮是一段新对话（第一句就是刚打的这句）", request?.first === words, { first: request?.first ?? null });
		check(scene, "乙会话的转录里没有这句话", Boolean(beta) && !beta!.text.includes(words), { beta: beta?.text.slice(-200) });
		check(scene, "侧栏多出一段新会话", created.length === 1, { created });
		check(scene, "左屏变成了那段新会话，转录里是这句话", Boolean(fresh && fresh.key !== "@draft" && fresh.key === created[0]?.id && fresh.text.includes(words)), { fresh: fresh && { key: fresh.key, text: fresh.text.slice(-200) } });
		await caption(
			request?.first === words
				? fresh?.key === created[0]?.id ? "结果：这句话开了左边自己的新会话，乙会话没动" : "结果：新会话建了，但没回到左边那一屏"
				: `结果：这句话发进了右边的「${B.title}」`,
		);
		await shoot(path === "mouse" ? "02" : "04", `${path === "mouse" ? "鼠标" : "键盘"}路径_发送后`, [`[data-ly-split-pane="${B.id}"]`, `[data-ly-split-pane]:not([data-ly-split-pane="${B.id}"])`]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// project: the project row above each screen's composer.
// ---------------------------------------------------------------------------

const PROJECT_ROW = (id: string) => [
	`[data-ly-split-pane="${id}"] .ly-composer-dock button:has([class*="lucide-folder"])`,
	`[data-ly-split-pane="${id}"] .ly-composer-dock button:has([class*="lucide-git-branch"])`,
];

async function sceneProject(): Promise<void> {
	const scene = "project";
	await boot("项目行");
	try {
		await caption(`打开「${A.title}」（${A.project} · ${A.branch}）`);
		await click(`[data-ly-row="${A.id}"] > button`);
		await until(`document.querySelector('[data-ly-split-pane="${A.id}"] textarea')`, 10000, "甲会话打开");
		await caption(`把「${B.title}」（${B.project} · ${B.branch}）拖进右边，焦点在右边`);
		await dragIntoSplit(B.id, 2);
		const own = (list: Screen[], one: typeof A) => list.find((screen) => screen.key === one.id);
		const focusB = await screens();
		console.log(`     焦点在乙：${JSON.stringify(focusB.map(({ key, focused, project, branch }) => ({ key, focused, project, branch })))}`);
		check(scene, "焦点在乙时，甲屏的项目行是甲自己的项目和分支", own(focusB, A)?.project === A.project && own(focusB, A)?.branch === A.branch, own(focusB, A) && { project: own(focusB, A)!.project, branch: own(focusB, A)!.branch });
		check(scene, "焦点在乙时，乙屏的项目行是乙的项目和分支", own(focusB, B)?.project === B.project && own(focusB, B)?.branch === B.branch, own(focusB, B) && { project: own(focusB, B)!.project, branch: own(focusB, B)!.branch });
		await caption(`左边「${A.title}」输入框上方写着：${own(focusB, A)?.project} · ${own(focusB, A)?.branch}`);
		await shoot("05", "焦点在乙_看左边甲屏的项目行", [...PROJECT_ROW(A.id), ...PROJECT_ROW(B.id)]);
		await caption(`点左边，焦点换到「${A.title}」`);
		await click(`[data-ly-split-pane="${A.id}"] textarea`);
		await until(`document.querySelector('[data-ly-split-pane="${A.id}"][data-ly-split-focused]')`, 8000, "焦点切到甲");
		await pause(1500);
		const focusA = await screens();
		console.log(`     焦点在甲：${JSON.stringify(focusA.map(({ key, focused, project, branch }) => ({ key, focused, project, branch })))}`);
		check(scene, "焦点在甲时，乙屏的项目行仍是乙的项目和分支", own(focusA, B)?.project === B.project && own(focusA, B)?.branch === B.branch, own(focusA, B) && { project: own(focusA, B)!.project, branch: own(focusA, B)!.branch });
		check(scene, "焦点在甲时，甲屏的项目行是甲的项目和分支", own(focusA, A)?.project === A.project && own(focusA, A)?.branch === A.branch, own(focusA, A) && { project: own(focusA, A)!.project, branch: own(focusA, A)!.branch });
		await caption(`右边「${B.title}」输入框上方写着：${own(focusA, B)?.project} · ${own(focusA, B)?.branch}`);
		await shoot("06", "焦点在甲_看右边乙屏的项目行", [...PROJECT_ROW(A.id), ...PROJECT_ROW(B.id)]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// running: a conversation with a command in flight, split beside another.
// ---------------------------------------------------------------------------

/** What screen `id` draws for its tool work: the group's run state and the icons its cards show. */
const TOOL_STATE = (id: string) => `(() => {
	const pane = document.querySelector('[data-ly-split-pane="${id}"]');
	if (!pane) return 'no-pane';
	const seen = (list) => [...list].filter((el) => el.checkVisibility()).length;
	const groups = [...pane.querySelectorAll('[data-ly-run]')].map((el) => el.getAttribute('data-ly-run')).join(',');
	return 'group[' + groups + '] spin=' + seen(pane.querySelectorAll('svg.ly-dash')) + ' cross=' + seen(pane.querySelectorAll('svg[class*="lucide-circle-x"]')) + ' check=' + seen(pane.querySelectorAll('svg[class*="lucide-circle-check"]'));
})()`;

async function sceneRunning(): Promise<void> {
	const scene = "running";
	await boot("运行中的命令");
	try {
		await click(`[data-ly-row="${A.id}"] > button`);
		const field = `[data-ly-split-pane="${A.id}"] textarea`;
		await until(`document.querySelector(${JSON.stringify(field)})`, 10000, "甲会话打开");
		await caption(`在「${A.title}」里让模型跑一条一直在打印的命令`);
		await click(field);
		await g.send("Input.insertText", { text: "跑命令：一直打印" });
		await pause(200);
		await key("Enter", 13);
		await until(`document.querySelector('[data-ly-split-pane="${A.id}"] [data-ly-run="running"]')`, 20000, "甲的命令开始跑");
		// The group line draws a sweep, not a spinner; the spinner belongs to the card inside it.
		await click(`[data-ly-split-pane="${A.id}"] [data-ly-run="running"] > button`);
		await until(`document.querySelector('[data-ly-split-pane="${A.id}"] svg.ly-dash')?.checkVisibility()`, 8000, "工具卡片的转圈");
		await pause(2500);
		const before = await js<string>(TOOL_STATE(A.id));
		check(scene, "分屏前：甲的命令画成在跑", /spin=[1-9]/.test(before) && before.includes("cross=0"), before);
		await caption("命令在跑：卡片上是转圈和秒数");
		await shoot("07", "分屏前_甲的命令在跑", [`[data-ly-split-pane="${A.id}"] [data-ly-run]`]);
		// Every painted frame from here on, so a failure that flashes by is still on the record.
		await js(`(() => {
			window.__probeRuns = [];
			let last = '';
			const read = () => ${TOOL_STATE(A.id)};
			const tick = () => {
				const now = read();
				if (now !== last) { window.__probeRuns.push({ at: Math.round(performance.now()), state: now }); last = now; }
				window.__probeRaf = requestAnimationFrame(tick);
			};
			tick();
		})()`);
		await caption(`命令还在跑，把「${B.title}」拖进右边分屏`);
		await dragIntoSplit(B.id, 2);
		await pause(3000);
		const split = await js<string>(TOOL_STATE(A.id));
		const alive = await js<boolean>(`window.lyra.sessions.running(${JSON.stringify(A.id)})`);
		check(scene, "分屏后：主进程确认甲的命令还在跑", alive, { running: alive });
		check(scene, "分屏后：甲屏的命令仍画成在跑（焦点在乙）", /spin=[1-9]/.test(split) && split.includes("cross=0"), split);
		await shoot("08", "分屏后_焦点在乙_甲的命令", [`[data-ly-split-pane="${A.id}"] [data-ly-run]`]);
		// The website script then focused the lead conversation's screen.
		await caption(`点回左边「${A.title}」`);
		await click(field);
		await until(`document.querySelector('[data-ly-split-pane="${A.id}"][data-ly-split-focused]')`, 8000, "焦点切到甲");
		await pause(2500);
		const back = await js<string>(TOOL_STATE(A.id));
		check(scene, "焦点切回甲后：命令仍画成在跑", /spin=[1-9]/.test(back) && back.includes("cross=0"), back);
		const frames = await js<Array<{ at: number; state: string }>>(`(() => { cancelAnimationFrame(window.__probeRaf); return window.__probeRuns; })()`);
		console.log(`     甲屏逐帧：${JSON.stringify(frames)}`);
		check(scene, "整个过程中甲屏没有一帧画出红叉", frames.every((frame) => frame.state.includes("cross=0")), frames.filter((frame) => !frame.state.includes("cross=0")));
		await caption(/cross=[1-9]/.test(back) ? "结果：命令其实还在跑，卡片却画成了红叉" : "结果：命令仍画成在跑（转圈）");
		await shoot("09", "焦点切回甲_命令", [`[data-ly-split-pane="${A.id}"] [data-ly-run]`]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// theme: the built-in terminal against a theme switch.
// ---------------------------------------------------------------------------

/**
 * The first pixel of a PNG.
 *
 * Enough of a decoder for a one-pixel screenshot: whatever filter a scanline uses, its first pixel
 * has no left or upper neighbour and decodes to its own bytes.
 */
function firstPixel(png: Buffer): [number, number, number] {
	const chunks: Buffer[] = [];
	for (let at = 8; at < png.length; ) {
		const length = png.readUInt32BE(at);
		if (png.toString("ascii", at + 4, at + 8) === "IDAT") chunks.push(png.subarray(at + 8, at + 8 + length));
		at += 12 + length;
	}
	const raw = inflateSync(Buffer.concat(chunks));
	return [raw[1], raw[2], raw[3]];
}

async function pixel(x: number, y: number): Promise<[number, number, number]> {
	const shot = await g.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { x, y, width: 1, height: 1, scale: 1 } });
	return firstPixel(Buffer.from(shot.data, "base64"));
}

const lightness = ([r, gg, b]: [number, number, number]) => (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;

/** The terminal as painted — a pixel inside it — beside what the app's own theme says. */
async function terminalLook(): Promise<{ dark: boolean; drawn: [number, number, number] | null; shell: [number, number, number] | null }> {
	const where = await js<{ dark: boolean; term: { x: number; y: number } | null; shell: { x: number; y: number } | null }>(`(() => {
		const screen = document.querySelector('[data-dock-pane="terminal"] .xterm-screen');
		const r = screen && screen.checkVisibility() ? screen.getBoundingClientRect() : null;
		const pane = document.querySelector('[data-ly-split-pane] [data-dock-pane="conversation"]');
		const p = pane ? pane.getBoundingClientRect() : null;
		return {
			dark: document.documentElement.classList.contains('dark'),
			term: r && r.width > 40 ? { x: Math.round(r.right - 14), y: Math.round(r.bottom - 14) } : null,
			shell: p ? { x: Math.round(p.x + 24), y: Math.round(p.y + p.height / 2) } : null,
		};
	})()`);
	return {
		dark: where.dark,
		drawn: where.term ? await pixel(where.term.x, where.term.y) : null,
		shell: where.shell ? await pixel(where.shell.x, where.shell.y) : null,
	};
}

/** Samples the painted terminal every ~120ms for `ms`, and says when (if ever) it showed the `dark` theme it was switched to. */
async function followTheme(ms: number, dark: boolean): Promise<{ matchedAt: number | null; samples: Array<{ at: number; dark: boolean; term: number | null }> }> {
	const start = Date.now();
	const samples: Array<{ at: number; dark: boolean; term: number | null }> = [];
	let matchedAt: number | null = null;
	while (Date.now() - start < ms) {
		const look = await terminalLook();
		const term = look.drawn ? Math.round(lightness(look.drawn) * 100) / 100 : null;
		samples.push({ at: Date.now() - start, dark: look.dark, term });
		if (matchedAt === null && term !== null && look.dark === dark && (dark ? term < 0.35 : term > 0.75)) matchedAt = Date.now() - start;
		await pause(120);
	}
	return { matchedAt, samples };
}

async function markText(selector: string, text: string, attribute: string): Promise<void> {
	await until(`[...document.querySelectorAll(${JSON.stringify(selector)})].some((el) => el.checkVisibility() && el.textContent.trim().includes(${JSON.stringify(text)}))`, 10000, `${selector} ${text}`);
	await js(`(() => {
		document.querySelector('[${attribute}]')?.removeAttribute('${attribute}');
		[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.checkVisibility() && el.textContent.trim().includes(${JSON.stringify(text)})).setAttribute('${attribute}', '');
	})()`);
}

/**
 * Every painted frame's theme class beside the terminal's own background, from just before a switch.
 *
 * The workspace is behind the settings page while the switch happens, so a screenshot cannot see
 * the terminal then; the colour xterm set on its viewport can still be read on every frame.
 */
const RECORD_TERMINAL = `(() => {
	window.__probeTheme = [];
	let last = '';
	const tick = () => {
		const viewport = document.querySelector('[data-dock-pane="terminal"] .xterm-scrollable-element');
		const now = (document.documentElement.classList.contains('dark') ? 'dark' : 'light') + ' ' + (viewport ? getComputedStyle(viewport).backgroundColor : 'none');
		if (now !== last) { window.__probeTheme.push({ at: Math.round(performance.now()), state: now }); last = now; }
		window.__probeThemeRaf = requestAnimationFrame(tick);
	};
	tick();
})()`;

/** How long, in painted frames and milliseconds, the terminal drew the old theme after the switch. */
async function themeLag(): Promise<{ frames: Array<{ at: number; state: string }>; wrongFrames: number; wrongMs: number }> {
	const frames = await js<Array<{ at: number; state: string }>>(`(() => { cancelAnimationFrame(window.__probeThemeRaf); return window.__probeTheme; })()`);
	const shade = (state: string) => {
		const [r, gg, b] = (state.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
		return lightness([r, gg, b]) < 0.35 ? "dark" : lightness([r, gg, b]) > 0.75 ? "light" : "mid";
	};
	// Frames on which the theme had already flipped and the terminal still showed the other one.
	const wrong = frames.filter((frame, i) => i > 0 && frame.state.split(" ")[0] !== shade(frame.state.slice(frame.state.indexOf(" ") + 1)));
	const index = frames.findIndex((frame, i) => i > 0 && frame.state.split(" ")[0] !== frames[0].state.split(" ")[0]);
	const flipped = index >= 0 ? frames[index] : undefined;
	const settled = frames.find((frame, i) => i >= index && index >= 0 && frame.state.split(" ")[0] === shade(frame.state.slice(frame.state.indexOf(" ") + 1)));
	return { frames, wrongFrames: wrong.length, wrongMs: flipped && settled ? settled.at - flipped.at : flipped ? Infinity : 0 };
}

/** 设置 › 外观 › one of the three theme cards, then back to the workspace. */
async function pickTheme(card: string, record = false): Promise<void> {
	await click(".ly-sidebar-foot button");
	await until(`document.querySelector('[data-ly-settings]')?.checkVisibility()`, 8000, "设置页");
	await markText("[data-ly-settings] nav button", "外观", "data-probe-nav");
	await click("[data-probe-nav]");
	await markText("[data-ly-settings] button[aria-pressed]", card, "data-probe-theme");
	if (record) await js(RECORD_TERMINAL);
	await click("[data-probe-theme]");
	await pause(400);
	await markText("[data-ly-settings] nav button", "返回工作区", "data-probe-back");
	await click("[data-probe-back]");
	await until(`!document.querySelector('[data-ly-settings]')?.checkVisibility()`, 8000, "回到工作区");
}

async function sceneTheme(): Promise<void> {
	const scene = "theme";
	await boot("终端主题");
	try {
		await click(`[data-ly-row="${A.id}"] > button`);
		await until(`document.querySelector('[data-ly-split-pane="${A.id}"] textarea')`, 10000, "甲会话打开");
		await caption("打开内置终端，打印一行彩色字");
		await click(`[data-ly-split-pane="${A.id}"] header button[aria-label^="终端"]`);
		await until(`document.querySelector('[data-dock-pane="terminal"] .xterm-screen')?.checkVisibility()`, 15000, "终端");
		await pause(1800);
		await click('[data-dock-pane="terminal"] .xterm-screen');
		await g.send("Input.insertText", { text: "printf '\\033[32mgreen\\033[0m plain \\033[31mred\\033[0m\\n'\r" });
		await pause(800);
		const start = await terminalLook();
		check(scene, "起点：浅色主题下终端是浅色", !start.dark && start.drawn !== null && lightness(start.drawn) > 0.75, start);
		await shoot("10", "浅色主题_终端", ['[data-dock-pane="terminal"]']);

		// 设置 › 外观: dark, then back to the workspace to look at the terminal.
		await caption("设置 › 外观：切到深色，再回工作区看终端");
		await pickTheme("深色", true);
		const darkLag = await themeLag();
		console.log(`     切到深色，逐帧：${JSON.stringify(darkLag.frames)}`);
		check(scene, "设置里切到深色：主题变的那一帧终端就变深，没有一帧还是浅的", darkLag.wrongFrames === 0, { wrongFrames: darkLag.wrongFrames, wrongMs: darkLag.wrongMs });
		const toDark = await followTheme(1500, true);
		check(scene, "设置里切到深色：回到工作区时终端画的是深色", toDark.matchedAt !== null, { matchedAt: toDark.matchedAt, last: toDark.samples.at(-1) });
		await caption(darkLag.wrongFrames ? `切换那一刻终端还是浅色，晚了 ${darkLag.wrongFrames} 帧（${darkLag.wrongMs}ms）才跟上` : "切换那一刻终端就变深了，没有一帧落后");
		await shoot("11", "设置里切到深色后_终端", ['[data-dock-pane="terminal"]']);
		await caption("设置 › 外观：切回浅色");
		await pickTheme("浅色", true);
		const lightLag = await themeLag();
		console.log(`     切回浅色，逐帧：${JSON.stringify(lightLag.frames)}`);
		check(scene, "设置里切回浅色：主题变的那一帧终端就变浅，没有一帧还是深的", lightLag.wrongFrames === 0, { wrongFrames: lightLag.wrongFrames, wrongMs: lightLag.wrongMs });
		const toLight = await followTheme(1500, false);
		check(scene, "设置里切回浅色：回到工作区时终端画的是浅色", toLight.matchedAt !== null, { matchedAt: toLight.matchedAt, last: toLight.samples.at(-1) });
		await shoot("12", "设置里切回浅色后_终端", ['[data-dock-pane="terminal"]']);

		// 跟随系统, and the system appearance changes while the terminal is on screen.
		await caption("改成跟随系统，然后在终端开着的时候把系统外观切到深色");
		await pickTheme("系统");
		await g.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
		await pause(1200);
		await js(RECORD_TERMINAL);
		await g.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
		const systemDark = await followTheme(2500, true);
		const systemDarkLag = await themeLag();
		console.log(`     系统外观变深之后：${JSON.stringify(systemDark)}\n     逐帧：${JSON.stringify(systemDarkLag.frames)}`);
		check(scene, "跟随系统时系统变深：终端跟着变深", systemDark.matchedAt !== null, { matchedAt: systemDark.matchedAt, last: systemDark.samples.at(-1) });
		check(scene, "跟随系统时系统变深：没有一帧终端还是浅的", systemDarkLag.wrongFrames === 0, { wrongFrames: systemDarkLag.wrongFrames, wrongMs: systemDarkLag.wrongMs });
		await caption(systemDark.matchedAt === null ? "结果：系统已经变深，终端还是浅色" : "结果：终端跟着系统变深了");
		await shoot("13", "跟随系统_系统变深后_终端", ['[data-dock-pane="terminal"]']);
		await caption("系统外观切回浅色");
		await js(RECORD_TERMINAL);
		await g.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
		const systemLight = await followTheme(2500, false);
		const systemLightLag = await themeLag();
		console.log(`     系统外观变浅之后：${JSON.stringify(systemLight)}\n     逐帧：${JSON.stringify(systemLightLag.frames)}`);
		check(scene, "跟随系统时系统变浅：终端跟着变浅", systemLight.matchedAt !== null, { matchedAt: systemLight.matchedAt, last: systemLight.samples.at(-1) });
		check(scene, "跟随系统时系统变浅：没有一帧终端还是深的", systemLightLag.wrongFrames === 0, { wrongFrames: systemLightLag.wrongFrames, wrongMs: systemLightLag.wrongMs });
		await shoot("14", "跟随系统_系统变浅后_终端", ['[data-dock-pane="terminal"]']);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	await mkdir(OUT, { recursive: true });
	const scenes: Record<string, () => Promise<void>> = {
		target: async () => {
			await sceneTarget("mouse");
			await sceneTarget("keyboard");
		},
		project: sceneProject,
		running: sceneRunning,
		theme: sceneTheme,
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
