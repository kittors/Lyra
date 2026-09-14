import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
before(async () => {
	app = await startApp({ port: 9631, seed: async (home) => {
		await seedInteractions(home);
		await mkdir(join(home, "commands"));
		for (let i = 0; i < 40; i++) await writeFile(join(home, "commands", `review-${i}.md`), `---\ndescription: 检查工作流程 ${i}\n---\nReview this change.`);
	} });
});
after(async () => { await app?.stop(); });

async function frames(count = 20) {
	await app.evaluate(`new Promise(resolve=>{let n=0;function tick(){if(++n>=${count})resolve();else requestAnimationFrame(tick)}requestAnimationFrame(tick)})`);
}
async function openMenu() {
	await app.evaluate(`document.querySelector('textarea').focus();document.querySelector('textarea').select()`);
	await app.send("Input.insertText", { text: "/" });
	await app.evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+8000;function tick(){if(document.querySelectorAll('.ly-command-menu [role="option"]').length>40)resolve();else if(performance.now()>end)reject(Error('commands did not load'));else requestAnimationFrame(tick)}tick()})`);
	await frames();
}
async function key(key: string, code: number) {
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code });
	await frames(2);
}
const view = `document.querySelector('.ly-command-menu .ly-scroll-view')`;

test("hover and wheel leave scroll ownership with the pointer; arrows reveal their selection", async (t) => {
	await openMenu();
	await app.evaluate(`${view}.scrollTop=145`); await frames();
	const before = await app.evaluate<number>(`${view}.scrollTop`);
	const point = await app.evaluate<{x:number;y:number}>(`(()=>{const r=${view}.getBoundingClientRect(),row=[...document.querySelectorAll('.ly-command-menu [role="option"]')].find(e=>{const b=e.getBoundingClientRect();return b.top<r.top+36&&b.bottom>r.top+3});if(!row)throw Error('no partially visible row');const b=row.getBoundingClientRect();return {x:r.left+45,y:Math.max(r.top+3,b.top+2)}})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }); await frames();
	const afterHover = await app.evaluate<number>(`${view}.scrollTop`);
	t.diagnostic(JSON.stringify({ before, afterHover }));
	assert.equal(afterHover, before, "hovering a partially visible row must not pull it into the viewport");
	await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaY: 180, deltaX: 0 }); await frames();
	const wheelTop = await app.evaluate<number>(`${view}.scrollTop`);
	assert.ok(wheelTop > before + 100, "the wheel moves the list under the stationary pointer");
	await frames(); assert.equal(await app.evaluate(`${view}.scrollTop`), wheelTop);
	for (let i = 0; i < 14; i++) await key("ArrowDown", 40);
	const selected = await app.evaluate<{top:number;bottom:number;viewTop:number;viewBottom:number}>(`(()=>{const r=document.querySelector('.ly-command-menu [aria-selected="true"]').getBoundingClientRect(),v=${view}.getBoundingClientRect();return {top:r.top,bottom:r.bottom,viewTop:v.top,viewBottom:v.bottom}})()`);
	assert.ok(selected.top >= selected.viewTop + 35 && selected.bottom <= selected.viewBottom - 47, JSON.stringify(selected));
	await frames();
	assert.equal(await app.evaluate(`document.querySelector('textarea').getAttribute('aria-activedescendant')`), await app.evaluate(`document.querySelector('.ly-command-menu [aria-selected="true"]').id`));
});

