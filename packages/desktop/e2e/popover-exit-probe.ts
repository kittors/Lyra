/* oxlint-disable no-console -- probe CLI plumbing that prints what it measured and where the film went */
/**
 * Whether a popover plays its exit however it is closed — read on every painted frame.
 *
 * `node --experimental-strip-types e2e/popover-exit-probe.ts <label> [output dir]`
 *
 * Five ways out, the first three being the ones that used to vanish in a single frame:
 *
 * 1. pressing the trigger again (the project chip: `usePopover().toggle` sets the anchor to null),
 * 2. choosing a row (the model menu: the row calls `onClose` itself),
 * 3. leaving a delivery card's hover preview (`setHover(null)` unmounts it),
 * 4. Escape — the one path that always had an exit, kept as the reference,
 * 5. Escape with the phone's stylesheet on, where the exit is 150ms and the unmount used to come at 120.
 *
 * Each frame records the opacity of every floating card on screen (the real one and any copy left to
 * fade). "Played" means painted frames strictly between opaque and gone after the close, and the last
 * one before nothing is drawn being near zero; "no flash" means the opacity never climbs back up on
 * the way out; "no residue" means nothing of it is left in the document half a second later.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { landsOn } from "./lands-on.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9472;
const label = process.argv[2] ?? "run";
const now = new Date();
const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()]
	.map((part) => String(part).padStart(2, "0"))
	.join("-");
const out = process.argv[3] ?? join(homedir(), "Desktop", "Lyra退场动画测试");

interface Sample { t: number; cards: { o: number; ghost: boolean }[] }
interface Reading { closeAt: number; samples: Sample[]; residue: number }

const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

let app: RunningApp | undefined;
let server: Server | undefined;
let turns = 0;

function written(index: number): string {
	const lines = [`export const value${index} = ${index};`];
	for (let i = 0; i < 30; i++) lines.push(`export const field_${index}_${i} = ${JSON.stringify("内容行")};`);
	return `${lines.join("\n")}\n`;
}

const evaluate = <T>(expression: string) => {
	if (!app) throw new Error("app 还没起来");
	return app.evaluate<T>(expression);
};

async function until(expression: string, note = expression) {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+20000;function tick(){if(${expression})resolve();else if(performance.now()<end)requestAnimationFrame(tick);else reject(Error(${JSON.stringify(note)}))}tick()})`,
	);
}

async function frames(n = 20) {
	await evaluate(`new Promise(r=>{let n=${n};function tick(){if(--n)requestAnimationFrame(tick);else r()}requestAnimationFrame(tick)})`);
}

async function mouse(type: "mouseMoved" | "mousePressed" | "mouseReleased", x: number, y: number) {
	if (!app) throw new Error("app 还没起来");
	await app.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
}

/** Moves there first, checks the press would land on the element, then presses. */
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

/**
 * Starts a per-frame log of every floating card, and of when the closing input arrived.
 *
 * The close time is taken from the input event itself, in the capture phase, so it is the moment the
 * app heard it rather than the moment this script asked for it.
 */
async function watch(): Promise<void> {
	await evaluate(`(() => {
		const probe = { samples: [], on: true, closeAt: 0 };
		window.__exit = probe;
		const heard = (event) => { if (!probe.closeAt) probe.closeAt = performance.now(); };
		probe.heard = heard;
		window.addEventListener("mousedown", heard, true);
		window.addEventListener("keydown", heard, true);
		const tick = (t) => {
			if (!probe.on) return;
			const cards = [...document.querySelectorAll(".ly-menu-card")].map((card) => ({
				o: Math.round(Number(getComputedStyle(card).opacity) * 1000) / 1000,
				ghost: card.hasAttribute("data-ly-popover-ghost"),
			}));
			probe.samples.push({ t: Math.round(t * 10) / 10, cards });
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	})()`);
}

/** Stops the log; a close with no input event (the hover preview) is dated by its first fading frame. */
async function read(fallbackClose: "first-change" | "event" = "event"): Promise<Reading> {
	await pause(700);
	return evaluate<Reading>(`(() => {
		const probe = window.__exit;
		probe.on = false;
		window.removeEventListener("mousedown", probe.heard, true);
		window.removeEventListener("keydown", probe.heard, true);
		let closeAt = probe.closeAt;
		if (${JSON.stringify(fallbackClose)} === "first-change" || !closeAt) {
			const first = probe.samples.find((s) => s.cards.length === 0 || s.cards.some((c) => c.ghost || c.o < 0.98));
			closeAt = first ? first.t - 0.1 : 0;
		}
		return { closeAt, samples: probe.samples, residue: document.querySelectorAll(".ly-menu-card, [data-ly-popover-ghost]").length };
	})()`);
}

