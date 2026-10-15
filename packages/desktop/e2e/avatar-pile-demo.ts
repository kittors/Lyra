/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * A pile of faces, judged by the pixels it paints: where one coin lies over the next, nothing of the
 * lower one may show through it.
 *
 * Three piles carry it: the bar above the composer (four faces), the switcher at the top of the
 * sub-agent panel (two faces and a "+2"), and the "results are back" row in the transcript (four
 * faces, reached by speaking to the main agent while four run in the background). Each is photographed
 * whole and sampled at rest, part-way through fanning out under the pointer, and with its menu open or
 * the pointer on it:
 *
 *   - see-through: the upper coin's rim where it lies over its neighbour, against the same rim where
 *     nothing is beneath. A fill that lets the neighbour through differs by the colour of that face;
 *     an opaque cover differs by nothing.
 *   - the gap: the sliver between two coins — its purest pixel against the surface the pile sits on,
 *     and its width edge to edge. A ring painted in a guessed colour reads as a line; a cut-out is the
 *     surface itself — and a cut-out that does not follow its coin shows up as a gap that changes.
 *
 * The fan-out is held still with the Web Animations API at quarter steps instead of being sampled
 * against the clock, so every reading is of a known moment of the transition. Worth running at 1× and
 * a fractional scale as well as 2×: that is where pixel snapping and edge softening differ.
 *
 * Usage: THEME=dark|light SCALE=2|1|1.25 LABEL=修复后 node --experimental-strip-types e2e/avatar-pile-demo.ts [output dir]
 *        DEBUG_ROW=1 prints the pixels each gap was read from.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { landsOn } from "./lands-on.ts";
import { decode, distance, enlarge, hex, mean, sample, type Picture, type RGB } from "./pixels.ts";
import { encode, frameGrabber, pause, type Frame } from "./record.ts";

const THEME = process.env.THEME === "dark" ? "dark" : "light";
const SCALE = Number(process.env.SCALE ?? 2);
const LABEL = process.env.LABEL ?? "";
const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra叠头像测试");
const PORT = 9641;
/** The sliver between two coins, in CSS px. */
const GAP = 2;
/** How far a reading may sit from what it should be, as RGB distance (0–441). */
const SAME = 6;
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const TAG = [THEME === "dark" ? "深色" : "浅色", `${SCALE}x`, LABEL].filter(Boolean).join("_");

let app: RunningApp;
const checks: { ok: boolean; what: string }[] = [];
function check(what: string, ok: boolean, saw = "") {
	checks.push({ ok, what });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

function reply(res: ServerResponse, r: { text?: string; tools?: { name: string; input: Record<string, unknown> }[] }): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: "m", type: "message", role: "assistant", content: [], model: "scripted", stop_reason: null, usage: { input_tokens: 500, output_tokens: 0 } } });
	const tools = r.tools ?? [];
	if (tools.length > 0) {
		tools.forEach((tool, index) => {
			emit("content_block_start", { index, content_block: { type: "tool_use", id: `t${Math.random().toString(36).slice(2, 10)}`, name: tool.name, input: {} } });
			emit("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } });
			emit("content_block_stop", { index });
		});
	} else {
		emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
		emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: r.text ?? "" } });
		emit("content_block_stop", { index: 0 });
	}
	emit("message_delta", { delta: { stop_reason: tools.length > 0 ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 40 } });
	emit("message_stop", {});
	res.end();
}

/** The main turn's last request, held open: while it waits, the turn — and the bar — stay up. */
const held: ServerResponse[] = [];
/** How long a background sub-agent takes — long enough to say something to the main one meanwhile. */
const BACKGROUND_MS = 5000;

/**
 * The last thing said to whoever is asking — a person, the task prompt of a sub-agent, or the
 * runtime's delivery — and whether tool results have come in since.
 *
 * Not "the last text in the body": every round ends on an `<env>` block nobody typed, and a message
 * carrying tool results is not someone speaking.
 */
function lastSaid(messages: { role: string; content: unknown }[]): { said: string; since: boolean } {
	let said = "";
	let since = false;
	for (const message of messages) {
		if (message.role !== "user") continue;
		const parts = (Array.isArray(message.content) ? message.content : [{ type: "text", text: message.content }]) as { type: string; text?: string }[];
		if (parts.some((part) => part.type === "tool_result")) {
			since = true;
			continue;
		}
		const text = parts
			.filter((part) => part.type === "text" && !(part.text ?? "").trimStart().startsWith("<env>"))
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (text) {
			said = text;
			since = false;
		}
	}
	return { said, since };
}

