import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { startApp, closeListeningServer, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { seedTrajectory } from "./trajectory-fixture.ts";

let app: RunningApp;
let server: Server;
before(async () => {
	server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: "trace-qa", role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: "轨迹验证摘要：保留关键决策与未完成事项。" } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } });
			emit("message_stop", {}); res.end();
		});
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string");
	app = await startApp({ port: 9618, seed: async home => { await seedInteractions(home, address.port); await seedTrajectory(home); } });
});
after(async () => { await cleanupFixture(() => app?.stop(), () => closeListeningServer(server)); });
afterEach(async t => { if (!t.passed) { t.diagnostic(await trajectoryGeometry()); await shot("failure"); t.diagnostic(await app.evaluate(`document.body.innerText.slice(-7000)`)); } });

async function trajectoryGeometry(): Promise<string> {
	return app.evaluate(`JSON.stringify((()=>{
		const first=document.querySelector('[data-dock-pane="trajectory"] .ly-scroll-view');
		const geometry=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {visible:e.checkVisibility(),style:e.getAttribute('style'),display:s.display,visibility:s.visibility,opacity:s.opacity,height:s.height,minHeight:s.minHeight,maxHeight:s.maxHeight,flexShrink:s.flexShrink,overflowY:s.overflowY,overflowAnchor:s.overflowAnchor,top:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,offsetHeight:e.offsetHeight,rect:{top:r.top,bottom:r.bottom,width:r.width,height:r.height}};};
		return {
			label:'trajectory DOM geometry',
			activeElement:document.activeElement?.outerHTML.slice(0,400),
			panes:[...document.querySelectorAll('[data-dock-pane="trajectory"]')].map(p=>({geometry:geometry(p),inert:p.inert,count:p.querySelector('[data-trace-count]')?.textContent,scrollers:[...p.querySelectorAll('.ly-scroll-view')].map(s=>({first:s===first,containsList:Boolean(s.querySelector('[data-trace-list]')),geometry:geometry(s)}))})),
			lists:[...document.querySelectorAll('[data-trace-list]')].map(list=>{
				const viewport=list.closest('.ly-scroll-view'),rows=[...list.querySelectorAll('[role="listitem"]')];
				const row=e=>e?{position:e.getAttribute('aria-posinset'),total:e.getAttribute('aria-setsize'),style:e.getAttribute('style'),geometry:geometry(e)}:null;
				return {geometry:geometry(list),viewportIsFirst:viewport===first,viewport:viewport?geometry(viewport):null,renderedRows:rows.length,first:row(rows[0]),last:row(rows.at(-1)),ancestors:[...function*(e){for(let n=0;e&&n<6;n++,e=e.parentElement)yield e;}(list.parentElement)].map(e=>({tag:e.tagName,className:e.className,geometry:geometry(e)}))};
			}),
		};
	})())`);
}

async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{let n=300;const f=()=>{if(${expression})resolve();else if(--n)requestAnimationFrame(f);else reject(new Error(${JSON.stringify(expression)}));};f();})`);
}
async function openPane(label: string) {
	await app.evaluate(`document.querySelector('button[aria-label="面板"]').click()`);
	await until(`document.querySelector('[role="menuitem"]')`);
	await until(`[...document.querySelectorAll('[role="menuitem"]')].some(e=>e.textContent.includes(${JSON.stringify(label)}))`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes(${JSON.stringify(label)})).click()`);
}
async function shot(name: string) {
	const directory = process.env.LYRA_E2E_ARTIFACTS; if (!directory) return;
	await mkdir(directory, { recursive: true });
	const data = await app.send<{data: string}>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(data.data, "base64"));
}

