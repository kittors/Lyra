/**
 * 智能体的脸，在真窗口里从头走一遍：设置页 → 新建 → 派发 → `@` 菜单 → 调度页。
 *
 * 单测证明了规则（谁拿哪张脸、排队怎么对号），组件测试证明了 DOM 上挂对了属性。它们都证不到的是
 * 这几件只有真窗口才有的事：
 *
 * - 动画真的放了——悬停那一下「果冻」要在合成出来的帧里看得到缩放，不是属性挂上了就算；
 * - 眼睛真的跟着真指针走，眨眼真的在没人碰的时候自己发生；
 * - 新建的智能体那张脸穿过 IPC 写进了文件，重新读回来还是它；
 * - 闸门只放一个时，排队的那两个在状态条和对话里都看得见，点卡片面板真的翻过去。
 *
 * 模型是假的：一个按「谁在问」回话的 Anthropic 流式服务，子智能体每一步都故意慢三秒，好让「在跑」
 * 和「在排队」都停留得够久、量得到。
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { named } from "./named.ts";

const CDP_PORT = 9637;
const STEP_MS = 3000;
const NEW_AGENT = "qa-avatar";

let app: RunningApp;
let model: Server;
let modelPort = 0;
/** 设置页上量到的脸，后面拿去和 `@` 菜单比。 */
let faces: Record<string, string> = {};

function reply(res: ServerResponse, r: { text?: string; tools?: { name: string; input: Record<string, unknown> }[] }): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: "m", type: "message", role: "assistant", content: [], model: "scripted", stop_reason: null, usage: { input_tokens: 500, output_tokens: 0 } } });
	const blocks = r.tools ?? [];
	if (blocks.length > 0) {
		blocks.forEach((tool, index) => {
			emit("content_block_start", { index, content_block: { type: "tool_use", id: `t${Math.random().toString(36).slice(2, 10)}`, name: tool.name, input: {} } });
			emit("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } });
			emit("content_block_stop", { index });
		});
	} else {
		emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
		emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: r.text ?? "" } });
		emit("content_block_stop", { index: 0 });
	}
	emit("message_delta", { delta: { stop_reason: blocks.length > 0 ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 40 } });
	emit("message_stop", {});
	res.end();
}

before(async () => {
	model = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const body = JSON.parse(raw) as { messages?: { content: unknown }[] };
			const parts = (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }])) as { type: string; text?: string }[];
			const answered = parts.some((c) => c.type === "tool_result");
			if (parts.some((c) => c.type === "text" && (c.text ?? "").includes("AVATAR-DEMO"))) {
				if (!answered) reply(res, { tools: [
					{ name: "task", input: { description: "找登录入口", prompt: "找登录入口在哪", subagent_type: "general" } },
					{ name: "task", input: { description: "整理文档", prompt: "把文档理一下", subagent_type: NEW_AGENT } },
					{ name: "task", input: { description: "规划迁移", prompt: "想清楚迁移怎么做", subagent_type: "reason" } },
				] });
				else reply(res, { text: "三个都回来了。" });
				return;
			}
			// 子智能体：先读一个文件，再交差，每一步都慢一点。
			setTimeout(() => (answered ? reply(res, { text: "查完了。" }) : reply(res, { tools: [{ name: "read", input: { path: "README.md" } }] })), STEP_MS);
		});
	});
	await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
	const address = model.address();
	assert.ok(address && typeof address !== "string");
	modelPort = address.port;
	app = await startApp({
		port: CDP_PORT,
		seed: async (home) => {
			await seedInteractions(home, modelPort);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			// 思考关着 → 调度落在「省着派」，闸门一次只放一个：排队的那两个正是要看的东西。
			Object.assign(settings, { autoSummarizeTitle: false, permissionMode: "full", thinking: "off", retryAttempts: 0 });
			await writeFile(path, JSON.stringify(settings));
			await mkdir(join(home, "agents"), { recursive: true });
			await writeFile(join(home, "agents", "docs-writer.md"), "---\nname: docs-writer\ndescription: 整理与改写项目文档\ntools: [read]\navatar: ghost-plum\n---\nYou write documentation.\n");
			await mkdir(join(home, "project", ".lyra", "agents"), { recursive: true });
			await writeFile(join(home, "project", ".lyra", "agents", "boss.md"), "---\nname: boss\ndescription: 编排者\n---\nBOSS\n");
		},
	});
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
	await app.send("Page.bringToFront");
});

