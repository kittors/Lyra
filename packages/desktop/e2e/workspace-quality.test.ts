import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { stopWorkspaceFixture } from "./workspace-quality-lifecycle.ts";

let app: RunningApp;
let server: Server;
let port = 0;
let step = 0;
const results: unknown[] = [];
function answer(res: ServerResponse, tool?: { name: string; input: object }) {
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: `qa-${step}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
	emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `call-${step}`, name: tool.name, input: {} } : { type: "text", text: "" } });
	emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: "WORKSPACE_QA_DONE" } });
	emit("content_block_stop", { index: 0 });
	emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 10 } });
	emit("message_stop", {}); res.end();
}
before(async () => {
	server = createServer((req, res) => {
		let raw = ""; req.on("data", (data) => { raw += data; });
		req.on("end", () => {
			const body = JSON.parse(raw); res.writeHead(200, { "content-type": "text/event-stream" });
			if (!body.tools?.length) { answer(res); return; }
			const last = body.messages?.at(-1)?.content;
			if (Array.isArray(last)) results.push(...last.filter((part: {type:string}) => part.type === "tool_result"));
			const script = [
				{name:"write",input:{path:"Sample.ts",content:"export const answer = 1;\n"}},
				{name:"edit",input:{path:"Sample.ts",old_string:"answer = 1",new_string:"answer = 2"}},
				{name:"bash",input:{command:"node --test verify.cjs",description:"运行实现验证"}},
				{name:"bash",input:{command:"node service.cjs",description:"启动本轮预览服务",run_in_background:true}},
			];
			answer(res, script[step++]);
		});
	});
	await new Promise<void>((resolve) => server.listen(0,"127.0.0.1",resolve));
	const addr=server.address(); assert.ok(addr && typeof addr !== "string");port=addr.port;
	app = await startApp({port: 9721,seed:async(home)=>{
		await seedInteractions(home,port);
		const path=join(home,"settings.json"), settings=JSON.parse(await readFile(path,"utf8"));
		settings.permissionMode="full"; settings.screenshot={enabled:false,shortcut:""};
		await writeFile(path,JSON.stringify(settings));
		const cwd=join(home,"project");
		await writeFile(join(cwd,"AGENTS.md"),"Use the existing project scripts for verification.\n");
		await writeFile(join(cwd,"verify.cjs"),"const t=require('node:test');const a=require('node:assert/strict');const fs=require('node:fs');t('answer',()=>a.match(fs.readFileSync('Sample.ts','utf8'),/answer = 2/));\n");
		await writeFile(join(cwd,"service.cjs"),"const http=require('node:http');const s=http.createServer((q,r)=>r.end('SERVICE_QA'));s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port));\n");
		const memory=join(home,"projects",settings.projects[0].id,"memory");await mkdir(memory,{recursive:true});
		await writeFile(join(memory,"MEMORY.md"),"# 项目记忆\n\nMEMORY_QA: 先检查当前项目的验证脚本。\n");
	}});
});
after(async(t)=>{ await stopWorkspaceFixture(app, server, (message) => t.diagnostic(message)); });
afterEach(async(t)=>{if(!t.passed){t.diagnostic(await app.evaluate<string>("document.body.innerText.slice(-4500)")); t.diagnostic(JSON.stringify({step,results})); await shot("workspace-failure");}});
async function until(expression:string){await app.evaluate(`new Promise((resolve,reject)=>{let n=1200;const f=()=>{if(${expression})resolve();else if(--n)requestAnimationFrame(f);else reject(new Error(${JSON.stringify(expression)}));};f();})`);}
async function click(selector:string){
	await until(`document.querySelector(${JSON.stringify(selector)})`);
	// Dock closure animates the toolbar; measure only after it reaches its actual hit target.
	await app.evaluate("Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})))");
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await app.evaluate("new Promise(requestAnimationFrame)");
	const point=await app.evaluate<{x:number;y:number}>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw new Error('control is covered: '+${JSON.stringify(selector)});return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	await app.send("Input.dispatchMouseEvent",{type:"mouseMoved",...point});await app.send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});await app.send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});
}
async function label(text:string,selector="button"){await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('No label '+${JSON.stringify(text)});e.setAttribute('data-qa-label','');})()`);await click('[data-qa-label]');await app.evaluate("document.querySelector('[data-qa-label]')?.removeAttribute('data-qa-label')");}
async function shot(name:string){const dir=process.env.LYRA_E2E_ARTIFACTS;if(!dir)return;await mkdir(dir,{recursive:true});await app.evaluate("Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))).then(()=>new Promise(requestAnimationFrame))");const result=await app.send<{data:string}>("Page.captureScreenshot",{format:"png"});await writeFile(join(dir,`${name}.png`),Buffer.from(result.data,"base64"));}
async function escape(){await app.send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",windowsVirtualKeyCode:27});await app.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",windowsVirtualKeyCode:27});}

