/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */
/**
 * Sessions in one SQLite database (ADR-0032), in a real window, recorded.
 *
 * Three launches of one profile, each step answered twice: on screen for the recording, and as a
 * measured `check()` in the terminal.
 *
 *   1. A profile the JSONL store left behind. Its conversations are in the sidebar — the ones its
 *      `index.json` listed, in its order — a log the index did not name is not, and the display
 *      caches are gone while the logs stay. One is deleted, its old log and index entry with it, and
 *      the usage page is read before and after.
 *   2. Restarted: the deleted conversation stays deleted, and what it spent is still counted. Then a
 *      reply starts streaming and the main process is killed half-way through it — SIGKILL, so
 *      nothing gets to flush on the way out.
 *   3. After the kill: the reply is there as far as it had got, with the message that asked for it.
 *
 * Usage: node --experimental-strip-types e2e/session-db-demo.ts (after `pnpm build`).
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projectIdFor } from "@lyra/core";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { encode, startRecording, type Frame } from "./record.ts";

const OUT = join(homedir(), "Desktop", "Lyra会话数据库测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9662;
/** The streamed reply: this many numbered pieces, one every SEGMENT_MS. */
const SEGMENTS = 60;
const SEGMENT_MS = 150;

interface Legacy {
	id: string;
	title: string;
	ask: string;
	answer: string;
	input: number;
	output: number;
	cost: number;
	ago: number;
	listed: boolean;
}

const KEEP: Legacy = { id: "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a", title: "升级前的老对话", ask: "升级之前问过的一个问题", answer: "这是旧日志里的回答，升级以后应该原样留在这里。", input: 1200, output: 300, cost: 0.012, ago: 2 * 3_600_000, listed: true };
const DOOMED: Legacy = { id: "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b", title: "等会儿要删掉的对话", ask: "这一条待会儿会被删掉", answer: "删掉以后，它花掉的钱应该还算在用量里。", input: 3400, output: 600, cost: 0.034, ago: 3_600_000, listed: true };
// Deleted by the JSONL store while its file stayed behind: never in its sidebar, always in its usage page.
const ORPHAN: Legacy = { id: "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c", title: "索引里没有的孤儿日志", ask: "这条的日志在盘上，但索引里没有它", answer: "旧版删除时没删掉文件，侧栏里从来不显示它。", input: 500, output: 100, cost: 0.005, ago: 1_800_000, listed: false };
const ASK_LONG = "写一段很长的回复，我会在中途把应用杀掉。";

let app: RunningApp;
const frames: Frame[] = [];
const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean, detail: string): void {
	results.push({ name, ok });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const short = (id: string) => id.slice(0, 8);

// ---- the model: one slow stream, so there is something to cut off -------------------------------

function stream(res: ServerResponse): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: "m", type: "message", role: "assistant", content: [], model: "scripted", stop_reason: null, usage: { input_tokens: 800, output_tokens: 0 } } });
	emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
	let n = 0;
	const timer = setInterval(() => {
		n += 1;
		if (n > SEGMENTS) {
			clearInterval(timer);
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 400 } });
			emit("message_stop", {});
			res.end();
			return;
		}
		emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: `第${String(n).padStart(2, "0")}段。` } });
	}, SEGMENT_MS);
	// The killed app hangs up mid-stream; nothing more to write to.
	res.on("close", () => clearInterval(timer));
}

const model = createServer((req, res) => {
	req.resume();
	req.on("end", () => stream(res));
});

// ---- the profile the JSONL store left ------------------------------------------------------------

let project = "";
const logPath = (home: string, one: Legacy) => join(home, "sessions", projectIdFor(project), `${one.id}.jsonl`);
const cachePath = (home: string, one: Legacy) => join(home, "sessions", projectIdFor(project), `${one.id}.display.json`);
/** The ids the JSONL store's index still lists. */
const indexed = async (home: string) => (JSON.parse(await readFile(join(home, "sessions", "index.json"), "utf8")) as { id: string }[]).map((entry) => entry.id);

