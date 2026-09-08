import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
let server: Server;
let port = 0;
let step = 0;
const results: unknown[] = [];
function answer(res: ServerResponse, tool?: { name: string; input: object }) {
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: `qa-${step}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
	emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `call-${step}`, name: tool.name, input: {} } : { type: "text", text: "" } });
	emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: "BROWSER_QA_DONE" } });
	emit("content_block_stop", { index: 0 });
	emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 10 } });
	emit("message_stop", {}); res.end();
}
before(async () => {
	server = createServer((req, res) => {
		if (req.method === "GET") {
			// Controlled web fixture, exercised inside the real app's browser component.
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end('<!doctype html><title>Browser QA</title><style>body{font:16px system-ui;margin:40px}button,input{font:inherit;padding:10px}main{height:1600px}</style><main><h1>浏览器交互测试页</h1><input id="name" aria-label="Name"><button id="add">增加</button><output id="count">0</output><p id="width"></p></main><script>window.inputTrace=[];for(const type of ["mousedown","mouseup","focusin","blur","resize","error"]){window.addEventListener(type,e=>inputTrace.push({type,t:performance.now(),target:e.target.id||e.target.tagName,active:document.activeElement?.id||document.activeElement?.tagName,x:e.clientX,y:e.clientY,width:innerWidth,height:innerHeight,rect:document.getElementById("name").getBoundingClientRect().toJSON(),message:e.message}),true);}add.onclick=()=>count.textContent=Number(count.textContent)+1;window.addEventListener("resize",()=>document.getElementById("width").textContent=innerWidth);</script>');
			return;
		}
		let raw = ""; req.on("data", (data) => { raw += data; });
		req.on("end", () => {
			const body = JSON.parse(raw);
			res.writeHead(200, { "content-type": "text/event-stream" });
			if (!body.tools?.length) { answer(res); return; }
			const last = body.messages?.at(-1)?.content;
			if (Array.isArray(last)) results.push(...last.filter((part: { type: string }) => part.type === "tool_result"));
			const script = [
				{ name: "skill", input: { name: "browser" } },
				{ name: "browser_open", input: { url: `http://127.0.0.1:${port}/page` } },
				{ name: "browser_act", input: { action: "type", selector: "#name", text: "测试输入" } },
				{ name: "browser_act", input: { action: "click", selector: "#add" } },
				{ name: "browser_viewport", input: { width: 390, height: 844 } },
				{ name: "browser_act", input: { action: "click", selector: "#add" } },
				{ name: "browser_act", input: { action: "eval", expression: "({value:document.querySelector('#name').value,count:document.querySelector('#count').textContent,width:innerWidth,height:innerHeight,styleCount:document.querySelectorAll('style').length})" } },
				{ name: "browser_screenshot", input: {} },
				{ name: "browser_viewport", input: { reset: true, zoom: 1.25 } },
				{ name: "browser_act", input: { action: "click", selector: "#add" } },
				{ name: "browser_viewport", input: { width: 390, height: 844, zoom: 1 } },
			];
			answer(res, script[step++]);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string"); port = address.port;
	app = await startApp({ port: 9617, seed: async (home) => {
		await seedInteractions(home, port);
		const path = join(home, "settings.json"); const settings = JSON.parse(await readFile(path, "utf8"));
		settings.alwaysAllow = [`http://127.0.0.1:${port}`];
		settings.screenshot = { enabled: false, shortcut: "" };
		await writeFile(path, JSON.stringify(settings));
	} });
});
after(async () => { await cleanupFixture(() => app?.stop(), () => closeListeningServer(server)); });
afterEach(async (t) => {
	if (!t.passed) {
		t.diagnostic(await app.evaluate<string>("document.body.innerText.slice(-6000)"));
		t.diagnostic(JSON.stringify({ step, results }, (key, value) => key === "data" && typeof value === "string" ? `[${value.length} bytes]` : value).slice(-16000));
		t.diagnostic(JSON.stringify(await app.evaluate("window.lyra.browser.state()")));
		t.diagnostic(JSON.stringify(await app.evaluate("document.querySelector('webview')?.executeJavaScript('window.inputTrace')")));
		const artifact = process.env.LYRA_E2E_ARTIFACTS;
		if (artifact) { await mkdir(artifact, { recursive: true }); const screenshot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" }); await writeFile(join(artifact, `browser-failed-${t.name.replace(/\W/g, "-")}.png`), Buffer.from(screenshot.data, "base64")); }
	}
});
async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{let n=1800;const f=()=>{if(${expression})resolve();else if(--n)requestAnimationFrame(f);else reject(new Error(${JSON.stringify(expression)}));};f();})`);
}

async function click(selector: string) {
	const point = await app.evaluate<{x:number;y:number}>(`new Promise((resolve,reject)=>{let previous='',same=0,left=180;const frame=()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el){reject(new Error('Missing '+${JSON.stringify(selector)}));return;}const r=el.getBoundingClientRect(),now=JSON.stringify(r);same=now===previous?same+1:0;previous=now;if(same>=3)resolve({x:r.x+r.width/2,y:r.y+r.height/2});else if(--left)requestAnimationFrame(frame);else reject(new Error('Unstable menu'));};frame();})`);
	await app.send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});
	await app.send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});
}
async function menu(label: string) {
	await click('[aria-label="浏览器菜单"]');
	await until(`document.querySelector('[role="menuitem"]')`);
	const index = await app.evaluate<number>(`[...document.querySelectorAll('[role="menuitem"]')].findIndex(e=>e.textContent.startsWith(${JSON.stringify(label)}))`);
	assert.ok(index >= 0, `menu contains ${label}`);
	await app.evaluate(`document.querySelectorAll('[data-browser-menu-target]').forEach(e=>e.removeAttribute('data-browser-menu-target'));document.querySelectorAll('[role="menuitem"]')[${index}].setAttribute('data-browser-menu-target','')`);
	await click('[data-browser-menu-target]');
}

test("agent drives the user's actual browser: native input, click, viewport and screenshot", async (t) => {
	const point = await app.evaluate<{x: number; y: number}>(`(()=>{const r=document.querySelector('[data-ly-row="qa-short"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
	await until(`document.querySelector('textarea[aria-label="消息"]')`);
	await app.evaluate(`window.lyra.agent.prompt('qa-short',[{type:'text',text:'BROWSER_QA 请检查浏览器'}])`);
	await until(`document.body.innerText.includes('BROWSER_QA_DONE')`);
	const state = await app.evaluate<{ tabs: { id: string; sessionId: string; viewport: { width: number } }[] }>("window.lyra.browser.state()");
	assert.equal(state.tabs.length, 1);
	assert.equal(state.tabs[0].sessionId, "qa-short");
	assert.equal(state.tabs[0].viewport.width, 390);
	const actual = await app.evaluate<{ value: string; count: string; width: number; height: number; cursor: boolean }>(`document.querySelector('webview').executeJavaScript("({value:document.querySelector('#name').value,count:document.querySelector('#count').textContent,width:innerWidth,height:innerHeight,cursor:!!document.getElementById('__lyra_agent_cursor')})")`);
	t.diagnostic(JSON.stringify(actual));
	assert.deepEqual(actual, { value: "测试输入", count: "3", width: 390, height: 844, cursor: false });
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-browser-cursor]').length`), 1);
	assert.equal(results.some((item) => typeof item === "object" && item !== null && "is_error" in item && item.is_error), false, JSON.stringify(results));
	const artifact = process.env.LYRA_E2E_ARTIFACTS;
	if (artifact) { await mkdir(artifact, { recursive: true }); const screenshot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" }); await writeFile(join(artifact, "browser-agent.png"), Buffer.from(screenshot.data, "base64")); }
});

test("tabs preserve forms and document identity through switching and closing the panel", async () => {
	const original = await app.evaluate<string>("window.lyra.browser.state().then(s=>s.activeId)");
	await app.evaluate(`document.querySelector('webview').executeJavaScript("document.body.dataset.identity='retained'")`);
	await app.evaluate(`window.lyra.browser.command({type:'open',url:'http://127.0.0.1:${port}/second',sessionId:'qa-short',newTab:true})`);
	await app.evaluate(`window.lyra.browser.command({type:'select',id:${JSON.stringify(original)}})`);
	assert.equal(await app.evaluate(`document.querySelector('[data-browser-page="${original}"]').executeJavaScript("document.body.dataset.identity")`), "retained");
	await app.evaluate(`document.querySelector('[data-dock-pane="browser"] [aria-label="关闭浏览器"]').click()`);
	await app.evaluate(`window.lyra.browser.command({type:'select',id:${JSON.stringify(original)}})`);
	assert.equal(await app.evaluate(`document.querySelector('[data-browser-page="${original}"]').executeJavaScript("document.querySelector('#name').value")`), "测试输入");
});


test("element inspection blocks page clicks and sends a real screenshot with DOM context to the composer", async (t) => {
	await menu("检查元素");
	await until(`document.querySelector('[aria-label="退出检查"]')`);
	await app.evaluate(`document.querySelector('webview').executeJavaScript("new Promise(resolve=>{const f=()=>document.getElementById('__lyra_inspect_layer')?resolve():requestAnimationFrame(f);f();})")`);
	await app.evaluate(`new Promise(resolve=>{let prior='',same=0;const f=()=>{const r=document.querySelector('webview').getBoundingClientRect();const now=JSON.stringify(r);same=now===prior?same+1:0;prior=now;if(same>=3)resolve();else requestAnimationFrame(f);};f();})`);
	const point = await app.evaluate<{x:number;y:number}>(`(async()=>{const page=[...document.querySelectorAll('webview')].find(p=>getComputedStyle(p).visibility==='visible');const r=page.getBoundingClientRect();const state=await window.lyra.browser.state();const tab=state.tabs.find(t=>t.id===state.activeId);const scale=tab.viewport?Math.min(1,r.width/tab.viewport.width,r.height/tab.viewport.height):1;const el=await page.executeJavaScript("(()=>{const r=document.querySelector('#add').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");return {x:r.x+el.x*tab.zoom*scale,y:r.y+el.y*tab.zoom*scale};})()`);
	await app.send("Input.dispatchMouseEvent",{type:"mouseMoved",...point});
	await app.send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});
	await app.send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});
	await until(`document.querySelector('[data-browser-selection] img')?.naturalWidth > 0`);
	assert.equal(await app.evaluate(`document.querySelector('webview').executeJavaScript("document.querySelector('#count').textContent")`), "3");
	const dimensions = await app.evaluate(`(()=>{const e=document.querySelector('[data-browser-selection] img');return {width:e.naturalWidth,height:e.naturalHeight,selector:document.querySelector('[data-browser-selection]').innerText};})()`);
	t.diagnostic(JSON.stringify(dimensions));
	await app.evaluate(`document.querySelector('[aria-label="添加到对话"]').click()`);
	await until(`document.querySelector('textarea[aria-label="消息"]').value.includes('Selector: #add')`);
	assert.match(await app.evaluate<string>(`document.querySelector('textarea[aria-label="消息"]').value`), /Styles:.*font-family/);
});

