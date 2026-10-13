/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * The session-level operations in a real window, recorded while checked: the suggestion card, and a
 * conversation archiving itself.
 *
 * The unit tests prove each link (`core/test/session-ops.test.ts`, `test/session-ops.test.ts`,
 * `test/ui/session-suggestion-card.test.ts`). This covers the chain they cannot reach: the model
 * really calling the tools the desktop injects, the card drawn outside the process block, a real
 * mouse on Start making the main process create the session and send its prompt to the model, the
 * sidebar gaining a row while the window stays where it was, the card still "started" after a
 * restart; and the archiving turn ending normally, the session in the archive, the window off it.
 *
 * The model is fake: an Anthropic streaming server that picks its script by a marker in what the
 * person said.
 *
 * Usage: node --experimental-strip-types e2e/session-ops-demo.ts [output directory]
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { landsOn } from "./lands-on.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra会话级操作测试");
const PORT = 9490;
const MODEL_PORT = 9890;
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

const SPAWN_ASK = "SPAWN-PROBE 把登录按钮的点击区域修一下";
const TITLE = "删掉没人调用的 legacyLogin";
const SUMMARY = "修登录按钮时看到 legacyLogin 已经没有调用方了。新会话会确认一遍，再删掉它和它的测试。";
const CHILD = "CHILD-PROMPT 在 src/auth.ts 里，legacyLogin 已经没有任何调用方。先全局搜一遍确认，再删掉它和 test/auth.test.ts 里对应的用例，最后跑一遍测试。";
const ARCHIVE_ASK = "ARCHIVE-PROBE 把 README 里的错别字改掉，做完就归档这个对话";

const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw = ""): void {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

// ---------------------------------------------------------------------------
// The scripted model
// ---------------------------------------------------------------------------

/** Every agent request the fake model answered, by whose it was and whether a tool result came with it. */
const asked: { who: string; answered: boolean; firstUser: string }[] = [];

const write = (res: ServerResponse, events: [string, unknown][]) => {
	for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
};

/**
 * One streamed reply: a sentence, then optionally a tool call.
 *
 * `holdMs` keeps the sentence on screen before the call arrives — an archive that lands the instant
 * the reply does leaves nothing for the recording to show of the conversation it took away.
 */
function reply(res: ServerResponse, text: string, tool?: { name: string; input: unknown }, holdMs = 0): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	write(res, [
		["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", content: [], model: "scripted", stop_reason: null, usage: { input_tokens: 900, output_tokens: 0 } } }],
		["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
		["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
		["content_block_stop", { type: "content_block_stop", index: 0 }],
	]);
	setTimeout(() => {
		if (tool) {
			const id = `toolu_${Math.random().toString(36).slice(2, 10)}`;
			write(res, [
				["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id, name: tool.name, input: {} } }],
				["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } }],
				["content_block_stop", { type: "content_block_stop", index: 1 }],
			]);
		}
		write(res, [
			["message_delta", { type: "message_delta", delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 40 } }],
			["message_stop", { type: "message_stop" }],
		]);
		res.end();
	}, holdMs);
}

type Part = { type: string; text?: string };
type Body = { tools?: { name: string }[]; messages?: { role: string; content: string | Part[] }[] };

function startModel(): Server {
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const body = JSON.parse(raw) as Body;
			// Side requests (the correction check, memory) carry no tools; a plain refusal is harmless to all of them.
			if (!body.tools?.some((tool) => tool.name === "read")) return reply(res, '{"isCorrection": false}');
			const users = (body.messages ?? []).filter((message) => message.role === "user");
			const parts = users.flatMap((message) => (typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content));
			const said = parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
			const last = users.at(-1)?.content;
			const answered = Array.isArray(last) && last.some((part) => part.type === "tool_result");
			const who = said.includes("ARCHIVE-PROBE") ? "archive" : said.includes("CHILD-PROMPT") ? "child" : said.includes("SPAWN-PROBE") ? "spawn" : "other";
			const first = users[0]?.content;
			const firstUser = typeof first === "string" ? first : (first ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").find((text) => !text.startsWith("<env>")) ?? "";
			asked.push({ who, answered, firstUser });
			if (who === "spawn" && !answered) return reply(res, "先修登录按钮。顺手看到一处没人用的旧代码，单独建议一个会话去清理。", { name: "spawn_session", input: { title: TITLE, summary: SUMMARY, prompt: CHILD } });
			if (who === "spawn") return reply(res, "SPAWN-DONE 登录按钮的点击区域修好了。");
			if (who === "archive" && !answered) return reply(res, "错别字改好了，按你说的把这个对话归档。", { name: "archive_session", input: { reason: "README 错别字已改" } }, 2500);
			if (who === "archive") return reply(res, "ARCHIVE-FOLLOW-UP 这句不该被要出来");
			if (who === "child") return reply(res, "CHILD-OK 收到，先搜一遍确认没人调用。");
			return reply(res, "好");
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

async function seed(home: string): Promise<string> {
	const project = join(home, "project");
	await mkdir(join(project, "src"), { recursive: true });
	await writeFile(join(project, "src", "auth.ts"), "export function legacyLogin() {}\nexport function login() {}\n");
	await writeFile(join(project, "README.md"), "# 演示工程\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "local", name: "Local", baseUrl: `http://127.0.0.1:${MODEL_PORT}`, api: "anthropic-messages", apiKey: "not-a-key", enabled: true,
					models: [{ id: "local/scripted", providerId: "local", modelId: "scripted", name: "Scripted", contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: false, supportsImages: false, supportsTools: true }],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "演示工程", path: project, pinned: true, lastOpenedAt: Date.now() }],
			defaultModelId: "local/scripted",
			autoSummarizeTitle: false,
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 0,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4523, token: null },
			appearance: { theme: "dark" },
		}),
	);
	return project;
}

