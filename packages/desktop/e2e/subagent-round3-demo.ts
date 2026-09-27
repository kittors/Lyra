/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 三轮：主智能体和子智能体的协同，在真窗口里从头走一遍，边演边验。
 *
 *   一、一次派四个、闸门只放两个：条上两个在跑两个排队，单子里说出闸门多宽、旁边就是调整；任务清单
 *      和那一条之间只隔一道窄缝；
 *   二、主智能体在等子智能体时人插话：消息直接送进去（不排队），主智能体当场回答，子智能体在后台接着跑；
 *   三、后台跑完：结果送回来，对话里一行「结果已交回」，主智能体合并成一份结论；这一轮收尾，那一条自己收起；
 *   四、子智能体要写文件：主窗口的授权卡上是它的脸和「谁在请求」，条上写着「等你授权」；
 *   五、子智能体撞上检查点（定义里 max-turns: 3）：没写清单就再给一段，列出清单后接着跑完，不是「阶段性交接」；
 *   六、每个请求都带着缓存键：主会话一个、每个子智能体各一个，从头到尾不变。
 *
 * 模型是假的，说的是 OpenAI Responses 协议——用户自己那个中转站走的就是这一条，缓存键正是在这条链上
 * 出发的。按「谁在问」回不同剧本：主会话手里有 `task`，审查者有 `yield`，写文件的是 general。
 *
 * 用法：node --experimental-strip-types e2e/subagent-round3-demo.ts [输出目录]
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { encode, frameGrabber, pause, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra智能体界面测试");
const PORT = 9645;
const STEP_MS = 1500;
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

let app: RunningApp;
let home = "";
const checks: { ok: boolean; what: string }[] = [];
function check(what: string, ok: boolean, saw = "") {
	checks.push({ ok, what });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

/** 每个请求：谁发的、带的缓存键（头和请求体各一份）、最后一句话。 */
const heard: { who: string; header?: string; key?: string; text: string; tools: string[]; instructions: string }[] = [];
/** 审查者什么时候可以交差——演示在「插话」之后才放它们走。 */
let reviewsMayFinish = false;

type Item = { type?: string; role?: string; content?: { type: string; text?: string }[]; call_id?: string; name?: string; arguments?: string; output?: string };

function sse(res: ServerResponse, reply: { text?: string; calls?: { name: string; args: Record<string, unknown> }[] }) {
	res.writeHead(200, { "content-type": "text/event-stream" });
	const emit = (data: Record<string, unknown>) => res.write(`event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`);
	let index = 0;
	if (reply.text) {
		const id = `msg_${Math.random().toString(36).slice(2, 8)}`;
		emit({ type: "response.output_item.added", output_index: index, item: { type: "message", id } });
		emit({ type: "response.output_text.delta", output_index: index, delta: reply.text });
		emit({ type: "response.output_item.done", output_index: index, item: { type: "message", id } });
		index += 1;
	}
	for (const call of reply.calls ?? []) {
		const id = `fc_${Math.random().toString(36).slice(2, 8)}`;
		const callId = `call_${Math.random().toString(36).slice(2, 10)}`;
		const args = JSON.stringify(call.args);
		emit({ type: "response.output_item.added", output_index: index, item: { type: "function_call", id, call_id: callId, name: call.name } });
		emit({ type: "response.function_call_arguments.delta", output_index: index, delta: args });
		emit({ type: "response.output_item.done", output_index: index, item: { type: "function_call", id, call_id: callId, name: call.name, arguments: args } });
		index += 1;
	}
	emit({ type: "response.completed", response: { id: `resp_${Math.random().toString(36).slice(2, 8)}`, usage: { input_tokens: 2400, output_tokens: 160, input_tokens_details: { cached_tokens: 1800 } } } });
	res.end();
}

const REVIEW = {
	summary: "看了这一块的改动：一处实打实的缺陷，一处风险。",
	findings: [
		{ severity: "high", file: "src/composer/useDraft.ts:50", problem: "切换对象时闭包里还是上一个的草稿，会把 A 的内容存到 B 的键下。", failure: "在两个子智能体之间快速切换，第二个的草稿被第一个覆盖。" },
		{ severity: "medium", file: "src/store/subAgents.ts:208", problem: "父子关系成环时递归构建不设防。", failure: "一条坏记录的 parentId 指回自己，面板在递归里爆栈。" },
	],
};

const model = createServer((req: IncomingMessage, res: ServerResponse) => {
	let raw = "";
	req.on("data", (chunk) => (raw += chunk));
	req.on("end", () => {
		const body = JSON.parse(raw) as { input?: Item[]; tools?: { name: string }[]; instructions?: string; prompt_cache_key?: string };
		const input = body.input ?? [];
		const tools = (body.tools ?? []).map((tool) => tool.name);
		const instructions = body.instructions ?? "";
		const header = typeof req.headers.session_id === "string" ? req.headers.session_id : undefined;
		const userTexts = input
			.filter((item) => item.role === "user")
			.map((item) => (item.content ?? []).map((part) => part.text ?? "").join(""))
			.filter((text) => !text.trimStart().startsWith("<env>"));
		const last = userTexts.at(-1) ?? "";
		const lastUserAt = input.findLastIndex((item) => item.role === "user" && !(item.content ?? []).some((part) => (part.text ?? "").trimStart().startsWith("<env>")));
		const outputsSince = input.slice(lastUserAt + 1).filter((item) => item.type === "function_call_output").length;
		const who = tools.includes("task") ? "main" : tools.includes("yield") && instructions.includes("code review agent") ? "review" : instructions.includes("仔细的调查员") ? "slowpoke" : tools.length > 0 ? "general" : "aside";
		heard.push({ who, header, key: body.prompt_cache_key, text: last, tools, instructions });
		const later = (reply: Parameters<typeof sse>[1], ms = STEP_MS) => setTimeout(() => sse(res, reply), ms);

		if (who === "aside") return later({ text: "{}" }, 50);

		if (who === "main") {
			if (last.startsWith("（运行时送达）")) {
				/*
				 * 送达可能分两批（闸门两个两个放）：先到的说一句「先回来几路」，四路齐了再勾清单、合并。
				 * 勾完清单那一轮的结果回来之后只说结论——同一个调用再发一遍，运行时会当它原地打转。
				 */
				const returned = userTexts.join("\n").split("<subagent_result").length - 1;
				if (returned < 4) return later({ text: `先回来 ${returned} 路，剩下的还在跑，回来一起合并。` }, 500);
				if (outputsSince === 0) {
					return later({
						text: "四路都回来了，合并一下。",
						calls: [{ name: "todo_write", args: { todos: [{ content: "派四路审查", status: "completed" }, { content: "等结果", status: "completed" }, { content: "合并结论", status: "completed" }] } }],
					}, 500);
				}
				return later({ text: "## 审查结论\n\n**useDraft.ts:50** 切换对象时会串写草稿（高），**subAgents.ts:208** 的树构建缺环路防护（中）。另外两路没有新发现。" }, 500);
			}
			if (last.includes("R3-INTERRUPT")) return later({ text: "先回答你：1+1 等于 2。审查还在后台跑，结果回来我再合并。" }, 700);
			if (last.includes("R3-PARALLEL")) {
				if (outputsSince > 0) return later({ text: "四路都回来了。" }, 400);
				return later({
					text: "分四路审查，互不依赖，一起派出去。",
					calls: [
						{ name: "todo_write", args: { todos: [{ content: "派四路审查", status: "completed" }, { content: "等结果", status: "in_progress" }, { content: "合并结论", status: "pending" }] } },
						...["架构与边界", "并发与状态", "界面与文案", "测试质量"].map((what) => ({
							name: "task",
							args: { description: `审查：${what}`, prompt: `只读审查新增代码的${what}，只报具体缺陷。`, subagent_type: "review" },
						})),
					],
				}, 600);
			}
			if (last.includes("R3-WRITE")) {
				if (outputsSince > 0) return later({ text: "写好了：`NOTES.md`。" }, 400);
				return later({ calls: [{ name: "task", args: { description: "写 NOTES", prompt: "把 NOTES.md 写好：一句话说明这个项目。", subagent_type: "general" } }] }, 600);
			}
			if (last.includes("R3-CHECKPOINT")) {
				if (outputsSince > 0) return later({ text: "慢慢查完了。" }, 400);
				return later({ calls: [{ name: "task", args: { description: "慢慢查入口", prompt: "把入口和调用链慢慢查清楚。", subagent_type: "slowpoke" } }] }, 600);
			}
			return later({ text: "好的。" }, 400);
		}

		if (who === "review") {
			const results = input.filter((item) => item.type === "function_call_output").length;
			// 每一轮两个读取一起发——这正是工作说明里要它做的。
			if (!reviewsMayFinish || results < 4) {
				const n = results;
				// 每一步参数都不一样：同样的调用连着来，运行时会当它原地打转。
				return later({ calls: [{ name: "read", args: { path: "README.md", limit: 40 + n } }, { name: "grep", args: { pattern: `draft${n}`, path: "." } }] });
			}
			return later({ calls: [{ name: "yield", args: REVIEW }] });
		}

		if (who === "general") {
			if (outputsSince > 0 || input.some((item) => item.type === "function_call_output")) return later({ text: "写好了 NOTES.md。" }, 400);
			return later({ calls: [{ name: "write", args: { path: "NOTES.md", content: "# 笔记\n\n这是一个用来验证子智能体协同的项目。\n" } }] }, 600);
		}

		// slowpoke：前三轮只读、不写清单；读到宽限那句话之后列清单，再跑两轮收尾。
		const results = input.filter((item) => item.type === "function_call_output").length;
		const graced = userTexts.some((text) => text.includes("（自动追加）这一段的 3 轮用完了"));
		if (!graced) return later({ calls: [{ name: "grep", args: { pattern: `entry${results}`, path: "." } }] }, 900);
		const since = input.slice(input.findLastIndex((item) => item.role === "user" && (item.content ?? []).some((part) => (part.text ?? "").includes("（自动追加）"))) + 1).filter((item) => item.type === "function_call_output").length;
		if (since === 0) {
			return later({
				calls: [
					{ name: "todo_write", args: { todos: [{ content: "找到入口", status: "completed" }, { content: "理清调用链", status: "in_progress" }] } },
					{ name: "grep", args: { pattern: "callers", path: "." } },
				],
			}, 900);
		}
		return later({ text: "入口在 `README.md` 描述的那个脚本里；调用链两层，没有回环。" }, 900);
	});
});

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
	const address = model.address();
	if (!address || typeof address === "string") throw new Error("model server did not start");
	app = await startApp({
		port: PORT,
		scaleFactor: 2,
		seed: async (seedHome) => {
			home = seedHome;
			await seedInteractions(seedHome, address.port);
			const path = join(seedHome, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			Object.assign(settings, {
				providers: [
					{
						id: "qa",
						name: "隔离测试模型（Responses）",
						api: "openai-responses",
						baseUrl: `http://127.0.0.1:${address.port}`,
						apiKey: "test",
						enabled: true,
						models: [{ id: "qa/model", providerId: "qa", modelId: "model", name: "QA", contextWindow: 128000, maxOutputTokens: 4096, supportsImages: true, supportsTools: true, supportsThinking: false }],
					},
				],
				autoSummarizeTitle: false,
				permissionMode: "ask",
				thinking: "off",
				retryAttempts: 0,
				subAgentDelegation: "eager",
				maxConcurrentSubAgents: 2,
				appearance: { theme: process.env.THEME ?? "light" },
			});
			await writeFile(path, JSON.stringify(settings));
			await writeFile(join(seedHome, "window.json"), JSON.stringify({ width: 1200, height: 860, x: 0, y: 0 }));
			// 一个自己写的子智能体：每 3 轮检查一次——演示检查点上的宽限。
			await mkdir(join(seedHome, "project", ".lyra", "agents"), { recursive: true });
			await writeFile(
				join(seedHome, "project", ".lyra", "agents", "slowpoke.md"),
				"---\nname: slowpoke\ndescription: 慢慢查的调查员\ntools: [read, grep, ls]\nmax-turns: 3\navatar: cloud-violet\n---\n你是一个仔细的调查员，一步一步查。\n",
			);
		},
	});
	await app.send("Page.bringToFront");
	const grab = await frameGrabber(PORT);
	const frames: Frame[] = [];
	const camera = { rolling: true };
	const film = (async () => {
		while (camera.rolling) frames.push({ at: Date.now(), data: await grab.shot() });
	})();

	const $ = <T>(expression: string) => grab.evaluate<T>(expression);
	const until = async (expression: string, ms = 30000) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (await $<boolean>(`Boolean(${expression})`)) return;
			await pause(120);
		}
		throw new Error(`等不到：${expression}`);
	};
	const centre = (selector: string) => $<{ x: number; y: number }>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	let pointer = { x: 600, y: 420 };
	const glide = async (to: { x: number; y: number }, ms = 420) => {
		const steps = Math.max(6, Math.round(ms / 30));
		const from = pointer;
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			const ease = 1 - (1 - t) ** 3;
			pointer = { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease };
			await grab.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...pointer });
			await pause(ms / steps);
		}
	};
	const click = async (selector: string) => {
		await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
		await glide(await centre(selector));
		for (const type of ["mousePressed", "mouseReleased"]) await grab.send("Input.dispatchMouseEvent", { type, ...pointer, button: "left", clickCount: 1 });
		await pause(140);
	};
	const key = async (name: string, code: number) => {
		await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, windowsVirtualKeyCode: code, ...(name === "Enter" ? { text: "\r" } : {}) });
		await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, windowsVirtualKeyCode: code });
	};
	const typeText = async (text: string) => {
		for (const ch of text) {
			await grab.send("Input.insertText", { text: ch });
			await pause(28);
		}
	};
	const still = async (name: string) => {
		await writeFile(join(OUT_DIR, `${STAMP}_三轮_${name}.png`), Buffer.from((await grab.send<{ data: string }>("Page.captureScreenshot", { format: "png" })).data, "base64"));
	};
	const mark = async (selector: string, attr: string) => {
		await $(`(()=>{document.querySelector('[${attr}]')?.removeAttribute('${attr}');const e=${selector};if(e)e.setAttribute('${attr}','');return Boolean(e);})()`);
	};
	const barText = () => $<string>(`document.querySelector('[data-ly-subagent-bar]')?.textContent ?? ''`);
	const mainText = () => $<string>(`document.querySelector('main')?.innerText ?? ''`);

	const MAIN = "main textarea";
	const SUB = '[data-dock-pane="subagents"]';

	try {
		console.log("【一】一次派四个、闸门只放两个");
		await pause(700);
		await click('[data-ly-row="qa-short"]');
		await until(`document.querySelector(${JSON.stringify(MAIN)})`);
		await click(MAIN);
		await typeText("R3-PARALLEL 分四路审查新增代码");
		await key("Enter", 13);
		await until(`document.querySelectorAll('[data-ly-subagent-bar] [data-pile-face]').length >= 4 || /4/.test(document.querySelector('[data-ly-subagent-bar]')?.textContent ?? '')`, 20000);
		await until(`/2 个子 Agent 运行中/.test(document.querySelector('[data-ly-subagent-bar]')?.textContent ?? '')`, 20000);
		await pause(900);
		const bar = await barText();
		check("条上：两个在跑、两个排队（四个一起派出去了）", /2 个子 Agent 运行中/.test(bar) && /2 个排队中/.test(bar), bar);
		const firstMain = heard.find((one) => one.who === "main" && one.text.includes("R3-PARALLEL"));
		check("主会话的提示词叫它一起派，而不是一轮一个", Boolean(firstMain?.instructions.includes("同一条回复里一起派")), firstMain?.instructions.slice(0, 80) ?? "");
		await click("[data-ly-subagent-bar]");
		await until(`document.querySelector('[data-sub-menu]')`);
		await pause(800);
		const cap = await $<{ text: string; clipped: boolean }>(`(()=>{const e=document.querySelector('[data-sub-menu-cap]');const s=e?.querySelector('span');return {text:e?.textContent??'',clipped:s?s.scrollWidth>s.clientWidth+1:true};})()`);
		check("单子底下说出闸门多宽，旁边就是调整，整句不被截断", /同时最多跑 2 个/.test(cap.text) && /调整/.test(cap.text) && !cap.clipped, JSON.stringify(cap));
		check("排着的两个也在单子上", (await $<number>(`document.querySelectorAll('[data-sub-menu] [data-sub-queued]').length`)) === 2);
		await still("01_四个一起派_两个排队");
		await key("Escape", 27);
		await until(`!document.querySelector('[data-sub-menu]')`);
		await pause(400);
		// 指针还停在那一条上：一摞脸是「松开」的样子，最后一张也不能压到旁边的字。
		await glide(await centre("[data-ly-subagent-bar] [data-avatar-pile]"), 300);
		await pause(500);
		const overlap = await $<{ coin: number; text: number }>(`(()=>{const coins=[...document.querySelectorAll('[data-ly-subagent-bar] .ly-avatar-coin')];const text=document.querySelector('[data-ly-subagent-bar] [data-avatar-pile]').nextElementSibling;return {coin:Math.max(...coins.map(c=>c.getBoundingClientRect().right)),text:text.getBoundingClientRect().left};})()`);
		check(`指针停在一摞脸上：松开之后最后一张也不压字（脸到 ${overlap.coin.toFixed(1)}，字从 ${overlap.text.toFixed(1)} 起）`, overlap.coin <= overlap.text, JSON.stringify(overlap));
		await still("02a_悬停时一摞脸不压字");
		const gap = await $<{ card: number | null; bar: number | null; chips: number | null }>(`(()=>{const c=document.querySelector('[data-ly-task-list="inline"]');const b=document.querySelector('[data-ly-subagent-bar]')?.parentElement;const bottomBar=b?.getBoundingClientRect();return {card:c?c.getBoundingClientRect().bottom:null,bar:bottomBar?bottomBar.top:null,chips:bottomBar?bottomBar.bottom:null};})()`);
		if (gap.card !== null && gap.bar !== null) {
			const between = gap.bar - gap.card;
			check(`任务清单和子智能体那一条之间只隔一道窄缝（${between.toFixed(1)}px）`, between > 2 && between <= 8.5, JSON.stringify(gap));
			await still("02_清单与状态条之间");
		} else check("任务清单卡片内嵌在输入框上方（窄栏）", false, JSON.stringify(gap));

		console.log("\n【二】主智能体在等子智能体时插话");
		await click(MAIN);
		await typeText("R3-INTERRUPT 先回答我：1+1 等于几？");
		const sentAt = Date.now();
		await key("Enter", 13);
		await pause(250);
		const queuedRow = await $<number>(`document.querySelectorAll('main [data-queue-row]').length`);
		check("消息直接送进去，没有在输入框上方排队", queuedRow === 0, String(queuedRow));
		await until(`(document.querySelector('main')?.innerText ?? '').includes('1+1 等于 2')`, 15000);
		const answeredIn = Date.now() - sentAt;
		const stillRunning = await barText();
		check(`主智能体当场回答（${(answeredIn / 1000).toFixed(1)}s），没等子智能体`, answeredIn < 8000, String(answeredIn));
		check("回答的时候子智能体还在后台跑", /运行中|排队中/.test(stillRunning), stillRunning);
		const toldDetached = heard.some((one) => one.who === "main" && one.text.includes("R3-INTERRUPT"));
		check("主智能体读到了人插的那句话", toldDetached);
		await pause(900);
		await still("03_插话当场回答_子智能体在后台");

		console.log("\n【三】后台跑完：送回来、合并、那一条收起");
		reviewsMayFinish = true;
		await until(`document.querySelector('[data-delivery-row]')`, 60000);
		await until(`(document.querySelector('main')?.innerText ?? '').includes('审查结论')`, 60000);
		const delivery = heard.find((one) => one.who === "main" && one.text.startsWith("（运行时送达）"));
		check("主智能体收到的是一份送达：结果原文 + 合并成一份的要求", Boolean(delivery && delivery.text.includes("<subagent_result") && delivery.text.includes("合并成一份")), delivery?.text.slice(0, 160) ?? "");
		const rowText = await $<string>(`[...document.querySelectorAll('[data-delivery-row]')].map(e=>e.innerText).join(' | ')`);
		check("对话里一行「结果已交回」，不是一个人发的气泡", /结果已交回/.test(rowText), rowText);
		await pause(600);
		await $(`document.querySelector('[data-delivery-row]')?.scrollIntoView({block:'center'})`);
		await pause(900);
		await still("04_结果送回_合并结论");
		await until(`!document.querySelector('[data-ly-subagent-bar]') || document.querySelector('[data-ly-subagent-bar]').closest('.ly-reveal')?.dataset.open === 'false'`, 30000);
		check("都结束了、这一轮收尾：输入框上方那一条自己收起来", true);
		await pause(1200);
		await still("05_状态条自动收起");

		console.log("\n【四】子智能体要写文件：授权卡说清是谁");
		await click(MAIN);
		await typeText("R3-WRITE 让一个子智能体把 NOTES.md 写好");
		await key("Enter", 13);
		await until(`document.querySelector('[data-approval-from]')`, 20000);
		await pause(900);
		const from = await $<string>(`document.querySelector('[data-approval-from]')?.textContent ?? ''`);
		check("授权卡上写着是哪个子智能体在请求", /子 Agent「写 NOTES」在请求 · @general/.test(from), from);
		check("卡上是它的脸，不是那枚警告图标", await $<boolean>(`Boolean(document.querySelector('[data-approval-card] .ly-avatar'))`));
		const asking = await barText();
		check("条上写着「等你授权」", /等你授权/.test(asking), asking);
		await still("06_子智能体请求授权");
		await mark(`[...document.querySelectorAll('[data-approval-card] button')].find(b=>b.textContent.includes('允许一次'))`, "data-demo-allow");
		await click("[data-demo-allow]");
		await until(`(document.querySelector('main')?.innerText ?? '').includes('写好了')`, 20000);
		const wrote = await access(join(home, "project", "NOTES.md")).then(() => true, () => false);
		check("点了允许，子智能体真的把文件写了", wrote);
		await pause(900);

		console.log("\n【五】检查点：没写清单就再给一段");
		await click(MAIN);
		await typeText("R3-CHECKPOINT 让 slowpoke 慢慢查一遍入口");
		await key("Enter", 13);
		await until(`(document.querySelector('main')?.innerText ?? '').includes('慢慢查完了')`, 60000);
		const slow = heard.filter((one) => one.who === "slowpoke");
		check("自己写的只读子智能体手里也有清单工具", slow.length > 0 && slow[0].tools.includes("todo_write") && !slow[0].tools.includes("write"), slow[0]?.tools.join(",") ?? "");
		check("撞上检查点时它读到了宽限那句话", slow.some((one) => one.text.includes("（自动追加）这一段的 3 轮用完了")), slow.map((one) => one.text.slice(0, 30)).join(" / "));
		await click(`${SUB} [data-sub-switch]`).catch(() => {});
		await pause(400);
		await mark(`[...document.querySelectorAll('[data-sub-menu] [data-sub-row]')].find(r=>r.textContent.includes('慢慢查入口'))?.querySelector('[role=menuitem]')`, "data-demo-pick");
		if (await $<boolean>(`Boolean(document.querySelector('[data-demo-pick]'))`)) await click("[data-demo-pick]");
		await until(`(document.querySelector('${SUB}')?.innerText ?? '').includes('慢慢查入口')`, 10000).catch(() => {});
		await pause(900);
		const pane = await $<string>(`document.querySelector('${SUB}')?.innerText ?? ''`);
		check("交回的是完整结论，不是「阶段性交接」", !/阶段性交接|到了检查点/.test(pane) && /调用链两层/.test(pane), pane.slice(-300));
		await still("07_检查点宽限后跑完");

		console.log("\n【六】缓存键");
		const mains = heard.filter((one) => one.who === "main");
		const mainKeys = new Set(mains.map((one) => one.key));
		check(`主会话 ${mains.length} 个请求都带着同一个键，头和请求体一致`, mainKeys.size === 1 && !mainKeys.has(undefined) && mains.every((one) => one.header === one.key), JSON.stringify([...mainKeys]));
		const subs = heard.filter((one) => one.who === "review" || one.who === "general" || one.who === "slowpoke");
		const subKeys = new Set(subs.map((one) => one.key));
		check(`子智能体各用各的键（${subKeys.size} 个），都不是主会话那个`, subKeys.size === 6 && ![...subKeys].some((one) => mainKeys.has(one)) && subs.every((one) => one.header === one.key && one.key), JSON.stringify([...subKeys]));
		const reviewsPerKey = new Map<string, number>();
		for (const one of heard.filter((each) => each.who === "review")) reviewsPerKey.set(one.key ?? "", (reviewsPerKey.get(one.key ?? "") ?? 0) + 1);
		check("同一个子智能体从头到尾一个键", [...reviewsPerKey.values()].every((n) => n >= 3), JSON.stringify([...reviewsPerKey.entries()]));
		check("审查者每一轮都把两个读取一起发", heard.some((one) => one.who === "review" && one.instructions.includes("放在同一条回复里一起发出去")));
		await pause(1200);
	} catch (error) {
		console.log("\n模型收到的：", JSON.stringify(heard.map((one) => `${one.who}[${one.key?.slice(-8) ?? "-"}]: ${one.text.replace(/\s+/g, " ").slice(0, 80)}`), null, 1));
		console.log("窗口上：", await mainText().then((text) => text.slice(-900)).catch(() => "(读不到)"));
		throw error;
	} finally {
		camera.rolling = false;
		await film;
		grab.close();
		const passed = checks.filter((one) => one.ok).length;
		const out = join(OUT_DIR, `${STAMP}_三轮_并行排队_插话秒回_送达合并_授权署名_检查点_缓存键_${passed}of${checks.length}.mp4`);
		console.log(`\n采到 ${frames.length} 帧，合成到 ${out}`);
		await encode(frames, out, 30, 1500);
		await app.stop();
		await closeListeningServer(model);
		console.log(`\n${passed}/${checks.length} 条通过`);
		if (passed !== checks.length) process.exitCode = 1;
	}
}

await main();