after(async () => {
	await cleanupFixture(() => app?.stop(), () => closeListeningServer(model));
});

async function frames(n = 15) {
	await app.evaluate(`new Promise(r=>{let n=${n};const f=()=>--n?requestAnimationFrame(f):r();requestAnimationFrame(f);})`);
}
async function until(expression: string, ms = 30000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await app.evaluate<boolean>(`Boolean(${expression})`)) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`等不到：${expression}`);
}
/** 真鼠标：先挪过去，问一句落点上是不是它，再按。 */
async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await frames(2);
	const at = await app.evaluate<{ x: number; y: number }>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(!e.contains(hit))throw new Error('被挡住了：'+${JSON.stringify(selector)}+' → '+(hit?hit.outerHTML.slice(0,120):'nothing'));return {x,y};})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...at, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	await frames(3);
}
async function label(text: string, scope = "button") {
	const match = named(text, "starts");
	await until(`[...document.querySelectorAll(${JSON.stringify(scope)})].some(e=>e.checkVisibility()&&${match})`);
	await app.evaluate(`(()=>{document.querySelector('[data-qa-target]')?.removeAttribute('data-qa-target');[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.checkVisibility()&&${match}).setAttribute('data-qa-target','');})()`);
	await click("[data-qa-target]");
}
const faceMap = () => app.evaluate<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll('[data-agent-profile]')].flatMap(row=>{const f=row.querySelector('.ly-avatar');return f?[[row.dataset.agentProfile,f.dataset.avatar]]:[];}))`);

test("设置页：九个智能体九张脸；指针进来那一行的脸真的弹了一下、眼睛跟着指针，没人碰也会自己眨眼", async () => {
	await click('button:has(svg.lucide-settings)');
	await label("智能体", "nav button");
	await until(`document.querySelectorAll('[data-agent-profile] .ly-avatar').length === 9`);
	faces = await faceMap();
	assert.equal(new Set(Object.values(faces)).size, 9, `互不相同：${JSON.stringify(faces)}`);
	assert.equal(faces.general, "circle-blue");
	assert.equal(faces["docs-writer"], "ghost-plum", "文件里写的那张");

	// 把真指针挪到 explore 那一行的描述上，逐帧读那张脸的缩放——果冻那一下要真的画出来。
	const target = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector('[data-agent-profile="explore"] p').getBoundingClientRect();return {x:r.x+20,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x - 200, y: target.y - 60 });
	await frames(4);
	const sampling = app.evaluate<{ widest: number; last: string }>(`new Promise(resolve=>{const g=document.querySelector('[data-agent-profile="explore"] .ly-avatar-squish');let widest=1,n=0;const f=()=>{const m=getComputedStyle(g).transform;const a=m.startsWith('matrix(')?Number(m.slice(7).split(',')[0]):1;widest=Math.max(widest,a);if(++n<60)requestAnimationFrame(f);else resolve({widest,last:getComputedStyle(g).transform});};requestAnimationFrame(f);})`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
	const jelly = await sampling;
	assert.ok(jelly.widest > 1.06, `进来那一下被压扁了（最宽 ${jelly.widest.toFixed(3)} 倍）`);
	assert.ok(jelly.last === "none" || jelly.last === "matrix(1, 0, 0, 1, 0, 0)", `弹完落稳：${jelly.last}`);

	// 指针在脸的右边：眼睛往右看。
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x + 180, y: target.y });
	await frames(20);
	const look = await app.evaluate<string>(`getComputedStyle(document.querySelector('[data-agent-profile="explore"] .ly-avatar')).getPropertyValue('--ly-look-x')`);
	assert.ok(Number.parseFloat(look) > 1, `眼睛往右挪了 ${look}`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });

	// 不碰它，等它们自己眨。
	const blinked = await app.evaluate<string[]>(`new Promise(resolve=>{const seen=new Set();const o=new MutationObserver(list=>{for(const m of list){if(m.target.hasAttribute('data-blink'))seen.add(m.target.closest('[data-agent-profile]')?.dataset.agentProfile);}});for(const f of document.querySelectorAll('[data-agent-profile] .ly-avatar'))o.observe(f,{attributes:true,attributeFilter:['data-blink']});setTimeout(()=>{o.disconnect();resolve([...seen]);},9000);})`);
	assert.ok(blinked.length >= 3, `九秒里好几张脸各自眨了眼：${blinked.join(", ")}`);
});

test("新建：一进来就是一张没人用的脸，随机能换、能挑，存下去的就是屏幕上那张", async () => {
	await label("新增智能体");
	await until(`document.querySelector('[data-agent-editor] [data-agent-avatar]')`);
	const shown = () => app.evaluate<string>(`document.querySelector('[data-agent-avatar]').dataset.agentAvatar`);
	const fresh = await shown();
	assert.ok(!Object.values(faces).includes(fresh), `新脸 ${fresh} 不和任何人重复`);
	await click("[data-agent-shuffle]");
	const rolled = await shown();
	assert.ok(rolled !== fresh && !Object.values(faces).includes(rolled), `换了一张：${rolled}`);

	await click('[aria-label="换个形象"]');
	await until(`document.querySelector('[data-avatar-picker]')`);
	// 挑一个和别人都不撞的颜色：天蓝。
	await click('[data-avatar-picker] [data-avatar-color="sky"]');
	const chosen = await shown();
	assert.ok(chosen.endsWith("-sky"), chosen);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
	await until(`!document.querySelector('[data-avatar-picker]')`);

	for (const [field, text] of [["智能体调用名", NEW_AGENT], ["智能体用途", "测试用的整理员"], ["智能体指令", "Tidy the docs."]] as const) {
		await click(`[aria-label="${field}"]`);
		await app.evaluate(`document.querySelector('[aria-label="${field}"]').select()`);
		await app.send("Input.insertText", { text });
	}
	await label("保存");
	await until(`document.querySelector('[data-agent-profile="${NEW_AGENT}"] .ly-avatar')`);
	faces = await faceMap();
	assert.equal(faces[NEW_AGENT], chosen, "列表上是存下去的那张");
	assert.equal(new Set(Object.values(faces)).size, Object.keys(faces).length, "十张，还是互不相同");
	const file = await readFile(join(app.home, "agents", `${NEW_AGENT}.md`), "utf8");
	assert.match(file, new RegExp(`^avatar: ${chosen}$`, "m"), "写进了定义文件");
	assert.match(file, /^name: qa-avatar$/m, "新文件是块状 YAML，一行一个字段");
});

test("派发：闸门只放一个，排队的两个也在；点卡片面板翻过去；做完换成弯眼", async () => {
	await label("返回工作区", "nav button");
	await click('[data-ly-row="qa-short"]');
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(field, "AVATAR-DEMO 分头查一下");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	})()`);
	await until(`document.querySelectorAll('[data-ly-subagent-bar] [data-avatar-pile] .ly-avatar').length >= 3`);
	// 不止一个：输入框上方那一行是一摞叠着的脸，不是一排并排的。
	const bar = await app.evaluate<{ moods: string[]; faces: string[]; text: string; menu: string | null }>(`(()=>{const bar=document.querySelector('[data-ly-subagent-bar]');const all=[...bar.querySelectorAll('[data-avatar-pile] .ly-avatar')];return {moods:all.map(a=>a.dataset.mood),faces:all.map(a=>a.dataset.avatar),text:bar.textContent,menu:bar.getAttribute('aria-haspopup')};})()`);
	assert.deepEqual(bar.moods, ["working", "waiting", "waiting"], `一个在干活，两个在排队：${bar.moods}`);
	assert.deepEqual(bar.faces, [faces.general, faces[NEW_AGENT], faces.reason], "排队的也是各自的脸——包括刚建的那个");
	assert.match(bar.text, /2 个排队中/);
	assert.equal(bar.menu, "menu", "点它是一张单子");

	// 对话里那一行：同样三张脸。
	const inline = await app.evaluate<string[]>(`[...document.querySelectorAll('main [data-ly-run] [data-avatar-stack] .ly-avatar')].map(a=>a.dataset.mood)`);
	assert.deepEqual(inline, ["working", "waiting", "waiting"]);

	// 等第二个开跑（闸门只放一个：第一个交了差，第二个才登记）：面板顶上那一摞里有两张不在排队的脸。
	const header = '[data-dock-pane="subagents"] [data-sub-header]';
	await until(`[...document.querySelectorAll('${header} [data-pile-face] .ly-avatar')].filter(a=>a.dataset.mood!=='waiting').length >= 2`, STEP_MS * 5);
	// 面板顶上的切换器：点开是一张单子，两个在跑、一个在排队（排着的也在名单上）；点另一行，面板翻过去。
	await click(`${header} [data-sub-switch]`);
	await until(`document.querySelectorAll('[data-sub-menu] [data-sub-row]').length === 3 && document.querySelectorAll('[data-sub-menu] [data-sub-queued]').length === 1`);
	const before = await app.evaluate<string>(`document.querySelector('${header} [data-sub-title]').textContent`);
	await app.evaluate(`[...document.querySelectorAll('[data-sub-menu] [data-sub-row]')].find(r=>r.dataset.selected!=='true'&&!r.dataset.subQueued).querySelector('[role=menuitem]').setAttribute('data-qa-pick','')`);
	await click("[data-qa-pick]");
	await until(`!document.querySelector('[data-sub-menu]') && document.querySelector('${header} [data-sub-title]').textContent !== ${JSON.stringify(before)}`);

	// 再点对话里第一张派发卡片：面板翻回它那一页。
	await app.evaluate(`document.querySelector('main [data-ly-run] > button')?.setAttribute('data-qa-run','')`);
	await click("[data-qa-run]");
	await until(`[...document.querySelectorAll('main [data-ly-run] div[data-ly-avatar-host] > button')].length === 3`);
	await app.evaluate(`document.querySelector('main [data-ly-run] div[data-ly-avatar-host] > button').setAttribute('data-qa-card','')`);
	await click("[data-qa-card]");
	await until(`document.querySelector('${header} [data-sub-title]')?.textContent === "找登录入口"`);

	/*
	 * 都交了差：对话里那一行的三张脸眯成两道弯。输入框上方那一条随后自己收起（主智能体用完结果、
	 * 这一轮收尾之后），所以不在它身上量——它可能已经不在了。
	 */
	await until(`(()=>{const m=[...document.querySelectorAll('main [data-ly-run] [data-avatar-stack] .ly-avatar')].map(a=>a.dataset.mood);return m.length===3&&m.every(x=>x==='done');})()`, STEP_MS * 10);
	await until(`!document.querySelector('[data-ly-subagent-bar]') || document.querySelector('[data-ly-subagent-bar]').closest('.ly-reveal')?.dataset.open === 'false'`, STEP_MS * 10);
});

