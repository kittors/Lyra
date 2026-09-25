/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 反馈原话：「对话 a 以模型 a 请求发出去之后，一直响应有问题（上游问题），我就在对话框的位置切模型 b，
 * 然后直接点对话 a 下面的编辑、打勾重发，这时请求的还是之前的模型 a；我重新复制，从对话框输入，
 * 这时才是模型 b 请求。」
 *
 * core 层三种时序、六个版本都复现不出来（编辑重发一直读会话当前的模型）。所以照原话在真窗口里走一遍，
 * 每一步都看假服务器实际收到的是哪个模型——而不是看界面上写着什么。
 *
 * 量出来的根因不在编辑重发，在它前面那段：一轮开始时拿到的模型用到这一轮结束，而上游重试是「一直
 * 重试到取消」时这一轮永远不会自己结束。输入框上写着 Model B，服务器收到的是 a、a、a、a。修好之后
 * 这里断言：切到 b 的那一刻就换人，不用停止、不用编辑。
 *
 * 「一直响应有问题」按用户本机的配置来：上游重试 `retries: null`，也就是一直重试到被取消。
 *
 * 用法：node --experimental-strip-types e2e/edit-resend-model-probe.ts [输出目录]
 * 先 build：探针跑的是 out/ 里的产物。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { closeListeningServer, startApp } from "./app.ts";
import { encode, frameGrabber, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(process.env.HOME ?? "/tmp", "Desktop", "编辑重发模型测试");
const MODEL_PORT = 9877;
const CDP_PORT = 9503;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 服务器收到的每一个请求：什么时候、哪个模型。 */
const requests: { at: number; model: string }[] = [];

function startModel(): Server {
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const body = JSON.parse(raw) as { model?: string };
			const model = body.model ?? "?";
			requests.push({ at: Date.now(), model });
			if (model === "model-a") {
				// 模型 a 的上游坏了，而且一直坏着。
				res.writeHead(502, { "content-type": "application/json" });
				res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "upstream exploded" } }));
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			const events: [string, unknown][] = [
				["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", content: [], model, stop_reason: null, usage: { input_tokens: 100, output_tokens: 0 } } }],
				["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
				["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `PROBE-OK 这一句是 ${model} 回答的` } }],
				["content_block_stop", { type: "content_block_stop", index: 0 }],
				["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } }],
				["message_stop", { type: "message_stop" }],
			];
			for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

const model = (id: string, name: string) => ({
	id: `local/${id}`,
	providerId: "local",
	modelId: id,
	name,
	contextWindow: 200000,
	maxOutputTokens: 8192,
	supportsThinking: false,
	supportsImages: false,
	supportsTools: true,
});

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	const forever = { retries: null, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 };
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "local",
					name: "Local",
					baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [model("model-a", "Model A"), model("model-b", "Model B")],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/model-a",
			autoSummarizeTitle: false,
			permissionMode: "full",
			thinking: "off",
			retryPolicy: { network: forever, upstream: forever },
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4525, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

const server = startModel();
const app = await startApp({ port: CDP_PORT, seed });
const grab = await frameGrabber(CDP_PORT);
const frames: Frame[] = [];
/** 一个对象而不是一个 `let`：录像循环读的是它，停下的那一句在别处写。 */
const filming = { on: true };
const film = (async () => {
	while (filming.on) {
		try {
			frames.push({ at: Date.now(), data: await grab.shot() });
		} catch {
			await pause(50);
		}
	}
})();

async function shot(name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, name), Buffer.from(data, "base64"));
	console.log(`  → ${name}`);
}

/** 真实鼠标：先移过去（悬停才出现的按钮要先有悬停），确认落点，再按。 */
async function press(selector: string, text?: string): Promise<boolean> {
	const at = await app.evaluate<{ x: number; y: number; lands: boolean } | null>(`(() => {
		const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
		const el = ${text ? `all.find((one) => (one.innerText ?? "").includes(${JSON.stringify(text)}))` : "all[0]"};
		if (!el) return null;
		el.scrollIntoView({ block: "center" });
		const r = el.getBoundingClientRect();
		const x = r.left + r.width / 2, y = r.top + r.height / 2;
		const hit = document.elementFromPoint(x, y);
		return { x, y, lands: !!hit && (hit === el || el.contains(hit)) };
	})()`);
	if (!at) return false;
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
	await pause(250);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 });
	return at.lands;
}

