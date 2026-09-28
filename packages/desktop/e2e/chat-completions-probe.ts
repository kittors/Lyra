/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * A provider that only speaks Chat Completions, driven through the real window.
 *
 * Two things were broken on this wire, and neither showed up anywhere but in use:
 *
 *   - The settings page's connection test posted `/v1/responses` for every provider that was not
 *     Anthropic, so an endpoint that only speaks `/v1/chat/completions` failed its test while its
 *     conversations worked. That is how the wire came to be seen as unsupported at all.
 *   - With thinking off, the adapter sent `reasoning_effort: "none"`, which Gemini refuses. The
 *     Responses adapter already knew that; this one did not, so every Gemini turn failed.
 *
 * The endpoint is a local fake that behaves like the relay measured on 2026-09-28: `/v1/responses`
 * is a 404, and a Gemini request carrying `"none"` gets Vertex's own 400. What is checked is what a
 * person sees — the reply in the transcript, the test result on the settings page — plus what the
 * endpoint received, which is the only place "no reasoning_effort was sent" can be seen.
 *
 *   node --experimental-strip-types e2e/chat-completions-probe.ts            # after (records a video)
 *   node --experimental-strip-types e2e/chat-completions-probe.ts --before   # on the old build, stills only
 */

import { createServer, type IncomingMessage } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9433;
const OUT = join(homedir(), "Desktop", "LyraChatCompletions兼容测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const phase = process.argv.includes("--before") ? "before" : "after";
const REPLY = "你好，这句是经 Chat Completions 流式送回来的。";

interface Seen {
	path: string;
	model?: string;
	reasoningEffort?: unknown;
	hasReasoningEffort: boolean;
}
const seen: Seen[] = [];

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
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

/** The fake relay: a Chat Completions endpoint and nothing else. */
function relay() {
	return createServer(async (req, res) => {
		const path = (req.url ?? "").replace(/\?.*$/, "");
		if (req.method === "GET" && path.endsWith("/models")) {
			seen.push({ path, hasReasoningEffort: false });
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ data: [{ id: "gemini-3.8-flash-high" }, { id: "deepseek-v4-flash" }] }));
			return;
		}
		const body = await bodyOf(req);
		seen.push({ path, model: String(body.model ?? ""), reasoningEffort: body.reasoning_effort, hasReasoningEffort: "reasoning_effort" in body });
		if (!path.endsWith("/chat/completions")) {
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: `Not found: this relay only speaks /v1/chat/completions (got ${path})` } }));
			return;
		}
		if (String(body.model).includes("gemini") && body.reasoning_effort === "none") {
			// Vertex's own words, as the relay passed them on.
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: `Invalid value at 'request.generation_config.thinking_config.thinking_level' (type.googleapis.com/google.cloud.aiplatform.master.GenerationConfig.ThinkingConfig.ThinkingLevel), "none"` } }));
			return;
		}
		res.writeHead(200, { "content-type": "text/event-stream" });
		const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
		const text = Array.isArray(body.tools) && body.tools.length > 0 ? REPLY : "Chat Completions 验收";
		for (const piece of text.match(/.{1,4}/gu) ?? []) {
			send({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
			await pause(60);
		}
		send({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
		send({ id: "c1", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 24, completion_tokens: 12, total_tokens: 36 } });
		res.end("data: [DONE]\n\n");
	});
}

let app: RunningApp;