test("region selection captures the dragged bounds and native DevTools is available", async (t) => {
	await menu("框选区域");
	await app.evaluate(`document.querySelector('webview').executeJavaScript("new Promise(resolve=>{const f=()=>document.getElementById('__lyra_inspect_layer')?resolve():requestAnimationFrame(f);f();})")`);
	await app.evaluate(`new Promise(resolve=>{let before='',same=0;const f=()=>{const now=JSON.stringify(document.querySelector('webview').getBoundingClientRect());same=now===before?same+1:0;before=now;if(same>=3)resolve();else requestAnimationFrame(f);};f();})`);
	const area = await app.evaluate<{x:number;y:number;scale:number}>(`(async()=>{const r=document.querySelector('webview').getBoundingClientRect();return {x:r.x,y:r.y,scale:Math.min(1,r.width/390,r.height/844)}})()`);
	const start = {x:area.x+22*area.scale,y:area.y+22*area.scale}, end = {x:area.x+342*area.scale,y:area.y+212*area.scale};
	await app.send("Input.dispatchMouseEvent",{type:"mouseMoved",...start});
	await app.send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",buttons:1,clickCount:1,...start});
	await app.send("Input.dispatchMouseEvent",{type:"mouseMoved",button:"left",buttons:1,...end});
	await app.send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...end});
	await until(`document.querySelector('[data-browser-selection] img')?.naturalWidth > 0`);
	const size=await app.evaluate<{width:number;height:number}>(`(()=>{const i=document.querySelector('[data-browser-selection] img');return {width:i.naturalWidth,height:i.naturalHeight}})()`);
	assert.ok(size.width > size.height && size.height > 50);t.diagnostic(JSON.stringify({region:size,scale:area.scale}));
	await app.evaluate(`document.querySelector('[aria-label="取消选择"]').click()`);
	await menu("开发者工具");
	let target: {id:string;url:string} | undefined;
	for(let i=0;i<100;i++) { const targets: {id:string;url:string}[] = await (await fetch('http://127.0.0.1:9617/json/list')).json();target=targets.find(t=>t.url.startsWith('devtools://'));if(target)break;await app.evaluate('new Promise(requestAnimationFrame)'); }
	assert.ok(target,'native Chromium DevTools target');await app.send('Target.closeTarget',{targetId:target.id});
});

