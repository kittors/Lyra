/* oxlint-disable no-console -- probe CLI: what it prints is the evidence */
/**
 * The split-view scoping faults found after the second pass, reproduced in a real window.
 *
 *   running   Two screens running at once: the one without focus drew the focused conversation's
 *             clock, token count and activity.
 *   branch    The branch menu under a screen the keyboard reached listed the focused project's
 *             branches, and switched the focused project's repository.
 *   model     The model and effort pickers under a screen the keyboard reached showed, and changed,
 *             the focused conversation's model and effort.
 *   files     The Files panel in a screen without focus listed the focused project's files.
 *   links     A relative file link in a screen without focus opened the focused project's file, in
 *             the focused screen; 「在终端运行」 there opened the terminal in the focused screen.
 *   defs      Which panels a screen offers followed the focused conversation: with a project-less
 *             conversation focused, the project's screen beside it lost its Git button.
 *   meter     The context reading under a screen froze across that screen's finished turn while the
 *             focused conversation was running.
 *   thinking  Reasoning cut short under a stopped screen typed itself out again while the focused
 *             conversation ran.
 *   mention   The composer's @ list under a screen reached by keyboard listed the focused project's files.
 *   skill     The skill capsule on a message in a screen without focus looked the skill up in the
 *             focused project, and opened the file pane in the focused screen.
 *   cards     The tool calls in a screen without focus lost their records: a preview drew no page, a
 *             folded run counted no changed lines, and finished calls were drawn as failures.
 *
 * Same method as `split-scope-rest-probe.ts`: verdicts come from what the window painted, from what
 * the fake model was asked, from git and from what is on disk — never from the store. Every press is
 * a real CDP mouse or key event. The keyboard path is `el.focus()` and a key: focus arrives the way
 * Tab brings it, without the pointer press that would have focused the screen first.
 *
 * Screenshots, recordings and the measured numbers land in ~/Desktop/分屏串台补漏测试/.
 *
 * Usage: node --experimental-strip-types e2e/split-scope-more-probe.ts <running|branch|model|files|links|defs|meter|thinking|mention|skill|cards|all> <before|after>
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
const OUT = join(homedir(), "Desktop", "分屏串台补漏测试");
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
	/** A second branch, so the branch menu has something to switch to. */
	extra: string | null;
	ask: string;
	answer: string;
	dirty: string[];
	model: string;
	projectId: string;
}

const A: Side = { id: "split-a", title: "甲会话", project: "alpha-app", branch: "main", extra: "alpha-feature", ask: "甲会话的第一个问题", answer: "甲会话的回答。", dirty: ["README.md"], model: "qa/model-2", projectId: "" };
const B: Side = { id: "split-b", title: "乙会话", project: "beta-lib", branch: "beta-work", extra: "beta-feature", ask: "乙会话的第一个问题", answer: "乙会话的回答。", dirty: ["README.md", "lib.ts"], model: "qa/model", projectId: "" };
/** Not in any project: its directory sits under the scratch root, the way 「不在项目中工作」 files it. */
const C: Side = { id: "split-c", title: "丙闲聊", project: "workspaces/chat-c", branch: null, extra: null, ask: "丙闲聊的第一个问题", answer: "丙闲聊的回答。", dirty: [], model: "qa/model", projectId: "" };

const MODELS = [
	{ id: "qa/model", name: "QA" },
	{ id: "qa/model-2", name: "QA 2" },
	{ id: "qa/model-3", name: "QA 3" },
];

