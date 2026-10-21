/* oxlint-disable no-console -- real Electron/API probe evidence */
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, closeListeningServer, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

// The relay forwards real requests; its disposable profile never contains the upstream key.
const key = process.env.DEEPSEEK_TEST_KEY;
delete process.env.DEEPSEEK_TEST_KEY;
const before = process.argv.includes("--before");
if (!before && !key) throw new Error("DEEPSEEK_TEST_KEY is required for the live API check");
const OUT = join(homedir(), "Desktop", "LyraDeepSeek思考等级测试");
const STAMP = new Date().toLocaleString("sv-SE").replace(/[: ]/g, "-").slice(0, 16);
const PORT = 9457;
const EFFORT = 'main button[aria-label^="推理强度："]';
const SLIDER = '[role="group"] input[type="range"]';
const models = ["deepseek-flash", "deepseek-v4-pro"];
const turns: { model: unknown; effort: unknown; status: number; reasoning: number; text: string }[] = [];
const checks: boolean[] = [];
function check(label: string, ok: boolean, saw: unknown) {
	checks.push(ok);
	console.log(`${ok ? "✅" : "❌"} ${label}: ${JSON.stringify(saw)}`);
}

const relay = createServer(async (req, res) => {
	try {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		const raw = Buffer.concat(chunks).toString("utf8");
		const body: { model?: unknown; reasoning_effort?: unknown; tools?: unknown } = JSON.parse(raw);
		const upstream = await fetch("https://api.deepseek.com/v1/chat/completions", {
			method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
			body: raw, signal: AbortSignal.timeout(90_000),
		});
		res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "text/event-stream" });
		let wire = "";
		if (upstream.body) for await (const chunk of upstream.body) {
			wire += Buffer.from(chunk).toString("utf8");
			res.write(chunk);
		}
		res.end();
		let reasoning = 0;
		let text = "";
		for (const line of wire.split("\n")) {
			if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
			const event: { choices?: { delta?: { reasoning_content?: string; content?: string } }[] } = JSON.parse(line.slice(6));
			for (const choice of event.choices ?? []) {
				reasoning += (choice.delta?.reasoning_content ?? "").length;
				text += choice.delta?.content ?? "";
			}
		}
		// Background classifiers also use this provider with reasoning off; measure agent turns only.
		if (Array.isArray(body.tools) && body.tools.length > 0) {
			turns.push({ model: body.model, effort: body.reasoning_effort, status: upstream.status, reasoning, text });
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : "API relay failed");
		res.destroy();
	}
});

