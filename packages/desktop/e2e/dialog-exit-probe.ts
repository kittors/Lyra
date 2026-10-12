/* oxlint-disable no-console -- probe CLI plumbing that prints what it measured and where the film went */
/**
 * Whether a dialog leaves the way it came in, read on every painted frame.
 *
 * `node --experimental-strip-types e2e/dialog-exit-probe.ts <label> [output dir]`
 *
 * The dialog is 新建项目, reached from the composer's project chip. Two closes:
 *
 * 1. its own 取消 button — which called `onClose` straight and unmounted the dialog in that frame,
 * 2. Escape about 50ms into the 180ms entrance — whose exit had a fixed `from`, so the card jumped
 *    back to fully opaque before it faded.
 *
 * Each frame records the card's opacity. "Played" means painted frames strictly between opaque and
 * gone after the close; "no jump" means the opacity never climbs once the close has been heard.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { landsOn } from "./lands-on.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9474;
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
const evaluate = <T>(expression: string) => {
	if (!app) throw new Error("app 还没起来");
	return app.evaluate<T>(expression);
};

async function until(expression: string, note = expression) {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+20000;function tick(){if(${expression})resolve();else if(performance.now()<end)requestAnimationFrame(tick);else reject(Error(${JSON.stringify(note)}))}tick()})`,
	);
}

async function mouse(type: "mouseMoved" | "mousePressed" | "mouseReleased", x: number, y: number) {
	if (!app) throw new Error("app 还没起来");
	await app.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
}

async function click(find: string) {
	await until(`(${find})?.checkVisibility()`, `等不到 ${find}`);
	const point = await evaluate<{ x: number; y: number }>(`(()=>{const r=(${find}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	await mouse("mouseMoved", point.x, point.y);
	await pause(120);
	await evaluate(`(()=>{const el=${find},x=${point.x},y=${point.y};${landsOn(find.slice(0, 60))}})()`);
	await mouse("mousePressed", point.x, point.y);
	await mouse("mouseReleased", point.x, point.y);
}

async function key(name: string, code: number) {
	if (!app) throw new Error("app 还没起来");
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
}

/** Logs the dialog card's opacity on every frame, and when the closing input was heard. */
async function watch() {
	await evaluate(`(() => {
		const probe = { samples: [], on: true, closeAt: 0 };
		window.__dialog = probe;
		probe.heard = () => { if (!probe.closeAt) probe.closeAt = performance.now(); };
		window.addEventListener("mousedown", probe.heard, true);
		window.addEventListener("keydown", probe.heard, true);
		const tick = (t) => {
			if (!probe.on) return;
			const card = document.querySelector("[data-ly-modal]");
			probe.samples.push({ t, o: card ? Math.round(Number(getComputedStyle(card).opacity) * 1000) / 1000 : null });
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	})()`);
}

async function read() {
	await pause(700);
	return evaluate<{ closeAt: number; samples: { t: number; o: number | null }[]; left: number }>(`(() => {
		const probe = window.__dialog;
		probe.on = false;
		window.removeEventListener("mousedown", probe.heard, true);
		window.removeEventListener("keydown", probe.heard, true);
		return { closeAt: probe.closeAt, samples: probe.samples, left: document.querySelectorAll("[data-ly-modal], [data-ly-overlay]").length };
	})()`);
}

function judge(name: string, reading: Awaited<ReturnType<typeof read>>) {
	const before = reading.samples.filter((s) => s.t < reading.closeAt && s.o !== null).map((s) => s.o as number);
	const after = reading.samples.filter((s) => s.t >= reading.closeAt);
	const gone = after.findIndex((s) => s.o === null);
	const visible = (gone === -1 ? after : after.slice(0, gone)).map((s) => s.o as number);
	const between = visible.filter((o) => o > 0.02 && o < 0.98).length;
	const atClose = before.at(-1);
	const peak = Math.max(...visible, 0);
	let climbs = 0;
	for (let i = 1; i < visible.length; i++) if (visible[i] > visible[i - 1] + 0.01) climbs++;
	const trail = visible.map((o) => o.toFixed(2)).join(" → ") || "（第一帧就没了）";
	console.log(`\n${name}：关之前最后一帧 ${atClose?.toFixed(2) ?? "—"}；关之后逐帧 ${trail}${gone === -1 ? "" : " → 无"}；${between} 帧中间态；残留 ${reading.left}`);
	check(`${name}：退场播出来了（中间态 ≥ 4 帧）`, between >= 4, `${between} 帧`);
	check(`${name}：关之后不往回跳（不先变回不透明再淡）`, climbs === 0 && (atClose === undefined || peak <= atClose + 0.02), `关时 ${atClose}，之后最高 ${peak}，往回跳 ${climbs} 次`);
	check(`${name}：半秒后不留任何东西`, reading.left === 0, `${reading.left} 个节点`);
}

async function main() {
	app = await startApp({ port: PORT, seed: async (home) => { await seedInteractions(home); } });
	await click(`document.querySelector('[data-ly-row="qa-short"]')`);
	await pause(800);
	const film: Frame[] = [];
	const stopFilm = await startRecording(PORT, film);
	await pause(600);

	const CHIP = `[...document.querySelectorAll('[data-dock-pane="conversation"] button')].find((b) => b.querySelector("svg.lucide-folder") && !b.closest("[role=menu]"))`;
	const NEW = `[...document.querySelectorAll('[role="menu"] button')].find((b) => b.textContent.trim() === "新建项目")`;
	const CANCEL = `[...document.querySelectorAll('[data-ly-modal] button')].find((b) => b.textContent.trim() === "取消")`;

	// 1. 取消, after the entrance has settled.
	await click(CHIP);
	await click(NEW);
	await until(`document.querySelector('[data-ly-project-dialog]')`, "新建项目弹窗没开");
	await pause(700);
	await watch();
	await click(CANCEL);
	judge("点「取消」", await read());
	await pause(500);

	// 2. Escape ~50ms into the entrance.
	await click(CHIP);
	await click(NEW);
	await until(`document.querySelector('[data-ly-project-dialog]')`, "新建项目弹窗没开");
	await watch();
	await pause(30);
	await key("Escape", 27);
	judge("入场途中按 Esc", await read());
	await pause(500);

	await stopFilm();
	await mkdir(out, { recursive: true });
	const passed = checks.filter((c) => c.ok).length;
	const name = `${stamp}_${label}_对话框退场_${passed}of${checks.length}`;
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
	await app?.stop();
	await rm(claudeHome, { recursive: true, force: true });
}
