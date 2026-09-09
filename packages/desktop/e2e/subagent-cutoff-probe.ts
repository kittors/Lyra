/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 一个中途断掉的子代理，在真窗口里走完整条链。
 *
 * 单测证明 `runSubAgent` 把结束原因带出来了，但那是在 core 里。这条链还有三段没人看过：结局
 * 有没有原样穿过 IPC 到名册、面板会不会在「失败」时把它已经做出来的东西画出来、以及父会话
 * 到底读到了什么——最后这一条是用户真正抱怨的那件事（四个子代理跑完，一份报告都没有）。
 *
 * 模型是假的：explore 的第一轮正常说话并读文件，第二轮起一律 500。主会话那边照常。
 *
 * 用法：node --experimental-strip-types e2e/subagent-cutoff-probe.ts [输出目录]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { closeListeningServer, startApp } from "./app.ts";

const out = process.argv[2] ?? join(process.env.HOME ?? "/tmp", "Desktop", "lyra-子代理中断");
const MODEL_PORT = 9874;
const CDP_PORT = 9498;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** explore 收到的请求数：第一轮正常回，之后全部 500。 */
let exploreCalls = 0;

function sse(res: ServerResponse, events: [string, unknown][]): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
	res.end();
}

function reply(res: ServerResponse, r: { text?: string; tool?: { name: string; input: Record<string, unknown> } }): void {
	const id = `t${Math.random().toString(36).slice(2, 8)}`;
	const blocks: [string, unknown][] = r.tool
		? [
				["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
				["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: r.text ?? "" } }],
				["content_block_stop", { type: "content_block_stop", index: 0 }],
				["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id, name: r.tool.name, input: {} } }],
				["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(r.tool.input) } }],
				["content_block_stop", { type: "content_block_stop", index: 1 }],
			]
		: [
				["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
				["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: r.text } }],
				["content_block_stop", { type: "content_block_stop", index: 0 }],
			];
	sse(res, [
		["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", content: [], model: "scripted", stop_reason: null, usage: { input_tokens: 500, output_tokens: 0 } } }],
		...blocks,
		["message_delta", { type: "message_delta", delta: { stop_reason: r.tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } }],
		["message_stop", { type: "message_stop" }],
	]);
}

function startModel(): Server {
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const body = JSON.parse(raw) as { system?: string | { text?: string }[]; messages?: { content: unknown }[] };
			const system = typeof body.system === "string" ? body.system : (body.system ?? []).map((b) => b.text ?? "").join("\n");
			const parts = (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }])) as { type: string; text?: string }[];
			const answered = parts.some((c) => c.type === "tool_result");
			// 只读探索那份提示词是 explore 自己的；剩下的就是主会话。
			const who = system.includes("read-only exploration agent") ? "explore" : "main";

			if (who === "explore") {
				exploreCalls += 1;
				if (exploreCalls === 1) {
					reply(res, { text: "读完了 auth.ts，登录入口在第 1 行。", tool: { name: "read", input: { path: "auth.ts" } } });
					return;
				}
				// 上游塌了，而且一直塌着——这一档不该被子代理自己悄悄咽掉。
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { type: "api_error", message: "upstream exploded" } }));
				return;
			}

			if (!answered) {
				reply(res, { text: "我派一个 explore 去看。", tool: { name: "task", input: { description: "找登录入口", prompt: "找登录入口在哪", subagent_type: "explore" } } });
				return;
			}
			reply(res, { text: "子代理那边的情况我看到了，见上面。" });
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "auth.ts"), "export const login = 1\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
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
					models: [
						{
							id: "local/scripted",
							providerId: "local",
							modelId: "scripted",
							name: "Scripted",
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: false,
							supportsImages: false,
							supportsTools: true,
						},
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			autoSummarizeTitle: false,
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 0,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4525, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

const model = startModel();
const app = await startApp({ port: CDP_PORT, seed });

async function shot(name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, name), Buffer.from(data, "base64"));
	console.log(`  → ${name}`);
}

const transcript = () => app.evaluate<string>(`(document.querySelector("main")?.innerText ?? "")`);

async function until(text: string, tries = 100): Promise<boolean> {
	for (let index = 0; index < tries; index++) {
		if ((await transcript()).includes(text)) return true;
		await pause(250);
	}
	return false;
}

try {
	await mkdir(out, { recursive: true });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	await pause(1200);

	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		if (!field) throw new Error("找不到输入框");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "PROBE-ASK 找一下登录入口");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	})()`);

	const landed = await until("子代理那边的情况我看到了");
	console.log(`\n主会话跑完：${landed ? "是" : "否（超时）"}，explore 收到 ${exploreCalls} 次请求`);
	await pause(800);
	await shot("01-主会话.png");

	/*
	 * 父代理读到的那一段——就是 task 工具的结果，藏在那张折叠的卡片里。
	 *
	 * 卡片默认是收着的（父代理读到的东西不该占满整屏），所以先点开再读。
	 */
	await app.evaluate(`(() => {
		const card = [...document.querySelectorAll("button")].find((b) => (b.innerText ?? "").includes("派发子任务"));
		if (card) card.click();
	})()`);
	await pause(700);
	const parentSaw = await app.evaluate<string>(`(() => {
		const text = document.querySelector("main")?.innerText ?? "";
		const at = text.indexOf("\\u6a21\\u578b\\u670d\\u52a1\\u51fa\\u9519");
		return at === -1 ? "(卡片里没有那段说明)" : text.slice(Math.max(0, at - 4), at + 200);
	})()`);
	console.log(`\n父代理读到的：\n${parentSaw}\n`);

	// 名册与面板：状态、报告、重新派发。
	await app.evaluate(`(() => {
		const bar = [...document.querySelectorAll("button")].find((b) => (b.innerText ?? "").includes("子 Agent 已结束") || (b.innerText ?? "").includes("找登录入口"));
		if (bar) bar.click();
	})()`);
	await pause(1200);
	await shot("02-子代理面板.png");

	const pane = await app.evaluate<{ dot: string; body: string; head: string; hasRedispatch: boolean }>(`(() => {
		const report = [...document.querySelectorAll("p, div")].reverse().find((el) => (el.innerText ?? "").startsWith("\\u6a21\\u578b\\u670d\\u52a1\\u51fa\\u9519") || (el.innerText ?? "").includes("\\u26a0 \\u6a21\\u578b\\u670d\\u52a1"));
		const text = report ? report.innerText.trim() : "";
		const dotEl = document.querySelector('[class*="bg-danger"], [class*="bg-ok"]');
		return {
			// 状态点的颜色就是状态：红 = 失败。文字状态只在悬停的提示里。
			dot: dotEl ? (dotEl.className.match(/bg-(danger|ok|ink-faint)/) ?? ["(没读到)"])[0] : "(没有状态点)",
			// 头几个码位：\`⚠\` 是 U+26A0，画不出来的话这里看得见它到底在不在。
			head: [...text.slice(0, 3)].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase()).join(" "),
			body: text.slice(0, 160) || "(面板上没有那段说明)",
			hasRedispatch: [...document.querySelectorAll("button")].some((b) => (b.innerText ?? "").includes("\\u91cd\\u65b0\\u6d3e\\u53d1")),
		};
	})()`);
	console.log("面板上：");
	console.log(`  状态点：${pane.dot}`);
	console.log(`  重新派发按钮：${pane.hasRedispatch ? "在" : "不在"}`);
	console.log(`  开头三个码位：${pane.head}`);
	console.log(`  内容：\n${pane.body}\n`);
} finally {
	await app.stop();
	await closeListeningServer(model);
}
