import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, afterEach, before, test, type TestContext } from "node:test";
import type { SessionMeta } from "@lyra/core";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
let server: Server;
let modelRequests = 0;
let completeReply: (() => void) | undefined;
let onModelRequest: (() => void) | undefined;

before(async () => {
	server = createServer((req, res) => {
		modelRequests++;
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.flushHeaders();
			completeReply = () => {
				const send = (event: { type: string; [key: string]: unknown }) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
				send({ type: "message_start", message: { id: "qa-reply", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
				send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
				send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "初始化后完成，后台缓存收到回复。" } });
				send({ type: "content_block_stop", index: 0 });
				send({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } });
				send({ type: "message_stop" });
				res.end();
			};
			onModelRequest?.();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string");
	app = await startApp({ port: 9602, seed: async (home) => {
		await seedInteractions(home, address.port);
		const mcp = join(home, "slow-mcp.cjs");
		// A deterministic slow capability handshake, not a delay added to production code.
		await writeFile(mcp, `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
const q=JSON.parse(line);if(q.id===undefined)return;
const reply=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');
if(q.method==='initialize')setTimeout(()=>reply({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'slow-qa',version:'1'}}),2400);
else if(q.method==='tools/list')reply({tools:[]});else reply({});});`);
		const file = join(home, "settings.json");
		const settings = JSON.parse(await readFile(file, "utf8"));
		settings.mcpServers = [{ id: "slow-qa", name: "Slow QA", transport: "stdio", enabled: true, command: process.execPath, args: [mcp] }];
		await writeFile(file, JSON.stringify(settings));
	} });
	await app.evaluate(`(() => {
		window.qaStartupTrace=[];
		for(const type of ['pointerdown','pointerup','click','focusin','input'])document.addEventListener(type,event=>{
			const target=event.target;
			window.qaStartupTrace.push({type,time:performance.now(),target:target.outerHTML?.slice(0,240),value:target.value,
				field:document.querySelector('textarea')?.value,heading:document.querySelector('h1')?.textContent});
			if(window.qaStartupTrace.length>80)window.qaStartupTrace.shift();
		},true);
	})()`);
});
after(async () => { await cleanupFixture(() => app?.stop(), () => closeListeningServer(server)); });
afterEach(async (t) => {
	if (t.passed) return;
	await shot("group-loading-failure");
	t.diagnostic(await app.evaluate<string>(`JSON.stringify({trace:window.qaStartupTrace,field:document.querySelector('textarea')?.value,active:document.activeElement?.outerHTML.slice(0,300),body:document.body.innerText.slice(-1600)})`));
	t.diagnostic(await app.evaluate<string>(`JSON.stringify([...document.querySelectorAll('[class~="group/project"] > button[aria-expanded]')].map(b=>({text:b.textContent,expanded:b.getAttribute('aria-expanded'),html:b.innerHTML})))`));
});

async function click(selector: string): Promise<void> {
	const at = await app.evaluate<{ x: number; y: number }>(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility({visibilityProperty:true}));if(!e)throw new Error(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;window.qaStartupTrace.push({type:'aim',selector:${JSON.stringify(selector)},time:performance.now(),rect:r.toJSON(),hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,240),field:document.querySelector('textarea')?.value});return {x,y};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...at });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...at });
	await frames(2);
}
async function frames(n: number): Promise<void> {
	await app.evaluate(`new Promise(r=>{let n=${n};const f=()=>--n?requestAnimationFrame(f):r();requestAnimationFrame(f);})`);
}
async function submit(): Promise<{ meta: SessionMeta; elapsed: number }> {
	await click('button[aria-label="在「交互验证」里新建会话"]');
	// Returning from a worktree replaces the previous conversation's composer after workspace.info.
	// Target the new draft, rather than focusing an old textarea between its pointerdown and unmount.
	await app.evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+8000;const step=()=>{
		if(document.querySelector('main h1')&&!document.querySelector('.ly-transcript')&&document.querySelector('textarea'))resolve();
		else if(performance.now()<end)requestAnimationFrame(step);else reject(new Error('new project draft did not appear'));
	};step();})`);
	await click('textarea');
	assert.equal(await app.evaluate(`document.activeElement===document.querySelector('textarea')`), true, "typing targets the new draft's live field");
	await app.send("Input.insertText", { text: "相同提示词隔离验证" });
	assert.equal(await app.evaluate(`document.querySelector('textarea').value`), "相同提示词隔离验证");
	const before = await app.evaluate<string[]>(`[...document.querySelectorAll('[data-ly-row]')].map(e=>e.dataset.lyRow)`);
	const start = performance.now();
	await click('button[aria-label="发送"]');
	const id = await app.evaluate<string>(`new Promise((resolve,reject)=>{let n=120;const before=${JSON.stringify(before)};const step=()=>{const row=[...document.querySelectorAll('[data-ly-row]')].find(e=>!before.includes(e.dataset.lyRow));if(row)resolve(row.dataset.lyRow);else if(--n)requestAnimationFrame(step);else reject(new Error('no immediate session row'));};step();})`);
	const elapsed = performance.now() - start;
	const meta = await app.evaluate<SessionMeta>(`window.lyra.sessions.list().then(list=>list.find(s=>s.id===${JSON.stringify(id)}))`);
	return { meta, elapsed };
}

test("slow MCP startup still creates immediate titled rows, aggregates collapsed status, and isolates identical prompts", async (t) => {
	const first = await submit();
	t.diagnostic(`first row ${first.elapsed}ms; provider requests ${modelRequests}`);
	assert.ok(first.elapsed < 1000, `opening row took ${first.elapsed}ms with a 2400ms MCP handshake`);
	assert.equal(first.meta.title, "相同提示词隔离验证"); assert.equal(first.meta.messageCount, 1);
	assert.equal(modelRequests, 0, "the row is present before either MCP or the provider responds");
	assert.equal(await app.evaluate(`!!document.querySelector('[class~="group/project"] > button[aria-expanded="true"] [aria-label*="个会话正在执行"]')`), false);
	await click('[class~="group/project"] > button[aria-expanded]');
	await frames(20);
	const group = await app.evaluate<{ expanded: string; label: string; hasSpinner: boolean }>(`(()=>{const b=document.querySelector('[class~="group/project"] > button[aria-expanded]');const status=b.querySelector('[aria-label*="个会话正在执行"]');return {expanded:b.getAttribute('aria-expanded'),label:status?.getAttribute('aria-label'),hasSpinner:!!status?.querySelector('svg.ly-star')};})()`);
	assert.equal(group.expanded, "false"); assert.equal(group.label, "1 个会话正在执行"); assert.equal(group.hasSpinner, true);
	await click('button[aria-label="停止"]');
	const second = await submit();
	assert.notEqual(first.meta.id, second.meta.id); assert.equal(first.meta.title, second.meta.title);
	await click('button[aria-label="停止"]');
	await frames(180);
	assert.equal(modelRequests, 0, "cancellation during initialization never starts the provider afterwards");
	const stored = await app.evaluate<{ id: string; count: number; pending: boolean; running: boolean }[]>(`Promise.all(${JSON.stringify([first.meta, second.meta])}.map(async s=>{const t=await window.lyra.sessions.transcript(s.projectId,s.id);return {id:s.id,count:t.messages.length,pending:!!t.meta.pendingPrompt,running:t.running};}))`);
	assert.ok(stored.every((s) => s.count === 1 && !s.pending && !s.running));
	t.diagnostic(JSON.stringify({ firstRowMs: first.elapsed, secondRowMs: second.elapsed, group, stored }));
	await app.evaluate(`window.lyra.sessions.rename(${JSON.stringify(first.meta.projectId)},${JSON.stringify(first.meta.id)},'独立重命名')`);
	await app.evaluate(`window.lyra.sessions.setArchived(${JSON.stringify(first.meta.projectId)},${JSON.stringify(first.meta.id)},true)`);
	await app.evaluate(`window.lyra.sessions.remove(${JSON.stringify(first.meta.projectId)},${JSON.stringify(first.meta.id)})`);
	const remaining = await app.evaluate<SessionMeta[]>(`window.lyra.sessions.list()`);
	assert.equal(remaining.find((s) => s.id === second.meta.id)?.title, "相同提示词隔离验证");
	assert.equal(remaining.find((s) => s.id === second.meta.id)?.archived, undefined);
});

test("a submitted worktree session preserves a startup rename and completes once while parked", async (t) => {
	await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,worktrees:{...s.worktrees,autoCreateOnNewSession:true}});})()`);
	const requested = new Promise<void>((resolve) => { onModelRequest = resolve; });
	const started = await submit();
	await app.evaluate(`window.lyra.sessions.rename(${JSON.stringify(started.meta.projectId)},${JSON.stringify(started.meta.id)},'初始化中重命名')`);
	await click('button[aria-label="在「交互验证」里新建会话"]');
	await requested;
	assert.ok(completeReply);
	completeReply();
	const saved = await app.evaluate<{ meta: SessionMeta; messages: { role: string }[]; running: boolean }>(`new Promise((resolve,reject)=>{let n=300;const read=async()=>{const s=await window.lyra.sessions.transcript(${JSON.stringify(started.meta.projectId)},${JSON.stringify(started.meta.id)});if(s.messages.some(m=>m.role==='assistant')&&!s.running)resolve(s);else if(--n)requestAnimationFrame(read);else reject(new Error('turn did not complete'));};read();})`);
	assert.deepEqual(saved.messages.map((m) => m.role), ["user", "assistant"]);
	assert.equal(saved.meta.title, "初始化中重命名");
	assert.equal(saved.meta.projectId, started.meta.projectId);
	assert.notEqual(saved.meta.cwd, started.meta.cwd, "worktree setup moves execution without changing identity");
	assert.equal(saved.meta.pendingPrompt, undefined);
	assert.equal(modelRequests, 1);
	if (await app.evaluate(`!!document.querySelector('[class~="group/project"] > button[aria-expanded="false"]')`)) await click('[class~="group/project"] > button[aria-expanded="false"]');
	await click(`[data-ly-row="${started.meta.id}"] > button`);
	const samples = await app.evaluate<string[]>(`(async()=>{const out=[];for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);out.push(document.querySelector('.ly-transcript')?.innerText??'');}return out;})()`);
	assert.ok(samples.every((text) => text.includes("初始化后完成，后台缓存收到回复。")), "a parked completion is present on every painted frame after selection");
	t.diagnostic(JSON.stringify({ rowMs: started.elapsed, providerRequests: modelRequests, messages: saved.messages.map((m) => m.role), title: saved.meta.title, frames: samples.length }));
});

