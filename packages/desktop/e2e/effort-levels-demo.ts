/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * GPT 模型的推理档位，在真窗口里点一遍，并看发出去的请求里写的是哪一档。
 *
 * GPT-6.1 Sol 上线时没有自己的规则，落在兜底那组里：菜单上是「关/低/中/高」，没有超高和最高，而
 * 「关」发的是它的接口会 400 的 `none`。现在它是「低/中/高/超高/最高」，关闭思考落到「低」。
 *
 * 单测证明了档位表和请求体，这里补的是它们证不到的：输入框按钮上的字、菜单里列出来的档、模型菜单
 * 里那一行说明，和这三样在真实的点击之后是否还对得上——以及一个假的 Responses 中转实际收到的
 * `reasoning.effort`。
 *
 *   node --experimental-strip-types e2e/effort-levels-demo.ts            # 改动后：录视频 + 断言
 *   node --experimental-strip-types e2e/effort-levels-demo.ts --before   # 改动前的构建：只拍两张图
 */

import { createServer, type IncomingMessage } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";
import { en } from "../src/i18n/messages/en.ts";
import { fr } from "../src/i18n/messages/fr.ts";
import { ja } from "../src/i18n/messages/ja.ts";
import { ko } from "../src/i18n/messages/ko.ts";
import { ru } from "../src/i18n/messages/ru.ts";
import { zhCN } from "../src/i18n/messages/zh-CN.ts";
import { zhTW } from "../src/i18n/messages/zh-TW.ts";

