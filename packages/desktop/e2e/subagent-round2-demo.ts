/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 二轮改版，录一段给人看，边演边验：
 *
 *   一、贴一个文件进主输入框，输入框上沿不再平白高一截；
 *   二、派三个子智能体：输入框上方叠成一摞、点开一张单子；面板顶上同一个切换器，上下键能走；
 *   三、在子智能体的操控框里附文件、说一句：气泡里是那句话和一枚标签，不是整篇正文；
 *   四、三份「回报给主 Agent」：结论开头、发现一条一条、报告直接展开，不再有挤成四个字一行的表格；
 *   五、只派一个的时候：顶上没有下拉；
 *   六、侧边聊天：PDF 抽得出字、上方只摆图片、正在答的时候回车是排队、工具调用收成一行。
 *
 * 模型是假的：按「谁在问」回不同剧本的 Anthropic 流式服务。子智能体每一步慢一点，好让「在跑」
 * 停留得够久；它们用 `yield` 交回声明过的结构化对象，回报卡片画的就是那个对象。
 *
 * 用法：node --experimental-strip-types e2e/subagent-round2-demo.ts [输出目录]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { encode, frameGrabber, pause, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra智能体界面测试");
const PORT = 9644;
const STEP_MS = 2600;
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

let app: RunningApp;
const checks: { ok: boolean; what: string }[] = [];
function check(what: string, ok: boolean, saw = "") {
	checks.push({ ok, what });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

/** 每个请求是谁发的、说了什么——验「侧边聊天读到了 PDF 里的字」这类只在模型那头看得见的事。 */
const heard: { who: string; text: string }[] = [];

type Part = { type: string; text?: string; content?: unknown };

function reply(res: ServerResponse, r: { text?: string; tools?: { name: string; input: Record<string, unknown> }[] }): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: "m", type: "message", role: "assistant", content: [], model: "scripted", stop_reason: null, usage: { input_tokens: 1800, output_tokens: 0 } } });
	const tools = r.tools ?? [];
	let index = 0;
	if (r.text) {
		emit("content_block_start", { index, content_block: { type: "text", text: "" } });
		emit("content_block_delta", { index, delta: { type: "text_delta", text: r.text } });
		emit("content_block_stop", { index });
		index += 1;
	}
	for (const tool of tools) {
		emit("content_block_start", { index, content_block: { type: "tool_use", id: `t${Math.random().toString(36).slice(2, 10)}`, name: tool.name, input: {} } });
		emit("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } });
		emit("content_block_stop", { index });
		index += 1;
	}
	emit("message_delta", { delta: { stop_reason: tools.length > 0 ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 120 } });
	emit("message_stop", {});
	res.end();
}

const REVIEW = {
	summary: "看了 `src/auth` 下的登录流程：令牌刷新和错误处理各有一处实打实的缺陷，另有一处命名问题。",
	findings: [
		{ severity: "low", file: "src/auth/names.ts:8", problem: "`uid` 和 `userId` 混用，读代码的人会以为是两个东西。", failure: "新人按 `uid` 去查，找不到写入 `userId` 的那一处。" },
		{ severity: "high", file: "src/auth/session.ts:42", problem: "会话令牌过期后没有刷新，用户会在操作到一半时被静默登出，未保存的编辑随之丢失。", failure: "令牌 TTL 到期后的第一个请求返回 401，拦截器只清掉登录态，不重放请求。" },
		{ severity: "medium", file: "src/auth/login.ts:117", problem: "登录失败时 `catch` 里什么都不做，界面一直停在「登录中」。", failure: "断网时点登录：请求抛出 `TypeError: Failed to fetch`，按钮永远转圈。" },
	],
};

