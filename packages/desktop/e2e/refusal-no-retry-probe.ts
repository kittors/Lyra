/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * A refusal written as the answer is not retried, in the real window.
 *
 * The relay behaves as it did on 2026-10-13 in front of Gemini: the Responses stream carries "The prompt
 * could not be submitted … Prohibited Use policy …" as text, then closes with a generic in-stream error.
 * That used to read as a server fault and was retried every five seconds — each attempt streaming the
 * same refusal again — until someone pressed stop. Measured: how many requests arrive, what the turn says.
 *
 *   node --experimental-strip-types e2e/refusal-no-retry-probe.ts   # records into ~/Desktop/Lyra内容拒绝测试
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9453;
const OUT = join(homedir(), "Desktop", "Lyra内容拒绝测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const REFUSAL =
	"The prompt could not be submitted. The prompt contains sensitive words that violate Google's Generative AI Prohibited Use policy. Try rephrasing the prompt. If you think this was an error, send feedback.";

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

let app: RunningApp;
async function shot(name: string) {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

async function main() {
	await mkdir(OUT, { recursive: true });
	const requests: string[] = [];
	const server = createServer((req, res) => {
		requests.push(req.url ?? "");
		req.resume();
		const frame = (type: string, body: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`;
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.write(frame("response.created", { response: { id: "resp_1" } }));
		res.write(frame("response.output_item.added", { output_index: 0, item: { type: "message", role: "assistant", content: [] } }));
		let at = 0;
		const timer = setInterval(() => {
			if (at < REFUSAL.length) {
				res.write(frame("response.output_text.delta", { output_index: 0, content_index: 0, delta: REFUSAL.slice(at, at + 12) }));
				at += 12;
				return;
			}
			clearInterval(timer);
			res.end(frame("error", { code: "internal_server_error", message: "response_stream_incomplete: upstream responses stream closed before response.completed", sequence_number: 0 }));
		}, 30);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no port");

	app = await startApp({
		port: PORT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
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
					appearance: { theme: "light" },
					projects: [{ path: cwd, name: "拒绝演示", pinned: true, lastOpenedAt: Date.now() }],
					defaultModelId: "relay/gemini-3.8-flash-high",
					providers: [
						{
							id: "relay",
							name: "中转站",
							api: "openai-responses",
							baseUrl: `http://127.0.0.1:${address.port}`,
							apiKey: "probe-key",
							enabled: true,
							models: [{ id: "relay/gemini-3.8-flash-high", providerId: "relay", modelId: "gemini-3.8-flash-high", name: "gemini-3.8-flash-high", contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: false, supportsImages: true, supportsTools: true }],
						},
					],
				}),
			);
		},
	});

	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);
	const { until, type, submit } = driver(app);
	try {
		await app.evaluate("document.fonts.ready");
		await pause(1200);
		await type("把这个女孩画得更好看一点");
		await pause(600);
		await submit();
		await until(`document.body.innerText.includes("Prohibited Use policy")`, 20000);
		// The old behaviour retried after five seconds; twelve leaves room for two of those to have happened.
		await pause(12000);
		const seen = await app.evaluate<{ text: string; stopVisible: boolean }>(`(() => ({ text: document.querySelector('main')?.innerText ?? '', stopVisible: Boolean(document.querySelector('button[aria-label="停止"]')) }))()`);
		const asked = requests.filter((url) => url.includes("/responses")).length;
		check("拒绝只问了一次，没有每 5 秒再问一遍", asked === 1, `${asked} 次请求`);
		check("界面上没有「服务端故障，几秒后重试」", !/秒后重试|服务端故障/.test(seen.text), seen.text.replace(/\s+/g, " ").slice(-200));
		check("这一轮结束了，说的是被内容安全策略拒绝", !seen.stopVisible && /内容被安全策略拒绝/.test(seen.text), seen.stopVisible ? "还在跑" : "已结束");
		check("服务商的原话留在回复里", /Prohibited Use policy/.test(seen.text), "");
		const button = await app.evaluate<string | null>(`document.querySelector('main [data-composer-send]')?.getAttribute('data-composer-send') ?? null`);
		check("输入框的按钮是发送，不是「继续」——继续只会被再拒一次", button === "send", `data-composer-send=${button}`);
		await shot("01_被拒以后直接停下");
		await pause(1200);
	} catch (error) {
		console.log(`💥 ${error instanceof Error ? error.message : String(error)}`);
		await shot("失败现场").catch(() => {});
		check("探针跑完了全程", false, error instanceof Error ? error.message : String(error));
	} finally {
		await stop();
		await app.stop();
		server.close();
		const passed = results.filter((result) => result.ok).length;
		const video = join(OUT, `${stamp}_内容被拒不再重试_${passed}of${results.length}.mp4`);
		await encode(frames, video);
		console.log(`\n🎬 ${video}\n${passed}/${results.length} 通过`);
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