function judge(name: string, reading: Reading, expectFade = true) {
	const after = reading.samples.filter((s) => s.t >= reading.closeAt);
	const opacities = after.map((s) => (s.cards.length ? Math.max(...s.cards.map((c) => c.o)) : null));
	const goneAt = opacities.findIndex((o) => o === null);
	const visible = (goneAt === -1 ? opacities : opacities.slice(0, goneAt)) as number[];
	const between = visible.filter((o) => o > 0.02 && o < 0.98).length;
	const last = visible.at(-1);
	let climbs = 0;
	for (let i = 1; i < visible.length; i++) if (visible[i] > visible[i - 1] + 0.01) climbs++;
	const ms = goneAt === -1 ? null : Math.round(after[goneAt].t - reading.closeAt);
	const trail = visible.map((o) => o.toFixed(2)).join(" → ") || "（第一帧就没了）";
	console.log(`\n${name}：关之后逐帧不透明度 ${trail}${goneAt === -1 ? "" : " → 无"}；${ms === null ? "一直没消失" : `${ms}ms 后不再画`}；${between} 帧在中间态；残留 ${reading.residue}`);
	if (expectFade) {
		check(`${name}：退场播出来了（中间态 ≥ 4 帧）`, between >= 4, `${between} 帧`);
		check(`${name}：播完才消失（最后一帧不透明度 ≤ 0.15）`, last !== undefined && last <= 0.15, `最后一帧 ${last}`);
		check(`${name}：一路往下，没有跳回去再淡（不闪）`, climbs === 0, `往回跳 ${climbs} 次：${trail}`);
	}
	check(`${name}：半秒后不留任何东西`, reading.residue === 0, `${reading.residue} 个节点`);
	return { between, last, ms };
}

