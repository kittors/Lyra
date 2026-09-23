/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * agent 调试网页时，浏览器面板不再自己弹出来：页面在后台照常跑，对话里留一张卡片，想看再点开。
 *
 * 客户原话：「每次 agent 调试网页，这个网页的预览都要弹出来感觉有点抢视野，我觉得这部分默认就是
 * 后台跑就行了，如果需要再弹」；以及「toast 提醒看到我也很不舒服」。
 *
 * 面板在不在屏幕上是**逐帧**记的（rAF），不是在几个时刻采样——一闪而过的展开也算弹出来过。剧本：
 * 打开页面 → 输入 → 点击 →（人在这里把面板关掉，如果它开着）→ 再点击 → 截图 → 收尾。
 *
 * 量的是：
 *   - 面板画出来过没有；人关掉之后，agent 的下一步有没有把它弹回来；
 *   - 后台的页面有没有真的被操作到：输入框里的字、按钮被点了几次；
 *   - agent 在后台拿到的截图是不是一张空图——在渲染进程里解码，数不是白色的像素；
 *   - 整个过程有没有冒出 toast；
 *   - 对话里那张卡片：标题和地址对不对，「打开」按下去面板展开、落在这一页上。
 *
 * 跑：node --experimental-strip-types e2e/browser-background-probe.ts [--before]
 */

import { createServer, type ServerResponse } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9433;
const OUT = join(homedir(), "Desktop", "浏览器后台调试测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-");
/**
 * `--away`：agent 打开页面之后，人切到另一个对话去干别的，最后再回来。
 *
 * 后台跑最常见的样子就是这个。那时这个对话的页面挂在别处、`visibility: hidden`，截图和缩略图是不是
 * 还画得出东西，要单独量一遍。
 */
const away = process.argv.includes("--away");
const phase = `${process.argv.includes("--before") ? "before" : "after"}${away ? "_切走" : ""}`;

let app: RunningApp;
const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

const PAGE = '<!doctype html><title>Browser QA</title><style>body{font:16px system-ui;margin:40px}button,input{font:inherit;padding:10px}</style><h1>浏览器交互测试页</h1><input id="name" aria-label="Name"><button id="add">增加</button><output id="count">0</output><script>add.onclick=()=>count.textContent=Number(count.textContent)+1;</script>';

