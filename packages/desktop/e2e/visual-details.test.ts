import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { before, after, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import type { SessionRecord } from "@lyra/core";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
/** 一个文件一个端口：几个文件共用一个，串行跑时上一个的 Electron 还没退，下一个就起不来。 */
const PORT = 9701;

before(async () => { app = await startApp({ port: PORT, seed: async (home) => {
	await seedInteractions(home, 1);
	const settings = JSON.parse(await readFile(join(home, "settings.json"), "utf8"));
	settings.appearance = { theme: "light", reduceMotion: "off" };
	await writeFile(join(home, "settings.json"), JSON.stringify(settings));
	const project = settings.projects[0];
	const memory = join(home, "projects", project.id, "memory");
	await mkdir(memory, {recursive:true});
	await writeFile(join(memory, "MEMORY.md"), "# 项目记忆\n\n核对当前仓库脚本，再选择验证命令。\n");
	await writeFile(join(project.path, "AGENTS.md"), "# Project instructions\nUse current repository evidence.\n");
	const log = join(home,"sessions",project.id,"qa-long.jsonl");
	const records: SessionRecord[] = (await readFile(log,"utf8")).trim().split("\n").map(line=>JSON.parse(line));
	const icon = (await readFile(new URL("../build/icon.png", import.meta.url))).toString("base64");
	for (const record of records) if (record.type === "message" && record.message.role === "user" && record.message.content.some(block=>block.type === "text" && block.text.includes("第 120 个问题"))) {
		record.message.timestamp = Date.now();
		record.message.content.push({type:"image",mimeType:"image/png",data:icon}, {type:"image",mimeType:"image/png",data:icon});
	}
	await writeFile(log, records.map(record=>JSON.stringify(record)).join("\n")+"\n");
} }); });
after(async () => { await app?.stop(); });
async function frames(n = 20) { await app.evaluate(`new Promise(r=>{let n=${n};const f=()=>--n?requestAnimationFrame(f):r();requestAnimationFrame(f);})`); }
async function until(expression: string) { await app.evaluate(`new Promise((r,j)=>{let n=300;const f=()=>(${expression})?r():--n?requestAnimationFrame(f):j(new Error('missing'));f();})`); }
async function click(selector: string) {
	const point = (visible: boolean) => app.evaluate<{x: number; y: number}>(`(async()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility({visibilityProperty:true}));if(!e)throw new Error('missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',behavior:'instant'});
		const deadline=Date.now()+8000;
		while(true) {
			// A mounted portal can still be transparent and waiting for its final position.
			let ready=e.isConnected&&!e.matches(':disabled');
			for(let ancestor=e;ancestor;ancestor=ancestor.parentElement) {
				const style=getComputedStyle(ancestor);
				ready&&=style.visibility!=='hidden'&&(!${visible}||Number(style.opacity)>0);
				ready&&=!ancestor.getAnimations().some(animation=>
					Number.isFinite(animation.effect?.getComputedTiming().endTime)&&
					(animation.pending||animation.playState==='running'));
			}
			const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
			const target=${visible}?e:(e.closest('[data-row-actions]')??e);
			if(ready&&r.width>0&&r.height>0&&target.contains(document.elementFromPoint(x,y)))break;
			if(Date.now()>deadline)throw new Error('click target did not become visible and stable '+${JSON.stringify(selector)});
			await new Promise(requestAnimationFrame);
		}
		const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
		if (${visible} && window.qaRegistryClicks) {
			const hit=document.elementFromPoint(x,y), menu=e.closest('[data-ly-popover]');
			window.qaRegistryClicks.push({ text:e.textContent, x, y, rect:r.toJSON(), hit:hit?.outerHTML.slice(0,300), same:e.contains(hit),
				menu:menu&&{rect:menu.getBoundingClientRect().toJSON(),transform:getComputedStyle(menu).transform,opacity:getComputedStyle(menu).opacity} });
		}
		return {x,y};})()`);
	// Row actions accept pointer events only after the real pointer enters their row.
	await app.send("Input.dispatchMouseEvent", {type:"mouseMoved",...await point(false),buttons:0});
	const at = await point(true);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", {type,...at,button:"left",clickCount:1});
	await frames(2);
}
async function clickText(text: string) {
	await app.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.checkVisibility({visibilityProperty:true})&&e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('missing text');e.setAttribute('data-qa-click','');})()`);
	await click('[data-qa-click]'); await app.evaluate(`document.querySelector('[data-qa-click]')?.removeAttribute('data-qa-click')`);
}
async function screenshot(name: string) {
	if (!process.env.LYRA_E2E_ARTIFACTS) return;
	await mkdir(process.env.LYRA_E2E_ARTIFACTS, {recursive:true});
	const shot = await app.send<{data:string}>("Page.captureScreenshot", {format:"png"});
	await writeFile(join(process.env.LYRA_E2E_ARTIFACTS, name+".png"), Buffer.from(shot.data,"base64"));
}

async function withTouchViewport(run: () => Promise<void>) {
	const targets: { url: string; webSocketDebuggerUrl?: string }[] = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((response) => response.json());
	const target = targets.find((entry) => entry.url.endsWith("/index.html"));
	assert.ok(target?.webSocketDebuggerUrl);
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("touch emulation connection failed")), { once: true });
	});
	let id = 0;
	const send = (method: string, params = {}) => new Promise<void>((resolve, reject) => {
		const request = ++id;
		const listener = (event: MessageEvent) => {
			const message: { id?: number; error?: { message: string } } = JSON.parse(String(event.data));
			if (message.id !== request) return;
			socket.removeEventListener("message", listener);
			if (message.error) reject(new Error(message.error.message)); else resolve();
		};
		socket.addEventListener("message", listener);
		socket.send(JSON.stringify({ id: request, method, params }));
	});
	try {
		// Touch overrides belong to the debugger session and disappear when its socket closes.
		await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 480, deviceScaleFactor: 1, mobile: true });
		await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
		await run();
	} finally {
		try { await send("Emulation.clearDeviceMetricsOverride"); }
		finally { socket.close(); }
		await frames();
	}
}

test("release preview and edit share a stable dialog and content height", async (t) => {
	await click('[data-ly-row="qa-long"] > button');
	await click('button[aria-label^="Git "]');
	await until(`document.querySelector('[data-dock-pane="review"] [data-ly-tip="流水线"]')`);
	await click('[data-dock-pane="review"] [data-ly-tip="流水线"]');
	await until(`document.querySelector('[aria-label="打开发版中心"]')`);
	await click('[aria-label="打开发版中心"]');
	await until(`document.querySelector('[role="dialog"] textarea') || document.querySelector('[role="dialog"] [aria-label="编辑更新日志"]')`);
	await frames();
	const size = () => app.evaluate<{height:number;top:number}>(`(()=>{const r=document.querySelector('[role="dialog"]').getBoundingClientRect();return {height:r.height,top:r.top};})()`);
	const before = await size();
	const sample = () => app.evaluate(`window.qaDialogFrames = new Promise(resolve=>{const samples=[];let n=30;const frame=()=>{const r=document.querySelector('[data-ly-modal]').getBoundingClientRect();samples.push({height:r.height,top:r.top});if(--n)requestAnimationFrame(frame);else resolve(samples);};requestAnimationFrame(frame);}); void 0`);
	const assertStable = async () => {
		const sizes = await app.evaluate<{height:number;top:number}[]>(`window.qaDialogFrames`);
		assert.ok(sizes.length === 30 && sizes.every(r=>Math.abs(r.height-before.height)<1 && Math.abs(r.top-before.top)<1), JSON.stringify(sizes));
	};
	await sample();
	if (await app.evaluate(`Boolean(document.querySelector('[aria-label="编辑更新日志"]'))`)) await click('[aria-label="编辑更新日志"]'); else await clickText('预览');
	await assertStable(); const after = await size();
	t.diagnostic(JSON.stringify({before,after}));
	await screenshot('release-center');
	assert.ok(Math.abs(before.height-after.height)<1, `dialog resized: ${before.height} -> ${after.height}`);
	await click('[aria-label="更新日志语言"]');
	await sample();
	await clickText("English");
	await assertStable();
	await until(`document.querySelector('[role="dialog"] textarea').value.includes('Other changes')`);
	assert.deepEqual(await size(), before);
	await click('[aria-label="预览更新日志"]');
	await frames(); await screenshot("release-preview");
	await click('[aria-label="关闭发版中心"]');
	await until(`!document.querySelector('[data-ly-modal]')`);
});


test("navigation shows fifteen compact marks and all 120 questions remain reachable", async (t) => {
	await click('[data-dock-pane="review"] [aria-label="关闭Git"]');
	await until(`document.querySelectorAll('.ly-question-mark').length === 15`);
	await click('.ly-question-mark');
	for (const key of ["Home", "End"]) {
		await app.send("Input.dispatchKeyEvent", {type:"keyDown",key,windowsVirtualKeyCode:key==="Home"?36:35});
		await app.send("Input.dispatchKeyEvent", {type:"keyUp",key,windowsVirtualKeyCode:key==="Home"?36:35});
		await frames(30);
		const marks = await app.evaluate<number[]>(`[...document.querySelectorAll('.ly-question-mark')].map(e=>Number(e.dataset.position))`);
		assert.equal(marks.length,15);
		assert.equal(key === "Home" ? marks[0] : marks.at(-1), key === "Home" ? 0 : 119);
	}
	const geometry = await app.evaluate(`(()=>{const e=document.querySelector('.ly-question-rail'), r=e.getBoundingClientRect();return {height:r.height,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,overflow:getComputedStyle(e).overflowY,count:document.querySelectorAll('.ly-question-mark').length};})()`);
	assert.ok(geometry.height <= 180 && geometry.overflow === "visible",JSON.stringify(geometry));
	const at = await app.evaluate(`(()=>{const r=document.querySelector('.ly-question-mark[data-position="117"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", {type:"mouseMoved",...at}); await frames();
	assert.match(await app.evaluate(`document.querySelector('.ly-question-preview').textContent`), /第 118 个问题.*第 118 个回答/s);
	await screenshot("question-neighbourhood"); t.diagnostic(JSON.stringify(geometry));
});

test("image attachments sit above their own bubble and time separators remain centered", async (t) => {
	const geometry = await app.evaluate(`(()=>{const r=document.querySelector('[data-question-index="238"]');const images=r.querySelector('.ly-user-images').getBoundingClientRect(),bubble=r.querySelector('.ly-user-bubble').getBoundingClientRect();const time=document.querySelector('.ly-conversation-time');return {imagesBottom:images.bottom,bubbleTop:bubble.top,imagesRight:images.right,bubbleRight:bubble.right,imageCount:r.querySelectorAll('img').length,time:time.textContent,timeAlign:getComputedStyle(time).textAlign};})()`);
	assert.ok(geometry.imagesBottom < geometry.bubbleTop);
	assert.equal(geometry.imagesRight,geometry.bubbleRight);
	assert.equal(geometry.imageCount,2); assert.equal(geometry.timeAlign,"center");
	await app.send("Input.dispatchMouseEvent", {type:"mouseMoved",x:900,y:80}); await frames();
	await screenshot("user-images-time");t.diagnostic(JSON.stringify(geometry));
});

test("permission dialog uses grouped capabilities, animates cancel, and restores keyboard focus", async (t) => {
	await clickText("帮我批准");
	await until(`document.querySelector('[aria-label="权限模式"]')`);
	await click('[aria-label="权限模式"] button:has(svg.lucide-circle-alert)');
	await until(`document.querySelector('[data-ly-modal]')`); await frames();
	assert.ok(await app.evaluate(`document.querySelector('[data-ly-modal]').textContent.includes('文件和文件夹')`));
	await screenshot("permission-dialog");
	await app.evaluate(`document.querySelector('[data-ly-modal] button:last-child').focus()`);
	await app.send("Input.dispatchKeyEvent", {type:"keyDown",key:"Tab",windowsVirtualKeyCode:9});
	await app.send("Input.dispatchKeyEvent", {type:"keyUp",key:"Tab",windowsVirtualKeyCode:9});
	assert.equal((await app.evaluate<string>(`document.activeElement.textContent`)).trim(), "取消");
	await clickText("取消");
	const leaving = await app.evaluate(`document.querySelector('[data-ly-modal]')?.classList.contains('ly-dialog-out')`);
	assert.equal(leaving,true);
	await until(`!document.querySelector('[data-ly-modal]')`);
	const focus = await app.evaluate<string>(`document.activeElement?.textContent`);
	assert.equal(focus?.trim(), "帮我批准");
	t.diagnostic(JSON.stringify({focus}));
});

test("project memory is visible in usage and its settings switch stops injection without erasing stored lessons", async (t) => {
	await app.send("Input.dispatchKeyEvent", {type:"keyDown",key:"Escape",windowsVirtualKeyCode:27});
	await app.send("Input.dispatchKeyEvent", {type:"keyUp",key:"Escape",windowsVirtualKeyCode:27}); await frames();
	const before = await app.evaluate<{used:number;projectMemory:string}>(`window.lyra.sessions.contextBreakdown('qa-long')`);
	assert.match(before.projectMemory,/核对当前仓库/);
	await click('button:has(svg.lucide-settings)');
	await until(`[...document.querySelectorAll('nav button')].some(b=>b.textContent.trim()==='个性化')`);
	await clickText("个性化"); await frames();
	await app.evaluate(`(()=>{const title=[...document.querySelectorAll('[data-view="personalization"] *')].find(e=>e.children.length===0&&e.textContent==='项目记忆');let row=title;while(row&&!row.querySelector('[role="switch"]'))row=row.parentElement;row.querySelector('[role="switch"]').setAttribute('data-project-switch','');})()`);
	await app.evaluate(`(()=>{const title=[...document.querySelectorAll('[data-view="personalization"] *')].find(e=>e.children.length===0&&e.textContent==='用户记忆');let row=title;while(row&&!row.querySelector('[role="switch"]'))row=row.parentElement;row.querySelector('[role="switch"]').setAttribute('data-user-switch','');})()`);
	await click('[data-user-switch]');
	assert.equal(await app.evaluate(`document.querySelector('[data-project-switch]').getAttribute('aria-checked')`),"true");
	assert.match((await app.evaluate<{projectMemory:string}>(`window.lyra.sessions.contextBreakdown('qa-long')`)).projectMemory, /核对当前仓库/);
	await click('[data-user-switch]');
	await click('[data-project-switch]');
	await until(`document.querySelector('[data-project-switch]').getAttribute('aria-checked') === 'false'`);
	const after = await app.evaluate<{used:number;projectMemory:string}>(`window.lyra.sessions.contextBreakdown('qa-long')`);
	assert.equal(after.projectMemory, "");
	assert.match(await app.evaluate<string>(`window.lyra.projectMemory.list(${JSON.stringify(join(app.home,"project"))}).then(r=>r.extracted.text)`), /核对当前仓库/);
	await click('[data-project-switch]'); await frames();
	assert.match((await app.evaluate<{projectMemory:string}>(`window.lyra.sessions.contextBreakdown('qa-long')`)).projectMemory, /核对当前仓库/);
	await screenshot("project-memory-settings");t.diagnostic(JSON.stringify({before:before.used,after:after.used}));
});


test("short touch viewports keep modal actions reachable and reduced motion still dismisses", async (t) => {
	await clickText("返回工作区");
	await frames();
	await withTouchViewport(async () => {
	await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,theme:'dark',reduceMotion:'on'}}))`);
	await frames();
	await clickText("帮我批准");
	await click('[aria-label="权限模式"] button:has(svg.lucide-circle-alert)');
	await until(`document.querySelector('[data-ly-modal]')`); await frames();
	const box = await app.evaluate(`(()=>{const e=document.querySelector('[data-ly-modal]'),r=e.getBoundingClientRect();return {x:r.x,right:r.right,top:r.top,bottom:r.bottom,height:r.height,titleTop:e.querySelector('h2').getBoundingClientRect().top,scrollTop:e.querySelector('.ly-scroll-view').scrollTop,duration:getComputedStyle(e).animationDuration};})()`);
	assert.ok(box.x>=0 && box.right<=375 && box.top>=0 && box.bottom<=480, JSON.stringify(box));
	assert.ok(parseFloat(box.duration)<0.01, JSON.stringify(box));
	assert.equal(box.scrollTop,0); assert.ok(box.titleTop>=box.top);
	await screenshot("permission-dark-compact");
	await clickText("取消");
	await until(`!document.querySelector('[data-ly-modal]')`);
	assert.equal((await app.evaluate<string>(`document.activeElement.textContent`)).trim(),"帮我批准");
	t.diagnostic(JSON.stringify(box));
	});
});


test("long registry lists scroll inside the dialog and nested confirmation closes independently", async (t) => {
	await app.send("Emulation.setTouchEmulationEnabled", {enabled:false});
	await app.send("Emulation.setDeviceMetricsOverride", {width:1200,height:800,deviceScaleFactor:1,mobile:false});
	await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,skillRegistries:[],pluginRegistries:Array.from({length:20},(_,i)=>'http://127.0.0.1/invalid-test-source-'+i+'/registry.json')}))`);
	// A missed native click needs its actual hit target; extending the wait cannot explain it.
	await app.evaluate(`(() => {
		window.qaRegistryClicks=[]; window.qaRegistryEvents=[];
		const record=e=>window.qaRegistryEvents.push({type:e.type,target:e.target.outerHTML.slice(0,300),x:e.clientX,y:e.clientY});
		const types=['pointerdown','mousedown','pointerup','mouseup','click'];
		for(const type of types) window.addEventListener(type,record,true);
		window.qaRegistryCleanup=()=>{for(const type of types) window.removeEventListener(type,record,true); delete window.qaRegistryClicks; delete window.qaRegistryEvents; delete window.qaRegistryCleanup;};
	})()`);
	try {
		await clickText("插件"); await frames();
		await clickText("添加");
		await clickText("添加插件市场");
		await until(`document.querySelector('[aria-label="关闭插件市场"]')`); await frames();
	} catch (error) {
		t.diagnostic(JSON.stringify(await app.evaluate(`({clicks:window.qaRegistryClicks,events:window.qaRegistryEvents,viewport:[innerWidth,innerHeight],native:[outerWidth,outerHeight],scale:devicePixelRatio,touch:navigator.maxTouchPoints,hover:matchMedia('(hover:hover)').matches,body:document.body.innerText.slice(-2000)})`)));
		await screenshot("registry-open-failure");
		throw error;
	} finally {
		await app.evaluate(`window.qaRegistryCleanup()`);
	}
	const box = await app.evaluate(`(()=>{const e=document.querySelector('[data-ly-modal]'),r=e.getBoundingClientRect(),s=e.querySelector('.ly-scroll-view');return {height:r.height,top:r.top,bottom:r.bottom,overflow:s.scrollHeight>s.clientHeight,actions:e.querySelectorAll('[data-row-actions]').length};})()`);
	assert.equal(box.actions,20); assert.equal(box.overflow,true); assert.ok(box.bottom<=800,JSON.stringify(box));
	await click('[data-ly-modal] button[aria-label^="移除 http"]');
	await until(`document.querySelectorAll('[data-ly-modal]').length===2`);
	const layers = await app.evaluate<number[]>(`[...document.querySelectorAll('[data-ly-modal]')].map(e=>Number(getComputedStyle(e.parentElement).zIndex))`);
	assert.ok(layers[1]>layers[0]);
	await app.send("Input.dispatchKeyEvent", {type:"keyDown",key:"Escape",windowsVirtualKeyCode:27});
	await app.send("Input.dispatchKeyEvent", {type:"keyUp",key:"Escape",windowsVirtualKeyCode:27});
	await until(`document.querySelectorAll('[data-ly-modal]').length===1`);
	assert.equal(await app.evaluate(`window.lyra.settings.get().then(s=>s.pluginRegistries.length)`),20);
	await withTouchViewport(async () => {
	await frames();
	const narrow = await app.evaluate(`(()=>{const e=document.querySelector('[data-ly-modal]'),r=e.getBoundingClientRect(),s=e.querySelector('.ly-scroll-view');return {x:r.x,right:r.right,bottom:r.bottom,overflow:s.scrollWidth-s.clientWidth,action:getComputedStyle(e.querySelector('.ly-row-action')).opacity,touch:navigator.maxTouchPoints,hover:matchMedia('(hover: hover)').matches};})()`);
	assert.ok(narrow.x>=0 && narrow.right<=375 && narrow.bottom<=480,JSON.stringify(narrow));
	assert.equal(narrow.overflow,0); assert.equal(narrow.action,"1"); assert.equal(narrow.hover,false); assert.equal(narrow.touch,1);
	await screenshot("registry-dark-compact");
	await click('[aria-label="关闭插件市场"]');
	await until(`!document.querySelector('[data-ly-modal]')`);
	t.diagnostic(JSON.stringify({box,narrow,layers}));
	});
});