async function settle() {
	await app.evaluate(`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})))`);
}
async function clickControl(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await settle();
	const p = await app.evaluate<{x: number; y: number}>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw new Error('control is covered');return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", {type:"mouseMoved", ...p});
	await app.send("Input.dispatchMouseEvent", {type:"mousePressed", ...p, button:"left", clickCount:1});
	await app.send("Input.dispatchMouseEvent", {type:"mouseReleased", ...p, button:"left", clickCount:1});
}
async function clickEntry() {
	if (await app.evaluate(`document.querySelector("[data-trajectory]").clientHeight < 240`)) await clickControl('[aria-label="全屏：轨迹"]');
	await settle();
	await app.evaluate(`(()=>{const v=document.querySelector('[data-trace-list]').closest('.ly-scroll-view');const h=v.querySelector('[role=listitem]').getBoundingClientRect().height;v.scrollTop=Math.ceil(v.scrollTop/h)*h;})()`);
	await until(`Boolean([...document.querySelectorAll('[data-trace-entry]')].find(e=>{const r=e.getBoundingClientRect();const v=e.closest('.ly-scroll-view').getBoundingClientRect();return r.top>=v.top && r.bottom<=v.bottom && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}))`);
	await app.evaluate(`for(const e of document.querySelectorAll('[data-trace-entry]')){const r=e.getBoundingClientRect(),v=e.closest('.ly-scroll-view').getBoundingClientRect();if(r.top>=v.top && r.bottom<=v.bottom && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))){e.setAttribute('data-trace-hit','');break;}}`);
	await clickControl('[data-trace-hit]');
	await app.evaluate(`document.querySelector('[data-trace-hit]')?.removeAttribute('data-trace-hit')`);
}
async function escape() {
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
	await settle();
}
async function timeline() {
	if (await app.evaluate(`document.querySelector("[data-trajectory]").clientHeight < 240`)) await clickControl('[aria-label="全屏：轨迹"]');
	if (await app.evaluate(`document.querySelector('button[aria-label="时间概览"]').getAttribute('aria-expanded') === 'false'`)) await clickControl('button[aria-label="时间概览"]');
	await until(`document.querySelector('[data-trace-timeline] canvas')?.checkVisibility()`);
	await settle();
	return app.evaluate<{x: number; y: number; width: number}>(`(()=>{const e=document.querySelector('[data-trace-timeline] canvas'),r=e.getBoundingClientRect();if(r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight||document.elementFromPoint(r.x+r.width/2,r.y+40)!==e)throw new Error('timeline is clipped or covered');return {x:r.x,y:r.y,width:r.width};})()`);
}
async function menuAction(label: string) {
	await clickControl('[aria-label="轨迹操作"]');
	await until(`[...document.querySelectorAll('[role="menuitem"]')].some(e=>e.textContent===${JSON.stringify(label)})`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent===${JSON.stringify(label)}).setAttribute('data-trace-action','')`);
	await clickControl('[data-trace-action]');
}

test("manual compression is traceable with its command, summary and lifecycle while the panel stays mounted", async (t) => {
	const at = await app.evaluate<{x: number; y: number}>(`(()=>{const r=document.querySelector('[data-ly-row="qa-long"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: 1 });
	await until(`document.querySelector('main').textContent.includes('第 120 个回答')`);
	await openPane("轨迹");
	await until(`document.querySelector('[data-dock-pane="trajectory"]')?.querySelector('[data-trace-entry]')`);
	await app.evaluate(`document.querySelector('main textarea').focus()`);
	await app.send("Input.insertText", { text: "/compact 保留关键决策" });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await until(`document.querySelector('[data-command-status="done"]')`);
	const persisted = await app.evaluate<{source: string; summary: string; detail: string; command?: string}[]>(`(async()=>{const m=(await window.lyra.sessions.list()).find(m=>m.id==='qa-long');return window.lyra.sessions.trajectory(m.projectId,m.id);})()`);
	t.diagnostic(JSON.stringify(persisted.filter(e => e.source === "compaction")));
	await shot("trajectory-manual");
	assert.ok(persisted.some(e => e.command === "/compact 保留关键决策"), "the durable command lifecycle must be projected, not just the message counts");
	assert.ok(persisted.some(e => e.detail.includes("轨迹验证摘要")), "the stored summary must be inspectable");
	await until(`document.querySelector('[data-dock-pane="trajectory"]')?.textContent.includes('/compact')`);
	await app.evaluate(`[...document.querySelectorAll('[data-trace-entry]')].find(e=>e.textContent.includes('/compact')).click()`);
	await until(`document.querySelector('.ly-trace-inspector')?.textContent.includes('轨迹验证摘要')`);
	await shot("manual-detail");
});

async function clickRow(id: string) {
	const at = await app.evaluate<{x: number; y: number}>(`(()=>{const r=document.querySelector('[data-ly-row="${id}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: 1 });
}
async function search(selector: string, text: string) {
	await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select();})()`);
	await app.send("Input.insertText", { text });
}

test("7500+ trajectory entries remain bounded; full output search and inspector selection do not shift rows", async (t) => {
	await clickRow("10000000-0000-4000-8000-000000000001");
	await until(`document.querySelector('[data-ly-row="10000000-0000-4000-8000-000000000001"][aria-current]') || document.querySelector('main').textContent.includes('执行并验证构建')`);
	await openPane("轨迹");
	await until(`Boolean(document.querySelector('[data-trace-count] [data-ly-tip="2500 次工具"]'))`);
	const baseline = await app.evaluate(`(()=>{const s=document.querySelector('[data-dock-pane="trajectory"] .ly-scroll-view');return {rows:document.querySelectorAll('[data-trace-entry]').length,top:s.scrollTop,height:s.scrollHeight};})()`);
	t.diagnostic(await trajectoryGeometry());
	assert.ok(baseline.rows < 55 && baseline.top > 200000, JSON.stringify(baseline));
	const sample = await app.evaluate(`new Promise(resolve=>{const s=document.querySelector('[data-dock-pane="trajectory"] .ly-scroll-view');const out=[];let i=0,prev=performance.now();const f=()=>{const now=performance.now();out.push({ms:now-prev,rows:document.querySelectorAll('[data-trace-entry]').length});prev=now;s.scrollTop=(s.scrollHeight-s.clientHeight)*(1-i/60);if(++i<60)requestAnimationFrame(f);else resolve(out);};requestAnimationFrame(f);})`);
	/*
	 * 静止时是一屏加固定预留，甩动时不是。
	 *
	 * `lib/overscan.ts` 把预留行数按这一帧滚过的距离放大，封顶 `MAX = 160`，上下各一份。这里
	 * 一帧跨过 (270144−558)/60 ≈ 4493px，除以行高 36 得 125，加一屏 16 行就是 141——上下合起来
	 * 二百八十几行，实测正是这个数。`< 55` 是预留还固定 8 行那会儿的上限。
	 *
	 * 放宽不等于不设限：七千五百条里画三百行仍然是「有界」，这条测试问的就是这个。
	 */
	const SCROLLING_CEILING = 2 * 160 + 24;
	assert.ok(
		sample.every((frame: {rows: number}) => frame.rows < SCROLLING_CEILING),
		`甩到底时画的行数应当停在预留上限附近，实测 ${Math.max(...sample.map((frame: {rows: number}) => frame.rows))}`,
	);
	t.diagnostic(JSON.stringify({ baseline, maxFrame: Math.max(...sample.map((frame: {ms: number}) => frame.ms)), maxRows: Math.max(...sample.map((frame: {rows: number}) => frame.rows)) }));
	await search('[data-trajectory] input', "TAIL_SENTINEL");
	await until(`document.querySelectorAll('[data-trace-entry]').length === 2`);
	await settle();
	const beforeSelection = await app.evaluate<number[]>(`[...document.querySelectorAll('[data-trace-entry]')].map(e=>e.getBoundingClientRect().top)`);
	assert.equal(beforeSelection.length, 2);
	await clickEntry();
	await until(`document.querySelector('.ly-trace-inspector')?.textContent.includes('TAIL_SENTINEL')`);
	const stable = await app.evaluate(`new Promise(resolve=>{const out=[];let n=20;const f=()=>{out.push([...document.querySelectorAll('[data-trace-entry]')].map(e=>e.getBoundingClientRect().top));if(--n)requestAnimationFrame(f);else resolve(out);};requestAnimationFrame(f);})`);
	assert.ok(stable.every((frame: number[]) => frame.length === 2 && JSON.stringify(frame) === JSON.stringify(beforeSelection)), "inspecting a record must not animate or shift its ledger row");
	await app.evaluate(`Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{document.documentElement.dataset.traceCopy=text;}})`);
	try {
		await app.evaluate(`document.querySelector('[aria-label="复制完整输出"]').click()`);
		const copied = await app.evaluate<string>(`document.documentElement.dataset.traceCopy`);
		assert.ok(copied.length > 12000 && copied.endsWith("TAIL_SENTINEL"));
	} finally { await app.evaluate(`delete navigator.clipboard.writeText;delete document.documentElement.dataset.traceCopy`); }
	await shot("long-trace-inspector");
});

test("task execution search includes omitted text, links to its trajectory and opens the complete raw output", async () => {
	await openPane("任务");
	await until(`document.querySelector('[data-task-records]')`);
	await search('[data-dock-pane="tasks"] input', "TAIL_SENTINEL");
	await until(`document.querySelectorAll('[data-task-record]').length === 1`);
	await app.evaluate(`document.querySelector('[data-task-record] button').click()`);
	await until(`document.querySelector('[data-dock-pane="tasks"]')?.textContent.includes('TAIL_SENTINEL')`);
	await app.evaluate(`document.querySelector('[data-dock-pane="tasks"] [aria-label="在轨迹中查看这次调用"]').click()`);
	await until(`document.querySelector('.ly-trace-inspector')?.textContent.includes('trace-run-2499')`);
	await clickControl('[aria-label="记录操作"]');
	await until(`[...document.querySelectorAll('[role="menuitem"]')].some(e=>e.textContent==='查看完整原始输出')`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent==='查看完整原始输出').click()`);
	const read = await app.evaluate(`(async()=>{const m=(await window.lyra.sessions.list()).find(m=>m.id==='10000000-0000-4000-8000-000000000001');const p=await window.lyra.sessions.exportTrajectory(m.projectId,m.id,'output',{correlationId:'trace-run-2499'});const r=await window.lyra.files.read(p);return {path:p,read:r?{bytes:r.bytes,truncated:r.truncated,tail:r.text.slice(-20)}:null};})()`);
	assert.ok(read.read, JSON.stringify(read));
	assert.ok(read.read.bytes > 200000 && read.read.truncated === false && read.read.tail.endsWith("RAW_FILE_TAIL"), JSON.stringify(read));
	await until(`document.querySelector('[data-dock-pane="file"] .cm-content')`);
	const paths = await app.evaluate<string[]>(`[...document.querySelectorAll('[data-dock-pane="file"] [data-ly-tip]')].map(e=>e.getAttribute('data-ly-tip'))`);
	assert.ok(paths.some(path => path.includes("build.log")), JSON.stringify(paths));
	await shot("task-raw-output");
});

test("session switching never renders the previous trace selection or filter contents", async () => {
	await clickRow("qa-short");
	await until(`document.querySelector('main').textContent.includes('第 5 个回答')`);
	await openPane("轨迹");
	await until(`document.querySelector('[data-trajectory]') && !document.querySelector('[data-trace-count] [data-ly-tip="2500 次工具"]')`);
	assert.equal(await app.evaluate(`document.querySelector('[data-trajectory]').textContent.includes('trace-run-2499')`), false);
	assert.equal(await app.evaluate(`document.querySelector('[data-trajectory] input').value`), "");
	await clickRow("10000000-0000-4000-8000-000000000001");
	await until(`document.querySelector('[data-trace-count]')?.textContent.includes('7503/7503')`);
	assert.equal(await app.evaluate(`Boolean(document.querySelector('.ly-trace-inspector'))`), false, "returning to the source session must not replay an already handled trace link");
	await clickRow("qa-long");
	await until(`document.querySelector('[data-trajectory]').textContent.includes('/compact')`);
	assert.equal(await app.evaluate(`document.querySelector('[data-trajectory]').textContent.includes('trace-run-2499')`), false);
});

test("time-range selection, turn folding and model timing are queryable through the real controls", async () => {
	await clickRow("10000000-0000-4000-8000-000000000001");
	await until(`document.querySelector('[data-trace-count]')?.textContent.includes('7503/7503')`);
	await settle();
	const box = await timeline();
	box.y += 24;
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x + box.width * 0.25, y: box.y, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + box.width * 0.75, y: box.y, button: "left", buttons: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + box.width * 0.75, y: box.y, button: "left", clickCount: 1 });
	await until(`!document.querySelector('[data-trace-count]').textContent.startsWith('7503/')`);
	const filtered = await app.evaluate<string>(`document.querySelector('[data-trace-count]').textContent`);
	const count = Number(filtered.match(/聚焦 (\d+) 条/)?.[1]); assert.ok(count > 3000 && count < 4500, filtered);
	await clickControl('[aria-label="重置时间范围"]');
	await until(`document.querySelector('[data-trace-count]').textContent.startsWith('7503/')`);
	await escape();
	await menuAction('收起所有轮次');
	await until(`document.querySelectorAll('[data-trace-entry]').length < 5`);
	await menuAction('展开所有轮次');
	await until(`document.querySelectorAll('[data-trace-entry]').length > 5`);
	await clickControl('[aria-label="筛选轨迹"]');
	await until(`Boolean(document.querySelector('[role="menu"][aria-label="筛选轨迹"]'))`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.startsWith('模型请求')).click()`);
	await app.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',windowsVirtualKeyCode:27});
	await app.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',windowsVirtualKeyCode:27});
	await until(`document.querySelector('[data-trace-count]').textContent.startsWith('2500/') && document.querySelector('[data-trace-entry]')`);
	await clickEntry();
	await until(`document.querySelector('.ly-trace-inspector [role="tab"]')`);
	await app.evaluate(`[...document.querySelectorAll('.ly-trace-inspector [role="tab"]')].find(e=>e.textContent==='信息').click()`);
	await settle();
	const timingVisible = await app.evaluate(`(()=>{const e=[...document.querySelectorAll('.ly-trace-inspector dt')].find(e=>e.textContent==='首 Token').nextElementSibling;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return e.textContent==='120 ms' && !e.closest('[aria-hidden=true],[inert]') && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
	assert.equal(timingVisible, true, "model timing must be visibly expanded, not merely mounted");
	await until(`document.querySelector('.ly-trace-inspector')?.textContent.includes('首 Token')`);
	const details = await app.evaluate<string>(`document.querySelector('.ly-trace-inspector').textContent`);
	assert.ok(details.includes("120 ms") && details.includes("80 ms") && details.includes("Token 用量"), details);
	await clickControl('[aria-label="返回记录"]');
	const modelBox = await timeline();
	const toolLane = { x: modelBox.x + modelBox.width / 2, y: modelBox.y + 26 };
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: toolLane.x, y: toolLane.y - 16, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: toolLane.x, y: toolLane.y - 16, button: "left", clickCount: 1 });
	await until(`document.querySelector('.ly-trace-inspector [data-trace-inspector-header]')?.textContent.includes('模型请求')`);
	await clickControl('[aria-label="返回记录"]');
	const toolBox = await timeline();
	toolLane.x = toolBox.x + toolBox.width / 2; toolLane.y = toolBox.y + 26;
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...toolLane, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...toolLane, button: "left", clickCount: 1 });
	await until(`document.querySelector('.ly-trace-inspector [data-trace-inspector-header]')?.textContent.includes('工具调用')`);
});

test("trajectory controls fit both themes and narrow panes; a brush stays local until release", async (t) => {
	await clickRow("10000000-0000-4000-8000-000000000001");
	await clickControl('[aria-label="返回记录"]');
	await until(`!document.querySelector('.ly-trace-inspector')`);
	for (const theme of ["dark", "light"]) {
		for (const width of [1280, 375]) {
			await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${JSON.stringify(theme)}}}))`);
			await app.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
			await until(`innerWidth===${width} && document.documentElement.classList.contains(${JSON.stringify(theme)})`);
			await settle();
			const geometry = await app.evaluate(`(()=>{const p=document.querySelector('[data-trajectory]'),r=p.getBoundingClientRect(),toolbar=p.querySelector('[role="toolbar"]');return {width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,pane:{left:r.left,right:r.right},actions:[...toolbar.querySelectorAll('button')].map(b=>({left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right,icons:b.querySelectorAll('svg').length})),controls:p.querySelector('.ly-scroll-view').getBoundingClientRect().top-r.top,ledgerHeight:p.querySelector('.ly-scroll-view').clientHeight,fadeTop:parseFloat(getComputedStyle(p.querySelector('.ly-scroll-view')).getPropertyValue('--ly-fade-top')),fadeBottom:parseFloat(getComputedStyle(p.querySelector('.ly-scroll-view')).getPropertyValue('--ly-fade-bottom')),paneHeight:r.height};})()`);
			assert.ok(geometry.overflow <= 0, JSON.stringify(geometry));
			assert.ok(geometry.fadeTop + geometry.fadeBottom <= geometry.ledgerHeight * 0.4, JSON.stringify(geometry));
			assert.ok(geometry.controls >= 0 && geometry.controls < 200 && geometry.ledgerHeight >= 36, JSON.stringify(geometry));
			assert.ok(geometry.actions.every((b: { left: number; right: number; icons: number }) => b.icons > 0 && b.left >= geometry.pane.left && b.right <= geometry.pane.right));
			t.diagnostic(JSON.stringify({ theme, ...geometry }));
			await clickControl('[aria-label="筛选轨迹"]');
			await until(`document.querySelector('[role="menu"][aria-label="筛选轨迹"]')?.checkVisibility()`);
			await settle();
			const menu = await app.evaluate(`(()=>{const p=document.querySelector('[role="menu"][aria-label="筛选轨迹"]'),r=p.getBoundingClientRect(),buttons=[...p.querySelectorAll('[role="menuitem"]')];return {left:r.left,right:r.right,width:innerWidth,icons:buttons.map(b=>b.querySelectorAll('svg').length),disabled:buttons.filter(b=>b.disabled).length};})()`);
			assert.ok(menu.left >= 0 && menu.right <= menu.width, JSON.stringify(menu));
			assert.ok(menu.icons.every((count: number) => count > 0)); assert.equal(menu.disabled, 0);
			await shot(`trajectory-filter-${theme}-${width}`);
			await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
			await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
			await settle();
			await shot(`trajectory-${theme}-${width}`);
			await clickEntry();
			await settle();
			const detail = await app.evaluate(`(()=>{const p=document.querySelector('.ly-trace-inspector'),r=p.getBoundingClientRect(),s=p.querySelector('[role=tabpanel]');return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,body:s.clientHeight};})()`);
			assert.ok(detail.left>=0 && detail.right<=detail.width && detail.top>=0 && detail.bottom<=detail.height && detail.body>120, JSON.stringify(detail));
			await shot(`trajectory-detail-${theme}-${width}`);
			await clickControl('[aria-label="返回记录"]');
			await timeline();
			await shot(`trajectory-timeline-${theme}-${width}`);
			await escape();
		}
	}
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
	await settle();
	await timeline();
	await clickControl('[aria-label="重置时间范围"]');
	const before = await app.evaluate<string>(`document.querySelector('[data-trace-count]').textContent`);
	const r = await timeline();
	const listBeforeBrush = await app.evaluate(`(()=>{const e=document.querySelector('[data-trace-list]').closest('.ly-scroll-view');return {top:e.getBoundingClientRect().top,scroll:e.scrollTop,height:e.scrollHeight};})()`);
	const zoomPositions = await app.evaluate(`['缩小时间范围','放大时间范围','重置时间范围'].map(label=>{const r=document.querySelector('[aria-label="'+label+'"]').getBoundingClientRect();return [r.x,r.y,r.width,r.height];})`);
	r.y += 24;
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x + r.width * .2, y: r.y, button: "left", clickCount: 1 });
	for (let n = 1; n <= 12; n++) {
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x + r.width * (.2 + n / 24), y: r.y, button: "left", buttons: 1 });
		assert.equal(await app.evaluate<string>(`document.querySelector('[data-trace-count]').textContent`), before, "the list must not re-filter during the brush preview");
	}
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x + r.width * .7, y: r.y, button: "left", clickCount: 1 });
	await until(`document.querySelector('[data-trace-count]').textContent!==${JSON.stringify(before)}`);
	const listAfterBrush = await app.evaluate(`(()=>{const e=document.querySelector('[data-trace-list]').closest('.ly-scroll-view');return {top:e.getBoundingClientRect().top,scroll:e.scrollTop,height:e.scrollHeight};})()`);
	assert.deepEqual(listAfterBrush, listBeforeBrush, "range focus preserves list position and geometry");
	assert.deepEqual(await app.evaluate(`['缩小时间范围','放大时间范围','重置时间范围'].map(label=>{const r=document.querySelector('[aria-label="'+label+'"]').getBoundingClientRect();return [r.x,r.y,r.width,r.height];})`), zoomPositions);
	await shot("trajectory-range-committed");
	await app.evaluate(`document.querySelector('[data-trace-timeline] canvas').focus()`);
	for (const [key, code] of [["End", 35], ["ArrowLeft", 37]] as const) {
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code });
		assert.equal(await app.evaluate(`Boolean(document.querySelector('.ly-trace-inspector'))`), false, "arrow navigation must keep focus in the timeline");
	}
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await until(`Boolean(document.querySelector('.ly-trace-inspector')) && document.querySelector('[data-trace-timeline] canvas')?.checkVisibility()`);
	await until(`document.querySelector('.ly-trace-inspector').contains(document.activeElement)`);
});