const model = createServer((req, res) => {
	let raw = "";
	req.on("data", (chunk) => (raw += chunk));
	req.on("end", () => {
		const { said, since } = lastSaid((JSON.parse(raw) as { messages?: { role: string; content: unknown }[] }).messages ?? []);
		const dispatch = (topics: string[], prompt: (topic: string) => string) =>
			reply(res, { tools: topics.map((topic) => ({ name: "task", input: { description: `查${topic}`, prompt: prompt(topic), subagent_type: "general" } })) });
		if (said.includes("分头查")) {
			if (since) held.push(res);
			else dispatch(["登录入口", "接口文档", "迁移计划", "发布脚本"], (topic) => `把${topic}查清楚`);
		} else if (said.includes("后台再查")) {
			if (since) reply(res, { text: "好的。" });
			else dispatch(["日志", "缓存", "权限", "配额"], (topic) => `后台查${topic}`);
		} else if (said.startsWith("后台查")) {
			setTimeout(() => reply(res, { text: "查完了。" }), BACKGROUND_MS);
		} else if (said.includes("先回答我")) {
			reply(res, { text: "1+1 等于 2。" });
		} else if (said.includes("subagent_result")) {
			reply(res, { text: "四个都回来了，结论已经合并。" });
		} else {
			// A sub-agent of the first batch: one answer and it is done, so every face settles still.
			reply(res, { text: "查完了。" });
		}
	});
});

interface Coin {
	x: number;
	y: number;
	r: number;
	key: string;
}

/**
 * The sliver just left of a coin, measured along one row, edge to edge — and what it should measure
 * on that row.
 *
 * An edge is where a pixel is half the colour on one side and half the other: what the eye takes as
 * the line. Counting only pixels of pure surface reads a 2px gap as 1px at 1×, because each edge
 * spends a pixel blending into it.
 *
 * The row is below the centre, through the faces' plain bodies: the closed eyes of a finished face
 * sit on the centre line, and at 1× they land right where the far edge is read.
 */