const PORT = 9441;
const OUT = join(homedir(), "Desktop", "Lyra推理档位测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PHASE = process.argv.includes("--before") ? "before" : "after";

const EFFORT = 'main button[aria-label^="推理强度："]';
const MODEL = 'main button[aria-label="选择模型"]';
const SLIDER = '[role="group"] input[type="range"]';

/** 中转收到的每一轮正文请求：哪个模型、`reasoning` 写的什么。 */
const turns: { model: string; reasoning: unknown }[] = [];

const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/** 一个只会说「收到」的 Responses 中转。 */
function relay() {
	return createServer(async (req, res) => {
		const body = await bodyOf(req);
		if (Array.isArray(body.tools) && body.tools.length > 0) turns.push({ model: String(body.model ?? ""), reasoning: body.reasoning });
		res.writeHead(200, { "content-type": "text/event-stream" });
		const item = { id: "answer", type: "message", role: "assistant", content: [{ type: "output_text", text: "收到", annotations: [] }] };
		const emit = (type: string, data: object) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
		emit("response.created", { response: { id: "r", status: "in_progress" } });
		emit("response.output_item.added", { output_index: 0, item: { ...item, content: [] } });
		emit("response.output_text.delta", { output_index: 0, content_index: 0, delta: "收到" });
		emit("response.output_item.done", { output_index: 0, item });
		emit("response.completed", { response: { id: "r", status: "completed", output: [item], usage: { input_tokens: 100, output_tokens: 5 } } });
		res.end();
	});
}

const model = (modelId: string) => ({
	id: `relay/${modelId}`, providerId: "relay", modelId, name: modelId,
	contextWindow: 1_050_000, maxOutputTokens: 128_000, supportsThinking: true, supportsImages: true, supportsTools: true,
});

let app: RunningApp;

async function shot(name: string) {
	await app.evaluate(
		"Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))).then(()=>new Promise(requestAnimationFrame))",
	);
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${STAMP}_${PHASE}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

const buttonLevel = async () => (await app.evaluate<string>(`document.querySelector(${JSON.stringify(EFFORT)})?.getAttribute("aria-label") ?? ""`)).replace(/^推理强度：/, "");
/** 菜单的档位说明表里那一列名字——收着的时候也挂在页面上。 */
const listedLevels = () => app.evaluate<string[]>(`[...document.querySelectorAll('[role="group"] .ly-reveal .flex.gap-2 > span:first-child')].map((e) => e.textContent)`);
const menuText = () => app.evaluate<string>(`[...document.querySelectorAll('[role="menu"]')].map((m) => m.innerText).join("\\n")`);

async function main() {
	await mkdir(OUT, { recursive: true });
	const endpoint = relay();
	await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
	const address = endpoint.address();
	if (!address || typeof address === "string") throw new Error("the fake relay got no port");

	app = await startApp({
		port: PORT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900 }));
			await writeFile(join(home, "settings.json"), JSON.stringify({
				uiLocale: "zh-CN",
				permissionMode: "full",
				projectMemory: false,
				thinking: "max",
				lastThinking: "max",
				autoSummarizeTitle: false,
				mcpServers: [],
				hooks: [],
				sync: { enabled: false },
				projects: [{ path: cwd, name: "MicroManagement", pinned: true, lastOpenedAt: Date.now() }],
				defaultModelId: "relay/gpt-6.1-sol",
				providers: [{
					id: "relay", name: "中转", api: "openai-responses", baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "probe-key", enabled: true,
					models: [model("gpt-6.1-sol"), model("gpt-5.6-luna"), model("gpt-5.5")],
				}],
			}));
		},
	});

	const frames: Frame[] = [];
	const stop = PHASE === "after" ? await startRecording(PORT, frames) : async () => {};
	const d = driver(app);
	/** 按文字在打开的菜单里挂一个记号，再用真鼠标点它。 */
	const clickMenuItem = async (startsWith: string) => {
		await app.evaluate(`(()=>{document.querySelector('[data-probe-item]')?.removeAttribute('data-probe-item');const e=[...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button')].find((b)=>b.checkVisibility()&&b.innerText.trim().startsWith(${JSON.stringify(startsWith)}));if(!e)throw new Error("菜单里没有 ${startsWith}");e.setAttribute('data-probe-item','');})()`);
		await d.click("[data-probe-item]");
	};
	const send = async (text: string, count: number) => {
		await d.click("main textarea");
		await d.type(text);
		await pause(500);
		await d.submit();
		const end = Date.now() + 20000;
		while (turns.length < count && Date.now() < end) await pause(100);
		await d.until(`!document.querySelector('button[aria-label="停止"]')`, 20000);
		await pause(800);
	};
	try {
		await app.evaluate("document.fonts.ready");
		await d.until(`document.querySelector(${JSON.stringify(EFFORT)})`, 20000);
		await pause(1200);

		console.log("① GPT-6.1 Sol，档位停在「最高」：打开推理强度菜单");
		check("输入框按钮写的是「最高」", (await buttonLevel()) === "最高", await buttonLevel());
		await d.click(EFFORT);
		await d.until(`document.querySelector(${JSON.stringify(SLIDER)})`, 5000);
		await pause(600);
		await d.click('[role="group"] button[data-ly-tip="各档位说明"]');
		await pause(900);
		await shot("01_GPT-6.1-Sol的推理档位");
		if (PHASE === "before") {
			console.log("   改动前的档位：", (await listedLevels()).join(" / "));
			await d.key("Escape", 27);
			await pause(500);
			await d.click(MODEL);
			await pause(900);
			await shot("02_模型菜单里的关闭思考");
			return;
		}
		const levels = await listedLevels();
		check("菜单里列的是「低/中/高/超高/最高」，没有它接口不收的「关」", levels.join("/") === "低/中/高/超高/最高", levels.join("/"));
		const slider = await app.evaluate<{ max: string; value: string }>(`(()=>{const s=document.querySelector(${JSON.stringify(SLIDER)});return {max:s.max,value:s.value};})()`);
		check("滑块五格、停在最右一格", slider.max === "4" && slider.value === "4", JSON.stringify(slider));

		console.log("② 方向键往左挪一格：超高");
		await app.evaluate(`document.querySelector(${JSON.stringify(SLIDER)}).focus()`);
		await d.key("ArrowLeft", 37);
		await pause(900);
		check("挪一格之后按钮上是「超高」", (await buttonLevel()) === "超高", await buttonLevel());
		await d.key("Escape", 27);
		await pause(700);

		console.log("③ 模型菜单：「关闭思考」那一行在 GPT-6.1 Sol 上说的是实话");
		await d.click(MODEL);
		await d.until(`[...document.querySelectorAll('[role="menu"]')].some((m) => m.innerText.includes("关闭思考"))`, 5000);
		await pause(800);
		const floorLine = (await menuText()).includes("关不掉推理，会用最低档「低」");
		check("那一行写着「关不掉推理，会用最低档「低」」", floorLine, (await menuText()).split("\n").filter((l) => l.includes("推理")).join(" | "));
		/*
		 * The row's second line is one line on purpose (see `MenuItem`), so the level at its end is the
		 * part a long sentence loses first. Measured here in Chinese, and for the other six languages
		 * with the line's own font against the width it gets.
		 */
		const line = await app.evaluate<{ width: number; scroll: number; font: string }>(`(()=>{const row=[...document.querySelectorAll('[role="menu"] button')].find((b)=>b.innerText.trim().startsWith("关闭思考"));const d=row.querySelector("span.truncate");return {width:d.clientWidth,scroll:d.scrollWidth,font:getComputedStyle(d).font};})()`);
		check("这一行一行放得下，末尾的「低」没被截掉", line.scroll <= line.width, JSON.stringify(line));
		const sentences = [en, fr, ja, ko, ru, zhCN, zhTW].map((messages) => messages["modelMenu.noThinkingFloor"].replace("{level}", messages["thinking.low"]));
		const widths = await app.evaluate<number[]>(`(()=>{const c=document.createElement("canvas").getContext("2d");c.font=${JSON.stringify(line.font)};return ${JSON.stringify(sentences)}.map((t)=>Math.ceil(c.measureText(t).width));})()`);
		check(`七种语言都放得下（宽 ${line.width}px）`, widths.every((w) => w <= line.width), sentences.map((text, i) => `${widths[i]}px「${text}」`).join("；"));
		console.log("      " + sentences.map((text, i) => `${widths[i]}px ${text}`).join(" · "));
		await clickMenuItem("关闭思考");
		await pause(900);
		check("打开之后输入框按钮是「低」，不是做不到的「关」", (await buttonLevel()) === "低", await buttonLevel());
		await shot("02_关闭思考落在低档");
		await d.key("Escape", 27);
		await pause(600);

		console.log("④ 发一句话：中转收到的是 low，不是会 400 的 none");
		await send("关着思考问一句", 1);
		check("请求里的 reasoning.effort 是 low", JSON.stringify((turns.at(-1)?.reasoning as { effort?: string })?.effort) === '"low"', JSON.stringify(turns.at(-1)));

		console.log("⑤ 关掉「关闭思考」：回到「超高」，请求里是 xhigh");
		await d.click(MODEL);
		await d.until(`[...document.querySelectorAll('[role="menu"]')].some((m) => m.innerText.includes("关闭思考"))`, 5000);
		await pause(600);
		await clickMenuItem("关闭思考");
		await pause(800);
		await d.key("Escape", 27);
		await pause(600);
		check("按钮回到「超高」", (await buttonLevel()) === "超高", await buttonLevel());
		await send("开着思考再问一句", 2);
		check("请求里的 reasoning.effort 是 xhigh", (turns.at(-1)?.reasoning as { effort?: string })?.effort === "xhigh", JSON.stringify(turns.at(-1)));

		console.log("⑥ 新对话换成 GPT-5.6 Luna：它能关推理，「关」照旧是「关」");
		await d.markByText("/^新对话$/", "data-probe-new");
		await d.click("[data-probe-new]");
		await pause(900);
		await d.click(MODEL);
		await d.until('document.querySelector(\'[data-model="relay/gpt-5.6-luna"]\')', 5000);
		await pause(500);
		await d.click('[data-model="relay/gpt-5.6-luna"] [role="menuitem"]');
		await pause(900);
		check("新对话里按钮写的是「关」", (await buttonLevel()) === "关", await buttonLevel());
		await d.click(MODEL);
		await d.until(`[...document.querySelectorAll('[role="menu"]')].some((m) => m.innerText.includes("关闭思考"))`, 5000);
		await pause(600);
		check("能关推理的模型，那一行还是「跳过推理直接作答」", (await menuText()).includes("跳过推理直接作答") && !(await menuText()).includes("关不掉推理"), (await menuText()).split("\n").filter((l) => l.includes("推理")).join(" | "));
		await d.key("Escape", 27);
		await pause(500);
		await d.click(EFFORT);
		await d.until(`document.querySelector(${JSON.stringify(SLIDER)})`, 5000);
		await pause(500);
		await d.click('[role="group"] button[data-ly-tip="各档位说明"]');
		await pause(900);
		const luna = await listedLevels();
		check("GPT-5.6 Luna 列的是「关/低/中/高/超高/最高」，没有「极简」", luna.join("/") === "关/低/中/高/超高/最高", luna.join("/"));
		await shot("03_GPT-5.6-Luna的推理档位");
		await d.key("Escape", 27);
		await pause(500);
		await send("在 Luna 上关着思考问一句", 3);
		check("Luna 上关思考，请求里明说 none", (turns.at(-1)?.reasoning as { effort?: string })?.effort === "none" && turns.at(-1)?.model === "gpt-5.6-luna", JSON.stringify(turns.at(-1)));
		await pause(1200);
	} finally {
		await stop();
		await app.stop();
		endpoint.close();
		if (PHASE === "after") {
			const passed = checks.filter((one) => one.ok).length;
			const video = join(OUT, `${STAMP}_GPT推理档位_${passed}of${checks.length}.mp4`);
			if (frames.length > 0) await encode(frames, video);
			console.log(`\n${passed}/${checks.length} 通过 · 🎬 ${video}`);
			if (passed !== checks.length) process.exitCode = 1;
		}
	}
}

await main();
