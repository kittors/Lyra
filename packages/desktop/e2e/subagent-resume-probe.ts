/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 子代理跑到检查点、交接、再被续上——在真窗口里走完整条链。
 *
 * 单测证明了 core 这一侧：交接、留上下文、同一个 id 续跑、续跑的请求原样接在旧历史后面。这里看
 * 那几段单测够不着的：名单穿过 IPC 之后还认不认得「可以接着跑」、面板上有没有那个出路、点下去
 * 草稿里带没带 id、主 Agent 按草稿续跑时名单上是不是还是那一行、子代理续上之后有没有把读过的
 * 文件再读一遍。
 *
 * 模型是假的，但走的是真适配器（anthropic-messages）：
 *   - scout（工作区里的 agent 定义，`max-turns: 3`）每轮读一个没读过的文件；只剩 `yield` 的那一轮
 *     交一份交接；被续上之后把没读的读完再给结论——它要是把读过的又读一遍，下面会查出来。
 *   - 主会话第一次派 scout；拿到检查点的结果后先停下（留出时间看面板、点按钮）；收到带 id 的那
 *     句草稿后调 `task` 的 `resume`；续跑的结果回来后收尾。
 *
 * 用法：node --experimental-strip-types e2e/subagent-resume-probe.ts [输出目录]
 * 先 build：探针跑的是 out/ 里的产物。
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { closeListeningServer, startApp } from "./app.ts";
import { encode, frameGrabber, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(process.env.HOME ?? "/tmp", "Desktop", "子代理续跑测试");
const MODEL_PORT = 9876;
const CDP_PORT = 9502;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const FILES = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
/** 主会话续跑时对 scout 说的那一句——scout 靠它认出自己是被续上的。 */
const RESUME_PROMPT = "接着把剩下的读完";

/** scout 每一次请求的样子，事后核对「续上之后有没有重读」。 */
const scoutRequests: { tools: string[]; resumed: boolean; sawResults: string[] }[] = [];
const scoutReads: string[] = [];
const mainPhases: string[] = [];

function sse(res: ServerResponse, events: [string, unknown][]): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
	res.end();
}