test("new profiles default to recently created and memory disclosure opens the actual source file",async(t)=>{
	await click('[data-ly-row="qa-short"]');
	await click('[aria-label="列表设置"]'); await until(`document.body.innerText.includes('最近创建')`);
	assert.equal(await app.evaluate("localStorage.getItem('ly-sidebar-sort')"),"createdAt"); await escape();
	await until(`document.querySelector('[aria-label^="上下文占用"]')`);await click('[aria-label^="上下文占用"]');
	await until(`document.querySelector('[aria-label="上下文窗口用量"]')?.innerText.includes('记忆文件')`);await label("记忆文件");
	const reading=await app.evaluate<{border:string;paths:string[]}>(`(()=>{const p=document.querySelector('[aria-label="上下文窗口用量"]');return {border:getComputedStyle(p.querySelector('section')).borderTopWidth,paths:[...p.querySelectorAll('button[data-ly-tip]')].map(e=>e.dataset.lyTip)};})()`);
	assert.equal(reading.border,"0px");assert.ok(reading.paths.some(p=>p.endsWith("AGENTS.md")));assert.ok(reading.paths.some(p=>p.endsWith("MEMORY.md")));
	await shot("memory-file-disclosure");
	await app.evaluate(`document.querySelector('[aria-label="上下文窗口用量"] button[data-ly-tip$="MEMORY.md"]').click()`);
	await until(`document.querySelector('[data-dock-pane="file"]')?.innerText.includes('MEMORY_QA')`);
	t.diagnostic(JSON.stringify(reading));
	await click('[data-dock-pane="file"] button[aria-label^="关闭"]');
});

test("motto persists, IME keeps confirmation keys and screenshot disabling reaches the main process",async(t)=>{
	await click('button:has(svg.lucide-settings)');await until(`[...document.querySelectorAll('nav')].some(e=>e.checkVisibility()&&e.innerText.includes('个性化'))`);await label("个性化","nav button");
	await click('[aria-label="侧边栏座右铭"]');await app.send("Input.imeSetComposition",{text:"中",selectionStart:1,selectionEnd:1});
	await app.send("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",windowsVirtualKeyCode:13});await app.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",windowsVirtualKeyCode:13});
	assert.ok(await app.evaluate(`!!document.querySelector('[aria-label="侧边栏座右铭"]')`));
	await app.send("Input.insertText",{text:"中文输入"});await app.evaluate(`document.querySelector('[aria-label="侧边栏座右铭"]').select()`);await app.send("Input.insertText",{text:"保持好奇，认真求证。"});
	await click('[aria-label="保存座右铭"]');await until(`document.querySelector('[aria-label="保存座右铭"]').disabled`);
	assert.equal((JSON.parse(await readFile(join(app.home,"settings.json"),"utf8"))).personalization.sidebarMotto,"保持好奇，认真求证。");
	await label("屏幕截图","nav button");await until(`document.querySelector('[data-view="screenshot"]')`);
	const result=await app.evaluate<string>(`window.lyra.screenshot.start().then(()=>"started",e=>e.message)`);assert.match(result,/已关闭/);
	await shot("screenshot-settings-disabled");await label("返回工作区","nav button");
	assert.match(await app.evaluate<string>("document.body.innerText"),/保持好奇/);t.diagnostic("Chromium IME composition, persisted motto and authoritative screenshot disable verified");
});