const EXPLORE = {
	summary: "登录入口是 `src/auth/login.ts` 的 `signIn`，由登录页和「会话过期」弹窗两处调用。",
	files: [
		{ path: "src/auth/login.ts:12-48", why: "`signIn`：表单提交、调接口、写会话，入口就在这里。" },
		{ path: "src/pages/Login.tsx:30", why: "登录页提交时调用 `signIn`。" },
		{ path: "src/auth/expired.tsx:21", why: "会话过期弹窗里的「重新登录」也走 `signIn`。" },
	],
	report: "## 调用链\n\n1. 登录页 `Login.tsx` 提交表单 → `signIn(credentials)`\n2. `signIn` 调 `/api/session`，成功后写 `sessionStore`\n3. 过期弹窗复用同一个 `signIn`，**没有**单独的刷新路径\n\n> 按你补充的，也看了 session 那一块：刷新逻辑确实缺失，见审查那份的第一条。",
};

const PLAN = {
	steps: [
		{ what: "给会话存储加一层接口，内存实现和 SQLite 实现并存。", files: ["src/store/session.ts", "src/store/memory.ts"] },
		{ what: "写迁移脚本：启动时把内存快照导进 SQLite，导完打个版本号。", files: ["scripts/migrate-sessions.ts"] },
		{ what: "切换默认实现，保留内存实现做回退，观察一个版本后删掉。", files: ["src/store/index.ts"] },
	],
	risks: ["迁移中途退出会留下半截数据：先写临时表，完成后再原子改名。", "SQLite 在网络盘上的锁行为不可靠。"],
	unknowns: ["线上最大会话有多大？决定要不要分批导入。"],
};

const model = createServer((req, res) => {
	let raw = "";
	req.on("data", (chunk) => (raw += chunk));
	req.on("end", () => {
		const body = JSON.parse(raw) as { system?: string | { text?: string }[]; messages?: { role: string; content: unknown }[]; tools?: { name: string }[] };
		const system = typeof body.system === "string" ? body.system : (body.system ?? []).map((b) => b.text ?? "").join("\n");
		const tools = new Set((body.tools ?? []).map((tool) => tool.name));
		const messages = body.messages ?? [];
		const parts = (m: { content: unknown }) => (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]) as Part[];
		/*
		 * 最后一句「有内容的」话：运行时在末尾接了一块 `<env>` 日期（`prompt/environment.ts`），它每一轮都在，
		 * 不算数。往回找到的第一块要么是工具结果（它在等我收尾），要么是人说的话（它在等我开工）。
		 */
		const meaningful = messages.flatMap(parts).filter((p) => !(p.type === "text" && (p.text ?? "").trimStart().startsWith("<env>")));
		const lastPart = meaningful[meaningful.length - 1];
		const answered = lastPart?.type === "tool_result";
		const lastUser = [...messages].reverse().find((m) => m.role === "user" && parts(m).some((p) => p.type === "text" && !(p.text ?? "").trimStart().startsWith("<env>")));
		const lastText = lastUser ? parts(lastUser).filter((p) => p.type === "text" && !(p.text ?? "").trimStart().startsWith("<env>")).map((p) => p.text ?? "").join("\n") : "";
		const allText = messages.flatMap(parts).filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
		const results = messages.flatMap(parts).filter((p) => p.type === "tool_result").length;

		if (tools.has("read_main_chat")) {
			heard.push({ who: "side", text: allText });
			if (lastText.includes("SIDE-TOOLS") && !answered) {
				setTimeout(() => reply(res, { text: "我先翻一下主聊天。", tools: ["登录", "迁移", "审查"].map((query) => ({ name: "read_main_chat", input: { query } })) }), 600);
				return;
			}
			if (answered) {
				setTimeout(() => reply(res, { text: "主聊天里一共派了三件事：审查登录模块、找登录入口、规划存储迁移。审查那份最要紧的是令牌过期不刷新。" }), STEP_MS);
				return;
			}
			const pdf = /Hello PDF/.test(lastText) ? " · 读到了 PDF 里的字「Hello PDF」" : "";
			setTimeout(() => reply(res, { text: `收到：${lastText.replace(/\s+/g, " ").slice(0, 28)}${pdf}` }), STEP_MS);
			return;
		}

		if (tools.has("yield")) {
			const who = system.includes("code review agent") ? "review" : system.includes("read-only exploration agent") ? "explore" : "plan";
			heard.push({ who, text: allText });
			const short = allText.includes("EXPLORE-SHORT");
			/*
			 * 找入口的那个一直干到有人跟它说话为止（最多十几步）：演示要在它还在跑的时候去操控框里附文件、
			 * 说一句。每一步的参数都不一样——同样的参数连着调，运行时会当它原地打转。
			 */
			const long = who === "explore" && !short;
			const busy = long ? !allText.includes("STEER") && results < 16 : results < 1;
			const later = (fn: () => void) => setTimeout(fn, STEP_MS);
			if (busy || (long && results < 3)) {
				const step =
					who === "plan" ? { name: "ls", input: { path: "." } }
					: results === 0 ? { name: "read", input: { path: "README.md" } }
					: results === 1 ? { name: "read", input: { path: "Hello.cs" } }
					: { name: "grep", input: { pattern: `signIn${results}`, path: "." } };
				later(() => reply(res, { text: results === 0 ? "先看看目录和入口。" : "", tools: [step] }));
				return;
			}
			if (who === "review") later(() => reply(res, { tools: [{ name: "yield", input: REVIEW }] }));
			else if (who === "plan") later(() => reply(res, { tools: [{ name: "yield", input: PLAN }] }));
			else if (short) later(() => reply(res, { tools: [{ name: "yield", input: { summary: "配置从 `~/.lyra/settings.json` 读，项目里的 `.lyra/config.json` 覆盖它。", files: [{ path: "src/config/settings.ts:994", why: "合并全局与项目配置的地方。" }] } }] }));
			else later(() => reply(res, { tools: [{ name: "yield", input: EXPLORE }] }));
			return;
		}

		heard.push({ who: "main", text: lastText });
		if (answered) {
			reply(res, { text: "都回来了：登录入口在 `src/auth/login.ts`，审查发现令牌过期不刷新，迁移分三步走。" });
			return;
		}
		if (lastText.includes("ROUND2-MULTI")) {
			reply(res, {
				text: "分三路去查。",
				tools: [
					{ name: "task", input: { description: "审一遍登录模块", prompt: "审查 src/auth 下的登录流程，只报具体缺陷。", subagent_type: "review" } },
					{ name: "task", input: { description: "找出登录入口和调用链", prompt: "EXPLORE-LONG 找到登录入口在哪、被谁调用。", subagent_type: "explore" } },
					{ name: "task", input: { description: "规划会话存储迁移", prompt: "规划把会话从内存迁到 SQLite 的步骤，不要动代码。", subagent_type: "plan" } },
				],
			});
			return;
		}
		if (lastText.includes("ROUND2-SINGLE")) {
			reply(res, { tools: [{ name: "task", input: { description: "单独查一下配置加载", prompt: "EXPLORE-SHORT 找配置从哪儿读。", subagent_type: "explore" } }] });
			return;
		}
		reply(res, { text: "好的。" });
	});
});