function reply(res: ServerResponse, r: { text?: string; tool?: { name: string; input: Record<string, unknown> } }): void {
	const id = `t${Math.random().toString(36).slice(2, 8)}`;
	const blocks: [string, unknown][] = [
		["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
		["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: r.text ?? "" } }],
		["content_block_stop", { type: "content_block_stop", index: 0 }],
		...(r.tool
			? ([
					["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id, name: r.tool.name, input: {} } }],
					["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(r.tool.input) } }],
					["content_block_stop", { type: "content_block_stop", index: 1 }],
				] as [string, unknown][])
			: []),
	];
	sse(res, [
		["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", content: [], model: "scripted", stop_reason: null, usage: { input_tokens: 500, output_tokens: 0 } } }],
		...blocks,
		["message_delta", { type: "message_delta", delta: { stop_reason: r.tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } }],
		["message_stop", { type: "message_stop" }],
	]);
}

type Block = { type: string; text?: string; content?: unknown; name?: string; input?: Record<string, unknown> };
type Turn = { role: string; content: string | Block[] };

const blocksOf = (turn: Turn): Block[] => (Array.isArray(turn.content) ? turn.content : [{ type: "text", text: turn.content }]);
const textOf = (block: Block): string =>
	block.type === "text"
		? (block.text ?? "")
		: block.type === "tool_result"
			? (Array.isArray(block.content) ? (block.content as Block[]).map((b) => b.text ?? "").join("") : String(block.content ?? ""))
			: "";

function startModel(): Server {
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const body = JSON.parse(raw) as { system?: string | { text?: string }[]; messages?: Turn[]; tools?: { name: string }[] };
			const system = typeof body.system === "string" ? body.system : (body.system ?? []).map((b) => b.text ?? "").join("\n");
			const turns = body.messages ?? [];
			const tools = (body.tools ?? []).map((tool) => tool.name);

			if (system.includes("PROBE-SCOUT")) {
				// 人（或主 Agent）说的最后一句——不是工具结果、不是日期块。
				const said = turns
					.filter((turn) => turn.role === "user")
					.flatMap(blocksOf)
					.filter((block) => block.type === "text" && !(block.text ?? "").startsWith("<env>"))
					.map(textOf);
				// 只认主会话续跑时说的那一句；讨交接那句话里也有「接着」两个字，不能算。
				const resumed = said.at(-1) === RESUME_PROMPT;
				const sawResults = turns.flatMap(blocksOf).filter((block) => block.type === "tool_result").map(textOf);
				scoutRequests.push({ tools, resumed, sawResults });

				if (tools.length === 1 && tools[0] === "yield") {
					reply(res, {
						text: "",
						tool: { name: "yield", input: { summary: `读了 ${scoutReads.join("、")}，登录入口在 a.ts:1`, remaining: "d.ts、e.ts 还没读", next: "读 d.ts 和 e.ts" } },
					});
					return;
				}
				if (resumed) {
					const next = FILES.find((file) => !scoutReads.includes(file));
					if (next) {
						scoutReads.push(next);
						reply(res, { text: `接着读 ${next}`, tool: { name: "read", input: { path: next } } });
						return;
					}
					reply(res, { text: "PROBE-SCOUT-DONE 五个文件都读完了：登录在 a.ts:1，刷新在 d.ts:1，登出在 e.ts:1。" });
					return;
				}
				const next = FILES.find((file) => !scoutReads.includes(file)) ?? "a.ts";
				scoutReads.push(next);
				reply(res, { text: `先读 ${next}`, tool: { name: "read", input: { path: next } } });
				return;
			}

			/*
			 * 不带 `task` 的那些不是这场对话：拟标题、纠正判断之类的辅助调用也打到同一个模型上。当成主会话
			 * 回它一个派活，就会把阶段记乱——单独记下来，认出是谁发的。
			 */
			if (!tools.includes("task")) {
				mainPhases.push(`aux(${system.replace(/\s+/g, " ").slice(0, 48)})`);
				reply(res, { text: "" });
				return;
			}

			// 主会话。
			const userTexts = turns.filter((turn) => turn.role === "user").flatMap(blocksOf).filter((block) => block.type === "text").map(textOf);
			const results = turns.flatMap(blocksOf).filter((block) => block.type === "tool_result").map(textOf);
			const draft = userTexts.findLast((text) => /:sub:[0-9a-f]{8}/.test(text));
			const draftId = draft?.match(/[\w-]+:sub:[0-9a-f]{8}/)?.[0];
			const resumeAnswered = results.length >= 2;

			if (results.length === 0) {
				mainPhases.push("dispatch");
				reply(res, { text: "派一个 scout 去梳理。", tool: { name: "task", input: { description: "梳理登录流程", prompt: "梳理登录流程：把五个文件都读一遍", subagent_type: "scout" } } });
				return;
			}
			if (draftId && !resumeAnswered) {
				mainPhases.push(`resume ${draftId}`);
				reply(res, { text: "按你说的，接着跑它。", tool: { name: "task", input: { description: "接着梳理", prompt: RESUME_PROMPT, resume: draftId } } });
				return;
			}
			if (resumeAnswered) {
				mainPhases.push("done");
				reply(res, { text: "PROBE-MAIN-DONE 子代理续上并做完了。" });
				return;
			}
			mainPhases.push("pause");
			reply(res, { text: "PROBE-MAIN-PAUSE 子代理停在检查点了，交接在上面。" });
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(join(project, ".lyra", "agents"), { recursive: true });
	for (const file of FILES) await writeFile(join(project, file), `export const ${file.replace(".ts", "")} = 1\n`);
	await writeFile(
		join(project, ".lyra", "agents", "scout.md"),
		"---\nname: scout\ndescription: 只读梳理\ntools: [read, ls]\nmax-turns: 3\n---\n你是只读梳理助手 PROBE-SCOUT。\n",
	);
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
			subAgentDelegation: "auto",
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
let home = "";
const app = await startApp({
	port: CDP_PORT,
	seed: async (dir) => {
		home = dir;
		await seed(dir);
	},
});

/*
 * 全程录下来：逐帧拍，不用 screencast——窗口被终端盖住时 screencast 只给第一帧（见 `record.ts`）。
 */
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

/** 名单条上说有几个子代理——「还是同一个」看这个，而不是看分页（只有一个时根本不画分页）。 */
const rosterCount = () =>
	app.evaluate<number>(`(() => {
		const label = document.querySelector("[data-ly-subagent-bar]")?.getAttribute("aria-label") ?? "";
		const n = label.match(/(\\d+)/);
		return n ? Number(n[1]) : -1;
	})()`);

const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
	checks.push({ name, ok, detail });
	console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
};

async function shot(name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, name), Buffer.from(data, "base64"));
	console.log(`  → ${name}`);
}