/** Makes the model run a shell command that takes a while: 甲's turn stays on a tool. */
const LONG = "甲：跑一个长命令";
const SLEEP = 30;
/** Makes the model type its answer out slowly: 乙's turn stays on writing. */
const SLOW = "乙：慢慢写一段";
/** Makes the model answer with relative file links and a shell block. */
const LINKS = "乙：给我看看文件";
/** Where the shell block in that answer leaves its mark: the directory it ran in says which screen's terminal took it. */
const RAN_HERE = "probe-ran-here.txt";
/** Makes the model type a short answer out, reporting a large prompt: the turn moves the context reading. */
const MEDIUM = "乙：写一段会用掉很多上下文的";
/** Reasoning 乙 was stopped in the middle of, in the thinking scene. */
const HALTED = ["先看目录", "再读配置", "最后改代码"];
/** A skill only 乙's project has. */
const SKILL = "probe-skill";
/** The title of the page 乙's preview made, in the cards scene. */
const CARD_PAGE = "乙的预览页面";

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
			if (!result && last.includes(LONG)) {
				// A shell command that keeps the turn on a running tool, with a token count of its own.
				begin(4000);
				emit("content_block_start", { index: 0, content_block: { type: "tool_use", id: `call-${call}`, name: "bash", input: {} } });
				emit("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command: `sleep ${SLEEP}` }) } });
				emit("content_block_stop", { index: 0 });
				end("tool_use");
				return;
			}
			if (!result && (last.includes(SLOW) || last.includes(MEDIUM))) {
				// Typed out a character at a time — twenty seconds, or six for the medium one, which
				// reports a prompt big enough to move the context reading.
				const medium = last.includes(MEDIUM);
				begin(medium ? 60_000 : 900);
				emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
				let sent = 0;
				const timer = setInterval(() => {
					if (res.writableEnded || res.destroyed) {
						clearInterval(timer);
						return;
					}
					emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: "写" } });
					if (++sent >= (medium ? 24 : 80)) {
						clearInterval(timer);
						emit("content_block_stop", { index: 0 });
						end("end_turn");
					}
				}, 250);
				res.on("close", () => clearInterval(timer));
				return;
			}
			begin(50);
			if (result) say("命令跑完了。");
			else if (last.includes(LINKS)) say(`看这两个文件：[README.md](README.md) 和 [lib.ts](lib.ts)。\n\n\`\`\`bash\npwd > ${RAN_HERE}\n\`\`\`\n`);
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
// Two projects with uncommitted work and two branches each, one conversation in each, and one
// conversation that is in no project at all.
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
			if (one.extra) await git(cwd, "branch", one.extra);
			// Left uncommitted, and the same on both branches, so switching carries it across.
			for (const file of one.dirty) await writeFile(join(cwd, file), `# ${one.project} ${file}\nchanged by the probe\n`);
		}
		const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
		one.projectId = projectId;
		if (one.branch) projects.push({ id: projectId, path: cwd, name: one.project, pinned: true, lastOpenedAt: 10 - index });
		const at = 1_790_000_000_000 + index * 60_000;
		const asked = { role: "user", content: [{ type: "text", text: one.ask }], timestamp: at, ...(scene === "skill" && one === B ? { skillRef: { name: SKILL } } : {}) };
		// 乙 was stopped mid-thought in the thinking scene; everywhere else each conversation has one plain exchange.
		const answered =
			scene === "thinking" && one === B
				? { role: "assistant", content: [{ type: "thinking", thinking: HALTED.join("\n") }], api: "anthropic-messages", provider: "qa", model: one.model.split("/")[1], usage, stopReason: "aborted", timestamp: at + 1 }
				: { role: "assistant", content: [{ type: "text", text: one.answer }], api: "anthropic-messages", provider: "qa", model: one.model.split("/")[1], usage, stopReason: "stop", timestamp: at + 1 };
		const messages: object[] = [asked, answered];
		if (scene === "cards" && one === B) {
			// 乙 edited a file and made a preview; the records are rebuilt from these results when it opens.
			const edit = { type: "toolCall", id: "b-edit", name: "edit", arguments: { path: join(cwd, "lib.ts"), old_string: "a", new_string: "b" } };
			const shown = { type: "toolCall", id: "b-preview", name: "preview", arguments: { entry: "index.html" } };
			const turn = at + 10;
			messages.push(
				{ role: "user", content: [{ type: "text", text: "乙：改个文件再给我看个预览" }], timestamp: turn },
				{ role: "assistant", content: [{ type: "text", text: "先改文件，再出一个预览。" }, edit, shown], api: "anthropic-messages", provider: "qa", model: one.model.split("/")[1], usage, stopReason: "toolUse", timestamp: turn + 1 },
				{ role: "toolResult", toolCallId: edit.id, toolName: "edit", content: [{ type: "text", text: "已修改 lib.ts" }], details: { added: 5, removed: 2 }, isError: false, timestamp: turn + 2 },
				{ role: "toolResult", toolCallId: shown.id, toolName: "preview", content: [{ type: "text", text: "预览已生成" }], details: { preview: { id: "p1", sessionId: one.id, title: CARD_PAGE, entry: "index.html" } }, isError: false, timestamp: turn + 3 },
				{ role: "assistant", content: [{ type: "text", text: "改好了，预览在上面。" }], api: "anthropic-messages", provider: "qa", model: one.model.split("/")[1], usage, stopReason: "stop", timestamp: turn + 4 },
			);
			await mkdir(join(home, "previews", one.id, "p1"), { recursive: true });
			await writeFile(join(home, "previews", one.id, "p1", "index.html"), `<!doctype html><meta charset="utf-8"><body style="margin:0;font:600 20px -apple-system;background:#e8f1ff;color:#1f4fd1;height:180px;display:grid;place-items:center">${CARD_PAGE}</body>`);
		}
		if (scene === "skill" && one === B) {
			await mkdir(join(cwd, ".lyra", "skills", SKILL), { recursive: true });
			await writeFile(join(cwd, ".lyra", "skills", SKILL, "SKILL.md"), `---\nname: ${SKILL}\ndescription: 只有乙的项目里有的技能\n---\n\n${B.project} 的技能正文。\n`);
		}
		const last = messages.length + 2;
		const updatedAt = at + messages.length;
		// 甲 thinks hard in the model scene, so the two screens' effort buttons have different things to say.
		const thinking = scene === "model" && one === A ? { thinking: "high" } : {};
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

