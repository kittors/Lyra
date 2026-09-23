import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
let server: Server;
let port = 0;
let run = 0;
let call = 0;
let queue: { name: string; input: object }[] = [];
before(async () => {
	server = createServer((req, res) => {
		if (req.method === "GET") {
			// Synthetic local pages and model responses exercise the real Electron tool pipeline.
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(`<!doctype html><title>Cursor QA</title><style>body{font:16px system-ui;margin:24px}main{height:1800px}button{padding:16px;font:inherit}dialog{background:white;border:1px solid #ccc}dialog::backdrop{background:white}</style><main><h1>光标交互验证</h1><button id="target" onclick="this.textContent='已点击'">点击这里</button></main><dialog><button id="modal">弹窗里的按钮</button></dialog><script>window.inputEvents=[];for(const type of ['mousemove','mousedown','mouseup','click','focus','resize'])window.addEventListener(type,e=>inputEvents.push({type,x:e.clientX,y:e.clientY,target:e.target.id,width:innerWidth,height:innerHeight,focused:document.hasFocus()}),true);</script>`);
			return;
		}
		let raw = ""; req.on("data", (data) => { raw += data; });
		req.on("end", () => {
			const body = JSON.parse(raw);
			const tool = body.tools?.length ? queue.shift() : undefined;
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			res.writeHead(200, { "content-type": "text/event-stream" });
			emit("message_start", { message: { id: `cursor-${++call}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `call-${call}`, name: tool.name, input: {} } : { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: `CURSOR_DONE_${run}` } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 10 } });
			emit("message_stop", {}); res.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string"); port = address.port;
	app = await startApp({ port: 9638, seed: async (home) => {
		await seedInteractions(home, port);
		const path = join(home, "settings.json"), settings = JSON.parse(await readFile(path, "utf8"));
		settings.alwaysAllow = [`http://127.0.0.1:${port}`]; settings.screenshot = { enabled: false, shortcut: "" };
		await writeFile(path, JSON.stringify(settings));
	} });
	const point = await app.evaluate<{x:number;y:number}>(`(()=>{const r=document.querySelector('[data-ly-row="qa-short"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	await app.send("Input.dispatchMouseEvent", {type:"mousePressed",button:"left",clickCount:1,...point});
	await app.send("Input.dispatchMouseEvent", {type:"mouseReleased",button:"left",clickCount:1,...point});
	/*
	 * What this file measures is the agent's pointer as seen by someone watching the panel — so that
	 * person opens it first. An agent no longer opens the panel for its own pages (see `openBrowser`),
	 * and never closes it either, so once is enough for every case below.
	 */
	await app.evaluate(`new Promise((resolve,reject)=>{let n=1800;const f=()=>{if(document.querySelector('textarea[aria-label="消息"]'))resolve();else if(--n)requestAnimationFrame(f);else reject(new Error('conversation did not open'));};f();})`);
	const toggle = await app.evaluate<{x:number;y:number}>(`(()=>{const r=document.querySelector('[data-ly-panel-quick] button[aria-label^="浏览器"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	await app.send("Input.dispatchMouseEvent", {type:"mousePressed",button:"left",clickCount:1,...toggle});
	await app.send("Input.dispatchMouseEvent", {type:"mouseReleased",button:"left",clickCount:1,...toggle});
	await app.evaluate(`new Promise((resolve,reject)=>{let n=600;const f=()=>{const pane=document.querySelector('[data-dock-pane="browser"]');if(pane&&!pane.hasAttribute('inert'))resolve();else if(--n)requestAnimationFrame(f);else reject(new Error('browser panel did not open'));};f();})`);
});
after(async () => { await cleanupFixture(() => app?.stop(), () => closeListeningServer(server)); });

async function drive(steps: typeof queue) {
	queue = steps; run++;
	await app.evaluate(`window.lyra.agent.prompt('qa-short',[{type:'text',text:'CURSOR_RUN_${run}'}])`);
	await app.evaluate(`new Promise((resolve,reject)=>{let n=1800;const f=()=>{if(document.body.innerText.includes('CURSOR_DONE_${run}'))resolve();else if(--n)requestAnimationFrame(f);else reject(new Error(document.body.innerText.slice(-3000)));};f();})`);
}
async function page<T>(expression: string): Promise<T> {
	return app.evaluate(`document.querySelector('webview').executeJavaScript(${JSON.stringify(expression)})`);
}
async function pixels(name: string) {
	await app.evaluate(`Promise.all((document.querySelector('[data-browser-cursor]')?.getAnimations({subtree:true}) ?? []).map(a=>a.finished))`);
	const clip = await app.evaluate<{x:number;y:number;width:number;height:number} | null>(`(async()=>{const host=document.querySelector('[data-browser-cursor] svg');if(host){const r=host.getBoundingClientRect();return {x:r.x-2,y:r.y-2,width:r.width+4,height:r.height+4};}const page=document.querySelector('webview'),r=page.getBoundingClientRect(),state=await window.lyra.browser.state(),tab=state.tabs[0];const cursor=await page.executeJavaScript("(()=>{const c=document.getElementById('__lyra_agent_cursor');if(!c)return null;const r=c.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");if(!cursor)return null;const scale=tab.zoom*(tab.viewport?Math.min(1,r.width/tab.viewport.width,r.height/tab.viewport.height):1);return {x:r.x+cursor.x*scale,y:r.y+cursor.y*scale,width:cursor.width*scale,height:cursor.height*scale};})()`);
	if (!clip) return 0;
	const shot = await app.send<{data:string}>("Page.captureScreenshot", { format: "png" });
	const folder = process.env.LYRA_E2E_ARTIFACTS;
	if (folder) { await mkdir(folder, { recursive: true }); await writeFile(join(folder, `${name}.png`), Buffer.from(shot.data, "base64")); }
	await app.evaluate(`document.querySelector('[data-browser-cursor]')?.style.setProperty('visibility','hidden')`);
	await page(`document.getElementById('__lyra_agent_cursor')?.style.setProperty('visibility','hidden')`);
	const hidden = await app.send<{data:string}>("Page.captureScreenshot", { format: "png" });
	await app.evaluate(`document.querySelector('[data-browser-cursor]')?.style.removeProperty('visibility')`);
	await page(`document.getElementById('__lyra_agent_cursor')?.style.removeProperty('visibility')`);
	return app.evaluate<number>(`(async()=>{const buffers=[];for(const src of ${JSON.stringify([shot.data,hidden.data])}){const image=new Image();image.src='data:image/png;base64,'+src;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const r=${JSON.stringify(clip)},scale=image.width/innerWidth;buffers.push(ctx.getImageData(Math.round(r.x*scale),Math.round(r.y*scale),Math.round(r.width*scale),Math.round(r.height*scale)).data);}let changed=0;for(let i=0;i<buffers[0].length;i+=4)if([0,1,2].some(c=>Math.abs(buffers[0][i+c]-buffers[1][i+c])>20))changed++;return changed;})()`);
}

test("pointer is visibly painted for native click, including a modal top layer", async (t) => {
	await drive([{ name: "browser_open", input: { url: `http://127.0.0.1:${port}/page` } }, { name: "browser_act", input: { action: "click", selector: "#target" } }]);
	const label = await page("document.querySelector('#target').textContent");
	t.diagnostic(JSON.stringify(await page("inputEvents")));
	if (label !== "已点击") { t.diagnostic(JSON.stringify(await page("({events:inputEvents,label:document.querySelector('#target').textContent,bounds:document.querySelector('#target').getBoundingClientRect().toJSON()})"))); t.diagnostic(JSON.stringify(await app.evaluate("window.lyra.browser.state()"))); }
	assert.equal(label, "已点击");
	const normal = await pixels("cursor-normal");
	assert.ok(normal > 100, `normal pointer has ${normal} painted pixels`);
	await page("document.querySelector('dialog').showModal()");
	await drive([{ name: "browser_act", input: { action: "hover", selector: "#modal" } }]);
	const modal = await pixels("cursor-modal"); t.diagnostic(JSON.stringify({normal, modal}));
	assert.ok(modal > 100, `pointer above modal has ${modal} painted pixels`);
});

test("navigation and scroll-only operations retain a visible pointer", async (t) => {
	await drive([{ name: "browser_open", input: { url: `http://127.0.0.1:${port}/next` } }, { name: "browser_act", input: { action: "scroll", y: 300 } }]);
	assert.equal(await page("scrollY"), 300);
	const painted = await pixels("cursor-scroll"); t.diagnostic(JSON.stringify({painted}));
	assert.ok(painted > 100, `pointer after navigation and scroll has ${painted} painted pixels`);
});


test("pointer stays 24 CSS pixels and aligns with real targets across zoom, viewport and panel resizing", async (t) => {
	const measurements = [];
	for (const zoom of [0.5, 1.25, 2]) {
		await drive([{name:"browser_viewport",input:{width:1440,height:900,zoom}}, {name:"browser_act",input:{action:"hover",selector:"#target"}}]);
		await app.evaluate(`Promise.all(document.querySelector('[data-browser-cursor]').getAnimations({subtree:true}).map(a=>a.finished))`);
		const result = await app.evaluate<{error:number;width:number;height:number}>(`(async()=>{const state=await window.lyra.browser.state(),tab=state.tabs.find(t=>t.id===state.activeId),page=document.querySelector('[data-browser-page="'+tab.id+'"]'),r=page.getBoundingClientRect();const point=await page.executeJavaScript("(()=>{const r=document.querySelector('#target').getBoundingClientRect();return {x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2}})()");const cursor=document.querySelector('[data-browser-cursor="'+tab.id+'"]'),c=cursor.getBoundingClientRect(),svg=cursor.querySelector('svg').getBoundingClientRect(),scale=tab.zoom*Math.min(1,r.width/tab.viewport.width,r.height/tab.viewport.height);return {error:Math.hypot(c.x-r.x-point.x*scale,c.y-r.y-point.y*scale),width:svg.width,height:svg.height}})()`);
		assert.ok(result.error < 2, JSON.stringify(result)); assert.equal(result.width,24); assert.equal(result.height,24); measurements.push({zoom,...result});
	}
	t.diagnostic(JSON.stringify(measurements));
	await pixels("cursor-desktop-viewport");
	await app.send("Emulation.setDeviceMetricsOverride",{width:1000,height:800,deviceScaleFactor:1,mobile:false});
	await drive([{name:"browser_act",input:{action:"click",selector:"#target"}}]);
	assert.ok(await pixels("cursor-narrow-panel") > 100);
	await app.send("Emulation.clearDeviceMetricsOverride");
});


test("rounded pointer and click feedback remain visible on light and dark pages in both app themes", async (t) => {
	const motion = await app.evaluate<{setting:string|null;systemReduced:boolean}>(`({setting:document.documentElement.dataset.reduceMotion??null,systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches})`);
	t.diagnostic(JSON.stringify({motion}));
	assert.equal(motion.setting, "off", "click feedback is measured with animations enabled, independently of the runner's accessibility setting");
	for (const theme of ["light", "dark"]) {
		await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${JSON.stringify(theme)}}}))`);
		for (const background of ["white", "#22252b"]) {
			await page(`document.documentElement.style.background=${JSON.stringify(background)};document.body.style.color=${JSON.stringify(background === "white" ? "black" : "#eee")}`);
			await app.evaluate(`(()=>{window.__cursorSamples=[];window.__sampleCursor=true;const sample=()=>{const ring=document.querySelector('[data-browser-click-ring]');if(ring)window.__cursorSamples.push(Number(getComputedStyle(ring).opacity));if(window.__sampleCursor)requestAnimationFrame(sample);};requestAnimationFrame(sample);})()`);
			await drive([{name:"browser_act",input:{action:"click",selector:"#target"}}]);
			const painted=await pixels(`cursor-${theme}-${background === "white" ? "light-page" : "dark-page"}`);
			const opacity=await app.evaluate<number>(`window.__sampleCursor=false;Math.max(...window.__cursorSamples)`);
			t.diagnostic(JSON.stringify({theme,background,painted,clickOpacity:opacity}));
			assert.ok(painted>100,JSON.stringify({theme,background,painted}));assert.ok(opacity>0.2, `click ring opacity ${opacity}`);
		}
	}
	// Media emulation is scoped to a CDP connection, unlike the persistent viewport override.
	const targets: {type:string;url:string;webSocketDebuggerUrl:string}[] = await (await fetch("http://127.0.0.1:9638/json/list")).json();
	const mainUrl = await app.evaluate<string>("location.href");
	const target = targets.find(entry=>entry.type === "page" && entry.url === mainUrl); assert.ok(target);
	// The preceding cases explicitly enable motion; this case must follow the emulated OS choice.
	await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,reduceMotion:'system'}}))`);
	await app.evaluate(`new Promise((resolve,reject)=>{let left=180;const frame=()=>{if(document.documentElement.dataset.reduceMotion==='system')resolve();else if(--left)requestAnimationFrame(frame);else reject(new Error('system motion preference did not apply'));};frame();})`);
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	try {
		await new Promise<void>((resolve,reject)=>{socket.addEventListener("open",()=>resolve(),{once:true});socket.addEventListener("error",()=>reject(new Error("CDP media connection failed")),{once:true});});
		const applied = new Promise<void>((resolve,reject)=>socket.addEventListener("message",event=>{const reply=JSON.parse(String(event.data));if(reply.id===1){if(reply.error)reject(new Error(JSON.stringify(reply.error)));else resolve();}}));
		socket.send(JSON.stringify({id:1,method:"Emulation.setEmulatedMedia",params:{features:[{name:"prefers-reduced-motion",value:"reduce"}]}}));
		await applied;
		queue = [{name:"browser_act",input:{action:"click",selector:"#target"}}]; run++;
		const measured = new Promise<unknown>((resolve,reject)=>socket.addEventListener("message",event=>{const reply=JSON.parse(String(event.data));if(reply.id===2){if(reply.error || reply.result?.exceptionDetails)reject(new Error(JSON.stringify(reply)));else resolve(reply.result.result.value);}}));
		socket.send(JSON.stringify({id:2,method:"Runtime.evaluate",params:{awaitPromise:true,returnByValue:true,expression:`(async()=>{await window.lyra.agent.prompt('qa-short',[{type:'text',text:'CURSOR_RUN_${run}'}]);await new Promise((resolve,reject)=>{let left=1800;const frame=()=>{if(document.body.innerText.includes('CURSOR_DONE_${run}'))resolve();else if(--left)requestAnimationFrame(frame);else reject(new Error('reduced-motion run did not finish'));};frame();});return {reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,transition:getComputedStyle(document.querySelector('[data-browser-cursor]')).transitionDuration,rings:document.querySelector('[data-browser-click-ring]').getAnimations().length};})()`}}));
		// The app-wide reduced-motion rule keeps a 0.01ms transition so lifecycle events still fire.
		assert.deepEqual(await measured,{reduced:true,transition:'1e-05s',rings:0});
	} finally {
		socket.close();
		await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,reduceMotion:'off'}}))`);
	}

});