async function main() {
	server = createServer((request, response) => {
		request.resume();
		request.on("end", () => {
			const index = turns++;
			const tool = index < 3 ? { name: "write", input: { path: `exit-${index}.ts`, content: written(index) } } : null;
			response.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `probe-${index}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `write-${index}`, name: tool.name, input: {} } : { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: "三个文件写好了。" } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
			emit("message_stop", {});
			response.end();
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
	if (!app) throw new Error("app 还没起来");
	await app.send("Input.insertText", { text: "写三个文件，用来看浮层的退场" });
	await key("Enter", 13);
	await until(`document.querySelector('[data-turn-delivery]')?.textContent.includes('已编辑 3 个文件')`, "等不到交付卡片");
	await frames(30);

	const film: Frame[] = [];
	const marks: { name: string; at: number }[] = [];
	const stopFilm = await startRecording(PORT, film);
	await pause(800);

	// The project chip: the composer button carrying the folder mark (its text is the folder's name).
	const CHIP = `[...document.querySelectorAll('[data-dock-pane="conversation"] button')].find((b) => b.querySelector("svg.lucide-folder") && !b.closest("[role=menu]"))`;
	const MODEL = `[...document.querySelectorAll('[data-dock-pane="conversation"] button[aria-label="选择模型"]')].find((b) => !b.closest("[role=menu]"))`;
	const results: Record<string, { between: number; last: number | undefined; ms: number | null }> = {};

	// 1. The trigger again.
	await click(CHIP);
	await until(`document.querySelector('[role="menu"][aria-label="切换项目"]')`, "项目菜单没开");
	await pause(500);
	await watch();
	marks.push({ name: "再点触发按钮", at: Date.now() });
	await click(CHIP);
	results.toggle = judge("再点一次触发按钮", await read());
	await pause(600);

	// 2. A row that closes its menu.
	await click(MODEL);
	await until(`document.querySelector('[data-model="qa/model"] [role="menuitem"]')`, "模型菜单没开");
	await pause(500);
	await watch();
	marks.push({ name: "点菜单项", at: Date.now() });
	await click(`document.querySelector('[data-model="qa/model"] [role="menuitem"]')`);
	results.item = judge("点菜单项", await read());
	await pause(600);

	// 3. The hover preview, left for empty space.
	await evaluate(`document.querySelector('[data-turn-delivery]').scrollIntoView({block:'end',behavior:'instant'})`);
	await frames();
	const row = await evaluate<{ x: number; y: number }>(
		`(()=>{const e=document.querySelector('[data-turn-delivery] [data-delivery-file]');const r=e.getBoundingClientRect();return {x:Math.round(r.x+50),y:Math.round(r.y+r.height/2)}})()`,
	);
	await mouse("mouseMoved", row.x, row.y);
	await until(`document.querySelector('[aria-label="文件变更预览"]')?.textContent.includes('export const')`, "等不到悬停预览");
	await pause(500);
	await watch();
	marks.push({ name: "移开悬停预览", at: Date.now() });
	// The sidebar's empty strip at the top: outside the card, outside the preview.
	await mouse("mouseMoved", 15, 75);
	results.hover = judge("交付卡片悬停预览移开", await read("first-change"));
	await pause(600);

	// 4. Escape, the reference.
	await click(CHIP);
	await until(`document.querySelector('[role="menu"][aria-label="切换项目"]')`, "项目菜单没开");
	await pause(500);
	await watch();
	marks.push({ name: "按 Esc", at: Date.now() });
	await key("Escape", 27);
	results.escape = judge("按 Esc（原本就有退场的那条）", await read());
	await pause(600);

	// 5. Escape under the phone's stylesheet: a 150ms exit.
	await evaluate(`document.documentElement.setAttribute("data-lyra-host", "mobile")`);
	await frames();
	await click(CHIP);
	await until(`document.querySelector('[role="menu"][aria-label="切换项目"]')`, "项目菜单没开");
	await pause(600);
	const declared = await evaluate<string>(`getComputedStyle(Object.assign(document.createElement("div"), { className: "ly-pop-out" })).animationDuration`);
	await watch();
	marks.push({ name: "手机样式下按 Esc", at: Date.now() });
	await key("Escape", 27);
	const phone = await read();
	await evaluate(`document.documentElement.removeAttribute("data-lyra-host")`);
	console.log(`\n手机样式下 .ly-pop-out 声明的时长：${declared}（脱离文档读不到时为空）`);
	results.phone = judge("手机样式下按 Esc（退场 150ms）", phone);

	// 6. Three presses in a row: open, close, open — it must end open, and only once.
	await pause(600);
	const before = await evaluate<string>(`document.activeElement?.tagName ?? "none"`);
	const chip = await evaluate<{ x: number; y: number }>(`(()=>{const r=(${CHIP}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	marks.push({ name: "连点三下", at: Date.now() });
	for (let i = 0; i < 3; i++) {
		await mouse("mousePressed", chip.x, chip.y);
		await mouse("mouseReleased", chip.x, chip.y);
		await pause(45);
	}
	await pause(500);
	const rapid = await evaluate<{ real: number; ghosts: number; opacity: number | null }>(`(() => {
		const real = document.querySelectorAll('[role="menu"][aria-label="切换项目"]');
		return { real: real.length, ghosts: document.querySelectorAll("[data-ly-popover-ghost]").length, opacity: real[0] ? Number(getComputedStyle(real[0]).opacity) : null };
	})()`);
	console.log(`\n连点三下（开、关、开）之后：真菜单 ${rapid.real} 个，不透明度 ${rapid.opacity}，克隆层 ${rapid.ghosts} 个；之前焦点在 ${before}`);
	check("连点三下：最后是开着的，只有一个，完全不透明", rapid.real === 1 && rapid.opacity === 1 && rapid.ghosts === 0, JSON.stringify(rapid));
	await key("Escape", 27);
	await pause(600);

	await stopFilm();
	await mkdir(out, { recursive: true });
	const passed = checks.filter((c) => c.ok).length;
	const name = `${stamp}_${label}_浮层退场五条路_${passed}of${checks.length}`;
	await encode(film, join(out, `${name}.mp4`), 60);
	// Each close again at a tenth of the speed: 120ms is seven frames, gone before the eye finds them.
	const slow: Frame[] = [];
	let offset = 0;
	for (const mark of marks.slice(0, 3)) {
		const around = film.filter((f) => f.at >= mark.at - 200 && f.at <= mark.at + 900);
		if (!around.length) continue;
		const base = around[0].at;
		for (const frame of around) slow.push({ at: offset + (frame.at - base) * 10, data: frame.data });
		offset += (around.at(-1)!.at - base) * 10 + 1500;
	}
	if (slow.length) await encode(slow, join(out, `${name}_前三条慢放10倍.mp4`), 60);
	console.log(`\n${passed}/${checks.length} 通过；录像 ${film.length} 帧，放在 ${out}`);
	console.log(JSON.stringify(results));
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
	await closeListeningServer(server);
	await rm(claudeHome, { recursive: true, force: true });
}