/** The pointer resting over an element, without pressing: what shows a control that appears on hover. */
async function hover(selector: string): Promise<void> {
	const at = await js<{ x: number; y: number }>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) throw new Error('missing ' + ${JSON.stringify(selector)});
		el.scrollIntoView({ block: 'nearest' });
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 24) };
	})()`);
	await g.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await pause(300);
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

/** The conversations as the app lists them from disk. */
const listed = () =>
	js<Array<{ id: string; modelId: string; thinking?: string }>>(`window.lyra.sessions.list().then((all) => all.map((one) => ({ id: one.id, modelId: one.modelId, thinking: one.thinking })))`);

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

// ---------------------------------------------------------------------------
// running: the line under a running turn, in both screens at once.
// ---------------------------------------------------------------------------

/**
 * Each screen's running line as painted: the mood the orb draws, the clock and the token count.
 * An expression rather than a function so the frame recorder can run the same reading every frame.
 */
const RUNNING_READ = `(() => {
	const read = (key) => {
		const line = document.querySelector('[data-ly-split-pane="' + key + '"] [data-ly-running]');
		if (!line) return null;
		const numbers = [...line.querySelectorAll('.tabular-nums')].map((el) => el.textContent.trim());
		const clock = numbers[0] ?? '';
		const tokens = numbers.find((text) => text.includes('tokens')) ?? '';
		const parts = clock.match(/^(?:(\\d+)h )?(?:(\\d+)m ?)?(?:(\\d+)s)?$/) ?? [];
		const seconds = Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
		return { mood: line.dataset.lyMood ?? '', clock, tokens, seconds };
	};
	return { a: read('${A.id}'), b: read('${B.id}') };
})()`;

type Line = { mood: string; clock: string; tokens: string; seconds: number } | null;

async function sceneRunning(): Promise<void> {
	const scene = "running";
	await boot(scene, "两屏同时在跑");
	try {
		await splitAB();
		await caption(`点左边「${A.title}」，让它跑一个要 ${SLEEP} 秒的命令`);
		await say(A, LONG);
		await until(`document.querySelector('${pane(A)} [data-ly-running][data-ly-mood="working"]')`, 20000, "甲屏的运行行显示在跑命令");
		await pause(4500);
		await caption(`点右边「${B.title}」，让它慢慢写一段`);
		await say(B, SLOW);
		await until(`document.querySelector('${pane(B)} [data-ly-running]')`, 15000, "乙屏的运行行");
		// Every painted frame from here on, so a line drawing the other screen's turn for a moment is on the record.
		await js(`(() => {
			window.__probeRun = [];
			let last = '';
			const tick = () => {
				const now = ${RUNNING_READ};
				const text = JSON.stringify(now);
				if (text !== last) { window.__probeRun.push({ at: Math.round(performance.now()), ...now }); last = text; }
				window.__probeRunRaf = requestAnimationFrame(tick);
			};
			tick();
		})()`);
		await pause(2500);
		const onB = { ...(await js<{ a: Line; b: Line }>(RUNNING_READ)), focused: await focusedScreen() };
		console.log(`     焦点在乙：${JSON.stringify(onB)}`);
		check(scene, "焦点在乙：甲屏的运行行讲甲自己（在跑命令，时钟比乙长 4 秒以上）", onB.a?.mood === "working" && (onB.a?.seconds ?? 0) - (onB.b?.seconds ?? 0) >= 4, onB);
		check(scene, "焦点在乙：甲屏的 token 数是甲这一轮的（4k 上下），不是乙的", /\b4(\.\d)?k\b/.test(onB.a?.tokens ?? "") && onB.a?.tokens !== onB.b?.tokens, { a: onB.a?.tokens, b: onB.b?.tokens });
		await caption(onB.a?.mood === "working" ? "甲屏讲甲：在跑命令，时钟更长" : "甲屏画的是乙的时钟和动作");
		await shoot("01", "焦点在乙_两屏的运行行", [`${pane(A)} [data-ly-running]`, `${pane(B)} [data-ly-running]`]);

		await caption(`点回左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		const onA = { ...(await js<{ a: Line; b: Line }>(RUNNING_READ)), focused: await focusedScreen() };
		console.log(`     焦点在甲：${JSON.stringify(onA)}`);
		check(scene, "焦点在甲：乙屏的运行行讲乙自己（在写字，时钟比甲短）", onA.b !== null && onA.b.mood !== "working" && (onA.a?.seconds ?? 0) - onA.b.seconds >= 4, onA);
		await caption(onA.b?.mood === "working" ? "乙屏画的是甲的时钟和动作" : "乙屏讲乙：在写字，时钟更短");
		await shoot("02", "焦点在甲_两屏的运行行", [`${pane(A)} [data-ly-running]`, `${pane(B)} [data-ly-running]`]);

		const frames = await js<Array<{ at: number; a: Line; b: Line }>>(`(() => { cancelAnimationFrame(window.__probeRunRaf); return window.__probeRun; })()`);
		// Both lines drawing the same clock and the same activity is one screen drawing the other's turn.
		const same = frames.filter((frame) => frame.a && frame.b && frame.a.clock === frame.b.clock && frame.a.mood === frame.b.mood);
		console.log(`     逐帧 ${frames.length} 次变化，其中两屏画成同一个时钟和动作的：${same.length}`);
		check(scene, "逐帧：没有一帧两屏画成同一个时钟和同一个动作", frames.length > 0 && same.length === 0, { changes: frames.length, same: same.slice(0, 4) });
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// branch: the branch menu under the screen without focus.
// ---------------------------------------------------------------------------

const BRANCHES = [A.branch, A.extra, B.branch, B.extra] as string[];
/** A screen's branch chip, whichever branch it is showing. */
const CHIPS = (side: Side) => `[...document.querySelectorAll('${pane(side)} button[aria-haspopup="menu"][data-ly-tip]')].map((el) => el.getAttribute('data-ly-tip')).filter((tip) => ${JSON.stringify(BRANCHES)}.includes(tip))`;
const head = async (side: Side) => (await git(join(app!.home, side.project), "branch", "--show-current")).stdout.trim();