test("bookmarks persist, default zoom applies to new tabs and invalid commands leave the page intact", async () => {
	await menu("收藏网页");
	await until(`window.lyra && document.querySelector('[aria-label="浏览器菜单"][aria-expanded="false"]')`);
	await click('[aria-label="浏览器菜单"]');
	await until(`[...document.querySelectorAll('[role="menuitem"]')].some(e=>e.textContent==='取消收藏网页')`);
	await click('[aria-label="浏览器菜单"]');
	const saved=JSON.parse(await readFile(join(app.home,'settings.json'),'utf8'));assert.equal(saved.browser.bookmarks[0].url,`http://127.0.0.1:${port}/page`);
	await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,browser:{...s.browser,defaultZoom:1.25}}))`);
	await app.evaluate(`window.lyra.browser.command({type:'open',url:'http://127.0.0.1:${port}/zoom',sessionId:'qa-short',newTab:true})`);
	const id=await app.evaluate<string>(`window.lyra.browser.state().then(s=>s.activeId)`);
	assert.equal(await app.evaluate(`window.lyra.browser.state().then(s=>s.tabs.find(t=>t.id===s.activeId).zoom)`),1.25);
	assert.match(await app.evaluate<string>(`window.lyra.browser.command({type:'viewport',id:${JSON.stringify(id)},viewport:{width:0,height:800}}).then(()=>'',e=>e.message)`),/视口范围/);
	assert.match(await app.evaluate<string>(`window.lyra.browser.command({type:'open',url:'file:///etc/passwd',sessionId:'qa-short'}).then(()=>'',e=>e.message)`),/只允许/);
	assert.equal(await app.evaluate(`document.querySelector('[data-browser-page="${id}"]').executeJavaScript('document.title')`),'Browser QA');
	await app.evaluate(`window.lyra.browser.command({type:'close',id:${JSON.stringify(id)}})`);
	assert.equal(await app.evaluate(`window.lyra.browser.state().then(s=>s.tabs.some(t=>t.id===${JSON.stringify(id)}))`),false);
	await app.evaluate(`window.lyra.browser.command({type:'resize',id:${JSON.stringify(id)},width:400,height:600})`);
	const original=await app.evaluate<string>(`window.lyra.browser.state().then(s=>s.tabs[0].id)`);
	await app.evaluate(`window.lyra.browser.command({type:'select',id:${JSON.stringify(original)}})`);
	assert.equal(await app.evaluate(`document.querySelector('[data-browser-page="${original}"]').executeJavaScript('innerWidth')`),390);
});

test("fullscreen keeps the native browser page and form state, with one viewport resize per direction", async (t) => {
	const result=await app.evaluate<{same:boolean;identity:string;value:string;resizes:number[]}>(`(async()=>{
		const pane=document.querySelector('[data-dock-pane="browser"]');
		const state=await window.lyra.browser.state(),page=document.querySelector('[data-browser-page="'+state.activeId+'"]'),id=page.getWebContentsId();
		const resizes=[];let count=0;const observer=new ResizeObserver(()=>count++);observer.observe(page);
		for(const label of ['全屏','退出全屏']) {
			await new Promise(requestAnimationFrame);count=0;
			pane.querySelector('button[aria-label^="'+label+'"]').click();
			for(let i=0;i<25;i++)await new Promise(requestAnimationFrame);resizes.push(count);
		}
		observer.disconnect();
		return {same:page.isConnected&&page.getWebContentsId()===id,identity:await page.executeJavaScript('document.body.dataset.identity'),value:await page.executeJavaScript("document.querySelector('#name').value"),resizes};
	})()`);
	assert.equal(result.same,true);assert.equal(result.identity,"retained");assert.equal(result.value,"测试输入");assert.ok(result.resizes.every(n=>n<=3));
	t.diagnostic(JSON.stringify(result));
});


test("one navigation row, a compact menu and a icon empty state at wide and 375px widths", async (t) => {
	await app.evaluate(`window.lyra.browser.state().then(async s=>{for(const tab of s.tabs)await window.lyra.browser.command({type:'close',id:tab.id})})`);
	await until(`document.querySelector('[data-browser-empty]')`);
	for (const theme of ["light", "dark"]) for (const width of [1200, 375]) {
		await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${JSON.stringify(theme)}}}))`);
		await app.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
		await click('[aria-label="浏览器菜单"]');
		await until(`document.querySelector('[role="menuitem"]')`);
		await app.evaluate(`Promise.all(document.querySelector('[role="menuitem"]').closest('[role="menu"]').getAnimations({subtree:true}).map(a=>a.finished))`);
		const metrics = await app.evaluate<{toolbarHeight:number;overflow:number;empty:string;tabs:number;menuWidth:number}>(`(()=>{const toolbar=document.querySelector('[data-browser-toolbar]'),menu=document.querySelector('[role="menuitem"]').closest('[role="menu"]');return {toolbarHeight:toolbar.getBoundingClientRect().height,overflow:toolbar.scrollWidth-toolbar.clientWidth,empty:document.querySelector('[data-browser-empty]').textContent,tabs:document.querySelector('[data-browser-panel]').querySelectorAll('[role="tab"]').length,menuWidth:menu.getBoundingClientRect().width}})()`);
		assert.equal(metrics.toolbarHeight, 40); assert.equal(metrics.overflow, 0); assert.match(metrics.empty, /打开一个网页.*输入网址/); assert.equal(metrics.tabs, 0); assert.equal(metrics.menuWidth, 224); t.diagnostic(JSON.stringify({theme,width,...metrics}));
		const directory=process.env.LYRA_E2E_ARTIFACTS;
		if(directory){await mkdir(directory,{recursive:true});const shot=await app.send<{data:string}>("Page.captureScreenshot",{format:"png"});await writeFile(join(directory,`browser-menu-${theme}-${width}.png`),Buffer.from(shot.data,"base64"));}
		await app.send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
		await app.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
		await until(`document.querySelector('[aria-label="浏览器菜单"][aria-expanded="false"]')`);
		const emptyStyle = await app.evaluate(`(()=>{const empty=document.querySelector('[data-browser-empty]'),toolbar=document.querySelector('[data-browser-toolbar]');return {background:getComputedStyle(empty).backgroundColor,container:getComputedStyle(empty.parentElement).backgroundColor,divider:getComputedStyle(toolbar).borderBottomWidth,icons:empty.querySelectorAll('svg').length};})()`);
		assert.equal(emptyStyle.background, emptyStyle.container); assert.equal(emptyStyle.divider, "0px"); assert.equal(emptyStyle.icons, 1);
		await click('[data-browser-empty] button'); assert.equal(await app.evaluate(`document.activeElement.getAttribute('aria-label')`), "地址栏或搜索");
		if(directory){const shot=await app.send<{data:string}>("Page.captureScreenshot",{format:"png"});await writeFile(join(directory,`browser-empty-${theme}-${width}.png`),Buffer.from(shot.data,"base64"));}
	}
	await app.send("Emulation.clearDeviceMetricsOverride");
	await menu("新标签页");
	await until(`document.querySelector('webview')`);
	assert.match(await app.evaluate<string>(`document.querySelector('[data-browser-empty]').textContent`), /打开一个网页.*输入网址/);
	await menu("视口尺寸");
	await until(`document.querySelector('[aria-label="视口宽度"]')`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.startsWith('手机')).setAttribute('data-mobile-preset','')`);
	await click('[data-mobile-preset]');
	assert.equal(await app.evaluate(`document.querySelector('webview').executeJavaScript('innerWidth')`), 312);
	await click('[aria-label="浏览器菜单"]');
	await click('[aria-label="重置网页缩放"]');
	assert.equal(await app.evaluate(`document.querySelector('webview').executeJavaScript('innerWidth')`), 390);
	await app.send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
	await app.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
	await until(`document.querySelector('[aria-label="浏览器菜单"][aria-expanded="false"]')`);
	await menu("关闭标签页");
	await until(`!document.querySelector('webview')`);
});