function gapAcross(pic: Picture, coin: Coin, surface: RGB): { width: number; expected: number; purest: RGB } {
	const dy = coin.r * 0.3;
	const near = Math.sqrt(coin.r ** 2 - dy ** 2);
	const far = Math.sqrt((coin.r + GAP) ** 2 - dy ** 2);
	const y = Math.floor((coin.y + dy - pic.origin.y) * pic.k);
	const at = (x: number): RGB => {
		const i = (y * pic.width + x) * 3;
		return [pic.rgb[i], pic.rgb[i + 1], pic.rgb[i + 2]];
	};
	const column = (cssX: number) => Math.floor((cssX - pic.origin.x) * pic.k);
	const away = (x: number) => distance(at(x), surface);
	/** Walk from `from` by `step` until a pixel is nearer the surface than half of `edge`. */
	const crossing = (from: number, step: number, edge: number) => {
		for (let x = from; Math.abs(x - from) < 6 * pic.k; x += step) {
			if (away(x + step) <= edge / 2 && away(x) > edge / 2) return x + step * ((away(x) - edge / 2) / (away(x) - away(x + step)));
		}
		return Number.NaN;
	};
	const inside = column(coin.x - near + 1.25);
	const beyond = column(coin.x - far - 1.25);
	const right = crossing(inside, -1, away(inside));
	const left = crossing(beyond, 1, away(beyond));
	const width = (right - left) / pic.k;
	// The purest pixel between the two edges: at 1.25× no pixel centre need fall clear of both soft
	// edges at the sliver's middle, but some pixel of a real cut-out is the surface itself.
	let purest = at(Math.round((left + right) / 2));
	for (let x = Math.ceil(left); x <= Math.floor(right); x++) if (away(x) < distance(purest, surface)) purest = at(x);
	if (process.env.DEBUG_ROW) console.log(`      row y=${y} beyond=${beyond} inside=${inside} cx=${(coin.x * pic.k).toFixed(2)} near=${near.toFixed(2)} far=${far.toFixed(2)} :: ${Array.from({ length: inside - beyond + 1 }, (_, i) => `${beyond + i}:${Math.round(away(beyond + i))}`).join(' ')}`);
	return { width, expected: far - near, purest };
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
	const address = model.address();
	if (!address || typeof address === "string") throw new Error("model server did not start");
	app = await startApp({
		port: PORT,
		scaleFactor: SCALE,
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			// Eager with four seats: a batch runs side by side, finishes together, and comes back as one delivery.
			Object.assign(settings, { autoSummarizeTitle: false, permissionMode: "full", thinking: "off", retryAttempts: 0, subAgentDelegation: "eager", maxConcurrentSubAgents: 4, appearance: { theme: THEME } });
			await writeFile(path, JSON.stringify(settings));
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 820, x: 0, y: 0 }));
		},
	});
	await app.send("Page.bringToFront");
	const grab = await frameGrabber(PORT);
	const frames: Frame[] = [];
	const camera = { rolling: true };
	const film = (async () => {
		while (camera.rolling) frames.push({ at: Date.now(), data: await grab.shot() });
	})();

	const $ = <T>(expression: string) => grab.evaluate<T>(expression);
	const until = async (expression: string, ms = 30000) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (await $<boolean>(`Boolean(${expression})`)) return;
			await pause(120);
		}
		throw new Error(`等不到：${expression}`);
	};
	let pointer = { x: 640, y: 400 };
	const glide = async (to: { x: number; y: number }, ms = 450) => {
		const steps = Math.max(6, Math.round(ms / 30));
		const from = pointer;
		for (let i = 1; i <= steps; i++) {
			const t = 1 - (1 - i / steps) ** 3;
			pointer = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
			await grab.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...pointer });
			await pause(ms / steps);
		}
	};
	const centre = (selector: string) => $<{ x: number; y: number }>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	const click = async (selector: string) => {
		await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
		const at = await centre(selector);
		await glide(at);
		const miss = await $<string>(`(()=>{try{const el=document.querySelector(${JSON.stringify(selector)});const x=${at.x},y=${at.y};${landsOn(selector)}return '';}catch(e){return String(e.message);}})()`);
		if (miss) throw new Error(miss);
		for (const type of ["mousePressed", "mouseReleased"]) await grab.send("Input.dispatchMouseEvent", { type, ...pointer, button: "left", clickCount: 1 });
		await pause(150);
	};
	const key = async (name: string, code: number) => {
		await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, windowsVirtualKeyCode: code });
		await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, windowsVirtualKeyCode: code });
	};
	const say = async (text: string) => {
		await click("main textarea");
		for (const ch of text) {
			await grab.send("Input.insertText", { text: ch });
			await pause(25);
		}
		await key("Enter", 13);
	};
	const frame = () => $(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(0))))`);
	/** Somewhere neither pile reacts to the pointer: the middle of the transcript. */
	const away = () => glide({ x: 480, y: 260 }, 300);

	const coinsOf = (pile: string) =>
		$<Coin[]>(`[...document.querySelectorAll(${JSON.stringify(`${pile} > .ly-avatar-coin`)})].map(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,r:r.width/2,key:e.dataset.pileFace||'more'};})`);

	/** Photograph a pile at ~8×, keep the picture, and judge every overlap in it. */
	const judge = async (where: string, pile: string, file: string) => {
		await frame();
		const coins = await coinsOf(pile);
		const box = await $<{ x: number; y: number; width: number; height: number; css: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(pile)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,css:innerWidth};})()`);
		const { data } = await grab.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		const png = Buffer.from(data, "base64");
		const pic = decode(png, box.css);
		enlarge(png, pic, { x: box.x - 6, y: box.y - 6, width: box.width + 18, height: box.height + 12 }, join(OUT_DIR, `${STAMP}_${TAG}_${file}.png`));
		const first = coins[0];
		const last = coins[coins.length - 1];
		const surface = mean(sample(pic, first.x - first.r - 2.5, first.y), sample(pic, last.x + last.r + 2.5, last.y));
		for (let i = 1; i < coins.length; i++) {
			const below = coins[i - 1];
			const above = coins[i];
			const rim = above.r * 0.87;
			const over = sample(pic, above.x - rim, above.y);
			const clear = mean(sample(pic, above.x, above.y - rim), sample(pic, above.x, above.y + rim));
			const across = gapAcross(pic, above, surface);
			const gap = across.purest;
			const width = across.width;
			const name = `${where}：第 ${i + 1} 枚（${above.key === "more" ? "+N" : "脸"}）压第 ${i} 枚`;
			check(`${name}，下面那张脸不透出来（Δ ${distance(over, clear).toFixed(1)}）`, distance(over, clear) <= SAME, `压住处 ${hex(over)}，空着处 ${hex(clear)}`);
			check(`${name}，缝里是底色本身（Δ ${distance(gap, surface).toFixed(1)}）、宽 ${width.toFixed(2)}px / ${across.expected.toFixed(2)}px`, distance(gap, surface) <= SAME && Math.abs(width - across.expected) <= 0.35, `缝 ${hex(gap)}，底 ${hex(surface)}，宽 ${width.toFixed(2)}px，这一行应为 ${across.expected.toFixed(2)}px（中心距 ${(above.x - below.x).toFixed(2)}px）`);
		}
	};

	/** Hold every transition under `root` at `f` of the way through. Returns how many there were. */
	const holdAt = (root: string, f: number) =>
		$<number>(`(()=>{const all=document.querySelector(${JSON.stringify(root)}).getAnimations({subtree:true}).filter(a=>a instanceof CSSTransition);for(const a of all){a.pause();a.currentTime=a.effect.getComputedTiming().duration*${f};}return all.length;})()`);
	const letGo = (root: string) => $(`document.querySelector(${JSON.stringify(root)}).getAnimations({subtree:true}).filter(a=>a instanceof CSSTransition).forEach(a=>a.finish())`);
	/** Slow every motion token tenfold, so a fan-out is still under way when it is caught. */
	const slow = (on: boolean) => $(`(()=>{const s=document.documentElement.style;if(${on}){s.setProperty('--ly-t-quick','1.4s');s.setProperty('--ly-t-base','2.2s');}else{s.removeProperty('--ly-t-quick');s.removeProperty('--ly-t-base');}})()`);

	/** Fan a pile out under the pointer and judge it at each quarter of the way. */
	const fanOut = async (where: string, pile: string, trigger: { x: number; y: number }, file: string) => {
		await slow(true);
		await glide(trigger, 350);
		const held = await holdAt(pile, 0);
		check(`${where}：指针进来，这一摞开始松开（${held} 段过渡）`, held > 0, "没有过渡在跑");
		for (const f of [0.25, 0.5, 0.75, 1]) {
			await holdAt(pile, f);
			await pause(500);
			const hovered = await $<boolean>(`document.querySelector(${JSON.stringify(pile)}).closest('[class~="group/pile"]').matches(':hover')`);
			if (!hovered) console.log(`   （松开 ${f * 100}% 时指针不在这一摞上了——多半是有人动了真鼠标）`);
			await judge(`${where} · 松开 ${f * 100}%`, pile, `${file}_${f * 100}`);
		}
		await letGo(pile);
		await slow(false);
	};

	try {
		console.log(`【${TAG}】派四个子智能体，等它们都交差`);
		await pause(600);
		await click('[data-ly-row="qa-short"]');
		await pause(700);
		await say("分头查一下登录入口、接口文档、迁移计划和发布脚本");
		const BAR = "[data-ly-subagent-bar] [data-avatar-pile]";
		await until(`(()=>{const m=[...document.querySelectorAll(${JSON.stringify(`${BAR} .ly-avatar`)})].map(a=>a.dataset.mood);return m.length===4&&m.every(x=>x==='done');})()`, 60000);
		await until(`/4/.test(document.querySelector('[data-ly-subagent-bar]').textContent)`);
		check("输入框上方那条：四张脸叠成一摞，都已交差", true);
		await away();
		await pause(1500);

		console.log("\n【一】输入框上方那条");
		await judge("条 · 静止", BAR, "01_条_静止");
		const label = await centre("[data-ly-subagent-bar] > span.truncate");
		await fanOut("条", BAR, { x: label.x, y: label.y }, "02_条_松开");
		await click("[data-ly-subagent-bar]");
		await until(`document.querySelector('[data-ly-subagent-bar]').getAttribute('aria-expanded')==='true'`);
		await pause(900);
		await judge("条 · 菜单打开", BAR, "03_条_菜单打开");
		await key("Escape", 27);
		await away();
		await pause(800);

		console.log("\n【二】子智能体面板顶上的切换器");
		await click("[data-ly-subagent-bar]");
		await click("[data-sub-menu] [role=menuitem]");
		const HEAD = '[data-dock-pane="subagents"] [data-sub-header] [data-avatar-pile]';
		await until(`document.querySelectorAll(${JSON.stringify(`${HEAD} > .ly-avatar-coin`)}).length===3`, 20000);
		await away();
		await pause(1500);
		await judge("面板头 · 静止", HEAD, "04_面板头_静止");
		const title = await centre('[data-dock-pane="subagents"] [data-sub-title]');
		await fanOut("面板头", HEAD, title, "05_面板头_松开");
		await click('[data-dock-pane="subagents"] [data-sub-switch]');
		await until(`document.querySelector('[data-dock-pane="subagents"] [data-sub-switch]').getAttribute('aria-expanded')==='true'`);
		await pause(900);
		await judge("面板头 · 菜单打开", HEAD, "06_面板头_菜单打开");
		await key("Escape", 27);
		await away();
		await pause(800);
		await writeFile(join(OUT_DIR, `${STAMP}_${TAG}_00_整窗.png`), Buffer.from((await grab.send<{ data: string }>("Page.captureScreenshot", { format: "png" })).data, "base64"));

		console.log("\n【三】对话里「结果已交回」那一行");
		// Let the first turn end, so the next message opens a turn of its own.
		for (const res of held.splice(0)) reply(res, { text: "四个都回来了。" });
		await until(`(document.querySelector('main')?.innerText ?? '').includes('四个都回来了。')`, 15000);
		await pause(800);
		await say("后台再查一下日志、缓存、权限和配额");
		await until(`[...document.querySelectorAll(${JSON.stringify(`${BAR} .ly-avatar`)})].filter(a=>a.dataset.mood==='working').length===4`, 20000);
		await pause(600);
		// Spoken to while it waits: the main agent answers now and the four carry on in the background.
		await say("先回答我：1+1 等于几？");
		await until(`(document.querySelector('main')?.innerText ?? '').includes('1+1 等于 2')`, 15000);
		const ROW = "[data-delivery-row] [data-avatar-pile]";
		await until(`document.querySelectorAll(${JSON.stringify(`${ROW} > .ly-avatar-coin`)}).length===4`, BACKGROUND_MS * 6);
		await until(`(document.querySelector('main')?.innerText ?? '').includes('结论已经合并')`, 15000);
		const seen = await $<{ top: number; bottom: number; height: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(ROW)}).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};})()`);
		check("后台的四个前后脚交差：对话里一行「结果已交回」，四张脸叠成一摞", seen.top > 0 && seen.bottom < seen.height, JSON.stringify(seen));
		// The window's title strip: nothing on the transcript is under the pointer there.
		await glide({ x: 640, y: 40 }, 300);
		await pause(1500);
		await judge("交回行 · 静止", ROW, "07_交回行_静止");
		const row = await centre("[data-delivery-row] button > span.truncate");
		await glide(row, 350);
		await pause(900);
		check("指针在那一行上：底色换成悬停色", await $<boolean>(`document.querySelector('[data-delivery-row] button').matches(':hover')`));
		await judge("交回行 · 悬停", ROW, "08_交回行_悬停");
		await away();
		await pause(600);
	} catch (error) {
		console.error("\n探针中途失败：", error);
		checks.push({ ok: false, what: "探针跑完" });
	} finally {
		camera.rolling = false;
		await film;
		grab.close();
		for (const res of held) reply(res, { text: "四个都回来了。" });
		const passed = checks.filter((one) => one.ok).length;
		const out = join(OUT_DIR, `${STAMP}_${TAG}_叠头像_${passed}of${checks.length}.mp4`);
		console.log(`\n采到 ${frames.length} 帧，合成到 ${out}`);
		await encode(frames, out, 30, 1500);
		await app.stop();
		await closeListeningServer(model);
		console.log(`\n${passed}/${checks.length} 条通过`);
		if (passed !== checks.length) process.exitCode = 1;
	}
}

await main();
