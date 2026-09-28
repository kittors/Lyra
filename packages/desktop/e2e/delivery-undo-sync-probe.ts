/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * An undo made anywhere reaches every surface showing that turn: the card, the docked pane, and a
 * pane popped out into a window of its own.
 *
 * Undo writes the file back and leaves the turn's record alone, so rows and +N −M stay what they
 * were — what changes is whether each file can still be undone. The card read that once, on mount,
 * so an undo made in the pane left it offering 「撤销」 for the whole turn and an enabled undo on the
 * file's preview, both of which the main process then refuses. The popped-out pane is a second
 * renderer and heard nothing of an undo made on the card.
 *
 * Every measurement is held against the main process's own answer (`delivery.get`) at that moment.
 *
 *   node --experimental-strip-types e2e/delivery-undo-sync-probe.ts [--before]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import { closeListeningServer, evaluateRenderer, startApp, type AppWindow, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { landsOn } from "./lands-on.ts";
import { encode, frameGrabber, pause, type Frame } from "./record.ts";

const OUT = join(homedir(), "Desktop", "Lyra交付卡片撤销同步测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const phase = process.argv.includes("--before") ? "before" : "after";
const PORT = 9437;
const SESSION = "qa-short";

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

/** Each prompt writes its own three files; the tag keys the tool call ids the script counts. */
const TURNS = [
	{ prompt: "写三份文档甲", tag: "alpha", files: ["alpha-1.md", "alpha-2.md", "alpha-3.md"] },
	{ prompt: "写三份文档乙", tag: "beta", files: ["beta-1.md", "beta-2.md", "beta-3.md"] },
];

let app: RunningApp | undefined;
let server: Server | undefined;
const mainFrames: Frame[] = [];
const panelFrames: Frame[] = [];
let filming = true;
const closers: (() => void)[] = [];

type Target = Pick<AppWindow, "evaluate" | "send">;

async function until(target: Target, expression: string, ms = 30_000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await target.evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(100);
	}
	throw new Error(`UI condition not reached: ${expression}`);
}

/**
 * Where an element's middle is, once it has stopped moving.
 *
 * A card that has just appeared is still being followed to the bottom, so the point measured first
 * is somewhere else by the time a press lands on it.
 */
async function steadyCenter(target: Target, selector: string): Promise<{ x: number; y: number }> {
	await target.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	let at = { x: -1, y: -1 };
	for (let tries = 0; tries < 30; tries++) {
		const next = await target.evaluate<{ x: number; y: number }>(
			`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);
		if (next.x === at.x && next.y === at.y) break;
		at = next;
		await pause(120);
	}
	return at;
}

/** A real press, after asking the page what is under the point. */
async function click(target: Target, selector: string) {
	await until(target, `document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	const at = await steadyCenter(target, selector);
	await target.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await target.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const x=${at.x},y=${at.y};${landsOn(selector)}})()`);
	for (const type of ["mousePressed", "mouseReleased"]) await target.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
}

/** The confirm dialog's 「撤销改动」, in whichever window asked. */
async function confirmUndo(target: Target) {
	await until(target, `[...document.querySelectorAll('[data-ly-modal] button')].some((b)=>b.innerText.trim()==='撤销改动')`);
	await target.evaluate(`[...document.querySelectorAll('[data-ly-modal] button')].find((b)=>b.innerText.trim()==='撤销改动').setAttribute('data-probe-confirm','')`);
	await pause(300);
	await click(target, "[data-probe-confirm]");
	await until(target, `!document.querySelector('[data-ly-modal]')`);
}

/**
 * Keep pictures of a window coming in, for the video, over one socket that stays open.
 *
 * A screenshot is forced even for a covered window, which a screencast is not; one socket per shot
 * is what `send` does, and that got 21 frames out of a minute.
 */
function film(shot: () => Promise<Buffer>, frames: Frame[]) {
	void (async () => {
		// Stopped by the probe's `finally`, out of this loop's sight: a `while (filming)` reads as never ending.
		for (;;) {
			if (!filming) return;
			const data = await Promise.race([shot().catch(() => null), pause(3_000).then(() => null)]);
			if (data) frames.push({ at: Date.now(), data });
			await pause(120);
		}
	})();
}

/** The popped-out pane's own debugger socket, found by asking each window who it is. */
async function panelShots(): Promise<(() => Promise<Buffer>) | null> {
	const list = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())) as { type: string; webSocketDebuggerUrl?: string }[];
	for (const one of list) {
		if (one.type !== "page" || !one.webSocketDebuggerUrl) continue;
		const kind = await evaluateRenderer<string | null>(one.webSocketDebuggerUrl, `(window.lyra && window.lyra.bootWindow && window.lyra.bootWindow.panelKind) || null`).catch(() => null);
		if (kind !== "delivery") continue;
		const socket = new WebSocket(one.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => {
			socket.addEventListener("open", resolve, { once: true });
			socket.addEventListener("error", reject, { once: true });
		});
		let id = 0;
		const waiting = new Map<number, (data: Buffer | null) => void>();
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data)) as { id?: number; result?: { data?: string } };
			if (message.id === undefined) return;
			waiting.get(message.id)?.(message.result?.data ? Buffer.from(message.result.data, "base64") : null);
			waiting.delete(message.id);
		});
		closers.push(() => socket.close());
		return () =>
			new Promise<Buffer>((resolve, reject) => {
				const at = ++id;
				waiting.set(at, (data) => (data ? resolve(data) : reject(new Error("no frame"))));
				socket.send(JSON.stringify({ id: at, method: "Page.captureScreenshot", params: { format: "jpeg", quality: 80 } }));
			});
	}
	return null;
}

/** Every picture is a state worth seeing, so the video holds on it for about a second either side. */
async function shoot(target: Target, name: string) {
	await pause(900);
	const { data } = await target.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${phase}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
	await pause(600);
}

interface Truth {
	timestamp: number;
	files: { name: string; counts: string; canUndo: boolean }[];
}

/** What a card mounted this moment would show: the main process's own answer for the latest turn. */
function truth(): Promise<Truth> {
	return app!.evaluate<Truth>(`(async()=>{
		const s=(await window.lyra.sessions.list()).find((one)=>one.id===${JSON.stringify(SESSION)});
		const t=await window.lyra.sessions.transcript(s.projectId,s.id);
		const last=[...t.messages].reverse().find((m)=>m.role==='assistant'&&m.stopReason!=='toolUse');
		const d=await window.lyra.delivery.get(s.id,last.timestamp);
		return {timestamp:last.timestamp,files:d.files.map((f)=>({name:f.path.split(/[\\\\/]/).pop(),counts:'+'+f.added+'−'+f.removed,canUndo:f.canUndo}))};
	})()`);
}

interface Card {
	title: string;
	total: string;
	rows: { name: string; counts: string }[];
	undoAll: boolean;
}

function card(): Promise<Card | null> {
	return app!.evaluate<Card | null>(`(()=>{
		const card=document.querySelector('[data-turn-delivery]');
		if(!card)return null;
		return {
			title:card.querySelector('p.truncate')?.textContent??'',
			total:card.querySelector('p.truncate')?.nextElementSibling?.textContent??'',
			rows:[...card.querySelectorAll('[data-delivery-file]')].map((row)=>({name:row.getAttribute('data-delivery-file').split(/[\\\\/]/).pop(),counts:row.querySelector('.tabular-nums')?.textContent??''})),
			undoAll:Boolean(card.querySelector('button[data-ly-tip="撤销这次文件改动"]')),
		};
	})()`);
}

/** Take the pointer off the card, and wait for a preview it had opened to go. */
async function leave() {
	await app!.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 80 });
	await until(app!, `!document.querySelector('[aria-label="文件变更预览"]')`, 5_000);
}

/**
 * Rest the pointer on a card row until its preview opens; what the preview's undo says.
 *
 * A rest that something interrupted — the row moving under it, a real pointer passing over the
 * window — opens nothing, so a second rest is tried before calling the preview missing.
 */
async function preview(name: string, keep = false): Promise<{ label: string; disabled: boolean } | null> {
	const row = `[data-turn-delivery] [data-delivery-file$="${name}"]`;
	let opened = false;
	for (let attempt = 0; attempt < 2 && !opened; attempt++) {
		await leave();
		await app!.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await steadyCenter(app!, row)) });
		opened = await until(app!, `document.querySelector('[aria-label="文件变更预览"] button[aria-label]')`, 4_000).then(() => true, () => false);
		if (!opened) {
			const seen = await app!.evaluate<object>(`(()=>{const row=document.querySelector(${JSON.stringify(row)});const r=row.getBoundingClientRect();return {visibility:document.visibilityState,focus:document.hasFocus(),hover:row.matches(':hover'),underPointer:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===row||row.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()`);
			console.log(`   ${name} 的预览第 ${attempt + 1} 次没打开：${JSON.stringify(seen)}`);
		}
	}
	if (!opened) return null;
	const seen = await app!.evaluate<{ label: string; disabled: boolean }>(`(()=>{const b=document.querySelector('[aria-label="文件变更预览"] button[aria-label]');return {label:b.getAttribute('aria-label'),disabled:b.disabled};})()`);
	if (!keep) await leave();
	return seen;
}

/**
 * Undo one file from the card's own preview: the only per-file undo the card has.
 *
 * The preview is a hover surface and may close under a probe's feet (a real pointer passing over
 * the window is enough), so it is opened again rather than chased, and the press waits until the
 * point is on the button.
 */
async function undoFromPreview(name: string): Promise<boolean> {
	const button = '[aria-label="文件变更预览"] button[aria-label="撤销此文件的改动"]';
	for (let attempt = 0; attempt < 3; attempt++) {
		const opened = await preview(name, true);
		if (!opened || opened.disabled) return false;
		const at = await app!.evaluate<{ x: number; y: number } | null>(`(()=>{const el=document.querySelector(${JSON.stringify(button)});if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
		if (!at) continue;
		await app!.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
		await pause(200);
		const landed = await app!.evaluate<boolean>(`(()=>{const el=document.querySelector(${JSON.stringify(button)});const hit=document.elementFromPoint(${at.x},${at.y});return Boolean(el&&hit&&el.contains(hit));})()`);
		if (!landed) {
			console.log(`   预览里的撤销键没按到（第 ${attempt + 1} 次），重开预览`);
			continue;
		}
		for (const type of ["mousePressed", "mouseReleased"]) await app!.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
		return true;
	}
	return false;
}

/** The card set against the truth: the same rows and counts, and no undo the main process will refuse. */
async function compare(label: string, undone: string) {
	const [shown, real] = [await card(), await truth()];
	if (!shown) {
		check(`${label}：卡片还在`, false, "卡片不见了");
		return;
	}
	const same = JSON.stringify(shown.rows) === JSON.stringify(real.files.map(({ name, counts }) => ({ name, counts })));
	check(`${label}：卡片的文件行与 +N −M 和主进程一致`, same, `卡片 ${JSON.stringify(shown.rows)}；主进程 ${JSON.stringify(real.files.map(({ name, counts }) => ({ name, counts })))}`);
	const undoable = real.files.every((file) => file.canUndo);
	check(
		`${label}：卡片头上的「撤销」跟着主进程走（能撤才给）`,
		shown.undoAll === undoable,
		`卡片${shown.undoAll ? "给了" : "没给"}「撤销」；主进程说${undoable ? "全部能撤" : `${real.files.filter((file) => !file.canUndo).map((file) => file.name).join("、")} 已经不能撤`}`,
	);
	const hovered = await preview(undone);
	const canUndo = real.files.find((file) => file.name === undone)?.canUndo;
	check(
		`${label}：${undone} 的悬停预览里，撤销键跟着主进程走`,
		hovered !== null && hovered.disabled === !canUndo,
		hovered ? `预览里的撤销键 ${hovered.disabled ? "禁用" : "可点"}（${hovered.label}）；主进程 canUndo=${canUndo}` : "悬停预览没开",
	);
}

/** Two-prompt script: which step of which prompt this request is, from the tool call ids it carries. */
function answer(raw: string): { name: string; input: object; id: string } | null {
	let latest: (typeof TURNS)[number] | undefined;
	for (const turn of TURNS) if (raw.includes(turn.prompt) && (!latest || raw.lastIndexOf(turn.prompt) > raw.lastIndexOf(latest.prompt))) latest = turn;
	if (!latest) return null;
	const done = latest.files.filter((_, index) => raw.includes(`toolu_${latest.tag}_${index}`)).length;
	if (done >= latest.files.length) return null;
	return { name: "write", id: `toolu_${latest.tag}_${done}`, input: { path: latest.files[done], content: `# ${latest.files[done]}\n\nexport const marker = "${latest.tag}-${done}";\n` } };
}

try {
	await mkdir(OUT, { recursive: true });
	server = createServer((req, res) => {
		if (req.method !== "POST") {
			res.writeHead(404).end();
			return;
		}
		let raw = "";
		req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
		req.on("end", () => {
			// A request that offers no tools is the app naming the conversation, not a step of the turn.
			const tool = (JSON.parse(raw) as { tools?: unknown[] }).tools?.length ? answer(raw) : null;
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `qa-${Date.now()}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: tool.id, name: tool.name, input: {} } : { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: "文档写好了。" } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
			emit("message_stop", {});
			res.end();
		});
	});
	await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No fixture port");

	app = await startApp({
		port: PORT,
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 880, x: 40, y: 40 }));
			await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off", appearance: { ...settings.appearance, theme: "light", reduceMotion: "on" } }));
		},
	});
	await app.evaluate("document.fonts.ready");
	const grabber = await frameGrabber(PORT);
	closers.push(grabber.close);
	film(grabber.shot, mainFrames);

	console.log("① 第一轮写了三份文档，点第一个文件行，差异开在停靠栏里");
	await click(app, `[data-ly-row="${SESSION}"] > button`);
	await app.evaluate(`window.lyra.agent.prompt(${JSON.stringify(SESSION)},[{type:'text',text:${JSON.stringify(TURNS[0].prompt)}}])`);
	await until(app, `document.querySelectorAll('[data-turn-delivery] [data-delivery-file]').length === 3 && document.querySelector('[data-turn-delivery] [data-delivery-file$="alpha-3.md"]')`);
	const fresh = await truth();
	check("起点：三个文件主进程都说能撤", fresh.files.length === 3 && fresh.files.every((file) => file.canUndo), JSON.stringify(fresh.files));
	const first = await card();
	check("起点：卡片给了「撤销」", Boolean(first?.undoAll), JSON.stringify(first));
	await click(app, `[data-turn-delivery] [data-delivery-file$="alpha-1.md"]`);
	await until(app, `document.querySelector('[data-dock-pane="delivery"] [data-delivery-diff$="alpha-1.md"] button[aria-label="撤销此文件的改动"]')`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 80 });
	await shoot(app, "01_停靠栏里开着alpha-1");

	console.log("② 在停靠栏里撤销 alpha-1");
	await click(app, `[data-dock-pane="delivery"] [data-delivery-diff$="alpha-1.md"] button[aria-label="撤销此文件的改动"]`);
	await confirmUndo(app);
	await until(app, `document.querySelector('[data-dock-pane="delivery"] [data-delivery-diff$="alpha-1.md"] button[aria-label="无法自动撤销，请核对后续修改"]')`);
	await pause(1_000);
	const afterDocked = await truth();
	check("撤销真的做了：主进程说 alpha-1 已经不能再撤", afterDocked.files.find((file) => file.name === "alpha-1.md")?.canUndo === false, JSON.stringify(afterDocked.files));
	await compare("停靠栏撤销之后", "alpha-1.md");
	await shoot(app, "02_停靠栏撤销之后_卡片");
	await preview("alpha-1.md", true);
	await shoot(app, "03_停靠栏撤销之后_alpha-1的预览");
	await leave();

	const stale = await card();
	if (stale?.undoAll) {
		console.log("   卡片还给着「撤销」，按下去看主进程怎么回");
		await click(app, `[data-turn-delivery] button[data-ly-tip="撤销这次文件改动"]`);
		await confirmUndo(app);
		await until(app, `document.querySelector('[data-ly-toaster] [role="alert"]')`, 10_000).catch(() => {});
		const alert = await app.evaluate<string>(`document.querySelector('[data-ly-toaster] [role="alert"]')?.innerText ?? ''`);
		console.log(`   红色提示：${JSON.stringify(alert)}`);
		await shoot(app, "04_按卡片上的撤销_主进程拒绝");
		await app.evaluate(`document.querySelectorAll('[data-ly-toaster] [role="alert"] button[data-ly-tip="关闭"]').forEach((b)=>b.click())`);
	}

	console.log("③ 第二轮写三份文档，点 beta-1，再把停靠栏的差异弹出成独立窗口");
	await app.evaluate(`window.lyra.agent.prompt(${JSON.stringify(SESSION)},[{type:'text',text:${JSON.stringify(TURNS[1].prompt)}}])`);
	await until(app, `document.querySelector('[data-turn-delivery] [data-delivery-file$="beta-3.md"]')`);
	await click(app, `[data-turn-delivery] [data-delivery-file$="beta-1.md"]`);
	await until(app, `document.querySelector('[data-dock-pane="delivery"] [data-delivery-diff$="beta-1.md"]')`);
	await app.evaluate(`document.querySelector('[data-ly-pop-out="delivery"]').closest('button').click()`);
	const end = Date.now() + 15_000;
	let win: AppWindow | undefined;
	while (!win && Date.now() < end) {
		const hit = (await app.windows()).find((one) => one.boot.kind === "panel" && one.boot.panelKind === "delivery");
		if (hit && (await hit.evaluate<boolean>(`Boolean(document.querySelector('[data-ly-restore-panel]'))`).catch(() => false))) win = hit;
		else await pause(300);
	}
	check("弹出了一个文件变更面板窗口", Boolean(win), win ? `boot.panelKind=${win.boot.panelKind}` : "没等到面板窗口");
	if (win) {
		const panel = await panelShots();
		if (panel) film(panel, panelFrames);
		await until(win, `document.querySelector('[data-delivery-diff$="beta-1.md"] button[aria-label="撤销此文件的改动"]')`);
		await shoot(win, "05_弹出的窗口里开着beta-1");

		console.log("④ 在弹出的窗口里撤销 beta-1");
		await click(win, `[data-delivery-diff$="beta-1.md"] button[aria-label="撤销此文件的改动"]`);
		await confirmUndo(win);
		await until(win, `document.querySelector('[data-delivery-diff$="beta-1.md"] button[aria-label="无法自动撤销，请核对后续修改"]')`);
		await pause(1_000);
		await shoot(win, "06_弹出的窗口里撤销了beta-1");
		await compare("弹出窗口撤销之后", "beta-1.md");
		await shoot(app, "07_弹出窗口撤销之后_主窗口的卡片");
		await preview("beta-1.md", true);
		await shoot(app, "08_弹出窗口撤销之后_主窗口里beta-1的预览");
		await leave();

		console.log("⑤ 反过来：主窗口点「审核」让弹出的窗口看整轮，再从卡片的预览撤销 beta-2");
		await click(app, `[data-turn-delivery] button[data-ly-tip="审核全部文件改动"]`);
		await until(win, `document.querySelectorAll('[data-delivery-diff]').length === 3`);
		const before = await win.evaluate<string | null>(`document.querySelector('[data-delivery-diff$="beta-2.md"] button[aria-label]')?.getAttribute('aria-label') ?? null`);
		check("弹出的窗口跟着看整轮，beta-2 此刻能撤", before === "撤销此文件的改动", `beta-2 的撤销键：${JSON.stringify(before)}`);
		// 「审核」 raised the popped-out window over this one; hover in a window that is behind is not what a person does.
		await app.send("Page.bringToFront");
		await pause(300);
		const pressed = await undoFromPreview("beta-2.md");
		console.log(`   从卡片预览按下 beta-2 的撤销：${pressed}；主窗口 visibility=${await app.evaluate<string>("document.visibilityState")}`);
		if (pressed) {
			await confirmUndo(app);
			await until(app, `(()=>{const s=document.querySelector('[data-ly-toaster] [role="status"]');return s&&s.innerText.includes('已撤销改动');})()`, 10_000).catch(() => {});
		}
		await pause(1_500);
		const real = await truth();
		const pane = await win.evaluate<{ label: string | null; disabled: boolean | null }>(`(()=>{const b=document.querySelector('[data-delivery-diff$="beta-2.md"] button[aria-label]');return {label:b?.getAttribute('aria-label')??null,disabled:b?b.disabled:null};})()`);
		const canUndo = real.files.find((file) => file.name === "beta-2.md")?.canUndo;
		check("撤销真的做了：主进程说 beta-2 已经不能再撤", canUndo === false, JSON.stringify(real.files));
		check("卡片上撤销的 beta-2，弹出的窗口跟着灰掉撤销键", canUndo === false && pane.disabled === true, `弹出窗口里 beta-2 的撤销键 ${pane.disabled ? "禁用" : "可点"}（${pane.label}）；主进程 canUndo=${canUndo}`);
		await shoot(win, "09_卡片撤销beta-2之后_弹出的窗口");
	}
} catch (error) {
	check("探针跑完", false, error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
	filming = false;
	await pause(400);
	for (const close of closers) close();
	const passed = results.filter((r) => r.ok).length;
	console.log(`\n${passed}/${results.length} 通过　（${phase}）`);
	await app?.stop();
	if (server) await closeListeningServer(server);
	const name = `${stamp}_${phase}_交付卡片撤销同步_${passed}of${results.length}`;
	await writeFile(join(OUT, `${name}.json`), JSON.stringify({ phase, results }, null, 2));
	if (mainFrames.length) await encode(mainFrames, join(OUT, `${name}_主窗口.mp4`), 30);
	if (panelFrames.length) await encode(panelFrames, join(OUT, `${name}_弹出窗口.mp4`), 30);
	console.log(`证据：${join(OUT, name)}（主窗口 ${mainFrames.length} 帧，弹出窗口 ${panelFrames.length} 帧）`);
	if (passed !== results.length) process.exitCode = 1;
}
