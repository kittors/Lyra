/**
 * The scheduler's notices in a real window, from real runs.
 *
 * `scheduler:notice` was sent from the main process since the first version and nothing received
 * it: a task started, failed or could not start, and the window never said so. This runs one task
 * for real — the ▶ on its card, a session, a scripted model — and makes another fail to start for
 * real, then follows each notice to where it is shown now: the task's card, the line above the
 * composer, the count on the sidebar's 已安排.
 *
 * A turn that fails after it started (`prompt()` rejecting) cannot be brought about from outside, so
 * that one is sent from the main process in the shape the scheduler sends it. The scheduler's own
 * half of it, recording the failure on the task, is `test/scheduler-notices.test.ts`.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";

const CDP_PORT = 9611;
const MODEL_PORT = 9612;
const INSPECT_PORT = 9613;
/** Long enough for the card to be seen saying the run is going. */
const REPLY_MS = 2500;

let app: RunningApp;
let model: Server;
let modelRequests = 0;

/** Where the session store keeps a project's sessions: `core/session/store.ts`, `projectIdFor`. */
function projectId(cwd: string): string {
	return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

function reply(res: ServerResponse, text: string): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	const events: [string, unknown][] = [
		["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", content: [], model: "scripted", stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
		["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
		["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
		["content_block_stop", { type: "content_block_stop", index: 0 }],
		["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }],
		["message_stop", { type: "message_stop" }],
	];
	for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
	res.end();
}

function startModel(): Server {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			modelRequests += 1;
			setTimeout(() => reply(res, "Checked the build. Nothing to report."), REPLY_MS);
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	const blocked = join(home, "blocked");
	await mkdir(project, { recursive: true });
	await mkdir(blocked, { recursive: true });
	/*
	 * `blocked`'s sessions would be kept in a folder named after its path. A file in that place
	 * makes creating one fail the way a full or read-only disk would — `mkdir` refuses — and the
	 * scheduler reports that the task could not start. Only that project's; the other runs normally.
	 */
	await mkdir(join(home, "sessions"), { recursive: true });
	await writeFile(join(home, "sessions", projectId(blocked)), "not a folder");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	// Both have just run, so neither is due until its ▶ is pressed.
	const ran = Date.now();
	const task = (id: string, name: string, cwd: string) => ({
		id,
		name,
		cwd,
		prompt: "Check the build.",
		schedule: { kind: "interval", minutes: 24 * 60 },
		enabled: true,
		lastRunAt: ran,
	});
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "local",
					name: "Local",
					baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [
						{
							id: "local/scripted",
							providerId: "local",
							modelId: "scripted",
							name: "Scripted",
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: false,
							supportsImages: false,
							supportsTools: true,
						},
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			autoSummarizeTitle: false,
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 0,
			hooks: [],
			scheduledTasks: [task("alpha", "Alpha", project), task("beta", "Beta", blocked)],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4531, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

before(async () => {
	model = startModel();
	app = await startApp({ port: CDP_PORT, inspectPort: INSPECT_PORT, seed });
	/*
	 * A second listener on the same bridge the app uses, keeping every notice that crosses it —
	 * the direct evidence that the main process's send reaches the page, and in what shape.
	 */
	await app.evaluate(`(() => { window.__notices = []; window.lyra.scheduler.onNotice((notice) => window.__notices.push({ ...notice, at: performance.now() })); })()`);
});

after(async () => {
	await cleanupFixture(() => app?.stop(), () => closeListeningServer(model));
});

async function until(expression: string, frames = 900): Promise<void> {
	await app.evaluate(
		`new Promise((resolve, reject) => { let n = ${frames}; const tick = () => { if (${expression}) resolve(); else if (--n) requestAnimationFrame(tick); else reject(new Error(${JSON.stringify(`timed out: ${expression}`)})); }; tick(); })`,
	);
}

async function frames(n = 10): Promise<void> {
	await app.evaluate(`new Promise((resolve) => { let n = ${n}; const f = () => (--n ? requestAnimationFrame(f) : resolve()); requestAnimationFrame(f); })`);
}

/** A real press where the element is drawn, after checking nothing covers that point. */
async function click(selector: string): Promise<void> {
	const quoted = JSON.stringify(selector);
	await until(`document.querySelector(${quoted})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${quoted}).scrollIntoView({ block: "nearest", behavior: "instant" })`);
	await frames(2);
	// Something still unfolding clips its own contents, so wait until the centre is really this element.
	await until(`(() => { const e = document.querySelector(${quoted}); if (!e) return false; const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })()`);
	const at = await app.evaluate<{ x: number; y: number }>(
		`(() => { const e = document.querySelector(${quoted}); const r = e.getBoundingClientRect(); const x = r.x + r.width / 2; const y = r.y + r.height / 2; if (!e.contains(document.elementFromPoint(x, y))) throw new Error("covered: " + ${quoted}); return { x, y }; })()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...at, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
	await frames(3);
}

/** The visible button whose text starts with `text`. */
async function press(text: string): Promise<void> {
	const pick = `[...document.querySelectorAll("button")].find((e) => e.checkVisibility() && ((e.textContent || "").trim().startsWith(${JSON.stringify(text)}) || (e.getAttribute("aria-label") || "").startsWith(${JSON.stringify(text)})))`;
	await until(`Boolean(${pick})`);
	await app.evaluate(`(() => { document.querySelector("[data-qa-target]")?.removeAttribute("data-qa-target"); ${pick}.setAttribute("data-qa-target", ""); })()`);
	await click("[data-qa-target]");
}

async function shot(name: string): Promise<void> {
	const directory = process.env.LYRA_E2E_ARTIFACTS;
	if (!directory) return;
	await mkdir(directory, { recursive: true });
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(result.data, "base64"));
}

/** From the main process to the main window, as `notify` in `main.ts` sends it. */
async function sendFromMain(notice: Record<string, unknown>): Promise<void> {
	await app.main(
		`(() => { const { BrowserWindow } = process._linkedBinding("electron_browser_window"); const win = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible()).sort((a, b) => b.getBounds().width - a.getBounds().width)[0]; win.webContents.send("scheduler:notice", ${JSON.stringify(notice)}); return win.id; })()`,
	);
}

// The count is the end of the rail button's name (「已安排 · 1 个任务运行失败」); in a drawer it is the badge's own.
const badge = (n: number) => `[aria-label$=" ${n} 个任务运行失败"], [aria-label="${n} 个任务运行失败"]`;
const noBadge = `!document.querySelector('[aria-label$="个任务运行失败"]')`;
const line = (taskId: string) => `document.querySelector('.ly-reveal[data-open="true"] [data-scheduled-alert="${taskId}"]')`;
const text = (selector: string) => `(document.querySelector(${JSON.stringify(selector)})?.textContent || "")`;

test("a task's start shows on its card, and a failure on the card, above the composer and on the sidebar", async (t) => {
	// ── The schedule, from the sidebar. ──
	await press("已安排");
	await until(`document.querySelector('[data-scheduled-task="alpha"]')?.checkVisibility()`);

	/*
	 * ── Alpha, run for real. ──
	 *
	 * Watched frame by frame from before the press: when the notice arrives, when the card says the
	 * run is going, and when the session's own row in the sidebar does — which is its activity.
	 */
	await app.evaluate(`(() => {
		window.__timeline = [];
		const started = performance.now();
		const tick = () => {
			const card = document.querySelector('[data-scheduled-task="alpha"] [data-scheduled-status]')?.getAttribute("data-scheduled-status") || null;
			const row = [...document.querySelectorAll('[data-ly-status-mark="running"]')].some((mark) => !mark.closest("[data-scheduled-task]"));
			const notices = window.__notices.length;
			const last = window.__timeline[window.__timeline.length - 1];
			if (!last || last.card !== card || last.row !== row || last.notices !== notices) window.__timeline.push({ at: Math.round(performance.now() - started), card, row, notices });
			if (!window.__stopTimeline) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	})()`);
	await click('[data-scheduled-task="alpha"] button[data-ly-tip="立即运行一次"]');
	await until(`document.querySelector('[data-scheduled-task="alpha"] [data-scheduled-status="running"]')`);
	assert.match(await app.evaluate<string>(text('[data-scheduled-task="alpha"] [data-scheduled-status]')), /正在执行/);
	await shot("1-card-running");

	// The turn ends when the scripted model answers, and the card stops saying it is going.
	await until(`!document.querySelector('[data-scheduled-task="alpha"] [data-scheduled-status]')`, 1800);
	await app.evaluate(`window.__stopTimeline = true`);
	assert.ok(modelRequests >= 1, "the run never reached the model");
	const timeline = await app.evaluate<{ at: number; card: string | null; row: boolean; notices: number }[]>(`window.__timeline`);
	t.diagnostic(`timeline (ms after the watch began): ${JSON.stringify(timeline)}`);
	const cardAt = timeline.find((frame) => frame.card === "running")?.at;
	const rowAt = timeline.find((frame) => frame.row)?.at;
	assert.ok(cardAt !== undefined && rowAt !== undefined, "the card or the session's row never showed the run");
	assert.ok(cardAt <= rowAt, `the card said so ${cardAt - rowAt}ms after the session itself did`);

	const started = await app.evaluate<{ taskId: string; kind: string; level: string; message: string; sessionId?: string }[]>(`window.__notices`);
	assert.equal(started.length, 1);
	assert.equal(started[0].taskId, "alpha");
	assert.equal(started[0].kind, "started");
	assert.equal(started[0].level, "info");
	assert.equal(started[0].message, "已安排任务「Alpha」开始运行");
	const alphaSession = started[0].sessionId;
	assert.ok(alphaSession, "a started run names its session");
	assert.equal(await app.evaluate<string>(`window.lyra.settings.get().then((s) => s.scheduledTasks.find((t) => t.id === "alpha").lastSessionId)`), alphaSession);

	// ── Beta cannot start: its sessions have nowhere to go. ──
	await click('[data-scheduled-task="beta"] button[data-ly-tip="立即运行一次"]');
	await until(`document.querySelector('[data-scheduled-task="beta"] [data-scheduled-error]')`);
	const reason = await app.evaluate<string>(text('[data-scheduled-task="beta"] [data-scheduled-error]'));
	assert.match(reason, /^失败：.*EEXIST/, reason);
	const refused = (await app.evaluate<{ taskId: string; kind: string; message: string; sessionId?: string }[]>(`window.__notices`)).at(-1);
	assert.equal(refused?.taskId, "beta");
	assert.equal(refused?.kind, "cannotStart");
	assert.equal(refused?.sessionId, undefined);
	assert.match(refused?.message ?? "", /^已安排任务「Beta」无法启动：.*EEXIST/);
	// On the schedule it is the card that says it; nothing is left counted as unseen.
	await frames(5);
	assert.ok(await app.evaluate<boolean>(noBadge), "the sidebar counts a failure that is on screen");
	await shot("2-card-cannot-start");

	// ── In a conversation: Beta again, and this time nobody is looking at its card. ──
	await press("新对话");
	await until(`document.querySelector("textarea")?.checkVisibility()`);
	await app.evaluate(`window.lyra.scheduler.runNow("beta")`);
	await until(`${line("beta")}?.checkVisibility()`);
	assert.match(await app.evaluate<string>(`${line("beta")}.textContent`), /已安排任务「Beta」无法启动/);
	await until(`document.querySelector(${JSON.stringify(badge(1))})`);
	/*
	 * Above the main composer, in the dock that holds the conversation's own textarea — measured once
	 * the line has finished unfolding, which is when its row no longer clips it. Mid-way the row is
	 * shorter than the line, and the line's box reaches down past what is drawn of it.
	 */
	await until(`(() => { const alert = ${line("beta")}; return Boolean(alert) && alert.closest(".ly-reveal").getBoundingClientRect().bottom >= alert.getBoundingClientRect().bottom; })()`);
	assert.ok(
		await app.evaluate<boolean>(
			`(() => { const alert = ${line("beta")}; const shell = alert.closest(".ly-composer-dock")?.querySelector("textarea")?.closest(".ly-composer"); return Boolean(shell) && alert.getBoundingClientRect().bottom <= shell.getBoundingClientRect().top; })()`,
		),
		"the line is not above the composer",
	);
	await shot("3-composer-line");

	// ── A turn of Alpha's that fails after it started, as the scheduler sends it. ──
	await sendFromMain({ taskId: "alpha", kind: "failed", level: "error", message: "已安排任务「Alpha」失败：rate limited", sessionId: alphaSession });
	await until(`${line("alpha")}?.checkVisibility()`);
	assert.equal(await app.evaluate<string>(text("[data-scheduled-alert-others]")), "另有 1 个");
	await until(`document.querySelector(${JSON.stringify(badge(2))})`);
	await shot("4-two-failures");

	// ── 查看: the schedule, Alpha's card in view and lit, nothing unseen any more. ──
	await click("[data-scheduled-alert-look]");
	await until(`document.querySelector('[data-scheduled-task="alpha"]')?.checkVisibility()`);
	assert.match(await app.evaluate<string>(`document.querySelector('[data-scheduled-task="alpha"]').className`), /border-accent/);
	await until(noBadge);
	// Past the workspace's own exit, whose `transition-all` controls linger over the page for a moment;
	// still well inside the 1.2s the card stays lit.
	await frames(24);
	await shot("5-card-looked-at");

	// Back in the conversation the line has gone.
	await press("新对话");
	await until(`document.querySelector("textarea")?.checkVisibility()`);
	await frames(30);
	assert.ok(await app.evaluate<boolean>(`!${line("alpha")} && !${line("beta")}`), "the line outlived being seen");

	// ── 知道了 on the line clears it, and the count with it. ──
	await sendFromMain({ taskId: "alpha", kind: "failed", level: "error", message: "已安排任务「Alpha」失败：rate limited", sessionId: alphaSession });
	await until(`${line("alpha")}?.checkVisibility()`);
	await until(`document.querySelector(${JSON.stringify(badge(1))})`);
	await click("[data-scheduled-alert-dismiss]");
	await until(`!${line("alpha")}`);
	await until(noBadge);
	await frames(30);
	await shot("6-dismissed");
});
