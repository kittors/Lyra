import { spawn, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, closeListeningServer, stopProcessGroup, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { seedTrajectory } from "./trajectory-fixture.ts";
import { startMobile } from "./mobile-app.ts";

const PORT = 4598;
const RELAY_PORT = 4599;
let relay: ChildProcess;
const TOKEN = "mobile-sync-isolated-test-token";
let desktop: RunningApp;
let phone: Awaited<ReturnType<typeof startMobile>>;
let reply: ServerResponse | undefined;
let turn = 0;
const model = createServer((request, response) => {
	request.resume();
	request.on("end", () => {
		reply = response;
		response.writeHead(200, { "content-type": "text/event-stream" });
		sse({ type: "message_start", message: { id: `mock-${++turn}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
		sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
		sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `同步回复第${turn}轮，正在生成` } });
	});
});
function sse(event: { type: string; [key: string]: unknown }) { reply?.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); }
function finish() {
	sse({ type: "content_block_stop", index: 0 });
	sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } });
	sse({ type: "message_stop" }); reply?.end(); reply = undefined;
}

type Page = Pick<RunningApp, "evaluate" | "send">;
/*
 * 默认 12 秒，但手机侧的 RPC 自己等到 20 秒才认输（见 `mobile/src/bridge.ts` 的
 * 「桌面端没有响应」）。等得比它短，慢一点的调用就会在还没有答复的时候被判死，报出来像是
 * 功能坏了。数据量大的那几步要把这个数字抬到 RPC 超时之上。
 */
async function until(page: Page, expression: string, label = expression, timeout = 12_000) {
	const started = performance.now();
	while (performance.now() - started < timeout) {
		if (await page.evaluate<boolean>(expression)) return performance.now() - started;
		await new Promise((resolve) => setTimeout(resolve, 80));
	}
	throw new Error(`${label}: ${await page.evaluate("document.body.innerText.slice(-2000)")}`);
}
/*
 * 按下去之前先问 elementFromPoint 落点上是不是它。`checkVisibility` 只看 display 和 visibility，收在屏幕
 * 外的抽屉照样算「看得见」：手机宽度下点侧栏里的一行，落点在 x=-323，什么也没按到，而后面那句等待
 * 在原来的会话上也成立——轨迹那条就这样一路绿着，量的是别的会话。点不到就当场报错。
 */
async function click(page: Page, selector: string, last = false) {
	const point = await page.evaluate<{ x: number; y: number }>(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.checkVisibility({visibilityProperty:true})).at(${last ? -1 : 0});if(!el)throw new Error(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest',behavior:'instant'});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(!hit||!el.contains(hit))throw new Error(${JSON.stringify(selector)}+' is off-screen or covered at '+Math.round(x)+','+Math.round(y)+': '+(hit?hit.outerHTML.slice(0,160):'nothing there'));return {x,y};})()`);
	await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
	await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}

async function shot(page: Page, name: string) {
	const { data } = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await mkdir("output/mobile-sync", { recursive: true });
	await writeFile(`output/mobile-sync/${name}.png`, Buffer.from(data, "base64"));
}
async function size(width: number, height: number) {
	await phone.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
	await phone.send("Emulation.setTouchEmulationEnabled", { enabled: true });
	await phone.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
}

before(async () => {
	relay = spawn(process.execPath, [join(import.meta.dirname, "../../relay/server.mjs")], { env: { ...process.env, PORT: String(RELAY_PORT) }, detached: true, stdio: "ignore" });
	for (let i = 0; i < 100; i++) {
		if (await fetch(`http://127.0.0.1:${RELAY_PORT}/health`).then(r => r.ok).catch(() => false)) break;
		await new Promise(resolve => setTimeout(resolve, 100));
	}

	await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
	const address = model.address(); assert.ok(address && typeof address !== "string");
	desktop = await startApp({ port: 9704, seed: async (home) => {
		await seedInteractions(home, address.port);
		// 交互 fixture 里一次工具调用也没有，轨迹里只有问答（并不是空的，所以「条目出来了」证明不了
		// 切对了会话）——手机那条要量的是工具调用和模型请求的条目。借桌面那条轨迹测试用的同一份数据。
		await seedTrajectory(home);
		const file = join(home, "settings.json");
		const settings = JSON.parse(await readFile(file, "utf8"));
		settings.sync = { enabled: true, port: PORT, token: TOKEN, relayUrl: `ws://127.0.0.1:${RELAY_PORT}` };
		settings.providers[0].models.push({ ...settings.providers[0].models[0], id: "qa/other", modelId: "other", name: "QA Other" });
		settings.uiLocale = "zh-CN";
		settings.appearance = { theme: "dark" };
		await writeFile(file, JSON.stringify(settings));
	} });
	phone = await startMobile(desktop.home, { host: "127.0.0.1", port: PORT, token: TOKEN, platform: "darwin" }, 9705);
	await until(phone, "!!document.querySelector('.ly-shell')", "mobile shell");
});
after(async () => {
	await cleanupFixture(
		() => finish(),
		() => phone?.stop(),
		() => desktop?.stop(),
		() => closeListeningServer(model),
		() => stopProcessGroup(relay),
	);
});

test("mobile renderer preserves desktop tokens and fits phone, landscape and tablet viewports", async (t) => {
	for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [844, 390], [768, 1024], [1024, 768]]) {
		await size(width, height);
		const geometry = await phone.evaluate<{ width: number; overflow: number; controls: { label: string; w: number; h: number; right: number; bottom: number }[] }>(`({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,controls:[...document.querySelectorAll('[data-ly-toolbar-button],.ly-composer-control')].filter(e=>e.checkVisibility({visibilityProperty:true})).map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label'),w:r.width,h:r.height,right:r.right,bottom:r.bottom}})})`);
		t.diagnostic(`${width}x${height}: ${JSON.stringify(geometry)}`);
		assert.equal(geometry.width, width); assert.equal(geometry.overflow, 0);
		assert.ok(geometry.controls.length > 0);
		for (const control of geometry.controls) { assert.ok(control.w >= 44 && control.h >= 44, JSON.stringify(control)); assert.ok(control.right <= width + 1 && control.bottom <= height + 1, JSON.stringify(control)); }
		await shot(phone, `mobile-${width}x${height}`);
	}
	await size(390, 844);
	const tokens = "['--color-shell','--color-ink','--color-accent'].map(t=>getComputedStyle(document.documentElement).getPropertyValue(t).trim())";
	assert.deepEqual(await phone.evaluate(tokens), await desktop.evaluate(tokens));
	assert.equal(await phone.evaluate("[...document.querySelectorAll('button')].some(e=>e.checkVisibility({visibilityProperty:true})&&/截图/.test(e.getAttribute('aria-label')||''))"), false);
});

test("cold-session rename, model, archive, restore and deletion reach the other screen", async (t) => {
	await size(1024, 768);
	const source = await desktop.evaluate<{ projectId: string; id: string }>("window.lyra.sessions.list().then(s=>s.find(s=>s.id==='qa-short'))");
	const args = `${JSON.stringify(source.projectId)},'qa-short'`;
	await phone.evaluate(`window.lyra.sessions.rename(${args},'手机改名同步')`);
	t.diagnostic(`phone → desktop rename ${await until(desktop, "document.body.innerText.includes('手机改名同步')")}ms`);
	await desktop.evaluate(`window.lyra.sessions.rename(${args},'电脑改名同步')`);
	await until(phone, "document.body.innerText.includes('电脑改名同步')");
	await click(phone, '[data-ly-row="qa-short"] > button');
	await until(phone, "!!document.querySelector('main textarea')");
	await desktop.evaluate("window.lyra.agent.setModel('qa-short','qa/other')");
	await until(phone, "[...document.querySelectorAll('.ly-composer-control')].some(e=>e.textContent.includes('QA Other'))");
	await desktop.evaluate("window.lyra.agent.setThinking('qa-short','high')");
	await phone.evaluate(`window.lyra.sessions.setArchived(${args},true)`);
	await until(desktop, "!document.querySelector('[data-ly-row=\"qa-short\"]')");
	await desktop.evaluate(`window.lyra.sessions.setArchived(${args},false)`);
	await until(phone, "!!document.querySelector('[data-ly-row=\"qa-short\"]')");
	await click(phone, '[data-ly-row="qa-short"] > button');
	await desktop.evaluate(`window.lyra.sessions.remove(${args})`);
	await until(phone, "!document.querySelector('[data-ly-row=\"qa-short\"]') && !document.querySelector('main')?.innerText.includes('qa-short 第')");
});

test("two real screens stream both ways and recover missed content without dropping a draft", async (t) => {
	await size(1024, 768);
	await click(desktop, '[data-ly-row="qa-long"] > button');
	await click(phone, '[data-ly-row="qa-long"] > button');
	await until(phone, "document.querySelector('main')?.innerText.includes('第 120 个问题')");
	const send = async (page: Page, text: string) => {
		await click(page, "main textarea");
		await page.send("Input.insertText", { text });
		await click(page, 'button[aria-label="发送"]');
	};
	await send(phone, "来自手机的实时消息");
	t.diagnostic(`phone → desktop prompt ${await until(desktop, "document.querySelector('main')?.innerText.includes('来自手机的实时消息')")}ms`);
	await until(phone, "document.querySelector('main')?.innerText.includes('同步回复第1轮')");
	await until(desktop, "document.querySelector('main')?.innerText.includes('同步回复第1轮')");
	finish();
	await until(phone, "!document.querySelector('button[aria-label=\"停止\"]')");
	await send(desktop, "来自电脑的实时消息");
	await until(phone, "document.querySelector('main')?.innerText.includes('同步回复第2轮')");
	/*
	 * 断线时按下去发不出去，和断线期间桌面把活干完——两件事得分在两轮里。
	 *
	 * 一轮还在跑的时候，手机上那颗键是「等这一轮结束后发出」：按下去消息进队列，输入框清空，
	 * 没有失败可报。可「断线期间桌面继续完成」又要求断线时那一轮正在跑。挤在同一轮里，两个
	 * 断言必然有一个不成立。所以先把这一轮收干净，验完离线发送，再让桌面单独跑一轮。
	 */
	finish();
	await until(phone, "!document.querySelector('button[aria-label=\"停止\"]')");
	await click(phone, "main textarea"); await phone.send("Input.insertText", { text: "断线也要保留的草稿" });
	await desktop.evaluate("window.lyra.sync.stop()");
	await until(phone, "window.lyra.sync.connectionStatus()==='reconnecting'", "socket actually disconnected");
	await click(phone, 'button[aria-label="发送"]');
	await until(phone, "document.body.innerText.includes('发送失败')");
	assert.equal(await phone.evaluate("document.querySelector('main textarea').value"), "断线也要保留的草稿");
	// 断着线，桌面自己跑完一整轮——手机不该看见它，重连之后才补上。
	await send(desktop, "断线期间的第三轮");
	await until(desktop, "document.querySelector('main')?.innerText.includes('同步回复第3轮')");
	sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "，断线期间桌面继续完成" } }); finish();
	await until(desktop, "document.querySelector('main')?.innerText.includes('断线期间桌面继续完成')");
	assert.equal(await phone.evaluate("document.querySelector('main')?.innerText.includes('断线期间桌面继续完成')"), false);
	await desktop.evaluate("window.lyra.sync.start()");
	await phone.evaluate("window.__lyraProbe()");
	t.diagnostic(`recovery ${await until(phone, "document.querySelector('main')?.innerText.includes('断线期间桌面继续完成')")}ms`);
	assert.equal(await phone.evaluate("document.querySelector('main textarea').value"), "断线也要保留的草稿");
	await shot(phone, "reconnected-transcript");
	await until(phone, "!document.querySelector('button[aria-label=\"停止\"]')");
	await desktop.evaluate("window.lyra.sync.stop()");
	await until(phone, "window.lyra.sync.connectionStatus()==='reconnecting'");
	await click(phone, 'main button[aria-label="编辑并重新发送"]', true);
	await until(phone, "document.querySelectorAll('main textarea').length===2");
	await click(phone, 'main [data-question-index] textarea');
	await phone.send("Input.insertText", { text: "离线编辑" });
	/*
	 * 确认键是一枚勾，「发送」只在 aria-label 上。从前按文字找它：find 落空，`?.click()` 一声不吭地
	 * 跳过，编辑从没发出去，下面等的那句「编辑重发失败」也就永远等不到。用 click()，找不到当场报错。
	 */
	await click(phone, 'main [data-question-index] button[aria-label="发送"]');
	await until(phone, "document.body.innerText.includes('编辑重发失败')");
	assert.equal(await phone.evaluate("document.querySelector('main')?.innerText.includes('断线期间桌面继续完成')"), true);
	await desktop.evaluate("window.lyra.sync.start()");
	await phone.evaluate("window.__lyraProbe()");
	await until(phone, "window.lyra.sync.connectionStatus()==='connected'");
});

/*
 * 手机上的轨迹面板：条目和时间概览上的每个控件都是 44px 的真实触控目标，桌面才有的导出不出现。
 *
 * 这条标过 todo，2026-09-24 去掉。当时面板停在「0/0 读取中…」，是被上一条带出来的：它红在半路，
 * 末尾的 `sync.start()` 没执行，桌面的同步服务一直停着。上一条修好之后又查出两处：
 *
 * 切会话从来没切过去。390 宽时侧栏收成抽屉，那一行在屏幕外，点击落空；随后等的 `main textarea`
 * 在原来的 qa-long 上也成立，于是一路量的都是 qa-long 的对话，不是 seed 进来的那 2500 次工具调用。
 * 现在先拉开抽屉，等的是这一行成了当前会话。
 *
 * 时间概览从「点开的浮层」改成了面板里常驻的一段（`TraceTimeline.tsx`）：面板矮于 240 只留折叠键，
 * 矮于 160 整段隐藏。这里三种尺寸下实测面板高 516、792、338，都该展开——横屏的 338 也够，不是只留
 * 折叠键。可展开与否还是人说了算：收起会记进 sessionStorage，没记过就看第一次打开时面板有没有 400
 * 高。所以量之前读 aria-expanded、收着才点开；旧写法照浮层那样盲点一下，反而把它收了起来，画布
 * 隐藏，量出来 top 是 0。旧写法最后按 Esc 等浮层从 DOM 里消失；常驻的一段不会消失，对应的是收起
 * ——画布和三个缩放键一起走，折叠键自己仍是 44px。再点开，把展开的样子原样交给下一个尺寸。
 */
test("mobile trajectory keeps real touch targets and omits desktop file exports", async (t) => {
	await size(390, 844);
	// Dismiss the errors intentionally produced by the preceding offline test.
	await phone.evaluate(`document.querySelectorAll('[role="alert"] button[aria-label="关闭"]').forEach(e=>e.click())`);
	await until(phone, `!document.querySelector('[role="alert"] button[aria-label="关闭"]')`);
	// 轨迹条目在「大规模轨迹验证」那个会话里——前面几条留在别的会话上，那里一次工具调用都没有。
	const trace = '[data-ly-row="10000000-0000-4000-8000-000000000001"]';
	await click(phone, 'button[aria-label^="显示侧边栏"]');
	await until(phone, `document.querySelector(${JSON.stringify(trace)}).getBoundingClientRect().left >= 0`, "drawer open");
	await phone.evaluate("Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})))");
	await click(phone, `${trace} > button`);
	await until(phone, `!!document.querySelector(${JSON.stringify(`${trace} > button[aria-current="page"]`)})`, "trajectory session opened");
	await click(phone, 'button[aria-label="面板"]');
	t.diagnostic(await phone.evaluate("document.body.innerText.slice(-800)"));
	await phone.evaluate("(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='轨迹');if(!e)throw new Error('trajectory action missing');e.click();})()");
	t.diagnostic(`轨迹面板：${await phone.evaluate<string>(`(()=>{const p=document.querySelector('[data-dock-pane="trajectory"]');return p?('在，内容='+p.innerText.slice(0,240).replace(/\\s+/g,' ')):'✗ 没有 trajectory 面板；当前 dock='+[...document.querySelectorAll('[data-dock-pane]')].map(e=>e.getAttribute('data-dock-pane')).join(',');})()`)}`);
	// 轨迹是这一屏里最重的一次调用：五千条消息走中转再到手机端解析。等到 RPC 自己超时之后，
	// 才分得清「还没回来」和「回来了是空的」。
	await until(phone, "!!document.querySelector('[data-trace-entry]')", "trajectory entries", 25_000);
	// 画布没画出来时 canvasTop 给 null：藏起来的画布量出来 top 是 0，拿 0 去比，哪个控件都「压着画布」。
	const timeline = () => phone.evaluate<{ expanded: string | null; canvasTop: number | null; controls: { label: string | null; width: number; height: number; bottom: number }[] }>(`(()=>{const s=document.querySelector('[data-trace-timeline]'),c=s.querySelector('canvas');return {expanded:s.querySelector('button[aria-label="时间概览"]').getAttribute('aria-expanded'),canvasTop:c.checkVisibility()?c.getBoundingClientRect().top:null,controls:[...s.querySelectorAll('button')].filter(e=>e.checkVisibility()).map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label'),width:r.width,height:r.height,bottom:r.bottom}})}})()`);
	const toggle = '[data-trace-timeline] button[aria-label="时间概览"]';
	for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
		await size(width, height);
		const rows = await phone.evaluate<{ top: number; height: number; bottom: number }[]>("[...document.querySelectorAll('[data-trace-list] [role=listitem]')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,height:r.height,bottom:r.bottom}})");
		assert.ok(rows.length > 0, 'the mobile ledger must contain visible records');
		for (let i = 0; i < rows.length; i++) { assert.equal(rows[i].height, 44); if (i) assert.ok(rows[i].top >= rows[i - 1].bottom); }
		assert.equal(await phone.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
		assert.equal(await phone.evaluate("document.querySelectorAll('[data-trajectory] button[aria-label*=导出],[data-trajectory] button[aria-label*=完整记录]').length"), 0);
		await shot(phone, `trajectory-${width}x${height}`);
		// 三种尺寸都该展开。收着才点开——展开着的，点一下就收起来了。
		if ((await timeline()).expanded === "false") await click(phone, toggle);
		await until(phone, "!!document.querySelector('[data-trace-timeline] canvas')?.checkVisibility()", `timeline expanded at ${width}x${height}`);
		const open = await timeline(), top = open.canvasTop;
		assert.deepEqual(open.controls.map(control => control.label), ["时间概览", "缩小时间范围", "放大时间范围", "重置时间范围"], JSON.stringify(open));
		assert.ok(top !== null && open.controls.every(r => r.height >= 44 && r.width >= 44 && r.bottom <= top), JSON.stringify(open));
		await shot(phone, `trajectory-timeline-${width}x${height}`);
		// 收起：画布和三个缩放键一起走，折叠键自己仍是 44px。
		await click(phone, toggle);
		await until(phone, `document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded') === 'false'`, "timeline collapsed");
		const closed = await timeline();
		assert.equal(closed.canvasTop, null, JSON.stringify(closed));
		assert.deepEqual(closed.controls.map(control => control.label), ["时间概览"], JSON.stringify(closed));
		assert.ok(closed.controls[0].height >= 44 && closed.controls[0].width >= 44, JSON.stringify(closed));
		// 再点开，把展开的样子原样交给下一个尺寸。
		await click(phone, toggle);
		await until(phone, "!!document.querySelector('[data-trace-timeline] canvas')?.checkVisibility()", "timeline expanded again");
	}
});

/*
 * 走中转也拿得到界面：渲染产物经资源隧道送过去（中转服务的 /app/<assetKey>/ 转成 asset_request，
 * 桌面端的同步服务回 asset_response）。
 *
 * 这条曾经标着 todo，理由是「中转只转数据、不转界面，需要单独的资源隧道」。隧道早就有了；它红，
 * 是因为上一条红在半路、没走到末尾的 `sync.start()`，桌面的同步服务一直停着，走中转的手机端连
 * 不上任何人，于是等不到 `.ly-shell`。上一条修好之后它就绿了。
 */
test("relay serves the real mobile renderer and synchronizes settings and forked conversations", async (t) => {
	await phone.stop();
	phone = await startMobile(desktop.home, { host: "127.0.0.1", port: RELAY_PORT, token: TOKEN, relay: true, platform: "darwin" }, 9705);
	await until(phone, "!!document.querySelector('.ly-shell')");
	await size(1024, 768);
	await click(phone, '[data-ly-row="qa-long"] > button');
	await until(phone, "document.querySelector('main')?.innerText.includes('断线期间桌面继续完成')");
	await desktop.evaluate("window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,theme:'light'}}))");
	t.diagnostic(`relay theme ${await until(phone, "document.documentElement.classList.contains('light')")}ms`);
	await phone.evaluate("window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,theme:'dark'}}))");
	await until(desktop, "document.documentElement.classList.contains('dark')");
	const fork = await phone.evaluate<{ meta: { id: string; title: string } }>("window.lyra.sessions.list().then(s=>{const m=s.find(s=>s.id==='qa-long');return window.lyra.sessions.fork(m.projectId,m.id,2)})");
	await until(desktop, `!!document.querySelector('[data-ly-row="${fork.meta.id}"]')`);
	await until(phone, `!!document.querySelector('[data-ly-row="${fork.meta.id}"]')`);
	const scratch = await phone.evaluate<string>("window.lyra.git.generalScratch()");
	assert.ok(scratch.endsWith("general"));
	await phone.evaluate("window.__lyraProbe()");
	await shot(phone, "relay-desktop-parity");
});