function answer(res: ServerResponse, step: number, tool?: { name: string; input: object }) {
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: `bg-${step}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
	emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `call-${step}`, name: tool.name, input: {} } : { type: "text", text: "" } });
	emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: "BROWSER_BG_DONE" } });
	emit("content_block_stop", { index: 0 });
	emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 10 } });
	emit("message_stop", {});
	res.end();
}

async function shot(name: string) {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${phase}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

async function main() {
	await mkdir(OUT, { recursive: true });
	let step = 0;
	let port = 0;
	/** agent 截到的那张图：从下一轮请求里的 tool_result 取出来。 */
	let screenshot: string | null = null;
	const errors: string[] = [];
	/** 第二次点击之前停一下，等探针决定要不要替人关掉面板。 */
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const script = () => [
		{ name: "skill", input: { name: "browser" } },
		{ name: "browser_open", input: { url: `http://127.0.0.1:${port}/page` } },
		{ name: "browser_act", input: { action: "type", selector: "#name", text: "后台输入" } },
		{ name: "browser_act", input: { action: "click", selector: "#add" } },
		{ name: "browser_act", input: { action: "click", selector: "#add" } },
		{ name: "browser_screenshot", input: {} },
	];
	const server = createServer((req, res) => {
		if (req.method === "GET") {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(PAGE);
			return;
		}
		let raw = "";
		req.on("data", (chunk) => { raw += chunk; });
		req.on("end", async () => {
			const body = JSON.parse(raw || "{}");
			res.writeHead(200, { "content-type": "text/event-stream" });
			if (!body.tools?.length) { answer(res, -1); return; }
			const last = body.messages?.at(-1)?.content;
			if (Array.isArray(last)) {
				for (const part of last) {
					if (part.type !== "tool_result") continue;
					if (part.is_error) errors.push(`第 ${step} 步之前那一步（${script()[step - 1]?.name ?? "?"}）：${JSON.stringify(part.content).slice(0, 200)}`);
					const image = Array.isArray(part.content) ? part.content.find((c: { type: string }) => c.type === "image") : undefined;
					if (image?.source?.data) screenshot = image.source.data;
				}
			}
			if (step === 4) await gate;
			answer(res, step, script()[step++]);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("夹具没拿到端口");
	port = address.port;

	app = await startApp({
		port: PORT,
		seed: async (home) => {
			await seedInteractions(home, port);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			settings.alwaysAllow = [`http://127.0.0.1:${port}`];
			settings.screenshot = { enabled: false, shortcut: "" };
			settings.uiLocale = "zh-CN";
			await writeFile(path, JSON.stringify(settings));
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 820 }));
		},
	});

	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);
	const d = driver(app);
	const PANE = '[data-dock-pane="browser"]';
	/** 页面里挂一个逐帧记录器：面板画没画出来、有没有 toast、有没有卡片。 */
	const RECORDER = `(() => {
		window.__probe = { frames: 0, panel: 0, toast: 0, card: 0, marks: [] };
		const tick = () => {
			const pane = document.querySelector('${PANE}');
			const style = pane ? getComputedStyle(pane) : null;
			const rect = pane ? pane.getBoundingClientRect() : null;
			const shown = Boolean(pane && !pane.hasAttribute('inert') && style && Number(style.opacity) > 0.01 && rect && rect.width > 0 && rect.height > 0);
			const p = window.__probe;
			p.frames++;
			if (shown) p.panel++;
			if (document.querySelector('.ly-toast-in, .ly-toast-out')) p.toast++;
			if (document.querySelector('[data-browser-card]')) p.card++;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	})()`;
	const probe = () => app.evaluate<{ frames: number; panel: number; toast: number; card: number }>("({ ...window.__probe })");
	const page = (expression: string) => app.evaluate<unknown>(`(async () => { const s = await window.lyra.browser.state(); const tab = s.tabs.find((t) => t.sessionId === 'qa-short'); const el = tab && document.querySelector('[data-browser-page="' + tab.id + '"]'); return el ? el.executeJavaScript(${JSON.stringify(expression)}) : null; })()`);

	try {
		await app.evaluate("document.fonts.ready");
		await d.click('[data-ly-row="qa-short"]');
		await d.until(`document.querySelector('textarea[aria-label="消息"]')`, 20000);
		await pause(800);
		await app.evaluate(RECORDER);
		await shot("00_开始之前");

		await app.evaluate(`window.lyra.agent.prompt('qa-short',[{type:'text',text:'打开页面，输入并点两下按钮，最后截个图'}])`);
		// 第一次点击落地之后，第二次点击之前。
		await d.until(`window.__probe && document.body.innerText.length > 0`, 5000);
		// `step` moves in the fake model's request handler, so it is read through a call each time round.
		const reached = (n: number) => step >= n;
		const end = Date.now() + 30000;
		if (away) {
			// 页面打开了（第三问已经发出），人切到另一个对话。
			while (!reached(3) && Date.now() < end) await pause(100);
			await d.click('[data-ly-row="qa-long"]');
			await d.until(`!document.querySelector('main')?.innerText.includes('打开页面，输入并点两下按钮')`, 10000);
			await pause(800);
			console.log(`   切走之后，页面自己说：${JSON.stringify(await page("({ visibility: document.visibilityState, hidden: document.hidden })"))}`);
		}
		while (!reached(4) && Date.now() < end) await pause(100);
		await pause(1200);
		const midway = await probe();
		await shot("01_点击一次之后");
		const openBeforeClose = await app.evaluate<boolean>(`(() => { const pane = document.querySelector('${PANE}'); return Boolean(pane && !pane.hasAttribute('inert')); })()`);
		if (openBeforeClose) {
			// 人觉得碍事，把面板关掉。
			await d.click(`${PANE} [aria-label="关闭浏览器"]`);
			await pause(600);
		}
		const beforeResume = await probe();
		release();
		if (away) {
			// 在另一个对话里等它做完，再回来看。
			while (!reached(7) && Date.now() < end + 30000) await pause(100);
			await pause(1500);
			await shot("01b_人在别的对话里");
			await d.click('[data-ly-row="qa-short"]');
		}
		await d.until(`document.body.innerText.includes('BROWSER_BG_DONE')`, 30000);
		await pause(1000);
		const done = await probe();
		await shot("02_agent做完");

		const typed = await page("document.querySelector('#name').value");
		const count = await page("document.querySelector('#count').textContent");

		// agent 在后台截到的图：在渲染进程里解码，数不是白色的像素。
		const pixels = screenshot === null ? null : await app.evaluate<{ width: number; height: number; ink: number; clear: number }>(`(async () => {
			const image = new Image();
			image.src = 'data:image/png;base64,${screenshot}';
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
			const context = canvas.getContext('2d');
			context.drawImage(image, 0, 0);
			const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
			let ink = 0, clear = 0;
			for (let i = 0; i < data.length; i += 4) {
				if (data[i + 3] < 250) clear++;
				else if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 200) ink++;
			}
			return { width: canvas.width, height: canvas.height, ink: ink / (data.length / 4), clear: clear / (data.length / 4) };
		})()`);

		check("agent 打开网页、操作网页的整个过程，面板一帧都没有弹出来", done.panel === 0, `${done.frames} 帧里有 ${done.panel} 帧面板在屏幕上`);
		check(
			"人关掉面板之后，agent 的下一步没有把它弹回来",
			done.panel - beforeResume.panel === 0,
			openBeforeClose ? `关掉之后又画出来 ${done.panel - beforeResume.panel} 帧` : "面板一直没开过，不用关",
		);
		check("后台的页面确实被操作到了：输入框里有字", typed === "后台输入", `输入框里是 ${JSON.stringify(typed)}`);
		check("后台的页面确实被操作到了：按钮点了两次", count === "2", `计数 ${JSON.stringify(count)}`);
		check(
			"agent 在后台截到的是一张画了东西的图，不是空图",
			pixels !== null && pixels.width > 100 && pixels.ink > 0.002,
			pixels ? `${pixels.width}×${pixels.height}，深色像素占 ${(pixels.ink * 100).toFixed(2)}%` : "没收到截图",
		);
		check(
			"agent 截到的图有实底，不是透明底",
			pixels !== null && pixels.clear < 0.01,
			pixels ? `透明像素占 ${(pixels.clear * 100).toFixed(2)}%——透明底交给模型，它看到的背景是什么颜色没人说得准` : "没收到截图",
		);
		check("工具一次都没报错", errors.length === 0, errors.length ? errors.join(" | ") : "全部成功");
		check("整个过程没有冒出 toast", done.toast === 0, `${done.toast} 帧里有 toast`);
		check("对话里出现了浏览器卡片", done.card > 0 && midway.card >= 0, `${done.card} 帧里有卡片`);

		const card = await app.evaluate<{ text: string } | null>(`(() => { const el = document.querySelector('[data-browser-card]'); return el ? { text: el.innerText } : null; })()`);
		check(
			"卡片写着页面标题、地址，和「已在浏览器中打开」",
			Boolean(card && card.text.includes("Browser QA") && card.text.includes(`127.0.0.1:${port}`) && card.text.includes("已在浏览器中打开")),
			card ? JSON.stringify(card.text) : "没有卡片",
		);
		/*
		 * 缩略图从落盘的那个文件读回来解码，而不是在页面里画 `ly-media://` 的图：那样 canvas 会被
		 * 跨源污染，读不出像素。测试页是白底黑字，一张对的缩略图绝大部分是亮的。
		 */
		const media = await app.evaluate<string | null>(`(() => { const img = document.querySelector('[data-browser-card] img'); return img ? decodeURIComponent(new URL(img.src).pathname.slice(1)) : null; })()`);
		const file = media ? await readFile(join(app.home, "session-media", media)).catch(() => null) : null;
		const thumbnail = file === null ? null : await app.evaluate<{ width: number; height: number; dark: number }>(`(async () => {
			const image = new Image();
			image.src = 'data:image/jpeg;base64,${file.toString("base64")}';
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
			const context = canvas.getContext('2d');
			context.drawImage(image, 0, 0);
			const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
			let dark = 0;
			for (let i = 0; i < data.length; i += 4) if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 60) dark++;
			return { width: canvas.width, height: canvas.height, dark: dark / (data.length / 4) };
		})()`);
		check("卡片上有这一页的缩略图，清晰到够 2× 屏", Boolean(thumbnail && thumbnail.width >= 800), thumbnail ? `${thumbnail.width}×${thumbnail.height}（${media}）` : "没有缩略图");
		check("缩略图是这一页本来的样子（白底），不是一片黑", Boolean(thumbnail && thumbnail.dark < 0.2), thumbnail ? `接近黑色的像素占 ${(thumbnail.dark * 100).toFixed(1)}%` : "没有缩略图");
		await shot("03_对话里的卡片");

		if (card) {
			await d.click("[data-browser-card] [data-browser-card-row] button");
			await d.until(`(() => { const pane = document.querySelector('${PANE}'); return pane && !pane.hasAttribute('inert') && Number(getComputedStyle(pane).opacity) > 0.99; })()`, 5000).catch(() => {});
			await pause(800);
			const shown = await app.evaluate<{ open: boolean; address: string }>(`(() => { const pane = document.querySelector('${PANE}'); const field = pane?.querySelector('input'); return { open: Boolean(pane && !pane.hasAttribute('inert')), address: field ? field.value : '' }; })()`);
			check("点卡片上的「打开」，面板展开并落在这一页上", shown.open && shown.address.includes(`127.0.0.1:${port}/page`), `面板${shown.open ? "开了" : "没开"}，地址栏 ${JSON.stringify(shown.address)}`);
			await shot("04_点开卡片之后");
		} else {
			check("点卡片上的「打开」，面板展开并落在这一页上", false, "没有卡片可点");
		}
	} finally {
		await stop();
		if (frames.length > 1) {
			const video = join(OUT, `${stamp}_${phase}_浏览器后台调试.mp4`);
			await encode(frames, video, 30, 1500).catch((error: unknown) => console.log(`   视频合成失败：${String(error)}`));
			console.log(`   🎬 ${video}`);
		}
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过　（${phase}）`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		server.close();
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