async function shot(name: string) {
	await app.evaluate(
		`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))).then(()=>new Promise(requestAnimationFrame))`,
	);
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${phase}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

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
			await writeFile(
				join(home, "settings.json"),
				JSON.stringify({
					uiLocale: "zh-CN",
					permissionMode: "full",
					projectMemory: false,
					thinking: "off",
					autoSummarizeTitle: false,
					mcpServers: [],
					hooks: [],
					sync: { enabled: false },
					appearance: { reduceMotion: "on" },
					projects: [{ path: cwd, name: "协议验收", pinned: true, lastOpenedAt: Date.now() }],
					defaultModelId: "cc/gemini-3.8-flash-high",
					providers: [
						{
							id: "cc",
							name: "Chat Completions 中转",
							api: "openai-chat-completions",
							baseUrl: `http://127.0.0.1:${address.port}/v1`,
							apiKey: "probe-key",
							enabled: true,
							models: ["gemini-3.8-flash-high", "deepseek-v4-flash"].map((modelId) => ({
								id: `cc/${modelId}`,
								providerId: "cc",
								modelId,
								name: modelId,
								contextWindow: 200000,
								maxOutputTokens: 8192,
								supportsThinking: true,
								supportsImages: false,
								supportsTools: true,
							})),
						},
					],
				}),
			);
		},
	});

	const frames: Frame[] = [];
	const stop = phase === "after" ? await startRecording(PORT, frames) : async () => {};
	const { until, click, type, submit } = driver(app);
	try {
		await app.evaluate("document.fonts.ready");
		await pause(1200);

		console.log("① 关着推理，用 Gemini 在对话里说一句话");
		await type("你好，用一句话回我。");
		await pause(900);
		await submit();
		await until(`[...document.querySelectorAll("main")].some((m) => m.innerText.includes(${JSON.stringify(REPLY)}) || /请求不被接受|Invalid value/.test(m.innerText))`, 60000);
		await pause(1500);
		const replied = await app.evaluate<boolean>(`document.querySelector("main").innerText.includes(${JSON.stringify(REPLY)})`);
		const turn = seen.filter((s) => s.path.endsWith("/chat/completions") && s.model === "gemini-3.8-flash-high");
		check("关推理时 Gemini 的回复出现在对话里", replied, replied ? `看到了「${REPLY}」` : "对话里是一条错误，不是回复");
		check(
			"关推理时发给 Gemini 的请求里没有 reasoning_effort",
			turn.length > 0 && turn.every((s) => !s.hasReasoningEffort),
			turn.map((s) => (s.hasReasoningEffort ? `reasoning_effort=${JSON.stringify(s.reasoningEffort)}` : "无 reasoning_effort")).join("；") || "一个对话请求都没收到",
		);
		await shot("01_关推理时Gemini对话");

		console.log("② 设置 → 模型设置 → 测试全部");
		const before = seen.length;
		await click(".ly-sidebar-foot button");
		await pause(900);
		await app.evaluate(`(()=>{document.querySelector('[data-probe-nav]')?.removeAttribute('data-probe-nav');[...document.querySelectorAll("nav button")].find((b)=>b.textContent.trim()==="模型设置")?.setAttribute('data-probe-nav','');})()`);
		await click("[data-probe-nav]");
		await pause(1200);
		await app.evaluate(`(()=>{document.querySelector('[data-probe-test]')?.removeAttribute('data-probe-test');[...document.querySelectorAll("button")].find((b)=>b.checkVisibility()&&b.innerText.trim()==="测试全部")?.setAttribute('data-probe-test','');})()`);
		await click("[data-probe-test]");
		await until(`[...document.querySelectorAll("div")].some((d)=>d.checkVisibility()&&/^(连接成功|HTTP |未找到|请先|密钥|请求)/.test(d.innerText.trim())&&d.children.length<=1)`, 60000);
		await pause(1200);
		const outcome = await app.evaluate<string>(`([...document.querySelectorAll("div")].find((d)=>d.checkVisibility()&&/^(连接成功|HTTP |未找到|请先|密钥|请求)/.test(d.innerText.trim())&&d.children.length<=1)?.innerText ?? "").trim()`);
		const tested = seen.slice(before);
		check("测试全部通过", outcome.startsWith("连接成功"), outcome || "没有结果");
		check(
			"测试连接打的是 /v1/chat/completions，没有去 /v1/responses",
			tested.some((s) => s.path.endsWith("/chat/completions")) && !tested.some((s) => s.path.endsWith("/responses")),
			tested.map((s) => s.path).join(" → "),
		);
		await shot("02_测试全部");

		console.log("③ 单独测第二个模型");
		await app.evaluate(`(()=>{document.querySelector('[data-probe-one]')?.removeAttribute('data-probe-one');[...document.querySelectorAll("button")].filter((b)=>b.checkVisibility()&&(b.getAttribute("data-ly-tip")==="测试此模型"||b.getAttribute("aria-label")==="测试此模型")).at(-1)?.setAttribute('data-probe-one','');})()`);
		await click("[data-probe-one]");
		await until(`[...document.querySelectorAll("[data-ly-tip]")].some((e)=>/^测试(通过|失败) · /.test(e.getAttribute("data-ly-tip")))`, 60000);
		await pause(1200);
		const single = await app.evaluate<string>(`[...document.querySelectorAll("[data-ly-tip]")].map((e)=>e.getAttribute("data-ly-tip")).find((t)=>/^测试(通过|失败) · /.test(t)) ?? ""`);
		check("单独测 deepseek-v4-flash 通过", single.startsWith("测试通过"), single);
		await shot("03_单独测一个模型");
		await pause(1500);
	} finally {
		await stop();
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过　（${phase}）`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		endpoint.close();
		if (phase === "after" && frames.length > 0) {
			const video = join(OUT, `${stamp}_Chat Completions兼容_${passed}of${results.length}.mp4`);
			await encode(frames, video);
			console.log(`   🎬 ${video}`);
		}
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
