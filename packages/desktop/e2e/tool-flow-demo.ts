/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 一轮工具活在真窗口里怎么长出来、跑完之后停在哪儿——边验边录。
 *
 * 模型是本地一个按剧本吐 SSE 的假服务：先说一句、列目录，想一下再读文件、搜索，然后改一处、跑一条
 * 命令，最后给出回答。每块之间留够停顿，好让录像看得清一行一行地冒出来。
 *
 * 用法：node --experimental-strip-types e2e/tool-flow-demo.ts [标签] [输出目录]
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const LABEL = process.argv[2] ?? "after";
const OUT_DIR = process.argv[3] ?? join(homedir(), "Desktop", "Lyra工具调用交互测试");
const PORT = 9491;
const MODEL_PORT = 9591;
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

type Block = { tool: string; args: Record<string, unknown> } | { text: string } | { thinking: string };

const SCRIPT: Block[][] = [
	[{ text: "先看一下项目结构。" }, { tool: "ls", args: { path: "." } }, { tool: "glob", args: { pattern: "**/*.ts" } }],
	[{ thinking: "目录很小，入口应该就是 src/one.ts，读一下再搜引用。" }, { tool: "read", args: { path: "src/one.ts" } }, { tool: "grep", args: { pattern: "one" } }],
	[
		{ tool: "edit", args: { path: "src/one.ts", old_string: "export const one = 1", new_string: "export const one = 2" } },
		{ tool: "bash", args: { command: "sleep 3 && echo toolcheck-complete" } },
	],
	[{ text: "已经改好了：" }, { text: "`src/one.ts` 里的常量从 1 改成了 2，" }, { text: "命令也跑通了。" }],
];
const BLOCK_DELAY_MS = 900;

function sse(res: ServerResponse, payload: { type: string }): void {
	res.write(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function startModel(): Server {
	let request = 0;
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", async () => {
			// The session-title request carries no tools; answering it from the script would eat a step.
			const titling = !body.includes('"tools"');
			const at = Math.min(request, SCRIPT.length - 1);
			const blocks: Block[] = titling ? [{ text: "工具调用演示" }] : SCRIPT[at];
			if (!titling) request++;
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			sse(res, { type: "message_start", message: { id: `msg_${request}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } } as never);
			for (const [index, block] of blocks.entries()) {
				await pause(BLOCK_DELAY_MS);
				if ("text" in block) {
					sse(res, { type: "content_block_start", index, content_block: { type: "text", text: "" } } as never);
					sse(res, { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } } as never);
				} else if ("thinking" in block) {
					sse(res, { type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } } as never);
					sse(res, { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } } as never);
					sse(res, { type: "content_block_delta", index, delta: { type: "signature_delta", signature: "sig" } } as never);
				} else {
					sse(res, { type: "content_block_start", index, content_block: { type: "tool_use", id: `call_${request}_${index}`, name: block.tool, input: {} } } as never);
					sse(res, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.args) } } as never);
				}
				sse(res, { type: "content_block_stop", index } as never);
			}
			const stop = blocks.some((b) => "tool" in b) ? "tool_use" : "end_turn";
			sse(res, { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 40 } } as never);
			sse(res, { type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(join(project, "src"), { recursive: true });
	await writeFile(join(project, "src", "one.ts"), "export const one = 1\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1180, height: 860, x: 0, y: 0 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1,
		providers: [{
			id: "local", name: "Local", baseUrl: `http://127.0.0.1:${MODEL_PORT}`, api: "anthropic-messages", apiKey: "not-a-key", enabled: true,
			models: [{ id: "local/scripted", providerId: "local", modelId: "scripted", name: "Scripted", contextWindow: 200000, maxOutputTokens: 8192, supportsThinking: false, supportsImages: false, supportsTools: true }],
		}],
		mcpServers: [],
		projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
		defaultModelId: "local/scripted",
		permissionMode: "full",
		thinking: "off",
		retryAttempts: 1,
		hooks: [],
		scheduledTasks: [],
		disabledPlugins: [],
		alwaysAllow: [],
	}));
}

const checks: { ok: boolean; what: string }[] = [];
function check(what: string, ok: boolean, saw: unknown) {
	checks.push({ ok, what });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${JSON.stringify(saw)}`}`);
}

