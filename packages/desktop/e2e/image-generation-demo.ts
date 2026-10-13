/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * Drawing in a conversation, end to end in the real window, against a fake relay.
 *
 * The relay behaves like the CliRelay measured on 2026-10-11 in front of Gemini: the conversation
 * model streams a real `image_generate` call over Chat Completions, `/v1/images/generations` and the
 * JSON form of `/v1/images/edits` answer after a few seconds with a JPEG in `b64_json`, and a spent
 * quota is the 429 Antigravity sends. What is checked is what a person sees: the dots at the
 * picture's shape while it draws, the percentage climbing, the picture landing in the same place,
 * the edit working from "#1", the spent quota said in words — plus what the relay was sent.
 *
 *   node --experimental-strip-types e2e/image-generation-demo.ts   # records into ~/Desktop/Lyra生图测试
 */

import { readdir, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { boatPictures, relaySettings, startFakeImageRelay, type Scene } from "./fake-image-relay.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9441;
const OUT = join(homedir(), "Desktop", "Lyra生图测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
/** How long the fake model takes to draw; long enough to watch the dots and the percentage move. */
const DRAW_MS = Number(process.env.LYRA_PROBE_DRAW_MS ?? 7000);

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

const SCENES: Scene[] = [
	{ cue: "纸船", call: "call_draw_boat", args: { prompt: "A red origami paper boat floating on calm blue water at midday, soft sunlight, gentle hills on the horizon, flat illustration", aspect_ratio: "16:9" }, reply: "画好了：一只停在平静水面上的红色纸船。" },
	{ cue: "夜晚", call: "call_edit_night", args: { prompt: "Turn the scene into a starry night with a full moon; keep the boat, its colours and the composition the same", images: ["#1"], aspect_ratio: "16:9" }, reply: "改成夜晚了，纸船和构图保持不变。" },
	{ cue: "正方形", call: "call_draw_square", args: { prompt: "The same red paper boat, square composition", aspect_ratio: "1:1" }, reply: "这次没画出来：生图模型的额度用完了，大约两个小时后恢复。" },
];

let app: RunningApp;

async function shot(name: string) {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

/** Every frame of the card, as it is drawn: what the reveal and the "no jump" claims are measured on. */
const WATCH = `(() => {
	const out = { frames: [], stop: false };
	window.__card = out;
	const tick = () => {
		const frame = document.querySelector('[data-ly-image-frame]');
		const card = document.querySelector('[data-ly-image-card]');
		if (frame) {
			const box = frame.getBoundingClientRect();
			const canvas = frame.querySelector('canvas');
			const img = frame.querySelector('img');
			const pct = frame.querySelector('[data-ly-image-progress]');
			out.frames.push({ t: Math.round(performance.now()), state: card ? card.getAttribute('data-ly-image-card') : '', w: Math.round(box.width), h: Math.round(box.height), canvas: Boolean(canvas), img: Boolean(img && img.complete && img.naturalWidth > 0), pct: pct ? pct.textContent : null, caption: card ? (card.querySelector('figcaption') || {}).textContent : '' });
		}
		if (!out.stop) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})()`;

interface CardFrame {
	t: number;
	state: string;
	w: number;
	h: number;
	canvas: boolean;
	img: boolean;
	pct: string | null;
	caption: string;
}

async function main() {
	await mkdir(OUT, { recursive: true });
	const relay = await startFakeImageRelay({ scenes: SCENES, art: await boatPictures(), drawMs: DRAW_MS });
	const seen = relay.seen;

	app = await startApp({
		port: PORT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
			await writeFile(join(home, "settings.json"), relaySettings(relay.port, cwd));
		},
	});

	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);
	const { until, hover, type, submit, settled } = driver(app);
	try {
		await app.evaluate("document.fonts.ready");
		await pause(1500);

		// The composer's model menu: conversation models only.
		await app.evaluate(`(() => { const b = [...document.querySelectorAll('main button[aria-haspopup="menu"]')].find((e) => /gemini-3\\.8/.test(e.textContent)); if (b) b.setAttribute('data-probe-model', ''); })()`);
		await driver(app).click("[data-probe-model]");
		await until(`document.querySelector('[role="menu"]')`, 10000);
		await pause(600);
		const menu = await app.evaluate<string>(`document.querySelector('[role="menu"]').innerText`);
		check("对话的模型菜单里没有生图模型", /gemini-3\.8-flash-high/.test(menu) && !/gemini-3\.1-flash-image/.test(menu), menu.replace(/\s+/g, " ").slice(0, 160));
		await shot("00_模型菜单只有对话模型");
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await pause(600);

		console.log("① 文生图：16:9 的纸船");
		await type("画一只停在平静水面上的红色纸船，16:9 横图");
		await pause(900);
		await app.evaluate(WATCH);
		await submit();
		await until(`document.querySelector('[data-ly-image-card="drawing"] canvas')`, 30000);
		await pause(1800);
		await shot("01_生成中_点阵与进度");
		await pause(2500);
		await shot("02_生成中_进度更新");
		await until(`document.querySelector('[data-ly-image-card="done"] img')?.naturalWidth > 0`, 60000);
		await pause(1400);
		await shot("03_图片落地");
		const watched = await app.evaluate<CardFrame[]>(`(() => { window.__card.stop = true; return window.__card.frames; })()`);

		const drawing = watched.filter((f) => f.state === "drawing");
		const done = watched.filter((f) => f.state === "done");
		const ratio = drawing.length ? drawing[0].w / drawing[0].h : 0;
		check("生成中画的是点阵，形状是要的 16:9", drawing.some((f) => f.canvas) && Math.abs(ratio - 16 / 9) < 0.02, `${drawing.length} 帧点阵，框 ${drawing[0]?.w}×${drawing[0]?.h}（${ratio.toFixed(3)}）`);
		const percents = drawing.map((f) => Number.parseInt(f.pct ?? "", 10)).filter((n) => Number.isFinite(n));
		check("进度一直往上走、没到 100", percents.length > 10 && percents.every((n, i) => i === 0 || n >= percents[i - 1]) && Math.max(...percents) < 100, `${percents[0]}% → ${percents.at(-1)}%（共 ${percents.length} 帧）`);
		const captions = [...new Set(drawing.map((f) => f.caption))];
		check("上方那行说出了进行到哪一步", captions.length >= 2, captions.join(" → "));
		const sizes = new Set(watched.map((f) => `${f.w}×${f.h}`));
		check("从点阵到图片，框一像素都没变", sizes.size === 1, [...sizes].join("、"));
		check("图片解码完以后点阵退场", done.some((f) => f.img) && !done.at(-1)?.canvas, `完成后 ${done.length} 帧，最后一帧 canvas=${done.at(-1)?.canvas}`);
		check("完成后那一行写的是模型和尺寸", /gemini-3\.1-flash-image · 1408×792/.test(done.at(-1)?.caption ?? ""), done.at(-1)?.caption ?? "");
		const generation = seen.find((s) => s.path.endsWith("/images/generations"));
		check("请求按 relay 的写法带比例", generation?.body.aspect_ratio === "16:9" && generation.body.response_format === "b64_json" && !("size" in (generation.body ?? {})), JSON.stringify(generation?.body ?? {}).slice(0, 220));
		await settled(60000);

		const toolRow = await app.evaluate<string>(`([...document.querySelectorAll('main [data-ly-run], main button')].map((e) => e.textContent).find((t) => /生成图片/.test(t)) || '').slice(0, 80)`);
		check("过程里那一行读作「生成图片」", /生成图片/.test(toolRow), toolRow || "没找到");

		console.log("② 悬停：编辑与下载");
		await hover('[data-ly-image-frame="done"]');
		await pause(900);
		await shot("04_悬停出现编辑与下载");
		const actions = await app.evaluate<string[]>(`[...document.querySelectorAll('[data-ly-image-frame="done"] .ly-image-action')].filter((b) => getComputedStyle(b.parentElement).opacity === '1').map((b) => b.getAttribute('aria-label'))`);
		check("悬停时出现「编辑」和「下载」", actions.includes("编辑") && actions.includes("下载"), actions.join("、") || "没有出现");

		console.log("③ 点开大图");
		await app.evaluate(`document.querySelector('[data-ly-image-frame="done"] button[aria-label]').click()`);
		await pause(1200);
		const viewer = await app.evaluate<boolean>(`[...document.querySelectorAll('img')].some((img) => img.naturalWidth > 0 && img.getBoundingClientRect().width > 600)`);
		check("点图片放大查看", viewer, viewer ? "大图已打开" : "没有打开");
		await shot("05_放大查看");
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await pause(900);

		console.log("④ 图生图：用 #1 改成夜晚");
		await type("把它改成夜晚的样子，满月和星星");
		await pause(700);
		await submit();
		await until(`document.querySelectorAll('[data-ly-image-card]').length >= 2 && document.querySelectorAll('[data-ly-image-card="done"]').length >= 2`, 60000);
		await pause(1400);
		await shot("06_图生图_夜晚");
		const editRow = await app.evaluate<string>(`([...document.querySelectorAll('main [data-ly-run], main button')].map((e) => e.textContent).find((t) => /编辑图片/.test(t)) || '').slice(0, 80)`);
		check("带着原图的那一次读作「编辑图片」", /编辑图片/.test(editRow), editRow || "没找到");
		const edit = seen.find((s) => s.path.endsWith("/images/edits"));
		const sent = Array.isArray(edit?.body.image) ? (edit?.body.image as string[]) : [];
		check("编辑请求带上了上一张图", sent.length === 1 && sent[0].startsWith("data:image/jpeg;base64,") && sent[0].length > 1000, `${sent.length} 张，${sent[0]?.slice(0, 32) ?? ""}…`);
		await settled(60000);

		console.log("⑤ 额度用完");
		await type("再来一张正方形的");
		await pause(700);
		await submit();
		await until(`document.querySelector('[data-ly-image-card="error"]')`, 60000);
		await pause(1200);
		const failure = await app.evaluate<string>(`document.querySelector('[data-ly-image-card="error"]').innerText`);
		check("额度用完时卡片直说，还说了多久恢复", /额度用完了/.test(failure) && /1h 53m/.test(failure), failure.replace(/\s+/g, " "));
		const quotaCalls = seen.filter((s) => s.body.aspect_ratio === "1:1").length;
		check("额度用完不重试", quotaCalls === 1, `发了 ${quotaCalls} 次`);
		await settled(60000);
		await app.evaluate(`document.querySelector('[data-ly-image-card="error"]').scrollIntoView({ block: "center" })`);
		await pause(800);
		await shot("07_额度用完");

		const media = await readdir(join(app.home, "session-media")).catch(() => [] as string[]);
		check("两张图都存进了 session-media", media.filter((name) => name.endsWith(".jpg")).length === 2, media.join("、"));
		await pause(1500);

		console.log("⑥ 设置 → 模型设置：生图模型那一行");
		const { click, markByText } = driver(app);
		await click("[data-ly-open-settings]");
		await pause(1000);
		await app.evaluate(`(()=>{document.querySelector('[data-probe-nav]')?.removeAttribute('data-probe-nav');[...document.querySelectorAll("nav button")].find((b)=>b.textContent.trim()==="模型设置")?.setAttribute('data-probe-nav','');})()`);
		await click("[data-probe-nav]");
		await pause(1200);
		if (!(await app.evaluate<boolean>(`Boolean(document.querySelector('[data-ly-model-row="gemini-3.1-flash-image"]'))`))) {
			await markByText("/中转站/", "data-probe-provider");
			await click("[data-probe-provider]");
		}
		await until(`document.querySelector('[data-ly-model-row="gemini-3.1-flash-image"]')`, 15000);
		await app.evaluate(`document.querySelector('[data-ly-model-row="gemini-3.1-flash-image"]').scrollIntoView({ block: "center" })`);
		await pause(800);
		const badges = await app.evaluate<string[]>(`[...document.querySelector('[data-ly-model-row="gemini-3.1-flash-image"]').closest('.group\\\\/row').querySelectorAll('[role="img"]')].map((e) => e.getAttribute('aria-label'))`);
		check("生图模型那一行标着「生图模型」，不标思考和工具", badges.includes("生图模型") && !badges.includes("支持思考 / 推理") && !badges.includes("支持工具调用"), badges.join("、"));
		const chatBadges = await app.evaluate<string[]>(`[...document.querySelector('[data-ly-model-row="gemini-3.8-flash-high"]').closest('.group\\\\/row').querySelectorAll('[role="img"]')].map((e) => e.getAttribute('aria-label'))`);
		check("对话模型那一行不标「生图模型」", !chatBadges.includes("生图模型"), chatBadges.join("、"));
		await shot("08_模型列表里的生图模型");

		console.log("⑦ 测一下生图模型：真画一张小图");
		const before = seen.length;
		await app.evaluate(`(()=>{document.querySelector('[data-probe-test]')?.removeAttribute('data-probe-test');document.querySelector('[data-ly-model-row="gemini-3.1-flash-image"]').closest('.group\\\\/row').querySelector('button[aria-label="画一张小图测试（会计费）"]')?.setAttribute('data-probe-test','');})()`);
		await click("[data-probe-test]");
		await until(`[...document.querySelectorAll("[data-ly-tip]")].some((e)=>/^测试(通过|失败) · /.test(e.getAttribute("data-ly-tip")))`, 60000);
		await pause(900);
		const tested = await app.evaluate<string>(`[...document.querySelectorAll("[data-ly-tip]")].map((e)=>e.getAttribute("data-ly-tip")).find((t)=>/^测试(通过|失败) · /.test(t)) ?? ""`);
		const testCall = seen.slice(before).find((s) => s.path.endsWith("/images/generations"));
		check("生图模型的「测试」画了一张图，不是去聊天", tested.startsWith("测试通过 · 生成成功") && Boolean(testCall) && !seen.slice(before).some((s) => s.path.endsWith("/chat/completions")), tested);
		await shot("09_生图模型测试通过");

		console.log("⑧ 模型编辑器里的「用途」");
		await click('[data-ly-model-row="gemini-3.1-flash-image"]');
		await until(`document.querySelector('[data-ly-model-output] [data-segment="image"]')`, 10000);
		await pause(700);
		const switched = await app.evaluate<string | null>(`document.querySelector('[data-ly-model-output] [data-segment="image"]')?.getAttribute('aria-pressed') ?? null`);
		check("编辑生图模型时，「用途」选的是生图", switched === "true", `aria-pressed=${switched}`);
		await shot("10_模型编辑器里的用途");
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await pause(800);

		console.log("⑨ 智能体 → 会话：默认生图模型");
		await app.evaluate(`(()=>{document.querySelector('[data-probe-nav]')?.removeAttribute('data-probe-nav');[...document.querySelectorAll("nav button")].find((b)=>b.textContent.trim()==="智能体")?.setAttribute('data-probe-nav','');})()`);
		await click("[data-probe-nav]");
		await until(`document.querySelector('[data-agent-profile="image"]')`, 15000);
		await app.evaluate(`document.querySelector('[data-agent-profile="image"]').scrollIntoView({ block: "center" })`);
		await pause(800);
		const row = await app.evaluate<string>(`document.querySelector('[data-agent-profile="image"]').innerText`);
		check("会话设置里有「生图模型」，默认自动选第一个", /生图模型/.test(row) && /gemini-3\.1-flash-image/.test(row) && /自动/.test(row), row.replace(/\s+/g, " "));
		await shot("11_会话设置里的生图模型");
		await app.evaluate(`document.querySelector('[data-agent-profile="image"] button[aria-haspopup="menu"]').setAttribute('data-probe-image-select','')`);
		await click("[data-probe-image-select]");
		await until(`document.querySelector('[role="menu"]')`, 10000);
		await pause(700);
		const offered = await app.evaluate<string>(`document.querySelector('[role="menu"]').innerText`);
		check("生图模型的下拉里只有生图模型", /gemini-3\.1-flash-image/.test(offered) && !/gemini-3\.8-flash-high/.test(offered), offered.replace(/\s+/g, " ").slice(0, 160));
		await shot("12_生图模型下拉");
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
		await pause(1200);
	} finally {
		await stop();
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		relay.close();
		if (frames.length > 0) {
			const video = join(OUT, `${stamp}_对话里生图_${passed}of${results.length}.mp4`);
			await encode(frames, video);
			console.log(`   🎬 ${video}`);
		}
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