test("engineering delivery shows net syntax diffs, a real report and a live owned service",async(t)=>{
	await app.evaluate(`window.lyra.agent.prompt('qa-short',[{type:'text',text:'WORKSPACE_QA 实现并验证'}])`);
	await until(`document.body.innerText.includes('WORKSPACE_QA_DONE')`);
	await until(`document.querySelector('[data-turn-delivery]')?.innerText.includes('1 个文件')`);
	assert.equal(await readFile(join(app.home,"project","Sample.ts"),"utf8"),"export const answer = 2;\n");
	const timestamp=await app.evaluate<number>(`window.lyra.sessions.list().then(s=>window.lyra.sessions.transcript(s.find(s=>s.id==='qa-short').projectId,'qa-short')).then(s=>s.messages.findLast(m=>m.role==='assistant').timestamp)`);
	const delivery=await app.evaluate<{reportPath:string;files:{added:number;removed:number}[];commands:{status:string}[]}>(`window.lyra.delivery.get('qa-short',${timestamp})`);
	assert.equal(delivery.files.length,1);assert.equal(delivery.files[0].removed,0);assert.ok(delivery.commands.some(c=>c.status==='exit 0'));
	assert.match(await readFile(delivery.reportPath,"utf8"),/answer = 2/);assert.match(await readFile(delivery.reportPath,"utf8"),/本轮实现与验证记录/);
	// 等的是交付卡片自己。这里从前等「在内置浏览器打开」，可那个按钮在任务面板的服务列表里，
	// 而任务面板要到下面第 122 行才打开——在它存在之前等它，只能等到超时。
	await until(`document.querySelector('[data-turn-delivery] [data-delivery-file]')`);
	await app.evaluate("Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))).then(()=>document.fonts.ready)");
	await app.evaluate(`document.querySelector('[data-turn-delivery] [data-delivery-file]').scrollIntoView({block:'nearest',behavior:'instant'})`);
	await app.evaluate("new Promise(requestAnimationFrame)");
	const row=await app.evaluate<{x:number;y:number;height:number}>(`(()=>{const e=document.querySelector('[data-turn-delivery] [data-delivery-file]'),r=e.getBoundingClientRect();if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw new Error('delivery row is covered');return {x:r.x+r.width/2,y:r.y+r.height/2,height:r.height}})()`);
	await app.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:row.x,y:row.y});await until(`document.querySelector('[aria-label="文件变更预览"] .ly-diff-add')`);
	await shot("turn-delivery-diff");
	assert.equal(await app.evaluate(`document.querySelector('[data-turn-delivery] [data-delivery-file]').getBoundingClientRect().height`),row.height);
	assert.ok(await app.evaluate(`document.querySelector('[aria-label="文件变更预览"]').getBoundingClientRect().bottom <= document.querySelector('[data-delivery-file]').getBoundingClientRect().top`), "the preview must stay above its file row");await escape();
	await click('[aria-label="查看实现与验证记录"]');await until(`document.querySelector('[data-dock-pane="file"]')?.innerText.includes('命令与验证证据')`);
	await shot("delivery-report-preview");await click('[data-dock-pane="file"] button[aria-label^="关闭"]');
	await click('[aria-label="面板"]');await until(`document.querySelector('[role="menuitem"]')`);
	await app.evaluate(`(()=>{const e=[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.innerText.split('\\n')[0]==='任务');if(!e)throw new Error('任务菜单不存在');e.setAttribute('data-qa-task','');})()`);await click('[data-qa-task]');
	/*
	 * 端点没出现时，把探测自己的说法一起报出来。
	 *
	 * `discoveryError` 只挂在一个图标的 `data-ly-tip` 上，不进 `innerText`——这条在 Windows 上
	 * 红过一次，日志里就只剩「没找到 127.0.0.1:」，看不出是那段 PowerShell 失败了，还是父子
	 * 进程没对上、监听的那个 pid 不在 `descendants` 里。差别决定改哪儿。
	 */
	await until(`document.querySelector('[data-session-services]')?.innerText.includes('127.0.0.1:')`).catch(async (cause: unknown) => {
		const report = await app.evaluate(`window.lyra.services.list('qa-short').then(s=>JSON.stringify({discoveryError:s.discoveryError,jobs:s.jobs.map(j=>({pid:j.pid,finishedAt:j.finishedAt,endpoints:j.endpoints}))}))`);
		throw new Error(`服务端点没有出现，探测的说法：${String(report)}`, { cause });
	});
	const services=await app.evaluate<{jobs:{id:string;pid:number;endpoints:{url:string;port:number}[]}[]}>("window.lyra.services.list('qa-short')");
	const job=services.jobs.find(j=>j.endpoints.length);assert.ok(job);assert.equal(await (await fetch(job.endpoints[0].url)).text(),"SERVICE_QA");
	assert.equal(await app.evaluate(`window.lyra.services.stop('qa-long',${JSON.stringify(job.id)},true)`),false);
	await shot("session-owned-service");t.diagnostic(JSON.stringify({files:delivery.files,service:job,hoverRowHeight:row.height}));
});

test("undo protects later user changes and service stop really closes the owned listener",async()=>{
	const path=join(app.home,"project","Sample.ts");await writeFile(path,"user added work\n");
	const timestamp=await app.evaluate<number>(`window.lyra.sessions.list().then(s=>window.lyra.sessions.transcript(s.find(s=>s.id==='qa-short').projectId,'qa-short')).then(s=>s.messages.findLast(m=>m.role==='assistant').timestamp)`);
	assert.match(await app.evaluate<string>(`window.lyra.delivery.undo('qa-short',${timestamp},${JSON.stringify(path)}).then(()=>"undone",e=>e.message)`),/没有可安全撤销/);
	assert.equal(await readFile(path,"utf8"),"user added work\n");
	await writeFile(path,"export const answer = 2;\n");
	await app.evaluate(`window.lyra.delivery.undo('qa-short',${timestamp},${JSON.stringify(path)})`);await assert.rejects(readFile(path),{code:"ENOENT"});
	await click('[data-session-services] [aria-label="停止服务"]');await until(`document.querySelectorAll('[data-service-id]').length===0`);
	const stopped=await app.evaluate<{jobs:{finishedAt?:number}[]}>("window.lyra.services.list('qa-short')");assert.ok(stopped.jobs.every(j=>j.finishedAt!==undefined));
});