let app: RunningApp | undefined;
const model = startModel();
const frames: Frame[] = [];
let shot = 0;

try {
	await mkdir(OUT_DIR, { recursive: true });
	app = await startApp({ port: PORT, seed });
	const d = driver(app);
	const capture = async (name: string) => {
		const { data } = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		await writeFile(join(OUT_DIR, `${STAMP}_${LABEL}_${String(++shot).padStart(2, "0")}_${name}.png`), Buffer.from(data, "base64"));
	};
	const state = () => app!.evaluate<{ header: string | null; open: boolean; groupHeads: number; rows: string[]; outside: number; glides: number; rail: boolean }>(`(() => {
		const proc = document.querySelector("main [data-ly-turn-process]");
		return {
			header: proc?.querySelector(":scope > button")?.innerText?.replace(/\\s+/g, " ") ?? null,
			open: Boolean(proc?.hasAttribute("data-ly-turn-open")),
			groupHeads: document.querySelectorAll("main [data-ly-run] > button").length,
			outside: [...document.querySelectorAll("main [data-ly-tool], main [data-ly-thinking]")].filter((row) => !row.closest("[data-ly-process-rail]")).length,
			rows: [...document.querySelectorAll("main [data-ly-tool]")].map((row) => row.innerText.replace(/\\s+/g, " ").trim()),
			glides: document.querySelectorAll("main .ly-glide").length,
			rail: Boolean(proc?.querySelector("[data-ly-process-rail]") && getComputedStyle(proc.querySelector("[data-ly-process-rail]")).borderLeftWidth !== "0px"),
		};
	})()`);

	await d.until(`document.querySelector("main textarea")`, 60000);
	const stop = await startRecording(PORT, frames);
	await pause(800);
	await d.type("把 one 改成 2，顺便跑一下命令确认");
	await pause(400);
	await d.submit();

	// 第二批工具出来之后、那条命令还在跑的时候，是「正在跑」最完整的样子。
	// 按剧本算，提交后约 8 秒那条 `sleep 3` 正在跑。
	await pause(8000);
	const running = await state();
	console.log("运行中：", running);
	await capture("运行中");
	check("跑的时候就有本轮过程那一行，正在跑的那一行在扫光", Boolean(running.header) && running.open && running.glides > 0, running);
	check("工具不再套一层分组行", running.groupHeads === 0, running.groupHeads);
	check("每个工具各占一行", running.rows.length >= 4, running.rows);
	check("过程挂在左边那条竖线下面，一行都没漏在外面", running.rail && running.outside === 0, running);
	check("标题行把思考和各类工具都算进去了", /思考 1 次/.test(running.header ?? "") && /读取文件/.test(running.header ?? ""), running.header);

	await d.settled(60000);
	await pause(1200);
	const done = await state();
	console.log("跑完：", done);
	await capture("跑完");
	check("跑完之后刚看着的那一轮不自己收起来", done.open, done);
	check("跑完之后没有东西还在扫光", done.glides === 0, done.glides);
	check("工具行说的是中文，和标题行一个说法", done.rows.some((row) => row.startsWith("读取文件")), done.rows);

	// 点开改动那一行，看细节里的红绿 diff。
	await app.evaluate(`(() => { const row = [...document.querySelectorAll("main [data-ly-tool]")].find((r) => r.innerText.includes("one.ts") && /\\+1/.test(r.innerText)); row?.querySelector("button")?.setAttribute("data-demo-edit", ""); })()`);
	await d.click("[data-demo-edit]").catch(() => {});
	await pause(900);
	const detail = await app.evaluate<{ expanded: string | null; diff: boolean }>(`(() => { const b = document.querySelector("[data-demo-edit]"); const row = b?.closest("[data-ly-tool]"); return { expanded: b?.getAttribute("aria-expanded") ?? null, diff: Boolean(row && /export const one = 2/.test(row.innerText)) }; })()`);
	await capture("展开改动");
	check("点开改动那一行能看到 diff", detail.expanded === "true" && detail.diff, detail);

	// 收起整轮过程。
	await d.click(`main [data-ly-turn-process] > button`);
	await pause(900);
	const folded = await state();
	await capture("收起过程");
	check("点本轮过程那一行能收起来", !folded.open, folded);
	await pause(800);

	// 设置 › 外观 › 调用链：切到「展开」，回到对话看它换回原来的排法，再切回来。
	const openAppearance = () => app!.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const hit = (text) => { const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text); el?.click(); return Boolean(el); };
		if (!hit("外观")) { document.querySelector("[data-ly-open-settings]")?.click(); await wait(1300); if (!hit("外观")) return false; }
		await wait(1000);
		return true;
	})()`);
	const pick = (label: string) => app!.evaluate<boolean>(`(async () => {
		const row = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent?.trim() === "调用链")?.closest("div:has(button)");
		row?.scrollIntoView({ block: "center" });
		await new Promise((r) => setTimeout(r, 500));
		const button = [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === ${JSON.stringify(label)});
		button?.click();
		await new Promise((r) => setTimeout(r, 700));
		return Boolean(button);
	})()`);
	const back = () => app!.evaluate(`(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("返回工作区"))?.click(); await new Promise((r) => setTimeout(r, 1500)); })()`);
	const layoutNow = () => app!.evaluate<{ chain: string | undefined; groupHeads: number; rows: number; chevrons: number }>(`(() => ({
		chain: document.documentElement.dataset.callChain,
		groupHeads: document.querySelectorAll("main [data-ly-run] > button").length,
		rows: document.querySelectorAll("main [data-ly-tool]").length,
		chevrons: [...document.querySelectorAll("main .ly-flow-chevron")].filter((c) => c.checkVisibility()).length,
	}))()`);

	check("设置里找得到外观页", await openAppearance(), "no 外观");
	const picked = await pick("展开");
	await capture("设置_调用链_展开");
	check("调用链那一行能选「展开」", picked, picked);
	await back();
	await app.evaluate(`(() => { const b = document.querySelector("main [data-ly-turn-process] > button"); if (b && b.getAttribute("aria-expanded") === "false") b.click(); })()`);
	await pause(900);
	const expanded = await layoutNow();
	console.log("展开：", expanded);
	await capture("展开_原来的样子");
	check("展开：回到工具组那一行、没有展开箭头", expanded.chain === "expanded" && expanded.groupHeads > 0 && expanded.chevrons === 0, expanded);

	// 打开最后那一组，量组那一行到第一张卡、卡与卡之间的距离——应该都是 10px。
	await app.evaluate(`(() => { const heads = document.querySelectorAll("main [data-ly-run] > button"); heads[heads.length - 1]?.click(); })()`);
	await pause(900);
	const gaps = await app.evaluate<{ head: number | null; between: number[] }>(`(() => {
		const runs = document.querySelectorAll("main [data-ly-run]");
		const run = runs[runs.length - 1];
		const head = run?.querySelector(":scope > button")?.getBoundingClientRect();
		const cards = [...(run?.querySelectorAll("[data-ly-tool]") ?? [])].map((c) => c.getBoundingClientRect());
		return { head: head && cards[0] ? Math.round((cards[0].top - head.bottom) * 10) / 10 : null, between: cards.slice(1).map((c, i) => Math.round((c.top - cards[i].bottom) * 10) / 10) };
	})()`);
	console.log("组内间距：", gaps);
	await capture("展开_组内间距");
	check("展开：组那一行和第一张卡之间留 10px，和卡与卡之间一样", gaps.head === 10 && gaps.between.every((g) => g === 10), gaps);

	await openAppearance();
	await pick("折叠");
	await back();
	await pause(900);
	const collapsed = await layoutNow();
	console.log("折叠：", collapsed);
	await capture("折叠_现在的样子");
	check("折叠：每次调用各占一行、没有工具组", collapsed.chain === "collapsed" && collapsed.groupHeads === 0 && collapsed.rows >= 6, collapsed);
	await pause(800);
	await stop();

	const passed = checks.filter((c) => c.ok).length;
	await encode(frames, join(OUT_DIR, `${STAMP}_${LABEL}_工具调用交互_${passed}of${checks.length}.mp4`));
	console.log(`\n${passed}/${checks.length} 通过，输出在 ${OUT_DIR}`);
	if (passed !== checks.length) process.exitCode = 1;
} finally {
	await app?.stop();
	await closeListeningServer(model);
}