async function seed(home: string, modelPort: number): Promise<void> {
	project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "README.md"), "# 老项目\n");
	const projectId = projectIdFor(project);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const now = Date.now();
	const listed: object[] = [];
	// Newest first, as the JSONL store kept its index.
	for (const one of [ORPHAN, DOOMED, KEEP]) {
		const createdAt = now - one.ago - 60_000;
		const asked = now - one.ago - 30_000;
		const answered = now - one.ago;
		const usage = { input: one.input, output: one.output, cacheRead: 0, cacheWrite: 0, total: one.input + one.output, cost: { input: one.cost * 0.8, output: one.cost * 0.2, cacheRead: 0, cacheWrite: 0, total: one.cost } };
		const meta = { id: one.id, title: one.title, cwd: project, projectId, projectName: "老项目", createdAt, updatedAt: answered, modelId: "local/scripted", messageCount: 2, usage, seq: 3 };
		const records = [
			{ seq: 1, ts: createdAt, type: "meta", meta: { ...meta, updatedAt: createdAt, messageCount: 0, seq: 0, usage: { ...usage, input: 0, output: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
			{ seq: 2, ts: asked, type: "message", message: { role: "user", content: [{ type: "text", text: one.ask }], timestamp: asked } },
			{ seq: 3, ts: answered, type: "message", message: { role: "assistant", content: [{ type: "text", text: one.answer }], api: "anthropic-messages", provider: "local", model: "scripted", stopReason: "stop", usage, timestamp: answered } },
		];
		await writeFile(logPath(home, one), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
		// What the JSONL store left beside a log it had opened: the whole transcript again.
		await writeFile(cachePath(home, one), JSON.stringify({ v: 2, seq: 3, meta }));
		if (one.listed) listed.push(meta);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(listed));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
	const off = { retries: 0, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 };
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			uiLocale: "zh-CN",
			providers: [
				{
					id: "local",
					name: "本地假模型",
					api: "anthropic-messages",
					baseUrl: `http://127.0.0.1:${modelPort}`,
					apiKey: "not-a-key",
					enabled: true,
					models: [{ id: "local/scripted", providerId: "local", modelId: "scripted", name: "Scripted", contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: false, supportsImages: false, supportsTools: true }],
				},
			],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "off",
			autoSummarizeTitle: false,
			projectMemory: false,
			retryPolicy: { network: off, upstream: off },
			mcpServers: [],
			hooks: [],
			sync: { enabled: false },
			appearance: { reduceMotion: "off" },
			projects: [{ path: project, name: "老项目", pinned: true, lastOpenedAt: now }],
		}),
	);
}

// ---- reading the window --------------------------------------------------------------------------

async function until(expression: string, label: string, ms = 30_000): Promise<void> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await app.evaluate<boolean>(`Boolean(${expression})`).catch(() => false)) return;
		await pause(150);
	}
	throw new Error(`等不到：${label}`);
}

/** Sidebar rows, top to bottom, as drawn. */
const rowOrder = () => app.evaluate<string[]>(`[...document.querySelectorAll('[data-ly-row]')].filter((row) => row.checkVisibility()).map((row) => row.getAttribute('data-ly-row'))`);
const mainHas = (text: string) => app.evaluate<boolean>(`Boolean(document.querySelector("main")?.innerText.includes(${JSON.stringify(text)}))`);
/** The highest numbered piece of the streamed reply on screen. */
const piecesOnScreen = () => app.evaluate<number>(`Math.max(0, ...[...(document.querySelector("main")?.innerText ?? "").matchAll(/第(\\d+)段/g)].map((m) => Number(m[1])))`);

/** What the usage page is given: the same call it makes. */
async function usage(): Promise<{ input: number; cost: number; activeToday: number }> {
	return app.evaluate(`(async () => {
		const scan = await window.lyra.usage.scan();
		const today = new Date().toLocaleDateString("sv-SE");
		const day = scan.days.find((one) => one.day === today);
		return {
			input: scan.buckets.reduce((total, bucket) => total + bucket.input, 0),
			cost: scan.buckets.reduce((total, bucket) => total + bucket.cost, 0),
			activeToday: day ? day.sessions : 0,
		};
	})()`);
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// ---- driving it, with a real pointer -------------------------------------------------------------

async function point(selector: string): Promise<{ x: number; y: number }> {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, selector);
	return app.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
}