/** 悬停到一个元素上，让「悬停才出现」的那排按钮出来。 */
async function hover(selector: string): Promise<void> {
	const at = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	})()`);
	if (at) await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
	await pause(300);
}

const since = (from: number) => requests.filter((one) => one.at >= from).map((one) => one.model);
const steps: { step: string; saw: string[] }[] = [];
const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
	checks.push({ name, ok, detail });
	console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
};
const mainText = () => app.evaluate<string>(`(document.querySelector("main")?.innerText ?? "")`);

try {
	await mkdir(out, { recursive: true });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	await pause(1500);

	// 1. 用模型 a 发出去：上游一直 502，它会一直重试。
	const t1 = Date.now();
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "Q1 这句话要重发");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	})()`);
	for (let i = 0; i < 40 && since(t1).length < 3; i++) await pause(250);
	steps.push({ step: "1. 用 a 发出去，上游一直 502，重试中", saw: since(t1) });
	await shot("01-模型a一直在重试.png");

	// 2. 重试还在进行的时候，在输入框那里切到模型 b（中途切换有一个确认框）。
	await press('main button[aria-label="选择模型"]');
	await pause(600);
	await app.evaluate(`(() => { const active = document.activeElement; if (active && active.blur) active.blur(); })()`);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "2", code: "Digit2", text: "2", windowsVirtualKeyCode: 50 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "2", code: "Digit2", windowsVirtualKeyCode: 50 });
	await pause(600);
	// 从按下确认的那一刻算起：换模型是当场生效的，晚一拍开始数就会漏掉 b 的那个请求。
	const t2 = Date.now();
	const confirmed = await press("button", "确认切换");
	await pause(800);
	const label = await app.evaluate<string>(`(document.querySelector('main button[aria-label="选择模型"]')?.innerText ?? "")`);
	console.log(`切模型：确认框${confirmed ? "已确认" : "没找到"}，输入框上显示「${label.trim()}」`);
	for (let i = 0; i < 40 && !(await mainText()).includes("PROBE-OK"); i++) await pause(250);
	await pause(800);
	const afterSwitch = since(t2);
	steps.push({ step: "2. 重试中切到 b 之后，服务器收到的", saw: afterSwitch });
	/*
	 * 「立刻」怎么量：按下确认到切换真正生效之间隔着一次鼠标、一次 IPC，而 a 每秒重试一次，那段空窗
	 * 里落进一个 a 是正常的。要证明的是两件事：第一个 b 之后再也没有 a；b 在按下确认后两秒内就出去了
	 * ——没有等 a 那一轮重试走完，更没有等人按停止。
	 */
	const firstB = requests.find((one) => one.at >= t2 && one.model === "model-b");
	const aAfterB = firstB ? requests.filter((one) => one.at > firstB.at && one.model === "model-a").length : -1;
	check(
		"重试中切到 b，下一个请求就是 b，之后再没有请求坏掉的 a",
		!!firstB && aAfterB === 0 && firstB.at - t2 < 2000,
		`按下确认后：${afterSwitch.join(", ")}；b 在 ${firstB ? firstB.at - t2 : "?"}ms 后发出，b 之后的 a：${aAfterB} 个`,
	);
	const answeredNow = (await mainText()).match(/PROBE-OK 这一句是 (\S+) 回答的/)?.[1] ?? "(没有回答)";
	check("不用停止、不用编辑，这一轮直接由 b 答完", answeredNow === "model-b", `回答来自 ${answeredNow}`);
	/*
	 * 重连那一行是「过程」，一轮说完就跟工具调用一起收进「思考了一会儿」里（`grouping.ts` 的
	 * `isProcess`）。先点开再读——不点开，读到的空是折叠，不是没画。
	 */
	await press("main button", "思考了一会儿");
	await pause(600);
	const hiccupLine = await app.evaluate<string>(`([...document.querySelectorAll("[data-hiccup]")].map((el) => el.innerText).join(" | "))`);
	check("重连那一行如实写「换成 Model B」，不说恢复", hiccupLine.includes("Model B") && !hiccupLine.includes("恢复"), hiccupLine);
	await shot("02-切到b之后.png");

	// 3. 按停止，然后编辑那条消息、打勾重发。
	await press('main button[aria-label="停止"]');
	await pause(1500);
	const t3 = Date.now();
	await hover("[data-question-index]");
	const editing = await press('[data-question-index] button[aria-label="编辑并重新发送"]');
	await pause(600);
	await shot("03-编辑框.png");
	const sent = await press('[data-question-index] button[aria-label="发送"]');
	for (let i = 0; i < 40 && since(t3).length === 0; i++) await pause(250);
	await pause(1500);
	steps.push({ step: `3. 停止 → 编辑（${editing ? "打开了" : "没打开"}）→ 打勾重发（${sent ? "按下了" : "没按到"}）`, saw: since(t3) });
	check("之后编辑重发，发给的也是 b", editing && sent && since(t3).length > 0 && since(t3).every((one) => one === "model-b"), since(t3).join(", "));
	await shot("04-编辑重发之后.png");

	const text = await app.evaluate<string>(`(document.querySelector("main")?.innerText ?? "")`);
	const answeredBy = text.match(/PROBE-OK 这一句是 (\S+) 回答的/)?.[1] ?? "(没有回答)";

	console.log("\n服务器看到的：");
	for (const one of steps) console.log(`  ${one.step}：${one.saw.join(", ") || "(没有请求)"}`);
	console.log(`  界面上的回答来自：${answeredBy}`);

	const passed = checks.filter((one) => one.ok).length;
	console.log(`\n${passed}/${checks.length} 通过`);
	if (passed !== checks.length) process.exitCode = 1;
	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	await writeFile(join(out, `edit-resend-probe-${stamp}-${passed}of${checks.length}.json`), JSON.stringify({ checks, steps, answeredBy, requests }, null, 2));
	filming.on = false;
	await film;
	const video = join(out, `编辑重发模型-真窗口-${stamp}-${passed}of${checks.length}.mp4`);
	await encode(frames, video, 30, 1500);
	console.log(`  → ${frames.length} 帧 → ${video}`);
} finally {
	filming.on = false;
	grab.close();
	await app.stop();
	await closeListeningServer(server);
}
