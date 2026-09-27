/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 智能体的脸，录一段给人看：设置页 → 新建 → 派发 → `@` 菜单 → 调度页，边演边验。
 *
 * 断言和 `agent-avatars.test.ts` 说的是同一件事，这里多的是节奏：每一步停一秒上下，让眨眼、悬停
 * 那一下果冻、排队的脸醒过来这些一闪而过的东西在录像里看得清。
 *
 * 画面用 `frameGrabber` 一帧一帧拍，不用 screencast：跑的时候终端多半盖在窗口前面，被盖住的窗口
 * 不合成，screencast 只给第一帧（见 `record.ts`）。帧打的是真实时间，动画多快，播出来就多快。
 *
 * 模型是假的（同 e2e 那个）：子智能体每一步慢一点，好让「在跑」和「在排队」都停留得够久。
 *
 * 用法：node --experimental-strip-types e2e/agent-avatars-demo.ts [输出目录]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { encode, frameGrabber, pause, type Frame } from "./record.ts";

const OUT_DIR = process.argv[2] ?? join(homedir(), "Desktop", "Lyra智能体界面测试");
const PORT = 9638;
const STEP_MS = 3500;
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

let app: RunningApp;
const checks: { ok: boolean; what: string }[] = [];
function check(what: string, ok: boolean, saw = "") {
	checks.push({ ok, what });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

function reply(res: ServerResponse, r: { text?: string; tools?: { name: string; input: Record<string, unknown> }[] }): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: "m", type: "message", role: "assistant", content: [], model: "scripted", stop_reason: null, usage: { input_tokens: 500, output_tokens: 0 } } });
	const tools = r.tools ?? [];
	if (tools.length > 0) {
		tools.forEach((tool, index) => {
			emit("content_block_start", { index, content_block: { type: "tool_use", id: `t${Math.random().toString(36).slice(2, 10)}`, name: tool.name, input: {} } });
			emit("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } });
			emit("content_block_stop", { index });
		});
	} else {
		emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
		emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: r.text ?? "" } });
		emit("content_block_stop", { index: 0 });
	}
	emit("message_delta", { delta: { stop_reason: tools.length > 0 ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 40 } });
	emit("message_stop", {});
	res.end();
}