/*
 * 最后一条：它改视口，而这些用例共用一个窗口。
 *
 * 窄到 380px 会把布局切进 compact——dock 折成单面板、侧边栏变抽屉——恢复宽度并不会把这些一并还原，
 * 所以它必须站在队尾，后面不能再有别人。
 */
test("a narrow column centres the transcript instead of parking the question rail's room on one side", async (t) => {
	/*
	 * 导航条要的那一条，在窄列里得从两边一起出。
	 *
	 * 转录区左边垫 48px 给导航让位，右边一直是 16px——在宽窗口里没人看得出来，在 380px 的一列里
	 * 那是十二分之一的宽度，整段正文明显地偏在自己那格的右边。量的是列不是窗口：开着侧边栏和另一
	 * 个面板的 1400px 窗口，对话列同样只有四百多像素，一样偏。
	 */
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
	await click('[data-ly-row="qa-long"] > button');
	await until(`document.querySelectorAll('.ly-question-mark').length > 1`);
	const column = `(()=>{const view=document.querySelector('.ly-transcript').closest('.ly-scroll-view'),v=view.getBoundingClientRect(),c=document.querySelector('.ly-transcript').getBoundingClientRect(),rail=document.querySelector('.ly-question-nav');
		return {width:Math.round(v.width),left:Math.round(c.left-v.left),right:Math.round(v.right-c.right),rail:rail?Math.round(rail.getBoundingClientRect().left-v.left):null}})()`;
	// 两头都在阈值之内：520 是分界本身，拿它去量只会测到分界写在哪一侧。
	for (const width of [380, 500]) {
		await app.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
		await frames(30);
		const box = await app.evaluate<{ width: number; left: number; right: number; rail: number | null }>(column);
		t.diagnostic(`${width}px → ${JSON.stringify(box)}`);
		assert.equal(box.left, box.right, `窄列里正文要居中，实际左 ${box.left} 右 ${box.right}（列宽 ${box.width}）`);
		assert.ok(box.rail !== null && box.rail >= 0 && box.rail < box.left, `导航条要贴着边缘并留在正文左侧：${JSON.stringify(box)}`);
	}
	await app.send("Emulation.clearDeviceMetricsOverride");
});