test("collapsed group loading shares the far-right action slot without shifting the heading", async (t) => {
	await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,worktrees:{...s.worktrees,autoCreateOnNewSession:false}});})()`);
	const requested = new Promise<void>((resolve) => { onModelRequest = resolve; });
	const started = await submit();
	await requested;
	await verifyGroupLoading(t, started.meta.id);
	assert.ok(completeReply); completeReply();
	await app.evaluate(`new Promise((resolve,reject)=>{let n=300;const read=async()=>{const s=await window.lyra.sessions.transcript(${JSON.stringify(started.meta.projectId)},${JSON.stringify(started.meta.id)});if(!s.running)resolve();else if(--n)requestAnimationFrame(read);else reject(new Error('turn did not complete'));};read();})`);
	await click('[data-qa-running-group]'); await frames(20);
	assert.equal(await app.evaluate(`!!document.querySelector('[data-qa-running-group] svg.ly-star')`), false);
});

async function shot(name: string) {
	const directory = process.env.LYRA_E2E_ARTIFACTS;
	if (!directory) return;
	await mkdir(directory, { recursive: true });
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, name + ".png"), Buffer.from(result.data, "base64"));
}

async function verifyGroupLoading(t: TestContext, sessionId: string) {
	// Workspace initialization may refresh the project name; locate the group by its actual row.
	await app.evaluate(`(()=>{let group=document.querySelector(${JSON.stringify(`[data-ly-row="${sessionId}"]`)}).parentElement;
const selector=':scope > [data-ly-head] > [class~="group/project"] > button[aria-expanded]';
while(group&&!group.querySelector(selector))group=group.parentElement;
if(!group)throw new Error('Running session has no project heading');group.querySelector(selector).setAttribute('data-qa-running-group','');})()`);
	const heading = '[data-qa-running-group]';
	assert.equal(await app.evaluate(`document.querySelector(${JSON.stringify(heading)}).getAttribute('aria-expanded')`), "true");
	assert.equal(await app.evaluate(`!!document.querySelector(${JSON.stringify(heading + ' svg.ly-star')})`), false);
	await click(heading);
	// Leave the row so its resting status can occupy the same slot as the hover actions.
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 600, y: 100 }); await frames(20);
	const measurement = `(()=>{const b=document.querySelector(${JSON.stringify(heading)}),r=b.getBoundingClientRect(),name=b.children[1].getBoundingClientRect();
const status=b.querySelector('[aria-label*="个会话正在执行"]'),slot=status.parentElement,s=status.getBoundingClientRect(),svg=status.querySelector('svg');
const menu=b.parentElement.querySelector('button[aria-haspopup="menu"]'),actions=menu.parentElement,m=menu.querySelector('svg').getBoundingClientRect();
return {height:r.height,nameX:name.x,nameWidth:name.width,rightInset:r.right-s.right,centerY:s.y+s.height/2-r.y-r.height/2,slotOpacity:Number(getComputedStyle(slot).opacity),actionsOpacity:Number(getComputedStyle(actions).opacity),diameter:s.width,menuCenterX:m.x+m.width/2,loadingCenterX:s.x+s.width/2,fade:[...svg.querySelectorAll('line')].map(l=>getComputedStyle(l).opacity).join(),buttonsReachable:[...actions.querySelectorAll('button')].every(e=>{const a=e.getBoundingClientRect();return e.contains(document.elementFromPoint(a.x+a.width/2,a.y+a.height/2));})};})()`;
	type Measurement = { height: number; nameX: number; nameWidth: number; rightInset: number; centerY: number; slotOpacity: number; actionsOpacity: number; diameter: number; menuCenterX: number; loadingCenterX: number; fade: string; buttonsReachable: boolean };
	const resting = await app.evaluate<Measurement>(measurement);
	assert.equal(resting.diameter, 14); assert.ok(resting.rightInset >= 8 && resting.rightInset <= 12);
	assert.ok(Math.abs(resting.centerY) <= 0.5); assert.ok(Math.abs(resting.menuCenterX - resting.loadingCenterX) <= 1);
	assert.equal(resting.slotOpacity, 1); assert.equal(resting.actionsOpacity, 0);
	await shot("group-loading-collapsed");
	const position = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(heading)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...position });
	const samples = await app.evaluate<Measurement[]>(`(async()=>{const samples=[];for(let i=0;i<24;i++){await new Promise(requestAnimationFrame);samples.push(${measurement});}return samples;})()`);
	assert.ok(samples.every((frame) => frame.height === resting.height && frame.nameX === resting.nameX && frame.nameWidth === resting.nameWidth));
	assert.ok(samples.some((frame) => frame.slotOpacity > 0 && frame.slotOpacity < 1), "status fades rather than jumping");
	assert.ok(new Set(samples.map((frame) => frame.fade)).size > 1, "the loading mark cycles rather than sitting still");
	const hovered = samples.at(-1); assert.ok(hovered);
	assert.equal(hovered.slotOpacity, 0); assert.equal(hovered.actionsOpacity, 1); assert.equal(hovered.buttonsReachable, true);
	await shot("group-loading-hover");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 600, y: 100 }); await frames(20);
	assert.equal((await app.evaluate<Measurement>(measurement)).slotOpacity, 1);
	await click(heading); await frames(20);
	assert.equal(await app.evaluate(`!!document.querySelector(${JSON.stringify(heading + ' svg.ly-star')})`), false);
	await shot("group-loading-expanded");
	const section = '[class~="group/section"]';
	assert.equal(await app.evaluate(`!!document.querySelector(${JSON.stringify(section + ' svg.ly-star')})`), false);
	await click(section); await frames(20);
	assert.equal(await app.evaluate(`!!document.querySelector(${JSON.stringify(section + ' svg.ly-star')})`), true);
	await click(section); await frames(20);
	assert.equal(await app.evaluate(`!!document.querySelector(${JSON.stringify(section + ' svg.ly-star')})`), false);
	t.diagnostic(JSON.stringify({ resting, hovered, sampledFrames: samples.length, slotOpacity: samples.map((frame) => frame.slotOpacity), pinnedSection: "collapsed only" }));
}