// ---------------------------------------------------------------------------
// Driving the window
// ---------------------------------------------------------------------------

let app: RunningApp;

async function until(expression: string, what: string, ms = 30_000): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await app.evaluate<boolean>(`Boolean(${expression})`).catch(() => false)) return true;
		await pause(200);
	}
	console.log(`   …等不到：${what}`);
	return false;
}

/** Whether the fake model has been asked by `who` yet, within 20 seconds. */
async function heard(who: string): Promise<boolean> {
	for (let i = 0; i < 100; i++) {
		if (asked.some((one) => one.who === who)) return true;
		await pause(200);
	}
	return false;
}

const center = (selector: string) =>
	app.evaluate<{ x: number; y: number } | null>(
		`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null; })()`,
	);

/** A real mouse: settle the target, prove the point lands on it, then move, press, release. */
async function press(selector: string, what: string): Promise<void> {
	if (!(await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, what, 20_000))) throw new Error(`找不到要点的：${what}`);
	let point = await center(selector);
	for (let i = 0; i < 12; i++) {
		await pause(90);
		const again = await center(selector);
		if (again && point && again.x === point.x && again.y === point.y) break;
		point = again;
	}
	if (!point) throw new Error(`量不到位置：${what}`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
	await pause(250);
	await app.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const x = ${point.x}; const y = ${point.y}; ${landsOn(what)} return true; })()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function ask(text: string): Promise<void> {
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		if (!field) throw new Error("no composer");
		field.focus();
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(text)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
	})()`);
	await pause(900);
	await app.evaluate(`document.querySelector("main textarea").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))`);
}

/** The conversation on screen, by the sidebar row that says it is the open one. */
// Scoped to the rows: other navigation (the sidebar's tabs) also says `aria-current`, and matching it read as "no conversation open".
const activeRow = () => app.evaluate<string | null>(`document.querySelector('[data-ly-row] [aria-current="page"]')?.closest("[data-ly-row]")?.getAttribute("data-ly-row") ?? null`);
const transcript = () => app.evaluate<string>(`document.querySelector("main")?.innerText ?? ""`);
type Meta = { id: string; title: string; projectId: string; archived?: boolean; spawnedFrom?: { sessionId: string; toolCallId: string } };
const listed = () => app.evaluate<Meta[]>(`window.lyra.sessions.list()`);

async function shot(name: string, clip?: string): Promise<void> {
	const box = clip
		? await app.evaluate<{ x: number; y: number; width: number; height: number } | null>(
				`(() => { const r = document.querySelector(${JSON.stringify(clip)})?.getBoundingClientRect(); return r ? { x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 16), width: r.width + 32, height: r.height + 32 } : null; })()`,
			)
		: null;
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png", ...(box ? { clip: { ...box, scale: 1 } } : {}) });
	await writeFile(join(OUT_DIR, `${STAMP}_${name}.png`), Buffer.from(data, "base64"));
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	const home = await mkdtemp(join(tmpdir(), "lyra-session-ops-"));
	// Commands and skills under ~/.claude would be read into the profile and into the pictures.
	const claudeDir = await mkdtemp(join(tmpdir(), "lyra-session-ops-claude-"));
	process.env.CLAUDE_CONFIG_DIR = claudeDir;
	await seed(home);
	const model = startModel();
	const frames: Frame[] = [];
	let stopRecording: (() => Promise<void>) | null = null;
	try {
		app = await startApp({ port: PORT, reuseHome: home, scaleFactor: 2 });
		stopRecording = await startRecording(PORT, frames);
		await until(`document.querySelector("main textarea")`, "输入框");
		await pause(1200);

		console.log("【一】模型在做手头的事时，建议另开一个会话");
		await ask(SPAWN_ASK);
		const carded = await until(`document.querySelector("[data-ly-session-suggestion]") && document.body.innerText.includes("SPAWN-DONE")`, "建议卡片和这一轮的收尾");
		check("这一轮跑完了，卡片画在对话里", carded, (await transcript()).slice(-300));
		await pause(1200);
		const suggested = await app.evaluate<{ state: string | null; title: string; summary: string; action: string; label: string; folded: boolean }>(`(() => {
			const card = document.querySelector("[data-ly-session-suggestion]");
			return {
				state: card?.getAttribute("data-ly-session-suggestion") ?? null,
				title: card?.querySelector("[data-ly-suggestion-title]")?.textContent ?? "",
				summary: card?.querySelector("[data-ly-suggestion-summary]")?.textContent ?? "",
				action: card?.querySelector("[data-ly-suggestion-action]")?.textContent ?? "",
				label: card?.innerText.split("\\n")[0] ?? "",
				folded: Boolean(card?.closest("[data-ly-turn-process], details")),
			};
		})()`);
		check("卡片：建议的新会话 / 标题 / 说明 / 开始", suggested.state === "suggested" && suggested.title === TITLE && suggested.summary === SUMMARY && suggested.action === "开始" && suggested.label.includes("建议的新会话"), JSON.stringify(suggested));
		check("卡片不在折叠起来的过程里", !suggested.folded, "在过程块里");
		const callId = await app.evaluate<string>(`document.querySelector("[data-ly-session-suggestion]")?.getAttribute("data-ly-suggestion-call") ?? ""`);
		const origin = await activeRow();
		// Everything below compares against this; null would let "still on the same conversation" pass for nothing.
		check("提建议的对话是侧栏里选中的那一行", Boolean(origin), String(origin));
		const rowsBefore = await app.evaluate<number>(`document.querySelectorAll("[data-ly-row]").length`);
		check("开始之前什么都没跑：模型只被问了这一个对话", asked.every((one) => one.who === "spawn"), JSON.stringify(asked.map((one) => one.who)));
		await shot("01_建议卡片_开始");
		await shot("01b_建议卡片特写", "[data-ly-session-suggestion]");

		console.log("\n【二】真鼠标点「开始」");
		await press('[data-ly-suggestion-action="start"]', "开始");
		const started = await until(`document.querySelector('[data-ly-session-suggestion="started"]')`, "卡片翻成已开始");
		const action = await app.evaluate<string>(`document.querySelector("[data-ly-suggestion-action]")?.textContent ?? ""`);
		// The card says what the conversation it started is doing: running at once, done once it has answered.
		check("卡片翻过来，说出那个会话在做什么", started && /^(进行中|已完成) · 打开$/.test(action), action);
		const child = (await listed()).find((meta) => meta.spawnedFrom?.toolCallId === callId);
		check("新会话记着它是从这张卡片开出来的", Boolean(child) && child?.spawnedFrom?.sessionId === origin, JSON.stringify(child?.spawnedFrom ?? null));
		const inSidebar = child ? await until(`document.querySelector('[data-ly-row="${child.id}"]')`, "侧栏里的新会话") : false;
		const rowsAfter = await app.evaluate<number>(`document.querySelectorAll("[data-ly-row]").length`);
		check("新会话出现在侧栏", inSidebar && rowsAfter === rowsBefore + 1, `${rowsBefore} → ${rowsAfter}`);
		const childAnswered = await heard("child");
		const childAsk = asked.find((one) => one.who === "child");
		check("新会话自己在后台跑了：发给模型的第一条就是卡片背后那段提示词", childAnswered && childAsk?.firstUser === CHILD, childAsk?.firstUser ?? "（新会话没有问过模型）");
		await pause(1500);
		const finished = await until(`document.querySelector("[data-ly-suggestion-action]")?.textContent === "已完成 · 打开"`, "卡片说已完成");
		check("它跑完以后，卡片说「已完成 · 打开」，不用去别处找", finished, await app.evaluate<string>(`document.querySelector("[data-ly-suggestion-action]")?.textContent ?? ""`));
		check("当前视图没切走：打开的还是原来那个对话", (await activeRow()) === origin && (await transcript()).includes("SPAWN-DONE"), `${await activeRow()} vs ${origin}`);
		if (child) {
			const stored = await app.evaluate<{ role: string; text: string }[]>(`window.lyra.sessions.transcript(${JSON.stringify(child.projectId)}, ${JSON.stringify(child.id)}).then((s) => (s?.messages ?? []).map((m) => ({ role: m.role, text: (Array.isArray(m.content) ? m.content : []).filter((c) => c.type === "text").map((c) => c.text).join("") })))`);
			check("新会话的记录里，第一条是那段提示词，后面跟着它自己的回答", stored[0]?.role === "user" && stored[0]?.text === CHILD && stored.some((one) => one.role === "assistant" && one.text.includes("CHILD-OK")), JSON.stringify(stored).slice(0, 300));
		}
		await shot("02_点开始之后_已开始_仍在原对话");
		await shot("02b_已开始特写", "[data-ly-session-suggestion]");
		await pause(1200);

		console.log("\n【三】重启：卡片还是「已开始」");
		await stopRecording();
		stopRecording = null;
		await app.stop();
		await pause(1500);
		app = await startApp({ port: PORT, reuseHome: home, scaleFactor: 2 });
		stopRecording = await startRecording(PORT, frames);
		await until(`document.querySelector("main textarea")`, "输入框");
		await pause(1000);
		if (origin) await press(`[data-ly-row="${origin}"]`, "原来那个对话");
		const reopened = await until(`document.body.innerText.includes("SPAWN-DONE") && document.querySelector("[data-ly-session-suggestion]")`, "重开后的卡片");
		const after = await app.evaluate<string | null>(`document.querySelector("[data-ly-session-suggestion]")?.getAttribute("data-ly-session-suggestion") ?? null`);
		check("重启后打开原对话，卡片仍是「已开始」", reopened && after === "started", String(after));
		await pause(1000);
		await shot("03_重启后仍是已开始");

		console.log("\n【四】点「已开始 · 打开」切到那个会话");
		await press('[data-ly-suggestion-action="open"]', "打开");
		const switched = child ? await until(`document.querySelector('[data-ly-row="${child.id}"] [aria-current="page"]') && document.body.innerText.includes("CHILD-OK")`, "切到新会话") : false;
		check("切过去了，看得到新会话自己的回答", switched, String(await activeRow()));
		await pause(1500);
		await shot("04_打开新会话");

		console.log("\n【五】归档自己");
		await app.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "新对话")?.setAttribute("data-qa-new-chat", "")`);
		await press("[data-qa-new-chat]", "新对话");
		await until(`!document.querySelector('[data-ly-row] [aria-current="page"]')`, "空白的新对话");
		await pause(800);
		await ask(ARCHIVE_ASK);
		await until(`document.body.innerText.includes("ARCHIVE-PROBE")`, "发出去了", 15_000);
		await pause(400);
		await shot("05_归档之前");
		const archivedMeta = await (async () => {
			for (let i = 0; i < 150; i++) {
				const found = (await listed()).find((meta) => meta.title.includes("ARCHIVE-PROBE") && meta.archived === true);
				if (found) return found;
				await pause(200);
			}
			return null;
		})();
		check("会话进了归档", Boolean(archivedMeta), JSON.stringify((await listed()).map((meta) => [meta.title.slice(0, 20), meta.archived ?? false])));
		await pause(1500);
		const archiveAsks = asked.filter((one) => one.who === "archive");
		check("这一轮停在归档那一下：模型只被问了一次，没有再追一句", archiveAsks.length === 1 && !archiveAsks.some((one) => one.answered), JSON.stringify(archiveAsks));
		if (archivedMeta) {
			const trail = await app.evaluate<string>(`window.lyra.sessions.trajectory(${JSON.stringify(archivedMeta.projectId)}, ${JSON.stringify(archivedMeta.id)}).then((entries) => JSON.stringify(entries))`);
			check("这一轮正常收尾：执行结束 · done，没有被砍成 aborted", trail.includes("执行结束 · done") && !trail.includes("执行结束 · aborted"), trail.slice(0, 200));
			const stored = await app.evaluate<{ role: string; isError?: boolean }[]>(`window.lyra.sessions.transcript(${JSON.stringify(archivedMeta.projectId)}, ${JSON.stringify(archivedMeta.id)}).then((s) => (s?.messages ?? []).map((m) => ({ role: m.role, isError: m.isError })))`);
			check("最后那条工具结果落进了记录，不是错误", stored.at(-1)?.role === "toolResult" && stored.at(-1)?.isError !== true, JSON.stringify(stored));
			const left = await until(`!document.querySelector('[data-ly-row="${archivedMeta.id}"]') && !document.querySelector("main")?.innerText.includes("ARCHIVE-PROBE")`, "界面离开");
			check("界面离开了它：侧栏没有这一行，屏幕上不再是这个对话", left, String(await activeRow()));
			await shot("06_归档之后_界面离开");
			await pause(1000);
			await press('button[aria-label^="已归档的聊天"]', "已归档的聊天");
			const inArchive = await until(`document.querySelector('[data-ly-row="${archivedMeta.id}"]')`, "归档列表里的这一行");
			check("在已归档的聊天里找得到它", inArchive, "");
			await pause(1200);
			await shot("07_已归档的聊天");
			await press('button[aria-label="退出归档"]', "退出归档");
			await pause(1000);
		}
	} catch (error) {
		check("探针完整跑完", false, error instanceof Error ? (error.stack ?? error.message) : String(error));
	} finally {
		if (stopRecording) await stopRecording().catch(() => {});
		await app?.stop().catch(() => {});
		await closeListeningServer(model);
		await rm(home, { recursive: true, force: true }).catch(() => {});
		await rm(claudeDir, { recursive: true, force: true }).catch(() => {});
	}

	const passed = checks.filter((one) => one.ok).length;
	console.log(`\n${passed}/${checks.length} 项通过，采到 ${frames.length} 帧`);
	if (frames.length > 0) {
		const out = join(OUT_DIR, `${STAMP}_会话级操作_${passed}of${checks.length}.mp4`);
		await encode(frames, out, 60, 1500);
		console.log(`视频：${out}`);
	}
	console.log(`截图：${OUT_DIR}`);
	if (passed !== checks.length) process.exitCode = 1;
}

await main();
