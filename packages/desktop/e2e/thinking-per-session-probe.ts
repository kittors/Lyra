/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 推理强度按会话记：客户在 0.9.19 上报的那一串，在真窗口里原样走一遍。
 *
 * 「我原本的对话 a 是模型 a，等级是高。然后我新开个对话 b，也是模型 a，等级我调成中。然后我回去看
 * 我的对话 a，我的那个等级怎么变成中了。」
 *
 * 量两样东西，不只是标签：输入框那枚「推理强度」按钮上写的字，和回到 a 再发一句时真正发给模型的那
 * 一档——Anthropic 请求里的 `thinking.budget_tokens`，中 12288、高 24576。只量标签的话，修好了显示、
 * 没修好请求的那一版也会是绿的。
 *
 * 供应商是本机起的假 Anthropic 端点：拟标题那一问（不带工具）回一个认得出的标题，正文那一问回一句话。
 * 整个过程录成视频，和截图一起写到桌面。
 *
 * 跑：node --experimental-strip-types e2e/thinking-per-session-probe.ts [--before]
 */

import { createServer, type ServerResponse } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9431;
const OUT = join(homedir(), "Desktop", "推理强度串台测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-");
const phase = process.argv.includes("--before") ? "before" : "after";
const BUDGET: Record<string, number> = { 中: 12288, 高: 24576 };

let app: RunningApp;
const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

