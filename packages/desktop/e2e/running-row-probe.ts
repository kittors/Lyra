/* oxlint-disable no-console -- probe CLI plumbing that prints what it measured and where the film went */
/**
 * Whether the 「运行中」 row folds away when a turn ends without an answer, read on every frame.
 *
 * `node --experimental-strip-types e2e/running-row-probe.ts <label> [output dir]`
 *
 * The model here never answers: the stream opens and stays silent, so the turn ends only when 停止
 * is pressed — one of the ways a turn ends with no prose (only tools, stopped, failed). That row's
 * `data-open` and its content used to change in the same frame, so a transcript pinned to the bottom
 * lost the row's whole height at once. Each frame records the row's height and whether the
 * indicator is still drawn in it.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { landsOn } from "./lands-on.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9475;
const label = process.argv[2] ?? "run";
const now = new Date();
const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()]
	.map((part) => String(part).padStart(2, "0"))
	.join("-");
const out = process.argv[3] ?? join(homedir(), "Desktop", "Lyra退场动画测试");

const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

let app: RunningApp | undefined;
let server: Server | undefined;
const held: ServerResponse[] = [];
const evaluate = <T>(expression: string) => {
	if (!app) throw new Error("app 还没起来");
	return app.evaluate<T>(expression);
};

async function until(expression: string, note = expression) {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+20000;function tick(){if(${expression})resolve();else if(performance.now()<end)requestAnimationFrame(tick);else reject(Error(${JSON.stringify(note)}))}tick()})`,
	);
}

async function click(find: string) {
	if (!app) throw new Error("app 还没起来");
	await until(`(${find})?.checkVisibility()`, `等不到 ${find}`);
	const point = await evaluate<{ x: number; y: number }>(`(()=>{const r=(${find}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
	await pause(120);
	await evaluate(`(()=>{const el=${find},x=${point.x},y=${point.y};${landsOn(find.slice(0, 60))}})()`);
	for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
}

async function main() {
	server = createServer((request, response) => {
		request.resume();
		request.on("end", () => {
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "silent", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } })}\n\n`);
			// Then nothing: the turn stays running until it is stopped.
			held.push(response);
		});
	});
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const modelPort = address.port;

	app = await startApp({
		port: PORT,
		seed: async (home) => {
			await seedInteractions(home, modelPort);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off" }));
		},
	});
	await click(`document.querySelector('[data-ly-row="qa-short"]')`);
	await click(`document.querySelector('[data-dock-pane="conversation"] textarea')`);
	await app.send("Input.insertText", { text: "这一轮不会有回答" });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await until(`document.querySelector('[data-ly-running]')?.closest('.ly-reveal')?.dataset.open === 'true'`, "运行中那一行没出来");
	await pause(1500);

	const film: Frame[] = [];
	const stopFilm = await startRecording(PORT, film);
	await pause(600);
	// The same row element all the way through — see e2e-measure-painted-frames.
	await evaluate(`(() => {
		const row = document.querySelector('[data-ly-running]').closest('.ly-reveal');
		const probe = { samples: [], on: true, stopAt: 0 };
		window.__row = probe;
		probe.heard = () => { if (!probe.stopAt) probe.stopAt = performance.now(); };
		window.addEventListener("mousedown", probe.heard, true);
		const tick = (t) => {
			if (!probe.on) return;
			const ind = row.querySelector('[data-ly-running]'); probe.samples.push({ t, h: row.isConnected ? row.offsetHeight : -1, drawn: Boolean(ind), open: row.dataset.open, inner: ind ? ind.offsetHeight : null, rows: getComputedStyle(row).gridTemplateRows, tr: getComputedStyle(row).transitionDuration, vis: row.checkVisibility() });
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	})()`);
	await click(`document.querySelector('button[aria-label="停止"]')`);
	await pause(1000);
	const reading = await evaluate<{ stopAt: number; samples: { t: number; h: number; drawn: boolean; open: string }[] }>(`(() => {
		const probe = window.__row; probe.on = false; window.removeEventListener("mousedown", probe.heard, true);
		return { stopAt: probe.stopAt, samples: probe.samples };
	})()`);
	const residue = await evaluate<boolean>(`Boolean(document.querySelector('[data-ly-running]'))`);
	await stopFilm();

	const before = reading.samples.filter((s) => s.t < reading.stopAt);
	const full = before.at(-1)?.h ?? 0;
	const after = reading.samples.filter((s) => s.t >= reading.stopAt);
	const folding = after.findIndex((s) => s.open !== "true");
	const fold = folding === -1 ? [] : after.slice(folding);
	const zero = fold.findIndex((s) => s.h === 0);
	const path = (zero === -1 ? fold : fold.slice(0, zero + 1)).map((s) => `${s.h}${s.drawn ? "" : "(空)"}`);
	const between = fold.filter((s) => s.h > 0 && s.h < full).length;
	const emptied = fold.findIndex((s) => !s.drawn);
	const emptiedEarly = emptied !== -1 && (zero === -1 || emptied < zero);
	console.log(`\n运行中那一行原高 ${full}px；按停止后逐帧高度 ${path.join(" → ")}${zero === -1 ? "（没收到 0）" : ""}`);
	check("收起是一段动画（中间高度 ≥ 5 帧），不是一帧掉光", between >= 5, `${between} 帧`);
	check("收起途中那一行的内容还在（不是先清空再收）", !emptiedEarly, `第 ${emptied} 帧就空了，高度到 0 是第 ${zero} 帧`);
	check("收完之后指示器卸掉了，不常驻", !residue, "收起后 [data-ly-running] 还在");

	await mkdir(out, { recursive: true });
	const passed = checks.filter((c) => c.ok).length;
	const name = `${stamp}_${label}_运行中那一行收起_${passed}of${checks.length}`;
	await encode(film, join(out, `${name}.mp4`), 60);
	console.log(`\n${passed}/${checks.length} 通过；录像 ${film.length} 帧，放在 ${out}`);
	process.exitCode = passed === checks.length ? 0 : 1;
}

const claudeHome = await mkdtemp(join(tmpdir(), "lyra-claude-"));
process.env.CLAUDE_CONFIG_DIR = claudeHome;
try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.stack : error);
	process.exitCode = 2;
} finally {
	for (const response of held) response.destroy();
	await app?.stop();
	await closeListeningServer(server);
	await rm(claudeHome, { recursive: true, force: true });
}