async function click(selector: string, button: "left" | "right" = "left"): Promise<void> {
	const at = await point(selector);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await pause(260);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button, clickCount: 1 });
	// A real press lasts about 80ms; sent back to back, a menu item can be replaced under the release.
	await pause(90);
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button, clickCount: 1 });
}

/**
 * A menu item by its text: the pointer goes there, the press is the element's own `click()`.
 * A synthetic press on a popover item lands, and the popover closes on it before `onClick` runs.
 */
async function byText(text: string, scope: string): Promise<void> {
	const match = `(e)=>e.checkVisibility()&&(e.innerText||'').trim()===${JSON.stringify(text)}`;
	await until(`[...document.querySelectorAll(${JSON.stringify(scope)})].some(${match})`, `「${text}」`);
	await app.evaluate(`(()=>{document.querySelector('[data-demo-db]')?.removeAttribute('data-demo-db');[...document.querySelectorAll(${JSON.stringify(scope)})].find(${match}).setAttribute('data-demo-db','');})()`);
	const at = await point("[data-demo-db]");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await pause(420);
	await app.evaluate(`document.querySelector('[data-demo-db]').click()`);
}

async function send(text: string): Promise<void> {
	await click("main textarea");
	await app.evaluate(`(()=>{
		const field = document.querySelector("main textarea");
		Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(field, ${JSON.stringify(text)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
	})()`);
	await pause(500);
	await app.evaluate(`document.querySelector("main textarea").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))`);
}