function answer(res: ServerResponse, text: string) {
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: `probe-${Date.now()}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
	emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
	emit("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
	emit("content_block_stop", { index: 0 });
	emit("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } });
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
	/** 每一轮正文请求：用户那句话，和它带着的思考预算。拟标题、记忆这些不带工具的旁路请求不记。 */
	const asked: { text: string; budget: number | null }[] = [];
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => { raw += chunk; });
		req.on("end", () => {
			const body = JSON.parse(raw || "{}");
			res.writeHead(200, { "content-type": "text/event-stream" });
			if (!body.tools?.length) {
				answer(res, /对话 b/.test(raw) ? "对话 b" : "对话 a");
				return;
			}
			const last = body.messages?.at(-1);
			const text = Array.isArray(last?.content)
				? last.content.filter((part: { type: string; text?: string }) => part.type === "text" && !part.text?.startsWith("<env>")).map((part: { text: string }) => part.text).join("")
				: String(last?.content ?? "");
			asked.push({ text, budget: body.thinking?.budget_tokens ?? null });
			answer(res, "收到");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("假模型没拿到端口");

	app = await startApp({
		port: PORT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 820 }));
			await writeFile(join(home, "settings.json"), JSON.stringify({
				uiLocale: "zh-CN",
				permissionMode: "full",
				projectMemory: false,
				thinking: "medium",
				mcpServers: [],
				hooks: [],
				sync: { enabled: false },
				appearance: { reduceMotion: "on" },
				projects: [{ path: cwd, name: "推理强度验收", pinned: true, lastOpenedAt: Date.now() }],
				defaultModelId: "qa/model",
				providers: [{
					id: "qa", name: "假模型", api: "anthropic-messages", baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "probe", enabled: true,
					// 最大输出要高过「高」那一档的预算，不然两档都被截到同一个数，量不出区别。
					models: [{ id: "qa/model", providerId: "qa", modelId: "model", name: "模型 a", contextWindow: 200000, maxOutputTokens: 64000, supportsImages: false, supportsTools: true, supportsThinking: true }],
				}],
			}));
		},
	});

	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);
	const d = driver(app);
	const TRIGGER = 'main button[aria-label^="推理强度"]';
	const level = async () => (await app.evaluate<string>(`document.querySelector(${JSON.stringify(TRIGGER)})?.getAttribute('aria-label') ?? ''`)).replace(/^推理强度：/, "");
	/**
	 * 等第 `count` 轮正文请求到达，并且屏幕上的对话里已经画出 `replies` 句回复。
	 *
	 * 不等「停止」按钮：假模型一下就答完，按钮可能一帧都没被轮询看见，那样会白白等满超时。
	 */
	const turns = async (count: number, replies: number) => {
		const end = Date.now() + 20000;
		while (asked.length < count && Date.now() < end) await pause(100);
		if (asked.length < count) throw new Error(`假模型只收到 ${asked.length} 轮正文请求，等的是 ${count}`);
		await d.until(`!document.querySelector('button[aria-label="停止"]') && (document.querySelector('main')?.innerText.match(/收到/g)?.length ?? 0) >= ${replies}`, 20000);
	};

	/** 打开等级菜单，用方向键一格一格挪到目标档，每一格都读一次按钮上的字。 */
	async function setLevel(target: string) {
		await d.click(TRIGGER);
		await d.until(`document.querySelector('[role="group"] input[type="range"]')`, 5000);
		await app.evaluate(`document.querySelector('[role="group"] input[type="range"]').focus()`);
		const order = ["关", "极简", "低", "中", "高", "超高", "最高", "极致"];
		for (let step = 0; step < 8 && (await level()) !== target; step++) {
			const up = order.indexOf(target) > order.indexOf(await level());
			await d.key(up ? "ArrowRight" : "ArrowLeft", up ? 39 : 37);
			await pause(120);
		}
		await pause(300);
		await d.key("Escape", 27);
		await pause(300);
	}

	async function send(text: string) {
		await d.click("main textarea");
		await d.type(text);
		await pause(200);
		await d.submit();
	}

	async function openRow(title: string) {
		await d.until(`[...document.querySelectorAll('[data-ly-row]')].some((r) => r.innerText.includes(${JSON.stringify(title)}))`, 10000);
		await app.evaluate(`(() => { document.querySelector('[data-probe-row]')?.removeAttribute('data-probe-row'); [...document.querySelectorAll('[data-ly-row]')].find((r) => r.innerText.includes(${JSON.stringify(title)})).setAttribute('data-probe-row', ''); })()`);
		await d.click("[data-probe-row]");
	}

	try {
		await app.evaluate("document.fonts.ready");
		await d.until(`document.querySelector(${JSON.stringify(TRIGGER)})`, 20000);
		await pause(600);

		// 对话 a：发第一句之前把等级调成「高」，然后发出去。
		await setLevel("高");
		const draftA = await level();
		await send("对话 a 的第一句");
		await turns(1, 1);
		await pause(600);
		await shot("01_对话a建好");

		// 新开对话 b，同一个模型，发第一句之前调成「中」。
		await d.markByText("/^新对话/", "data-probe-new");
		await d.click("[data-probe-new]");
		await d.until(`!document.querySelector('main')?.innerText.includes('对话 a 的第一句')`, 10000);
		await pause(500);
		const draftB = await level();
		await setLevel("中");
		await send("对话 b 的第一句");
		await turns(2, 1);
		await pause(600);
		await shot("02_对话b建好");

		// 回到 a。
		await openRow("对话 a");
		await d.until(`document.querySelector('main')?.innerText.includes('对话 a 的第一句')`, 10000);
		await pause(800);
		const backInA = await level();
		await shot("03_回到对话a");

		// 在 a 里再发一句：看真正发给模型的是哪一档。
		await send("对话 a 的第二句");
		await turns(3, 2);
		await pause(800);
		await shot("04_对话a第二句");

		const named = (budget: number | null) => Object.entries(BUDGET).find(([, value]) => value === budget)?.[0] ?? String(budget);
		console.log(`\n   正文请求：${asked.map((a, i) => `${["a 第一句", "b 第一句", "a 第二句"][i] ?? `第 ${i + 1} 轮`} → ${named(a.budget)}（${a.budget}）`).join("；")}`);
		check("对话 a 发第一句前调到了「高」", draftA === "高", `按钮上写着「${draftA}」`);
		check("对话 a 的第一轮按「高」发出", asked[0]?.budget === BUDGET.高, `thinking.budget_tokens = ${asked[0]?.budget}`);
		check("新开对话 b 时从上一次选的「高」起步", draftB === "高", `按钮上写着「${draftB}」`);
		check("对话 b 的第一轮按「中」发出", asked[1]?.budget === BUDGET.中, `thinking.budget_tokens = ${asked[1]?.budget}`);
		check("回到对话 a，按钮上还是「高」", backInA === "高", `按钮上写着「${backInA}」`);
		check("对话 a 的第二轮仍按「高」发出", asked[2]?.budget === BUDGET.高, `thinking.budget_tokens = ${asked[2]?.budget}（${named(asked[2]?.budget ?? null)}）`);
	} finally {
		await stop();
		if (frames.length > 1) {
			const video = join(OUT, `${stamp}_${phase}_推理强度串台.mp4`);
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