const mainText = () => app.evaluate<string>(`(document.querySelector("main")?.innerText ?? "")`);
async function until(probe: () => Promise<boolean>, tries = 120): Promise<boolean> {
	for (let index = 0; index < tries; index++) {
		if (await probe()) return true;
		await pause(250);
	}
	return false;
}

/** 真实鼠标：先确认落点就是那个元素，再按下去。 */
async function press(selector: string): Promise<boolean> {
	const at = await app.evaluate<{ x: number; y: number; lands: boolean } | null>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		el.scrollIntoView({ block: "center" });
		const r = el.getBoundingClientRect();
		const x = r.left + r.width / 2, y = r.top + r.height / 2;
		const hit = document.elementFromPoint(x, y);
		return { x, y, lands: !!hit && (hit === el || el.contains(hit)) };
	})()`);
	if (!at?.lands) return false;
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 });
	return true;
}

try {
	await mkdir(out, { recursive: true });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	await pause(1500);

	// 1. 派活：主会话派 scout，scout 读三个文件后到检查点、交接，主会话停下。
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		if (!field) throw new Error("找不到输入框");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "梳理一下登录流程");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	})()`);
	const paused = await until(async () => (await mainText()).includes("PROBE-MAIN-PAUSE"));
	check("主会话拿到检查点的结果后停下", paused, `主会话走过：${mainPhases.join(" → ")}`);
	await pause(800);
	await shot("01-检查点之后的主会话.png");

	// 父模型读到的那一段——task 的工具结果，从落盘的会话里读，不靠折叠卡片。
	const sessionsDir = join(home, "sessions");
	const logs: string[] = [];
	for (const dir of await readdir(sessionsDir).catch(() => [] as string[])) {
		for (const file of await readdir(join(sessionsDir, dir)).catch(() => [] as string[])) {
			if (file.endsWith(".jsonl")) logs.push(await readFile(join(sessionsDir, dir, file), "utf8"));
		}
	}
	const log = logs.join("\n");
	check("父模型被告知用 resume 续跑", /resume: \\"[\w-]+:sub:[0-9a-f]{8}\\"/.test(log), "task 结果里带着那句「传 resume」");
	check("父模型没有再被劝「拆小再派一次」", !log.includes("拆小"));
	check("第一段 scout 只读了检查点那么多轮", scoutReads.length === 3, `读了 ${scoutReads.join("、")}`);
	check("到检查点时讨了一份交接（只剩 yield 的那一轮）", scoutRequests.some((r) => r.tools.length === 1 && r.tools[0] === "yield"));

	// 2. 面板：打开名单条，看有没有「接着跑」。
	await press("[data-ly-subagent-bar]");
	await pause(1200);
	const pane = await app.evaluate<{ partial: boolean; resume: boolean; redispatch: boolean; rows: number }>(`(() => ({
		partial: (document.body.innerText ?? "").includes("\\u6ca1\\u8dd1\\u5b8c"),
		resume: !!document.querySelector("[data-sub-resume]"),
		redispatch: [...document.querySelectorAll("button")].some((b) => (b.getAttribute("aria-label") ?? "").includes("\\u91cd\\u65b0\\u6d3e\\u53d1")),
		rows: document.querySelectorAll("[data-sub-tab]").length,
	}))()`);
	check("面板标出「没跑完」", pane.partial);
	const countAtCheckpoint = await rosterCount();
	check("检查点之后名单上是一个子代理", countAtCheckpoint === 1, `名单条：${countAtCheckpoint} 个`);
	check("面板给的出路是「接着跑」", pane.resume && !pane.redispatch, `接着跑=${pane.resume} 重新派发=${pane.redispatch}`);
	await shot("02-面板上的接着跑.png");

	// 3. 点「接着跑」：草稿落进主输入框，带着 id。
	const pressed = await press("[data-sub-resume]");
	await pause(600);
	const draft = await app.evaluate<string>(`(() => {
		const fields = [...document.querySelectorAll("textarea")];
		return fields.map((f) => f.value).find((v) => v.includes(":sub:")) ?? "";
	})()`);
	check("按下「接着跑」，草稿进了主输入框并带着 id", pressed && /:sub:[0-9a-f]{8}/.test(draft), draft.slice(0, 80));
	await shot("03-草稿.png");

	// 4. 发出去：主 Agent 按草稿 resume，同一行重新跑起来、做完。
	await app.evaluate(`(() => {
		const field = [...document.querySelectorAll("textarea")].find((f) => f.value.includes(":sub:"));
		if (!field) throw new Error("找不到草稿");
		field.focus();
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	})()`);
	const done = await until(async () => (await mainText()).includes("PROBE-MAIN-DONE"));
	check("主 Agent 按草稿续跑并收尾", done, `主会话走过：${mainPhases.join(" → ")}`);
	await pause(1000);
	await press("[data-ly-subagent-bar]");
	await pause(1000);
	await shot("04-续跑做完.png");

	const firstResumed = scoutRequests.find((r) => r.resumed);
	check(
		"续上的第一个请求里带着之前读到的内容（不用重读）",
		!!firstResumed && ["a.ts", "b.ts", "c.ts"].every((file) => firstResumed.sawResults.some((text) => text.includes(file.replace(".ts", "")))),
		firstResumed ? `前面的工具结果 ${firstResumed.sawResults.length} 条` : "没有续跑请求",
	);
	const reread = scoutReads.filter((file, index) => scoutReads.indexOf(file) !== index);
	check("续上之后没有把读过的文件再读一遍", reread.length === 0, `scout 一共读了：${scoutReads.join("、")}`);
	const after = await app.evaluate<{ rows: number; partial: boolean; resume: boolean }>(`(() => ({
		rows: document.querySelectorAll("[data-sub-tab]").length,
		partial: (document.body.innerText ?? "").includes("\\u6ca1\\u8dd1\\u5b8c"),
		resume: !!document.querySelector("[data-sub-resume]"),
	}))()`);
	const countAfter = await rosterCount();
	check("续跑之后名单上还是那一个，不是又派了一个", countAfter === 1 && after.rows <= 1, `名单条：${countAfter} 个，分页 ${after.rows} 行`);
	check("做完之后不再标「没跑完」、也不再给「接着跑」", !after.partial && !after.resume);

	await pause(1200);
	const passed = checks.filter((c) => c.ok).length;
	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	filming.on = false;
	await film;
	const video = join(out, `子代理续跑-真窗口-${stamp}-${passed}of${checks.length}.mp4`);
	// 等模型的那几秒压到 1.5 秒以内，看的人不用干等；动画本身不受影响。
	await encode(frames, video, 30, 1500);
	console.log(`  → ${frames.length} 帧 → ${video}`);
	await writeFile(join(out, `window-probe-${stamp}-${passed}of${checks.length}.json`), JSON.stringify({ checks, mainPhases, scoutReads, scoutRequests: scoutRequests.map((r) => ({ tools: r.tools, resumed: r.resumed, results: r.sawResults.length })) }, null, 2));
	console.log(`\n${passed}/${checks.length} 通过`);
	if (passed !== checks.length) process.exitCode = 1;
} finally {
	filming.on = false;
	grab.close();
	await app.stop();
	await closeListeningServer(model);
}