async function sceneBranch(): Promise<void> {
	const scene = "branch";
	await boot(scene, "分支菜单");
	try {
		await splitAB();
		await caption(`点左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		await shoot("03", "焦点在甲_两屏的分支按钮", [`${pane(A)} button[data-ly-tip="${A.branch}"]`, `${pane(B)} button[data-ly-tip="${B.branch}"]`]);

		await caption(`键盘把焦点移到右边「${B.title}」的分支按钮 ${B.branch}（没有鼠标按下），回车`);
		await keyboardPress(`${pane(B)} button[aria-haspopup="menu"][data-ly-tip="${B.branch}"]`);
		await until(`document.querySelector('[role="menuitem"][data-ly-tip]')`, 8000, "分支菜单列出分支");
		await pause(1200);
		const rows = await js<string[]>(`[...document.querySelectorAll('[role="menuitem"][data-ly-tip]')].map((el) => el.getAttribute('data-ly-tip'))`);
		check(scene, "键盘打开乙屏的分支菜单：列的是乙的分支，没有甲的", rows.includes(B.branch!) && rows.includes(B.extra!) && !rows.includes(A.extra!), { rows, focused: await focusedScreen() });
		await caption(rows.includes(A.extra!) ? "乙屏的分支菜单列的是甲的分支" : "乙屏的分支菜单列的是乙自己的分支");
		await shoot("04", "乙屏的分支菜单", ['[role="menuitem"][data-ly-tip]']);

		// The first branch the menu offers that neither repository is on: what a person scanning it would pick.
		const target = rows.find((name) => name !== A.branch && name !== B.branch) ?? null;
		await caption(`键盘选菜单里的「${target}」，回车`);
		if (target) await keyboardPress(`[role="menuitem"][data-ly-tip="${target}"]`);
		await pause(3000);
		const heads = { alpha: await head(A), beta: await head(B) };
		console.log(`     选了 ${target}，两个仓库此刻在：${JSON.stringify(heads)}`);
		check(scene, "切分支落在乙的仓库（乙切到 beta-feature），甲的仓库仍在 main", heads.beta === B.extra && heads.alpha === A.branch, { chose: target, heads });
		const chips = { a: await js<string[]>(CHIPS(A)), b: await js<string[]>(CHIPS(B)) };
		check(scene, "乙屏的分支按钮显示乙的新分支，甲屏仍是 main", chips.b[0] === B.extra && chips.a[0] === A.branch, chips);
		await caption(heads.alpha !== A.branch ? `切的是甲的仓库：${A.project} 现在在 ${heads.alpha}` : heads.beta === B.extra ? `切的是乙的仓库：${B.project} 现在在 ${heads.beta}` : "两个仓库都没动");
		await shoot("05", "键盘切分支之后", [`${pane(A)} button[aria-haspopup="menu"]`, `${pane(B)} button[aria-haspopup="menu"]`]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// model: the model and effort pickers under the screen without focus.
// ---------------------------------------------------------------------------

const MODEL_BUTTON = (side: Side) => `${pane(side)} button[aria-label="选择模型"]`;
const EFFORT_BUTTON = (side: Side) => `${pane(side)} button[aria-label^="推理强度"]`;
const PICKERS = `(() => {
	const read = (key) => ({
		model: document.querySelector('[data-ly-split-pane="' + key + '"] button[aria-label="选择模型"]')?.textContent.trim() ?? null,
		effort: document.querySelector('[data-ly-split-pane="' + key + '"] button[aria-label^="推理强度"]')?.getAttribute('aria-label') ?? null,
	});
	return { a: read('${A.id}'), b: read('${B.id}') };
})()`;

async function sceneModel(): Promise<void> {
	const scene = "model";
	await boot(scene, "模型与推理强度");
	try {
		await splitAB();
		await caption(`点左边「${A.title}」的输入框，焦点换到甲（甲：QA 2、推理强度高；乙：QA、推理强度关）`);
		await focusByMouse(A);
		const shown = await js<{ a: { model: string; effort: string }; b: { model: string; effort: string } }>(PICKERS);
		check(scene, "焦点在甲：乙屏的推理强度讲乙自己（关），不是甲的（高）", shown.b.effort === "推理强度：关" && shown.a.effort === "推理强度：高", shown);
		await caption(shown.b.effort === shown.a.effort ? `乙屏的推理强度画成了甲的「${shown.a.effort}」` : "两屏的推理强度各是各的");
		await shoot("06", "焦点在甲_两屏的模型和推理强度", [MODEL_BUTTON(A), MODEL_BUTTON(B), EFFORT_BUTTON(A), EFFORT_BUTTON(B)]);

		await caption(`键盘把焦点移到右边「${B.title}」的模型按钮（没有鼠标按下），回车`);
		await keyboardPress(MODEL_BUTTON(B));
		await until(`document.querySelector('[data-model]')`, 6000, "模型菜单");
		await pause(600);
		const ticked = await js<string | null>(`document.querySelector('[data-model][data-selected="true"]')?.getAttribute('data-model') ?? null`);
		check(scene, "乙屏的模型菜单勾的是乙的模型 QA", ticked === B.model, { ticked });
		await shoot("07", "乙屏的模型菜单", ['[data-model][data-selected="true"]']);

		await caption("键盘选「QA 3」，回车");
		await keyboardPress(`[data-model="qa/model-3"] button[role="menuitem"]`);
		const asked = await within(`document.querySelector('[data-ly-modal]')`, 2500);
		if (asked) {
			await shoot("08", "中途换模型的确认框", ["[data-ly-modal]"]);
			await caption("键盘按「确认切换」");
			await keyboardPress("确认切换", `[...document.querySelectorAll('[data-ly-modal] button')].find((el) => el.textContent.trim() === '确认切换')`);
		}
		await pause(2500);
		const disk = await listed();
		const models = { a: disk.find((one) => one.id === A.id)?.modelId, b: disk.find((one) => one.id === B.id)?.modelId };
		check(scene, "换模型落在乙（乙变成 QA 3），甲仍是 QA 2", models.b === "qa/model-3" && models.a === A.model, { onDisk: models, confirmed: asked });
		const after = await js<{ a: { model: string; effort: string }; b: { model: string; effort: string } }>(PICKERS);
		check(scene, "乙屏的模型按钮显示 QA 3，甲屏仍是 QA 2", after.b.model === "QA 3" && after.a.model === "QA 2", after);
		await caption(models.a !== A.model ? `换的是甲的模型：甲现在是 ${models.a}` : models.b === "qa/model-3" ? "换的是乙自己的模型" : "两边都没换");
		await shoot("09", "键盘换模型之后", [MODEL_BUTTON(A), MODEL_BUTTON(B)]);

		/*
		 * Home, then two steps right: the slider lands on 「中」 from wherever it starts, so the level
		 * changes whichever conversation it acts on — 甲 is already at the top, where one step right
		 * would change nothing and prove nothing.
		 */
		await caption(`键盘打开右边「${B.title}」的推理强度，Home 再按两下右方向键（调到「中」）`);
		await keyboardPress(EFFORT_BUTTON(B));
		await until(`document.querySelector('input[type="range"]')`, 6000, "推理强度滑块");
		await pause(500);
		const slider = await js<{ value: string; label: string }>(`(() => {
			const input = document.querySelector('input[type="range"]');
			return { value: input.value, label: input.closest('[role="group"]')?.textContent.slice(0, 8) ?? '' };
		})()`);
		await shoot("10", "乙屏的推理强度菜单", ['input[type="range"]']);
		await js(`document.querySelector('input[type="range"]').focus()`);
		for (const [name, code] of [["Home", 36], ["ArrowRight", 39], ["ArrowRight", 39]] as const) {
			await key(name, code);
			await pause(900);
		}
		await pause(800);
		await key("Escape", 27);
		await pause(800);
		const later = await listed();
		const efforts = { a: later.find((one) => one.id === A.id)?.thinking ?? null, b: later.find((one) => one.id === B.id)?.thinking ?? null };
		check(scene, "改推理强度落在乙（乙变成 medium），甲仍是 high", efforts.a === "high" && efforts.b === "medium", { onDisk: efforts, sliderWhenOpened: slider });
		await caption(efforts.a !== "high" ? `改的是甲的推理强度：甲现在是 ${efforts.a}` : "改的是乙自己的推理强度");
		await shoot("11", "键盘改推理强度之后", [EFFORT_BUTTON(A), EFFORT_BUTTON(B)]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// files: the Files panel in the screen without focus.
// ---------------------------------------------------------------------------

/** The paths each screen's Files panel lists, as drawn. */
const TREES = `(() => {
	const read = (key) => {
		const panel = [...document.querySelectorAll('[data-ly-split-pane="' + key + '"] [data-dock-pane="files"]')].find((el) => el.checkVisibility());
		if (!panel) return null;
		const rows = [...panel.querySelectorAll('[data-path]')].map((el) => el.getAttribute('data-path'));
		return rows.length ? rows : [panel.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80)];
	};
	return { a: read('${A.id}'), b: read('${B.id}') };
})()`;

async function sceneFiles(): Promise<void> {
	const scene = "files";
	await boot(scene, "文件面板");
	try {
		await splitAB();
		await caption(`点左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		await caption(`键盘在右边「${B.title}」的标题栏打开「面板」菜单，选「文件」`);
		await keyboardPress(`${pane(B)} button[data-ly-toolbar-button][aria-label="面板"]`);
		// The row's text carries its shortcut (「文件⌘P」), and 「文件内容」 is the file pane, not the tree.
		const item = `[...document.querySelectorAll('[role="menuitem"]')].find((el) => /^文件(?!内容)/.test(el.textContent.trim()))`;
		await keyboardPress("菜单里的「文件」", item);
		await until(`document.querySelector('${pane(B)} [data-dock-pane="files"]')?.checkVisibility()`, 6000, "乙屏的文件面板");
		await pause(2500);
		const tree = { ...(await js<{ a: string[] | null; b: string[] | null }>(TREES)), focused: await focusedScreen() };
		console.log(`     文件面板：${JSON.stringify(tree)}`);
		const ours = (rows: string[] | null) => Boolean(rows?.some((path) => path.endsWith(`/${B.project}/lib.ts`))) && !rows?.some((path) => path.includes(`/${A.project}/`));
		check(scene, "焦点在甲：乙屏的文件面板列的是乙的项目（有 lib.ts，没有甲的文件）", ours(tree.b), tree);
		await caption(ours(tree.b) ? "乙屏的文件面板列的是乙的项目" : "乙屏的文件面板列的是甲的项目");
		await shoot("12", "焦点在甲_乙屏的文件面板", [`${pane(B)} [data-dock-pane="files"]`]);

		await caption(`点右边乙，再点回左边甲——乙屏的文件面板要一直是乙的`);
		await focusByMouse(B);
		await focusByMouse(A);
		await pause(1500);
		const again = { ...(await js<{ a: string[] | null; b: string[] | null }>(TREES)), focused: await focusedScreen() };
		check(scene, "焦点来回之后：乙屏的文件面板仍是乙的项目", ours(again.b), again);
		await shoot("13", "焦点回到甲_乙屏的文件面板", [`${pane(B)} [data-dock-pane="files"]`]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// links: a relative file link and a shell block in the screen without focus.
// ---------------------------------------------------------------------------

/** Where the file pane is open, which files it holds and what it shows. */
const FILE_STATE = `(() => {
	const shown = (key) => [...document.querySelectorAll('[data-ly-split-pane="' + key + '"] [data-dock-pane="file"]')].find((el) => el.checkVisibility()) ?? null;
	const a = shown('${A.id}'), b = shown('${B.id}');
	const panel = b ?? a;
	return {
		inA: Boolean(a), inB: Boolean(b),
		tabs: [...document.querySelectorAll('[data-file-tab]')].map((el) => el.getAttribute('data-file-tab')),
		text: panel ? panel.textContent.replace(/\\s+/g, ' ').trim().slice(0, 200) : null,
	};
})()`;
const TERMINAL_IN = (side: Side) => `[...document.querySelectorAll('${pane(side)} [data-dock-pane="terminal"]')].some((el) => el.checkVisibility())`;

async function sceneLinks(): Promise<void> {
	const scene = "links";
	await boot(scene, "文件链接与在终端运行");
	try {
		await open(B);
		await caption(`在「${B.title}」里问一句，让它回两个相对路径的文件链接和一段命令`);
		await say(B, LINKS);
		await until(`document.querySelectorAll('${pane(B)} [data-ly-file-link]').length >= 2`, 20000, "乙的回复里的文件链接");
		await within(`!document.querySelector('${pane(B)} [data-ly-running]')`, 10000);
		await pause(800);
		await caption(`把「${A.title}」拖进右边分屏，焦点落在甲上`);
		await dragIntoSplit(A.id, 2);
		await pause(800);
		await shoot("14", "焦点在甲_乙屏回复里的文件链接", [`${pane(B)} [data-ly-file-link]`]);

		await caption("键盘把焦点移到乙屏的「README.md」链接（没有鼠标按下），回车");
		await keyboardPress(`${pane(B)} [data-ly-file-link] a`);
		await within(`[...document.querySelectorAll('[data-dock-pane="file"]')].some((el) => el.checkVisibility())`, 6000);
		await pause(2000);
		const opened = { ...(await js<{ inA: boolean; inB: boolean; tabs: string[]; text: string | null }>(FILE_STATE)), focused: await focusedScreen() };
		console.log(`     文件面板：${JSON.stringify(opened)}`);
		check(scene, "键盘按乙屏的链接：文件面板开在乙屏，甲屏没有", opened.inB && !opened.inA, opened);
		const ours = join(app!.home, B.project, "README.md");
		check(scene, "打开的是乙项目的 README.md（内容写着 beta-lib）", opened.tabs.includes(ours) && Boolean(opened.text?.includes(`${B.project} README.md`)), { tabs: opened.tabs, text: opened.text });
		await caption(opened.tabs.some((tab) => tab.includes(`/${A.project}/`)) ? `打开的是甲的 ${A.project}/README.md` : opened.inA ? "文件开在了甲屏" : "乙的文件开在乙屏");
		await shoot("15", "键盘按乙屏链接之后", ['[data-dock-pane="file"]']);

		await caption("鼠标停在乙屏的命令块上（不按），键盘按「在终端运行」");
		const run = `${pane(B)} button[data-ly-tip="在终端运行"]`;
		await hover(`${pane(B)} pre`);
		await keyboardPress(run);
		await within(`${TERMINAL_IN(A)} || ${TERMINAL_IN(B)}`, 8000);
		await pause(1500);
		const terminal = { inA: await js<boolean>(TERMINAL_IN(A)), inB: await js<boolean>(TERMINAL_IN(B)), focused: await focusedScreen() };
		check(scene, "「在终端运行」：终端开在乙屏，甲屏没有", terminal.inB && !terminal.inA, terminal);
		// The command writes a file where it runs: which project that is says which screen's terminal took it.
		const ran = (side: Side) => existsSync(join(app!.home, side.project, RAN_HERE));
		const end = Date.now() + 8000;
		while (!ran(A) && !ran(B) && Date.now() < end) await pause(200);
		const where = { alpha: ran(A), beta: ran(B) };
		check(scene, "「在终端运行」的命令在乙的项目里执行，甲的项目里没有", where.beta && !where.alpha, where);
		await caption(terminal.inA ? "终端开在了甲屏" : "终端开在乙屏");
		await shoot("16", "键盘按在终端运行之后", ['[data-dock-pane="terminal"]']);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// defs: which panels a screen offers, beside a project-less conversation.
// ---------------------------------------------------------------------------

/** The quick panel buttons in each screen's title bar. */
const QUICK = `(() => {
	const read = (key) => [...document.querySelectorAll('[data-ly-split-pane="' + key + '"] [data-ly-panel-quick] button')].map((el) => el.getAttribute('aria-label'));
	return { a: read('${A.id}'), c: read('${C.id}') };
})()`;

async function sceneDefs(): Promise<void> {
	const scene = "defs";
	await boot(scene, "面板可用性", [A, C]);
	try {
		await open(A);
		await caption(`把不在项目里的「${C.title}」拖进右边分屏，焦点落在丙上`);
		await dragIntoSplit(C.id, 2);
		await pause(800);
		const onC = { ...(await js<{ a: string[]; c: string[] }>(QUICK)), focused: await focusedScreen() };
		const hasGit = (labels: string[]) => labels.some((label) => label?.startsWith("Git"));
		check(scene, "焦点在无项目的丙：甲屏标题栏仍有 Git 按钮", hasGit(onC.a), onC);
		await caption(hasGit(onC.a) ? "甲屏的 Git 按钮还在" : "焦点一到丙，甲屏的 Git 按钮就没了");
		await shoot("17", "焦点在丙_两屏标题栏的面板按钮", [`${pane(A)} [data-ly-panel-quick]`, `${pane(C)} [data-ly-panel-quick]`]);

		await caption(`点左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		const onA = { ...(await js<{ a: string[]; c: string[] }>(QUICK)), focused: await focusedScreen() };
		check(scene, "焦点在甲：无项目的丙屏标题栏没有 Git 按钮", !hasGit(onA.c), onA);
		await caption(hasGit(onA.c) ? "丙没有项目，标题栏却出现了 Git 按钮" : "丙屏没有 Git 按钮");
		await shoot("18", "焦点在甲_两屏标题栏的面板按钮", [`${pane(A)} [data-ly-panel-quick]`, `${pane(C)} [data-ly-panel-quick]`]);
	} finally {
		await shutdown();
	}
}


// ---------------------------------------------------------------------------
// meter: the context reading under a screen whose turn ends while the focused one runs.
// ---------------------------------------------------------------------------

const METER = (side: Side) => `${pane(side)} button[aria-label^="上下文占用"]`;
const reading = (side: Side) => js<string | null>(`document.querySelector('${METER(side)}')?.getAttribute('aria-label') ?? null`);

async function sceneMeter(): Promise<void> {
	const scene = "meter";
	await boot(scene, "上下文读数");
	try {
		await splitAB();
		const before = await reading(B);
		await caption(`点左边「${A.title}」，让它跑一个要 ${SLEEP} 秒的命令`);
		await say(A, LONG);
		await until(`document.querySelector('${pane(A)} [data-ly-running][data-ly-mood="working"]')`, 20000, "甲在跑命令");
		await caption(`点右边「${B.title}」，问一句会用掉很多上下文的`);
		await say(B, MEDIUM);
		await until(`document.querySelector('${pane(B)} [data-ly-running]')`, 15000, "乙在跑");
		await caption(`马上点回左边「${A.title}」——乙在后台把这一轮跑完`);
		await focusByMouse(A);
		await until(`!document.querySelector('${pane(B)} [data-ly-running]')`, 20000, "乙这一轮跑完");
		await pause(2500);
		const after = { b: await reading(B), aRunning: await js<boolean>(`Boolean(document.querySelector('${pane(A)} [data-ly-running]'))`), focused: await focusedScreen() };
		console.log(`     乙屏读数：之前 ${before}，之后 ${JSON.stringify(after)}`);
		check(scene, "甲还在跑时，乙屏跑完一轮：上下文读数刷新成这一轮的用量（47%）", after.aRunning && /\b47%/.test(after.b ?? ""), { before, after });
		await caption(/\b47%/.test(after.b ?? "") ? "乙屏读数刷新到了 47%" : `乙屏读数没动：还是「${after.b}」`);
		await shoot("19", "甲在跑_乙跑完一轮后的上下文读数", [METER(A), METER(B)]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// thinking: reasoning cut short under a stopped screen, while the focused conversation runs.
// ---------------------------------------------------------------------------

const HALTED_ROW = `document.querySelector('${pane(B)} [data-ly-thinking] .ly-flow-summary')`;

async function sceneThinking(): Promise<void> {
	const scene = "thinking";
	await boot(scene, "停下的思考块");
	try {
		await splitAB();
		await caption(`「${B.title}」停在一段没想完的思考上。点左边「${A.title}」，让它跑一个长命令`);
		await say(A, LONG);
		await until(`document.querySelector('${pane(A)} [data-ly-running][data-ly-mood="working"]')`, 20000, "甲在跑命令");
		// Every painted frame of 乙's reasoning row: typing shows as its text changing and as the follow-the-end mark.
		await js(`(() => {
			window.__probeThink = [];
			let last = '';
			const tick = () => {
				const row = ${HALTED_ROW};
				const now = row ? JSON.stringify({ text: row.textContent.trim(), follow: row.hasAttribute('data-follow-end') }) : 'none';
				if (now !== last) { window.__probeThink.push({ at: Math.round(performance.now()), ...(row ? JSON.parse(now) : { text: null, follow: false }) }); last = now; }
				window.__probeThinkRaf = requestAnimationFrame(tick);
			};
			tick();
		})()`);
		await pause(4000);
		const frames = await js<Array<{ at: number; text: string | null; follow: boolean }>>(`(() => { cancelAnimationFrame(window.__probeThinkRaf); return window.__probeThink; })()`);
		console.log(`     乙屏思考行逐帧：${JSON.stringify(frames.slice(0, 12))}`);
		const still = frames.length > 0 && frames.every((frame) => !frame.follow && frame.text === HALTED[0]);
		check(scene, "甲在跑时，乙屏停下的思考块一直静止：不逐字写，停在第一句", still, { changes: frames.length, first: frames.slice(0, 6) });
		await caption(still ? "乙屏的思考块停在第一句，没有动" : "乙屏停下的思考块又开始一个字一个字地写");
		await shoot("20", "甲在跑_乙屏停下的思考块", [`${pane(B)} [data-ly-thinking]`]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// mention: the composer's @ list under a screen the keyboard reached.
// ---------------------------------------------------------------------------

const MENTIONED = (side: Side) => js<string[]>(`[...document.querySelectorAll('${pane(side)} [data-mention-kind="file"]')].map((el) => el.dataset.mentionTitle)`);

async function sceneMention(): Promise<void> {
	const scene = "mention";
	await boot(scene, "输入框的@菜单");
	try {
		await splitAB();
		await caption(`点左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		await caption(`键盘把光标移进右边「${B.title}」的输入框（没有鼠标按下），打一个 @`);
		const reached = await js<boolean>(`(() => { const el = document.querySelector('${field(B)}'); el.focus(); return document.activeElement === el; })()`);
		if (!reached) throw new Error("键盘焦点落不到乙的输入框");
		await pause(300);
		await g.send("Input.insertText", { text: "@" });
		await within(`document.querySelector('${pane(B)} [data-mention-kind="file"]')`, 6000);
		await pause(1200);
		const files = await MENTIONED(B);
		check(scene, "键盘在乙屏打 @：列的是乙项目的文件（有 lib.ts）", files.includes("lib.ts"), { files, focused: await focusedScreen() });
		await caption(files.includes("lib.ts") ? "乙屏的 @ 列的是乙的文件" : "乙屏的 @ 列的是甲的文件，没有 lib.ts");
		await shoot("21", "键盘在乙屏打@", [`${pane(B)} [data-mention-kind="file"]`]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------
// skill: the skill capsule on a message in the screen without focus.
// ---------------------------------------------------------------------------

async function sceneSkill(): Promise<void> {
	const scene = "skill";
	await boot(scene, "技能胶囊");
	try {
		await splitAB();
		await caption(`点左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		await caption(`键盘把焦点移到右边「${B.title}」消息上的技能胶囊「${SKILL}」（没有鼠标按下），回车`);
		await keyboardPress(`${pane(B)} button[data-ly-tip="在侧边栏打开技能文件"]`);
		await within(`[...document.querySelectorAll('[data-dock-pane="file"]')].some((el) => el.checkVisibility())`, 6000);
		await pause(1500);
		const opened = { ...(await js<{ inA: boolean; inB: boolean; tabs: string[]; text: string | null }>(FILE_STATE)), focused: await focusedScreen() };
		const skillFile = join(app!.home, B.project, ".lyra", "skills", SKILL, "SKILL.md");
		console.log(`     技能胶囊：${JSON.stringify(opened)}`);
		check(scene, "键盘按乙屏的技能胶囊：打开乙项目里的 SKILL.md", opened.tabs.includes(skillFile), { tabs: opened.tabs, text: opened.text });
		check(scene, "文件面板开在乙屏，甲屏没有", opened.inB && !opened.inA, opened);
		await caption(opened.tabs.includes(skillFile) ? "打开了乙项目里的技能文件" : "没找到技能——它去甲的项目里找了");
		await shoot("22", "键盘按乙屏技能胶囊之后", ['[data-dock-pane="file"]']);
	} finally {
		await shutdown();
	}
}


// ---------------------------------------------------------------------------
// cards: the tool calls in the screen without focus, and the records they are drawn from.
// ---------------------------------------------------------------------------

const CARDS = `(() => {
	const root = document.querySelector('[data-ly-split-pane="${B.id}"]');
	const group = root?.querySelector('[data-ly-run]');
	return {
		pages: root ? [...root.querySelectorAll('iframe')].filter((el) => el.title === ${JSON.stringify("乙的预览页面")}).length : -1,
		line: group ? group.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80) : null,
		failed: root ? root.querySelectorAll('[data-ly-run] svg.lucide-circle-x').length : -1,
		done: root ? root.querySelectorAll('[data-ly-run] svg.lucide-circle-check').length : -1,
	};
})()`;

async function sceneCards(): Promise<void> {
	const scene = "cards";
	await boot(scene, "工具卡片记录");
	try {
		await splitAB();
		await caption(`「${B.title}」改过一个文件、出过一个预览。点左边「${A.title}」的输入框，焦点换到甲`);
		await focusByMouse(A);
		// A finished turn folds its tool work into one process line, and mounts nothing inside until opened.
		await caption(`键盘展开右边「${B.title}」那一轮的过程（没有鼠标按下）`);
		await keyboardPress(`${pane(B)} [data-ly-turn-process="done"] button[aria-expanded]`);
		await until(`document.querySelector('${pane(B)} [data-ly-run]')`, 5000, "乙屏过程里的工具");
		await pause(600);
		// And the run itself: its cards, the preview among them, are mounted the first time it opens.
		await caption(`键盘再展开那一行工具，看每一张卡片`);
		const group = `${pane(B)} [data-ly-run] button[aria-expanded="false"]`;
		if (await js<boolean>(`Boolean(document.querySelector('${group}'))`)) await keyboardPress(group);
		await pause(1500);
		const drawn = { ...(await js<{ pages: number; line: string | null; failed: number; done: number }>(CARDS)), focused: await focusedScreen() };
		console.log(`     乙屏的工具：${JSON.stringify(drawn)}`);
		check(scene, "焦点在甲：乙屏的预览画出了页面", drawn.pages === 1, drawn);
		check(scene, "焦点在甲：乙屏那一行工具数的是乙的改动（+5 -2）", /\+5/.test(drawn.line ?? "") && /-2/.test(drawn.line ?? ""), { line: drawn.line });
		check(scene, "焦点在甲：乙屏做完的调用画成完成，没有一个画成出错", drawn.failed === 0 && drawn.done >= 1, drawn);
		await caption(drawn.failed > 0 || drawn.pages === 0 ? "乙屏的调用没有记录：画成出错、预览没有页面、改动数是空的" : "乙屏的调用各有记录：打勾、改动数、预览页面");
		await shoot("23", "焦点在甲_乙屏展开的工具", [`${pane(B)} [data-ly-run]`]);
	} finally {
		await shutdown();
	}
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	await mkdir(OUT, { recursive: true });
	const scenes: Record<string, () => Promise<void>> = {
		running: sceneRunning,
		branch: sceneBranch,
		model: sceneModel,
		files: sceneFiles,
		links: sceneLinks,
		defs: sceneDefs,
		meter: sceneMeter,
		thinking: sceneThinking,
		mention: sceneMention,
		skill: sceneSkill,
		cards: sceneCards,
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