const model = createServer((req, res) => {
	let raw = "";
	req.on("data", (chunk) => (raw += chunk));
	req.on("end", () => {
		const body = JSON.parse(raw) as { messages?: { content: unknown }[] };
		const parts = (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }])) as { type: string; text?: string }[];
		const answered = parts.some((c) => c.type === "tool_result");
		if (parts.some((c) => c.type === "text" && (c.text ?? "").includes("分头查"))) {
			if (!answered) reply(res, { tools: [
				{ name: "task", input: { description: "找登录入口", prompt: "找登录入口在哪", subagent_type: "general" } },
				{ name: "task", input: { description: "整理接口文档", prompt: "把接口文档理一下", subagent_type: "doc-keeper" } },
				{ name: "task", input: { description: "规划迁移步骤", prompt: "想清楚迁移怎么做", subagent_type: "reason" } },
			] });
			else reply(res, { text: "三个都回来了：登录入口在 `src/auth.ts:42`，接口文档理好了，迁移分三步走。" });
			return;
		}
		setTimeout(() => (answered ? reply(res, { text: "查完了，结论已经写好。" }) : reply(res, { tools: [{ name: "read", input: { path: "README.md" } }] })), STEP_MS);
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
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			Object.assign(settings, { autoSummarizeTitle: false, permissionMode: "full", thinking: "off", retryAttempts: 0, appearance: { theme: process.env.THEME ?? "light" } });
			await writeFile(path, JSON.stringify(settings));
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 820, x: 0, y: 0 }));
			await mkdir(join(home, "agents"), { recursive: true });
			await writeFile(join(home, "agents", "docs-writer.md"), "---\nname: docs-writer\ndescription: 整理与改写项目文档\ntools: [read]\navatar: ghost-plum\n---\nYou write documentation.\n");
			await mkdir(join(home, "project", ".lyra", "agents"), { recursive: true });
			await writeFile(join(home, "project", ".lyra", "agents", "boss.md"), "---\nname: boss\ndescription: 编排者，会再派 explore 去找\n---\nBOSS\n");
		},
	});
	await app.send("Page.bringToFront");
	const grab = await frameGrabber(PORT);
	const frames: Frame[] = [];
	// 一个对象而不是一个 `let`：循环在这里读它，停下它的是最后那个 finally。
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
	/** 指针一路滑过去，不是瞬移——录像里要看得见它是怎么过去的。 */
	let pointer = { x: 640, y: 400 };
	const glide = async (to: { x: number; y: number }, ms = 450) => {
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
		await pause(120);
	};
	const byText = async (text: string, scope = "button") => {
		await until(`[...document.querySelectorAll(${JSON.stringify(scope)})].some(e=>e.checkVisibility()&&((e.textContent||'').trim().startsWith(${JSON.stringify(text)})||(e.getAttribute('aria-label')||'').startsWith(${JSON.stringify(text)})))`);
		await $(`(()=>{document.querySelector('[data-demo]')?.removeAttribute('data-demo');[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.checkVisibility()&&((e.textContent||'').trim().startsWith(${JSON.stringify(text)})||(e.getAttribute('aria-label')||'').startsWith(${JSON.stringify(text)}))).setAttribute('data-demo','');})()`);
		await click("[data-demo]");
	};
	const typeInto = async (selector: string, text: string) => {
		await click(selector);
		await $(`document.querySelector(${JSON.stringify(selector)}).select()`);
		for (const ch of text) {
			await grab.send("Input.insertText", { text: ch });
			await pause(45);
		}
	};
	const still = async (name: string) => {
		const file = join(OUT_DIR, `${STAMP}_${name}.png`);
		await writeFile(file, Buffer.from((await grab.send<{ data: string }>("Page.captureScreenshot", { format: "png" })).data, "base64"));
	};
	const faceMap = () => $<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll('[data-agent-profile]')].flatMap(row=>{const f=row.querySelector('.ly-avatar');return f?[[row.dataset.agentProfile,f.dataset.avatar]]:[];}))`);

	try {
		console.log("【一】设置 › 智能体：每个人一张脸");
		await pause(800);
		await click('button:has(svg.lucide-settings)');
		await byText("智能体", "nav button");
		await until(`document.querySelectorAll('[data-agent-profile] .ly-avatar').length === 9`);
		await pause(1500);
		let faces = await faceMap();
		check("九个智能体，九张互不相同的脸", new Set(Object.values(faces)).size === 9, JSON.stringify(faces));
		await still("01_智能体列表");

		console.log("\n【二】指针划过：果冻一下、眼睛跟着指针");
		for (const name of ["boss", "general", "explore", "plan", "reason"]) {
			const at = await centre(`[data-agent-profile="${name}"] p`);
			await glide({ x: at.x + 60, y: at.y - 6 }, 520);
			await pause(700);
		}
		const look = await $<string>(`getComputedStyle(document.querySelector('[data-agent-profile="reason"] .ly-avatar')).getPropertyValue('--ly-look-x')`);
		check("眼睛看向指针那一侧", Number.parseFloat(look) > 0.5, look);
		await glide({ x: 1180, y: 60 }, 600);
		console.log("   （停三秒，看它们自己眨眼）");
		await pause(3200);

		console.log("\n【三】新增智能体：一张没人用的脸");
		await byText("新增智能体");
		await until(`document.querySelector('[data-agent-avatar]')`);
		await pause(1200);
		const shown = () => $<string>(`document.querySelector('[data-agent-avatar]').dataset.agentAvatar`);
		const fresh = await shown();
		check(`新脸 ${fresh} 没人在用`, !Object.values(faces).includes(fresh), fresh);
		for (let roll = 0; roll < 2; roll++) {
			await click("[data-agent-shuffle]");
			await pause(900);
		}
		check("随机换过之后仍然没人在用", !Object.values(faces).includes(await shown()), await shown());
		await click('[aria-label="换个形象"]');
		await until(`document.querySelector('[data-avatar-picker]')`);
		await pause(900);
		// 先把形状换成幽灵，再去碰 docs-writer 的那一格（幽灵·梅紫）：挑不走，提示里说是谁在用。
		await click('[data-avatar-picker] [data-avatar-shape="ghost"]');
		await pause(700);
		await glide(await centre('[data-avatar-picker] [data-avatar-color="plum"]'));
		await pause(1400);
		const plumTaken = await $<string | null>(`document.querySelector('[data-avatar-picker] [data-avatar-color="plum"]').getAttribute('aria-disabled')`);
		check("docs-writer 那张（幽灵·梅紫）挑不走", plumTaken === "true", String(plumTaken));
		await click('[data-avatar-picker] [data-avatar-color="sky"]');
		await pause(900);
		const chosen = await shown();
		check("挑中了幽灵·天蓝", chosen === "ghost-sky", chosen);
		await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
		await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
		await pause(500);
		await typeInto('[aria-label="智能体调用名"]', "doc-keeper");
		await typeInto('[aria-label="智能体用途"]', "整理接口文档，保持示例能跑");
		await typeInto('[aria-label="智能体指令"]', "Read the code before writing. Keep every example runnable.");
		await pause(500);
		await $(`document.querySelector('[data-agent-tools]').scrollIntoView({block:'center',behavior:'smooth'})`);
		await pause(900);
		await byText("自选");
		await pause(700);
		await click('[data-agent-tools] [data-tool="write"]');
		await pause(400);
		await click('[data-agent-tools] [data-tool="edit"]');
		await pause(900);
		await byText("保存");
		await until(`document.querySelector('[data-agent-profile="doc-keeper"] .ly-avatar')`);
		await pause(1600);
		faces = await faceMap();
		check("新建的出现在「自定义」里，还是那张脸", faces["doc-keeper"] === chosen, faces["doc-keeper"]);
		check("十张脸仍然互不相同", new Set(Object.values(faces)).size === 10, JSON.stringify(faces));
		const file = await readFile(join(app.home, "agents", "doc-keeper.md"), "utf8");
		check("脸写进了定义文件（avatar: ghost-sky）", /^avatar: ghost-sky$/m.test(file), file.slice(0, 120));
		await still("02_新建之后");

		console.log("\n【四】派发：一次派三个，闸门只放一个");
		await byText("返回工作区", "nav button");
		await pause(700);
		await click('[data-ly-row="qa-short"]');
		await pause(900);
		await click("main textarea");
		for (const ch of "分头查一下登录入口、接口文档和迁移计划") {
			await grab.send("Input.insertText", { text: ch });
			await pause(40);
		}
		await pause(500);
		await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
		await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
		await until(`document.querySelector('[data-ly-subagent-bar]')`);
		await pause(1500);
		const bar = await $<{ moods: string[]; text: string }>(`(()=>{const b=document.querySelector('[data-ly-subagent-bar]');return {moods:[...b.querySelectorAll('[data-avatar-pile] .ly-avatar')].map(a=>a.dataset.mood),text:b.textContent};})()`);
		check("状态条：一个在干活，两个在排队", bar.moods.join() === "working,waiting,waiting", bar.moods.join());
		check("状态条说「2 个排队中」", /2 个排队中/.test(bar.text), bar.text);
		await still("03_派发中");
		// 把「派发子任务」那一行点开，看每一张卡片。
		await $(`document.querySelector('main [data-ly-run] > button')?.setAttribute('data-demo-run','')`);
		await click("[data-demo-run]");
		await pause(1800);
		await until(`[...document.querySelectorAll('[data-dock-pane="subagents"] [data-sub-header] [data-pile-face] .ly-avatar')].filter(a=>a.dataset.mood==='working').length >= 2`, STEP_MS * 6);
		await pause(1200);
		await $(`document.querySelector('main [data-ly-run] div[data-ly-avatar-host] > button')?.setAttribute('data-demo-card','')`);
		await click("[data-demo-card]");
		await pause(1400);
		const selected = await $<string | null>(`document.querySelector('[data-dock-pane="subagents"] [data-sub-title]')?.textContent ?? null`);
		check("点第一张卡片，面板翻到它那一页", selected === "找登录入口", String(selected));
		// 看对话里那一行的三张脸：输入框上方那一条在主智能体收尾之后会自己收起（ADR-0026），不一定还在。
		await until(`(()=>{const m=[...document.querySelectorAll('main [data-ly-run] [data-avatar-stack] .ly-avatar')].map(a=>a.dataset.mood);return m.length===3&&m.every(x=>x==='done');})()`, STEP_MS * 12);
		await pause(2000);
		const done = await $<string[]>(`[...document.querySelectorAll('main [data-ly-run] [data-avatar-stack] .ly-avatar')].map(a=>a.dataset.mood)`);
		check("三个都交差了，眼睛眯成两道弯", done.join() === "done,done,done", done.join());
		await still("04_派发结束");

		console.log("\n【五】@ 菜单：同一张脸");
		await click("main textarea");
		await grab.send("Input.insertText", { text: "@" });
		await until(`document.querySelectorAll('.ly-mention-menu [data-mention-kind="subagent"] .ly-avatar').length >= 10`);
		await pause(1200);
		for (let i = 0; i < 4; i++) {
			await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", windowsVirtualKeyCode: 40 });
			await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", windowsVirtualKeyCode: 40 });
			await pause(650);
		}
		const menu = await $<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll('.ly-mention-menu [data-mention-kind="subagent"]')].map(r=>[r.dataset.mentionTitle,r.querySelector('.ly-avatar').dataset.avatar]))`);
		check("@ 菜单里每个智能体都是设置页上那张脸", Object.entries(faces).every(([name, face]) => menu[name] === face), JSON.stringify(menu));
		await still("05_提及菜单");
		// 回车点名高亮的那一个：输入框里的 `@` 换成它的脸。
		const picked = await $<string>(`document.querySelector('.ly-mention-menu [aria-selected="true"]')?.dataset.mentionTitle ?? ''`);
		await grab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
		await grab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
		for (const ch of "帮我看看这一块") {
			await grab.send("Input.insertText", { text: ch });
			await pause(45);
		}
		await until(`document.querySelector('[data-command-mirror] .ly-mention-face .ly-avatar')`);
		await pause(1400);
		const token = await $<{ face: string; same: boolean }>(`({face:document.querySelector('[data-command-mirror] .ly-mention-face .ly-avatar').dataset.avatar,same:document.querySelector('[data-command-mirror]').textContent===document.querySelector('main textarea').value})`);
		check(`输入框里点名 @${picked}：@ 那一格是它的脸`, token.face === faces[picked], `${token.face} vs ${faces[picked]}`);
		check("镜像层的字和输入框一字不差", token.same, "");
		await still("05b_输入框里点名");
		await $(`(()=>{const f=document.querySelector('main textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(f,'');f.dispatchEvent(new Event('input',{bubbles:true}));})()`);
		await pause(600);

		console.log("\n【六】调度页：并发上限是一排座位");
		await click('button:has(svg.lucide-settings)');
		await byText("子智能体调度", "nav button");
		await until(`document.querySelectorAll('[data-concurrency-slots] [data-seat]').length === 8`);
		await $(`document.querySelector('[data-concurrency-slots]').scrollIntoView({block:'center'})`);
		await pause(1200);
		for (const seat of [6, 2, 3]) {
			await click(`[data-concurrency-slots] [data-seat="${seat}"]`);
			await pause(1100);
		}
		const awake = await $<number>(`document.querySelectorAll('[data-concurrency-slots] [data-awake]').length`);
		check("点第三个座位：三个醒着", awake === 3, String(awake));
		await still("06_调度座位");
		await pause(1200);
	} finally {
		camera.rolling = false;
		await film;
		grab.close();
		const passed = checks.filter((one) => one.ok).length;
		const out = join(OUT_DIR, `${STAMP}_智能体形象与子智能体调用_${passed}of${checks.length}.mp4`);
		console.log(`\n采到 ${frames.length} 帧，合成到 ${out}`);
		await encode(frames, out, 30, 1500);
		await app.stop();
		await closeListeningServer(model);
		console.log(`\n${passed}/${checks.length} 条通过`);
		if (passed !== checks.length) process.exitCode = 1;
	}
}

await main();