/** 一份最小的 PDF：一页、一行字。pdf.js 抽得出「Hello PDF」就说明走的是抽字，而不是当文本读成乱码。 */
function tinyPdf(): string {
	const stream = "BT /F1 18 Tf 20 100 Td (Hello PDF) Tj ET";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, "latin1").toString("base64");
}

/** 一张 2×2 的 PNG，够当一张截图贴进去。 */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEIGBmgAC4AAEYHAgAqRyGQAAAAAElFTkSuQmCC";

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
	const address = model.address();
	if (!address || typeof address === "string") throw new Error("model server did not start");
	app = await startApp({
		port: PORT,
		scaleFactor: 2,
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			Object.assign(settings, {
				autoSummarizeTitle: false,
				permissionMode: "full",
				thinking: "off",
				retryAttempts: 0,
				subAgentDelegation: "eager",
				maxConcurrentSubAgents: 2,
				appearance: { theme: process.env.THEME ?? "light" },
			});
			await writeFile(path, JSON.stringify(settings));
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1320, height: 860, x: 0, y: 0 }));
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
	let pointer = { x: 660, y: 420 };
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
			await pause(35);
		}
	};
	/** 把文件贴进一个输入框——和人按 ⌘V 走的是同一个 `paste` 事件。 */
	const paste = (selector: string, files: { name: string; type: string; base64?: string; text?: string }[]) =>
		$<number>(`(()=>{const f=document.querySelector(${JSON.stringify(selector)});f.focus();const dt=new DataTransfer();for(const spec of ${JSON.stringify(files)}){const bytes=spec.base64?Uint8Array.from(atob(spec.base64),c=>c.charCodeAt(0)):new TextEncoder().encode(spec.text);dt.items.add(new File([bytes],spec.name,{type:spec.type}));}f.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));return dt.files.length;})()`);
	const clearField = (selector: string) => $(`(()=>{const f=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(f,'');f.dispatchEvent(new Event('input',{bubbles:true}));})()`);
	const still = async (name: string) => {
		await writeFile(join(OUT_DIR, `${STAMP}_二轮_改后_${name}.png`), Buffer.from((await grab.send<{ data: string }>("Page.captureScreenshot", { format: "png" })).data, "base64"));
	};
	const mark = async (selector: string, attr: string) => {
		await $(`(()=>{document.querySelector('[${attr}]')?.removeAttribute('${attr}');const e=${selector};if(e)e.setAttribute('${attr}','');return Boolean(e);})()`);
	};

	const MAIN = "main textarea";
	const SUB = '[data-dock-pane="subagents"]';
	const SIDE = '[data-dock-pane="chat"]';

	try {
		console.log("【一】贴一个文件进主输入框：上沿不动");
		await pause(700);
		await click('[data-ly-row="qa-short"]');
		await until(`document.querySelector(${JSON.stringify(MAIN)})`);
		await click(MAIN);
		await pause(500);
		const top = () => $<number>(`document.querySelector(${JSON.stringify(MAIN)}).closest('.ly-composer').getBoundingClientRect().top`);
		const before = await top();
		await paste(MAIN, [{ name: "release-notes.zip", type: "application/zip", base64: "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==" }]);
		await until(`document.querySelector('[data-command-mirror] .ly-attachment-token')`);
		await pause(900);
		const after = await top();
		check(`贴进一个压缩包：输入框上沿不动（${before.toFixed(1)} → ${after.toFixed(1)}）`, Math.abs(after - before) < 0.5, `${before} → ${after}`);
		await still("01_贴入文件后");
		await paste(MAIN, [{ name: "shot.png", type: "image/png", base64: PNG }]);
		await until(`document.querySelector('main [data-ly-composer-attachments][data-open="true"]')`);
		await pause(900);
		check("贴进一张图：上方那一排才展开", (await top()) < after - 20, String(await top()));
		await clearField(MAIN);
		await until(`document.querySelector('main [data-ly-composer-attachments][data-open="false"]')`);
		await pause(500);

		console.log("\n【二】派三个：叠成一摞，点开一张单子");
		await click(MAIN);
		await typeText("ROUND2-MULTI 分头查一下登录、入口和迁移");
		await key("Enter", 13);
		await until(`document.querySelectorAll('[data-ly-subagent-bar] [data-avatar-pile] .ly-avatar').length >= 3`, 20000);
		await until(`[...document.querySelectorAll('[data-ly-subagent-bar] [data-avatar-pile] .ly-avatar')].filter(a=>a.dataset.mood==='working').length >= 2`, 20000);
		await pause(900);
		await glide(await centre("[data-ly-subagent-bar] [data-avatar-pile]"), 600);
		await pause(1200);
		const pile = await $<{ faces: number; text: string; popup: string | null }>(`(()=>{const b=document.querySelector('[data-ly-subagent-bar]');return {faces:b.querySelectorAll('[data-pile-face]').length,text:b.textContent,popup:b.getAttribute('aria-haspopup')};})()`);
		check("输入框上方：三张脸叠成一摞", pile.faces === 3, String(pile.faces));
		check("说清楚了几个在跑、几个在排队", /2 个子 Agent 运行中/.test(pile.text) && /1 个排队中/.test(pile.text), pile.text);
		check("不止一个：点它是一张下拉单", pile.popup === "menu", String(pile.popup));
		await still("02_多个子智能体_输入框上方");
		await click("[data-ly-subagent-bar]");
		await until(`document.querySelectorAll('[data-sub-menu] [data-sub-row]').length === 3 && document.querySelectorAll('[data-sub-menu] [data-sub-queued]').length === 1`);
		await pause(1100);
		const menu = await $<{ rows: string[]; overflow: boolean }>(`(()=>{const m=document.querySelector('[data-sub-menu]');const r=m.getBoundingClientRect();return {rows:[...m.querySelectorAll('[data-sub-row]')].map(e=>e.innerText.replace(/\\s+/g,' ')),overflow:r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight};})()`);
		check("单子上每一行：谁、在干什么、多久", menu.rows.length === 3 && menu.rows.every((row) => /@(review|explore|plan)/.test(row)), JSON.stringify(menu.rows));
		check("单子整个在窗口里，不被裁掉", !menu.overflow);
		await still("03_输入框上方的下拉单");
		await key("ArrowDown", 40);
		await pause(500);
		await key("ArrowDown", 40);
		await pause(500);
		await mark(`[...document.querySelectorAll('[data-sub-menu] [data-sub-row]')].find(r=>/找出登录入口/.test(r.textContent))?.querySelector('[role=menuitem]')`, "data-demo-pick");
		await click("[data-demo-pick]");
		await until(`!document.querySelector('[data-sub-menu]') && /找出登录入口/.test(document.querySelector('${SUB} [data-sub-title]')?.textContent ?? '')`);
		check("点一行，面板翻到它那一页", true);
		await pause(1200);

		console.log("\n【三】面板顶上的切换器");
		const header = await $<{ faces: number; title: string; meta: string; height: number }>(`(()=>{const h=document.querySelector('${SUB} [data-sub-header]');return {faces:h.querySelectorAll('[data-pile-face]').length,title:h.querySelector('[data-sub-title]').textContent,meta:h.querySelector('[data-sub-meta]').textContent,height:h.getBoundingClientRect().height};})()`);
		check("面板顶上也是一摞脸，正在看的在最上面", header.faces >= 3, String(header.faces));
		check(`一行半就说完：标题 + 读数（${Math.round(header.height)}px 高）`, header.height < 56 && /@explore/.test(header.meta), JSON.stringify(header));
		await still("04_面板切换器");
		await click(`${SUB} [data-sub-switch]`);
		await until(`document.querySelector('[data-sub-menu]')`);
		await pause(1000);
		await still("05_面板里的下拉单");
		await key("Escape", 27);
		await until(`!document.querySelector('[data-sub-menu]')`);

		console.log("\n【四】在操控框里附文件、说一句");
		const steerField = `${SUB} textarea`;
		await until(`document.querySelector(${JSON.stringify(steerField)}) && !document.querySelector(${JSON.stringify(steerField)}).disabled`);
		await click(steerField);
		await paste(steerField, [
			{ name: "session.md", type: "text/markdown", text: "# 会话\n\n会话令牌 30 分钟过期，刷新靠拦截器。\n" },
			{ name: "shot.png", type: "image/png", base64: PNG },
		]);
		await until(`document.querySelectorAll('${SUB} [data-command-mirror] .ly-attachment-token').length === 2`);
		await pause(700);
		const steerStrip = await $<{ tiles: number }>(`({tiles:document.querySelectorAll('${SUB} [data-ly-attachment]').length})`);
		check("操控框上方只摆图片，文件在句子里那枚标签上", steerStrip.tiles === 1, String(steerStrip.tiles));
		await typeText(" STEER 顺便看看 session 那一块的刷新逻辑");
		await pause(500);
		await still("06_操控框里附了文件");
		await key("Enter", 13);
		await until(`document.querySelector('${SUB} [data-spoken-bubble]')`);
		await pause(900);
		const bubble = await $<string>(`document.querySelector('${SUB} [data-spoken-bubble]').innerText`);
		check("气泡里是那句话和标签，不是整篇文件", /STEER/.test(bubble) && !bubble.includes("30 分钟过期") && !bubble.includes("Attached file"), bubble);
		check("开头那份任务是一张卡片，不是人发的气泡", await $<boolean>(`Boolean(document.querySelector('${SUB} [data-sub-brief]'))`));
		await still("07_纠偏气泡与任务卡片");

		console.log("\n【五】三份回报");
		// 看对话里那一行的三张脸：输入框上方那一条在主智能体收尾之后会自己收起，不一定还在。
		await until(`(()=>{const m=[...document.querySelectorAll('main [data-ly-run] [data-avatar-stack] .ly-avatar')].map(a=>a.dataset.mood);return m.length===3&&m.every(x=>x==='done');})()`, STEP_MS * 14);
		await pause(800);
		const seenBrief = heard.some((one) => one.who === "explore" && one.text.includes("STEER"));
		check("那句话真的到了子智能体手里", seenBrief);
		for (const [pick, name, file] of [["审一遍登录模块", "审查", "08_回报_审查"], ["找出登录入口", "探索", "09_回报_探索"], ["规划会话存储迁移", "规划", "10_回报_规划"]] as const) {
			await click(`${SUB} [data-sub-switch]`);
			await until(`document.querySelector('[data-sub-menu]')`);
			await mark(`[...document.querySelectorAll('[data-sub-menu] [data-sub-row]')].find(r=>r.textContent.includes(${JSON.stringify(pick)}))?.querySelector('[role=menuitem]')`, "data-demo-pick");
			await click("[data-demo-pick]");
			await until(`(document.querySelector('${SUB} [data-sub-title]')?.textContent ?? '').includes(${JSON.stringify(pick)}) && document.querySelector('${SUB} [data-sub-report]')`);
			await $(`document.querySelector('${SUB} [data-sub-report]').scrollIntoView({block:'start'})`);
			await pause(1300);
			const report = await $<{ text: string; tables: number; width: number }>(`(()=>{const r=document.querySelector('${SUB} [data-sub-report]');return {text:r.innerText,tables:r.querySelectorAll('table').length,width:r.getBoundingClientRect().width};})()`);
			check(`${name}：没有表格，内容只画一遍`, report.tables === 0 && !/severity:|problem:|why:/.test(report.text), report.text.slice(0, 200));
			if (name === "审查") {
				const order = await $<string[]>(`[...document.querySelectorAll('${SUB} [data-sub-report] [data-item-severity]')].map(e=>e.textContent)`);
				check("审查：最重的在最上面，严重度写成人话", order.join() === "高,中,低", order.join());
				const widths = await $<number[]>(`[...document.querySelectorAll('${SUB} [data-sub-report] [data-item-text]')].slice(0,1).map(p=>p.getBoundingClientRect().width)`);
				check(`审查：问题那句话占满一行（${Math.round(widths[0] ?? 0)}px / 卡片 ${Math.round(report.width)}px）`, (widths[0] ?? 0) > report.width * 0.7, String(widths));
			}
			await still(file);
		}

		console.log("\n【六】只派一个的时候");
		// 三份都交了、主智能体也收尾了：那一条自己收起来，不用再去点叉。
		await until(`!document.querySelector('[data-ly-subagent-bar]') || document.querySelector('[data-ly-subagent-bar]').closest('.ly-reveal')?.dataset.open === 'false'`, STEP_MS * 6);
		await click(MAIN);
		await typeText("ROUND2-SINGLE 看看配置怎么加载");
		await key("Enter", 13);
		await until(`document.querySelector('[data-ly-subagent-bar]') && document.querySelector('${SUB} [data-sub-header]')`, 20000);
		await pause(1200);
		const single = await $<{ popup: string | null; pile: number; switcher: number }>(`({popup:document.querySelector('[data-ly-subagent-bar]').getAttribute('aria-haspopup'),pile:document.querySelectorAll('[data-ly-subagent-bar] [data-avatar-pile]').length,switcher:document.querySelectorAll('${SUB} [data-sub-switch]').length})`);
		check("只有一个：没有下拉、没有叠脸", single.popup === null && single.pile === 0 && single.switcher === 0, JSON.stringify(single));
		await still("11_只派一个");
		await until(`/1 个子 Agent 已结束|已完成/.test(document.querySelector('[data-ly-subagent-bar]')?.textContent ?? '') || document.querySelector('${SUB} [data-sub-report]')`, STEP_MS * 6);

		console.log("\n【七】侧边聊天：PDF、只摆图片、排队、工具成组");
		await click('button[aria-label="面板"]');
		await mark(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.checkVisibility()&&e.textContent.trim().startsWith('侧边聊天'))`, "data-demo-side");
		await click("[data-demo-side]");
		const sideField = `${SIDE} textarea`;
		await until(`document.querySelector(${JSON.stringify(sideField)}) && !document.querySelector(${JSON.stringify(sideField)}).disabled`);
		await click(sideField);
		await paste(sideField, [
			{ name: "合同.pdf", type: "application/pdf", base64: tinyPdf() },
			{ name: "shot.png", type: "image/png", base64: PNG },
		]);
		await until(`document.querySelectorAll('${SIDE} [data-command-mirror] .ly-attachment-token').length === 2`);
		await pause(700);
		check("侧边聊天上方只摆图片", (await $<number>(`document.querySelectorAll('${SIDE} [data-ly-attachment]').length`)) === 1);
		await typeText(" 这份合同说了什么");
		await key("Enter", 13);
		await until(`document.querySelector('${SIDE}').innerText.includes('Hello PDF')`, 20000);
		check("PDF 抽出了字，而不是当文本读成乱码", heard.some((one) => one.who === "side" && one.text.includes("Hello PDF")));
		await pause(800);
		await click(sideField);
		await typeText("SIDE-TOOLS 帮我翻翻主聊天派了些什么");
		await key("Enter", 13);
		await until(`document.querySelector('${SIDE} [aria-label="停止"]')`, 10000);
		await pause(400);
		await typeText("再顺便说说哪条最要紧");
		await key("Enter", 13);
		await until(`document.querySelector('${SIDE} [data-queue-row]')`, 5000);
		await pause(900);
		check("正在答的时候回车是排队，排在输入框上方", true);
		await still("12_侧边聊天排队");
		await until(`!document.querySelector('${SIDE} [data-queue-row]')`, STEP_MS * 6);
		await until(`document.querySelectorAll('${SIDE} [data-ly-run]').length >= 1`, STEP_MS * 4);
		await pause(900);
		const grouped = await $<{ runs: number; text: string }>(`(()=>{const r=[...document.querySelectorAll('${SIDE} [data-ly-run]')];return {runs:r.length,text:r.map(e=>e.innerText).join(' | ')};})()`);
		check("三次工具调用收成一行", grouped.runs === 1 && /3/.test(grouped.text), JSON.stringify(grouped));
		await until(`document.querySelector('${SIDE}').innerText.includes('哪条最要紧')`, STEP_MS * 6);
		check("排着的那一句，答完自己发了出去", true);
		await pause(STEP_MS + 800);
		await still("13_侧边聊天工具成组");
		await pause(1200);
	} catch (error) {
		// 等不到的时候，模型那头收到了什么、窗口上画着什么——不看这两样，只能靠猜。
		console.log("\n模型收到的：", JSON.stringify(heard.map((one) => `${one.who}: ${one.text.replace(/\s+/g, " ").slice(-120)}`), null, 1));
		console.log("窗口上：", await $<string>(`(document.querySelector('main')?.innerText ?? '').slice(-600)`).catch(() => "(读不到)"));
		throw error;
	} finally {
		camera.rolling = false;
		await film;
		grab.close();
		const passed = checks.filter((one) => one.ok).length;
		const out = join(OUT_DIR, `${STAMP}_二轮_子智能体切换与回报与输入框统一_${passed}of${checks.length}.mp4`);
		console.log(`\n采到 ${frames.length} 帧，合成到 ${out}`);
		await encode(frames, out, 30, 1500);
		await app.stop();
		await closeListeningServer(model);
		console.log(`\n${passed}/${checks.length} 条通过`);
		if (passed !== checks.length) process.exitCode = 1;
	}
}

await main();