test("menu thumbs stay inside their rounded surfaces in both themes and narrow windows", async (t) => {
	for (const theme of ["light", "dark"]) for (const width of [1200, 375]) {
		await app.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
		await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${theme === "light" ? '"light"' : '"dark"'}}})})()`);
		await openMenu();
		for (const top of [0, 100000]) {
			await app.evaluate(`${view}.scrollTop=${top}`); await frames();
			const metrics = await app.evaluate<{top:number;bottom:number;right:number;gap:number;left:number;panelRight:number}>(`(()=>{const m=document.querySelector('.ly-command-menu'),r=m.getBoundingClientRect(),thumb=m.querySelector('.ly-thumb').getBoundingClientRect(),row=m.querySelector('[role="option"]').getBoundingClientRect();return {top:thumb.top-r.top,bottom:r.bottom-thumb.bottom,right:r.right-thumb.right,gap:thumb.left-row.right,left:r.left,panelRight:r.right}})()`);
			t.diagnostic(JSON.stringify({theme,width,...metrics}));
			assert.ok(metrics.top >= 6 && metrics.bottom >= 6 && metrics.right >= 6 && metrics.gap >= 4, JSON.stringify(metrics));
			assert.ok(metrics.left >= 0 && metrics.panelRight <= width);
		}
		if (process.env.LYRA_E2E_ARTIFACTS) {
			const point = await app.evaluate<{x:number;y:number}>(`(()=>{const r=${view}.getBoundingClientRect();return {x:r.left+40,y:r.top+r.height/2}})()`);
			await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }); await frames();
			await mkdir(process.env.LYRA_E2E_ARTIFACTS, { recursive: true });
			const shot = await app.send<{data:string}>("Page.captureScreenshot", { format: "png" });
			await writeFile(join(process.env.LYRA_E2E_ARTIFACTS, `menu-scroll-${theme}-${width}.png`), Buffer.from(shot.data, "base64"));
		}
	}
});

test("shared model popovers keep clear gutters and their thumb can be dragged to the last row", async (t) => {
	await key("Escape", 27);
	// Synthetic models are saved through the real settings IPC; no provider request is made.
	await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();const models=Array.from({length:40},(_,i)=>({id:'qa/model-'+i,providerId:'qa',modelId:'model-'+i,name:'菜单验证 '+String(i).padStart(2,'0'),contextWindow:128000,maxOutputTokens:4096,supportsImages:false,supportsThinking:false,supportsTools:true}));await window.lyra.settings.save({...s,providers:[{id:'qa',name:'菜单验证',api:'anthropic-messages',baseUrl:'http://127.0.0.1:9',apiKey:'test',enabled:true,models}],defaultModelId:'qa/model-0'})})()`);
	const selector = '[role="menu"][aria-label="选择模型"]';
	for (const theme of ["light", "dark"]) for (const width of [1200, 375]) {
		// Protocol GC failures carry no JavaScript stack; record the pending operation in CI.
		const phase = (step: string) => t.diagnostic(`${theme}/${width}: ${step}`);
		phase("resize");
		await app.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
		phase("save theme and open model menu");
		await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${theme === "light" ? '"light"' : '"dark"'}}});[...document.querySelectorAll('button[aria-haspopup="menu"]')].find(b=>(b.dataset.lyTip||'').endsWith('上下文')).click()})()`);
		phase("wait for open menu frames");
		await frames();
		phase("read thumb geometry");
		const geometry = await app.evaluate<{x:number;y:number;travel:number;gap:number;right:number;top:number}>(`(()=>{const m=document.querySelector('${selector}'),v=m.querySelector('.ly-scroll-view'),thumb=m.querySelector('.ly-thumb'),r=m.getBoundingClientRect(),b=thumb.getBoundingClientRect(),row=m.querySelector('[data-model]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,travel:v.clientHeight-b.height,gap:b.left-row.right,right:r.right-b.right,top:b.top-v.getBoundingClientRect().top}})()`);
		assert.ok(geometry.gap >= 4 && geometry.right >= 6 && geometry.travel > 0, JSON.stringify(geometry));
		phase("hover thumb and wait for frames");
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: geometry.x, y: geometry.y }); await frames();
		phase("drag thumb and wait for frames");
		await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: geometry.x, y: geometry.y, button: "left", buttons: 1, clickCount: 1 });
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: geometry.x, y: geometry.y + geometry.travel + 2, buttons: 1 });
		await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: geometry.x, y: geometry.y + geometry.travel + 2, button: "left", buttons: 0, clickCount: 1 }); await frames();
		phase("read final scroll geometry");
		const end = await app.evaluate<{remaining:number;inside:boolean;opacity:number}>(`(()=>{const m=document.querySelector('${selector}'),v=m.querySelector('.ly-scroll-view'),last=m.querySelector('[data-model="qa/model-39"]').getBoundingClientRect(),r=v.getBoundingClientRect();return {remaining:v.scrollHeight-v.clientHeight-v.scrollTop,inside:last.top>=r.top&&last.bottom<=r.bottom,opacity:Number(getComputedStyle(m.querySelector('.ly-thumb')).opacity)}})()`);
		t.diagnostic(JSON.stringify({theme,width,...geometry,...end}));
		assert.ok(end.remaining <= 1 && end.inside && end.opacity > 0, JSON.stringify(end));
		phase("close menu and wait for frames");
		await key("Escape", 27); await frames();
	}
});