async function shot(name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${STAMP}_${name}.png`), Buffer.from(data, "base64"));
}

/** The main process of the instance on `port`: the one Electron process without a `--type`. */
function mainPid(port: number): number {
	const line = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" })
		.split("\n")
		.find((each) => each.includes(`--remote-debugging-port=${port}`) && !each.includes("--type="));
	if (!line) throw new Error(`no main process on port ${port}`);
	return Number(line.trim().split(/\s+/, 1)[0]);
}

async function gone(pid: number): Promise<boolean> {
	for (let i = 0; i < 50; i++) {
		try {
			process.kill(pid, 0);
		} catch {
			return true;
		}
		await pause(100);
	}
	return false;
}

/** The last message of a session as stored, read beside the running app. */
function lastStored(home: string, sessionId: string): { role?: string; stopReason?: string; pieces: number } {
	const db = new DatabaseSync(join(home, "sessions", "sessions.db"), { readOnly: true });
	try {
		const row = db.prepare("SELECT body FROM records WHERE session_id = ? AND kind = 'message' ORDER BY seq DESC LIMIT 1").get(sessionId) as { body: string } | undefined;
		const message = row ? (JSON.parse(row.body) as { message?: { role?: string; stopReason?: string; content?: { text?: string }[] } }).message : undefined;
		const text = (message?.content ?? []).map((part) => part.text ?? "").join("");
		return { role: message?.role, stopReason: message?.stopReason, pieces: Math.max(0, ...[...text.matchAll(/第(\d+)段/g)].map((m) => Number(m[1]))) };
	} finally {
		db.close();
	}
}

async function main(): Promise<void> {
	await mkdir(OUT, { recursive: true });
	await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
	const address = model.address();
	if (!address || typeof address === "string") throw new Error("model server did not start");
	// A profile of our own: it is launched three times.
	const home = await mkdtemp(join(tmpdir(), "lyra-db-demo-"));
	await seed(home, address.port);
	let stop: () => Promise<void> = async () => {};

	try {
		// ---- 1. the upgrade ----------------------------------------------------------------------
		app = await startApp({ port: PORT, reuseHome: home });
		stop = await startRecording(PORT, frames);
		await app.evaluate("document.fonts.ready");
		await until(`document.querySelector('[data-ly-row="${KEEP.id}"]')`, "升级前的对话出现在侧栏");
		await pause(1500);

		const rows = await rowOrder();
		check(
			"旧日志导入后，索引里的两条对话都在侧栏，顺序和旧版一样",
			rows.includes(DOOMED.id) && rows.indexOf(KEEP.id) > rows.indexOf(DOOMED.id),
			`侧栏从上到下：${JSON.stringify(rows.map(short))}`,
		);
		check("索引里没有的孤儿日志没有变成会话", !rows.includes(ORPHAN.id), `侧栏里有没有 ${short(ORPHAN.id)}：${rows.includes(ORPHAN.id)}`);
		const onDisk = [KEEP, DOOMED, ORPHAN].map((one) => existsSync(logPath(home, one)));
		const caches = [KEEP, DOOMED, ORPHAN].map((one) => existsSync(cachePath(home, one)));
		check(
			"会话库建好了，三份旧日志原样留在盘上当备份",
			existsSync(join(home, "sessions", "sessions.db")) && onDisk.every(Boolean),
			`sessions.db：${existsSync(join(home, "sessions", "sessions.db"))}；旧日志：${JSON.stringify(onDisk)}`,
		);
		check("旧版的展示缓存导入后删掉了", caches.every((left) => !left), `还在的展示缓存：${JSON.stringify(caches)}`);
		await shot("01_升级后的侧栏");

		await click(`[data-ly-row="${KEEP.id}"]`);
		await until(`document.querySelector("main")?.innerText.includes(${JSON.stringify(KEEP.answer)})`, "老对话的回答");
		await pause(1200);
		check("打开导入的老对话，问题和回答都在", (await mainHas(KEEP.ask)) && (await mainHas(KEEP.answer)), `问题：${await mainHas(KEEP.ask)}；回答：${await mainHas(KEEP.answer)}`);
		await shot("02_打开导入的老对话");

		const before = await usage();
		check(
			"删除之前，用量算上了三份日志花的钱（孤儿日志也算，和旧版的用量页一样）",
			before.input === KEEP.input + DOOMED.input + ORPHAN.input && near(before.cost, KEEP.cost + DOOMED.cost + ORPHAN.cost),
			`输入 ${before.input} tokens，费用 $${before.cost.toFixed(4)}，今天活跃 ${before.activeToday} 条会话`,
		);

		// Deleting is offered for archived conversations only: archive it, then delete it from the archive.
		await click(`[data-ly-row="${DOOMED.id}"]`, "right");
		await pause(800);
		await byText("归档", "[data-ly-popover] button");
		await until(`!document.querySelector('[data-ly-row="${DOOMED.id}"]')`, "归档后它离开侧栏");
		await pause(900);
		await click("[data-ly-open-settings]");
		await pause(700);
		await byText("已归档的聊天", "nav button");
		await until(`document.querySelector('[data-ly-archive-row="${DOOMED.id}"]')`, "已归档列表里的那一条");
		await pause(900);
		await byText("删除", `[data-ly-archive-row="${DOOMED.id}"] button`);
		await until(`document.querySelector('[data-ly-modal]')`, "确认框");
		await pause(900);
		await shot("03_确认删除");
		await byText("删除", "[data-ly-modal] button");
		await until(`!document.querySelector('[data-ly-archive-row="${DOOMED.id}"]')`, "那一条从已归档里消失");
		await pause(1200);
		await click('[data-ly-rail-item="chat"]');
		await pause(900);
		const afterDelete = await usage();
		check(
			"删掉之后它从侧栏消失，花掉的钱还在用量里",
			afterDelete.input === before.input && near(afterDelete.cost, before.cost),
			`输入 ${before.input} → ${afterDelete.input}，费用 $${before.cost.toFixed(4)} → $${afterDelete.cost.toFixed(4)}`,
		);
		check("它不再算今天的活跃会话", afterDelete.activeToday === before.activeToday - 1, `今天活跃 ${before.activeToday} → ${afterDelete.activeToday}`);
		const index = await indexed(home);
		check(
			"它的旧日志和旧索引里那一条也一起删了，别的会话的不动",
			!existsSync(logPath(home, DOOMED)) && !index.includes(DOOMED.id) && existsSync(logPath(home, KEEP)) && index.includes(KEEP.id),
			`它的旧日志还在：${existsSync(logPath(home, DOOMED))}；旧索引里还有它：${index.includes(DOOMED.id)}；老对话的旧日志还在：${existsSync(logPath(home, KEEP))}`,
		);

		// ---- 2. restarted; then a reply cut off ---------------------------------------------------
		await stop();
		await app.stop();
		app = await startApp({ port: PORT, reuseHome: home });
		stop = await startRecording(PORT, frames);
		await app.evaluate("document.fonts.ready");
		await until(`document.querySelector('[data-ly-row="${KEEP.id}"]')`, "重启后的老对话");
		await pause(1500);
		const restarted = await rowOrder();
		check(
			"重启之后，删掉的对话没有回来",
			!restarted.includes(DOOMED.id),
			`侧栏：${JSON.stringify(restarted.map(short))}`,
		);
		const afterRestart = await usage();
		check(
			"重启之后，用量里的花销没变",
			afterRestart.input === before.input && near(afterRestart.cost, before.cost),
			`输入 ${afterRestart.input} tokens，费用 $${afterRestart.cost.toFixed(4)}`,
		);
		await click("[data-ly-open-settings]");
		await pause(700);
		await byText("使用统计", "nav button");
		await pause(2500);
		await shot("04_删除并重启之后的用量页");
		await click('[data-ly-rail-item="chat"]');
		await pause(900);

		await click(`[data-ly-row="${KEEP.id}"]`);
		await until(`document.querySelector("main")?.innerText.includes(${JSON.stringify(KEEP.answer)})`, "再打开老对话");
		await pause(800);
		await send(ASK_LONG);
		await until(`/第(0[6-9]|[1-9]\\d)段/.test(document.querySelector("main")?.innerText ?? "")`, "回复流出几段");
		await pause(1200);
		const seen = await piecesOnScreen();
		await shot("05_回复流到一半");
		await stop().catch(() => undefined);
		const pid = mainPid(PORT);
		process.kill(pid, "SIGKILL");
		check("在回复流到一半时强杀主进程（SIGKILL，什么都来不及收尾）", await gone(pid), `pid ${pid}，杀之前屏幕上流到第 ${seen} 段（共 ${SEGMENTS} 段）`);
		await app.stop();

		// ---- 3. after the kill ----------------------------------------------------------------------
		app = await startApp({ port: PORT, reuseHome: home });
		stop = await startRecording(PORT, frames);
		await app.evaluate("document.fonts.ready");
		await until(`document.querySelector('[data-ly-row="${KEEP.id}"]')`, "崩溃重启后的老对话");
		await pause(1000);
		await click(`[data-ly-row="${KEEP.id}"]`);
		await until(`/第\\d+段/.test(document.querySelector("main")?.innerText ?? "")`, "那段没写完的回复");
		await pause(1500);
		const recovered = await piecesOnScreen();
		check(
			"重启之后，流到一半的回复还在，最多差最后一批没来得及写的",
			recovered >= seen - 1 && recovered >= 5,
			`杀之前屏幕上到第 ${seen} 段，重启后到第 ${recovered} 段（流式每 80ms 落一次盘）`,
		);
		check("它停在中途，没有被补成写完的样子", recovered < SEGMENTS, `${recovered} < ${SEGMENTS}`);
		check("引出它的那条消息也在", await mainHas(ASK_LONG), `「${ASK_LONG}」在屏幕上：${await mainHas(ASK_LONG)}`);
		const stored = lastStored(home, KEEP.id);
		check("库里那条回复记成了「停止」", stored.role === "assistant" && stored.stopReason === "aborted" && stored.pieces === recovered, JSON.stringify(stored));
		await shot("06_重启后流到一半的回复还在");
		await pause(1500);
	} finally {
		await stop().catch(() => undefined);
		const passed = results.filter((result) => result.ok).length;
		const file = join(OUT, `${STAMP}_会话存进数据库_${passed}of${results.length}.mp4`);
		// The gaps between launches are not worth seconds of a frozen frame.
		await encode(frames, file, 12, 1200).catch((cause: unknown) => console.log(`录像没能合成：${String(cause)}`));
		console.log(`\n${passed}/${results.length} 通过`);
		console.log(`🎬 ${file}`);
		await app?.stop().catch(() => undefined);
		await closeListeningServer(model).catch(() => undefined);
		await rm(home, { recursive: true, force: true });
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