test("@ 菜单：智能体是设置页上的同一张脸", async () => {
	await click("main textarea");
	await app.send("Input.insertText", { text: "@" });
	await until(`document.querySelectorAll('.ly-mention-menu [data-mention-kind="subagent"] .ly-avatar').length >= 10`);
	const menu = await app.evaluate<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll('.ly-mention-menu [data-mention-kind="subagent"]')].map(r=>[r.dataset.mentionTitle,r.querySelector('.ly-avatar').dataset.avatar]))`);
	for (const [name, face] of Object.entries(faces)) assert.equal(menu[name], face, `${name} 在两处是同一张脸`);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
	// 点名之后，输入框里那个 `@` 换成了它的脸，而镜像层的字一个没少。
	await app.send("Input.insertText", { text: `${NEW_AGENT} 整理一下` });
	await until(`document.querySelector('[data-command-mirror] .ly-mention-face .ly-avatar')`);
	const token = await app.evaluate<{ face: string; mirror: string; field: string }>(`({face:document.querySelector('[data-command-mirror] .ly-mention-face .ly-avatar').dataset.avatar,mirror:document.querySelector('[data-command-mirror]').textContent,field:document.querySelector('main textarea').value})`);
	assert.equal(token.face, faces[NEW_AGENT]);
	assert.equal(token.mirror, token.field, "镜像层和 textarea 一字不差");
	await app.evaluate(`(()=>{const f=document.querySelector('main textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(f,'');f.dispatchEvent(new Event('input',{bubbles:true}));})()`);
});

test("调度页：并发上限是八个座位，点第三个就设成三", async () => {
	await click('button:has(svg.lucide-settings)');
	await label("子智能体调度", "nav button");
	await until(`document.querySelectorAll('[data-concurrency-slots] [data-seat]').length === 8`);
	await click('[data-concurrency-slots] [data-seat="3"]');
	await until(`document.querySelectorAll('[data-concurrency-slots] [data-awake]').length === 3`);
	let saved = 0;
	for (let attempt = 0; attempt < 50 && saved !== 3; attempt++) {
		saved = JSON.parse(await readFile(join(app.home, "settings.json"), "utf8")).maxConcurrentSubAgents;
		if (saved !== 3) await new Promise((r) => setTimeout(r, 100));
	}
	assert.equal(saved, 3, "写进了 settings.json");
	await label("返回工作区", "nav button");
});