let app: RunningApp | undefined;
const frames: Frame[] = [];
let stopRecording = async () => {};
await mkdir(OUT, { recursive: true });
try {
	await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
	const address = relay.address();
	if (!address || typeof address === "string") throw new Error("Relay has no port");
	app = await startApp({
		port: PORT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900 }));
			await writeFile(join(home, "settings.json"), JSON.stringify({
				uiLocale: "zh-CN", permissionMode: "full", projectMemory: false, thinking: "max", lastThinking: "max",
				autoSummarizeTitle: false, mcpServers: [], hooks: [], sync: { enabled: false },
				projects: [{ path: cwd, name: "DeepSeek API verification", pinned: true, lastOpenedAt: Date.now() }],
				defaultModelId: `ds/${models[0]}`,
				providers: [{
					id: "ds", name: "DeepSeek", api: "openai-chat-completions", baseUrl: `http://127.0.0.1:${address.port}/v1`,
					apiKey: "local-probe", enabled: true,
					models: models.map((id) => ({ id: `ds/${id}`, providerId: "ds", modelId: id, name: id,
						contextWindow: 1_000_000, maxOutputTokens: 2048, supportsThinking: true, supportsTools: true, supportsImages: false })),
				}],
			}));
		},
	});
	const window = app;
	stopRecording = await startRecording(PORT, frames);
	const d = driver(window);
	const level = () => window.evaluate<string>(`document.querySelector(${JSON.stringify(EFFORT)})?.getAttribute('aria-label')`);
	const shot = async (name: string) => {
		await pause(1000);
		const { data } = await window.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		const file = join(OUT, `${STAMP}_${before ? "before" : "after"}_${name}.png`);
		await writeFile(file, Buffer.from(data, "base64"));
		console.log(`📸 ${file}`);
	};
	const openEffort = async () => {
		if (!await window.evaluate<boolean>(`document.querySelector(${JSON.stringify(SLIDER)})?.checkVisibility()`)) await d.click(EFFORT);
		await d.until(`document.querySelector(${JSON.stringify(SLIDER)})`, 5000);
		await pause(500);
		await d.click('[role="group"] button[data-ly-tip="各档位说明"]');
		await pause(600);
	};
	const send = async (wanted: string, thinking: boolean) => {
		const count = turns.length;
		const answer = `DS_OK_${count + 1}:${(13729 + count) * 28371 + 409}`;
		await d.click("main textarea");
		await d.type(`Using mental arithmetic, calculate (${13729 + count} times 28371) + 409. Reply in the format DS_OK_${count + 1}:<result>, with no other text.`);
		await pause(800);
		await d.submit();
		const end = Date.now() + 100_000;
		while (turns.length === count && Date.now() < end) await pause(250);
		await d.until(`!document.querySelector('button[aria-label="停止"]')`, 20_000);
		await pause(1000);
		const turn = turns.at(-1);
		check(`实际请求发送 ${wanted}，上游 200`, turns.length > count && turn?.effort === wanted && turn.status === 200, turn);
		check(thinking ? "真实接口返回推理内容" : "关闭后推理内容为 0", !!turn && (thinking ? turn.reasoning > 0 : turn.reasoning === 0), turn?.reasoning);
		check("回答显示在真实会话页面", turn?.text.trim() === answer && await window.evaluate<boolean>(`[...document.querySelectorAll('main .prose-dw')].some(e=>e.innerText.trim()===${JSON.stringify(answer)})`), turn?.text);
	};
	await d.until(`document.querySelector(${JSON.stringify(EFFORT)})`, 20_000);
	await pause(1200);
	await openEffort();
	const levels = await window.evaluate<string[]>(`[...document.querySelectorAll('[role="group"] .ly-reveal .flex.gap-2 > span:first-child')].map(e=>e.textContent)`);
	console.log(`可见档位：${levels.join("/")}，${await level()}`);
	await shot("01_DeepSeek思考等级");
	if (!before) {
		check("DeepSeek 档位为关/低/高/最高", levels.join("/") === "关/低/高/最高", levels);
		check("已有 max 选择显示最高", (await level()) === "推理强度：最高", await level());
		await d.key("Escape", 27);
		await send("max", true);
		await shot("02_Flash最高思考真实回答");
		for (const [press, code, wanted, thinking] of [["ArrowLeft", 37, "high", true], ["ArrowLeft", 37, "low", true], ["Home", 36, "none", false]] as const) {
			await openEffort();
			await window.evaluate(`document.querySelector(${JSON.stringify(SLIDER)}).focus()`);
			await d.key(press, code);
			await pause(1000);
			await d.key("Escape", 27);
			await send(wanted, thinking);
		}
		await d.click('main button[aria-label="选择模型"]');
		await d.until(`document.querySelector('[data-model="ds/deepseek-v4-pro"] [role="menuitem"]')`, 5000);
		await pause(800);
		await d.click('[data-model="ds/deepseek-v4-pro"] [role="menuitem"]');
		await d.until(`document.querySelector('[role="alertdialog"], [role="dialog"]')`, 5000);
		await d.markByText("/^确认切换$/", "data-confirm-model");
		await d.click("[data-confirm-model]");
		await d.until(`document.querySelector('main button[aria-label="选择模型"]')?.innerText.includes('deepseek-v4-pro')`, 5000);
		await pause(1000);
		await openEffort();
		await window.evaluate(`document.querySelector(${JSON.stringify(SLIDER)}).focus()`);
		await d.key("End", 35);
		await pause(1000);
		check("V4 Pro 能选最高", (await level()) === "推理强度：最高", await level());
		await d.key("Escape", 27);
		await send("max", true);
		check("请求确实使用 V4 Pro", turns.at(-1)?.model === "deepseek-v4-pro", turns.at(-1)?.model);
		await shot("03_Pro最高思考真实回答");
	}
} finally {
	await stopRecording();
	await app?.stop();
	await closeListeningServer(relay);
	const passed = checks.filter(Boolean).length;
	const video = join(OUT, `${STAMP}_${before ? "before" : "after"}_DeepSeek思考等级_${passed}of${checks.length}.mp4`);
	if (frames.length) await encode(frames, video);
	console.log(`${passed}/${checks.length} checks passed; ${video}`);
	if (checks.some((ok) => !ok)) process.exitCode = 1;
}
