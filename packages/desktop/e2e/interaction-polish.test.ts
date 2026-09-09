import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
before(async () => { app = await startApp({ port: 9601, seed: seedInteractions }); });
after(async () => { await app?.stop(); });

async function frames(count = 20): Promise<void> {
	await app.evaluate(`new Promise(resolve => { let n=${count}; const frame=()=>--n?requestAnimationFrame(frame):resolve(); requestAnimationFrame(frame); })`);
}
async function click(selector: string): Promise<void> {
	const at = await app.evaluate<{ x: number; y: number }>(`(() => {
		const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility({visibilityProperty:true}));
		if (!el) throw new Error('missing control '+${JSON.stringify(selector)});
		el.scrollIntoView({block:'nearest',behavior:'instant'}); const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...at });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...at });
	await frames(2);
}
async function until(expression: string): Promise<void> {
	await app.evaluate(`new Promise((resolve,reject)=>{let n=300;const step=()=>{if(${expression})resolve();else if(--n)requestAnimationFrame(step);else reject(new Error(${JSON.stringify(expression)}));};step();})`);
}
async function shot(name: string): Promise<void> {
	const dir = process.env.LYRA_E2E_ARTIFACTS;
	if (!dir) return;
	await mkdir(dir, { recursive: true });
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(result.data, "base64"));
}

test("question navigation is mouse reachable and jumps to an unmounted historical question without a moving first frame", async (t) => {
	await click('[data-ly-row="qa-long"] > button');
	await until('document.querySelectorAll(".ly-question-mark").length === 15');
	await click('.ly-question-mark');
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", windowsVirtualKeyCode: 36 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Home", windowsVirtualKeyCode: 36 });
	await until('document.querySelector("[data-question-index=\\"0\\"]")');
	const samples = await app.evaluate<{ y: number; rows: number }[]>(`(async()=>{const out=[];for(let i=0;i<24;i++){await new Promise(requestAnimationFrame);out.push({y:document.querySelector('[data-question-index="0"]').getBoundingClientRect().top,rows:document.querySelector('.ly-transcript').children.length});}return out;})()`);
	t.diagnostic(JSON.stringify(samples));
	assert.ok(samples[0].y >= 44 && samples[0].y < 110);
	assert.ok(samples.every((sample) => Math.abs(sample.y - samples[0].y) < 1 && sample.rows <= 62));
	await frames();
	await shot("question-navigation");
	await click('button[aria-label="跳转到第 10 个问题：qa-long 第 10 个问题：检查会话导航、缓存与滚动位置。"]');
	const trajectory = await app.evaluate<number[]>(`(async()=>{const out=[];for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);out.push(document.querySelector('[data-question-index="18"]').getBoundingClientRect().top);}return out;})()`);
	t.diagnostic(JSON.stringify({question10:trajectory.filter((_,i)=>i%10===0)}));
	const position = await app.evaluate<number>(`document.querySelector('[data-question-index="18"]').getBoundingClientRect().top`);
	assert.ok(position >= 44 && position <= 100, `question 10 at ${position}`);
	await click('[data-ly-row="qa-short"] > button'); await frames();
	await click('[data-ly-row="qa-long"] > button'); await frames();
	assert.ok(Math.abs(await app.evaluate<number>(`document.querySelector('[data-question-index="18"]').getBoundingClientRect().top`) - position) <= 1);
});

test("every visible settings navigation resolves to its own page, including screenshots", async (t) => {
	await click('button:has(svg.lucide-settings)');
	await until(`[...document.querySelectorAll('nav button')].some(b=>b.checkVisibility({visibilityProperty:true})&&b.textContent.trim()==='常规')`);
	const ids = await app.evaluate<string[]>(`[...document.querySelectorAll('nav button')].filter(b=>b.checkVisibility({visibilityProperty:true})&&b.hasAttribute('aria-current')).map(b=>b.textContent)`);
	t.diagnostic(`initial settings selection: ${ids.join(",")}`);
	// The registry's visible sidebar buttons carry the page label as their complete text.
	const pages: [string, string][] = [["常规", "general"], ["外观", "appearance"], ["代码格式化", "formatting"], ["个性化", "personalization"], ["模型设置", "models"], ["代码托管", "forges"], ["屏幕截图", "screenshot"], ["浏览器", "browser"], ["插件", "plugins"], ["智能体", "agents"], ["子智能体调度", "delegation"], ["命令", "commands"], ["钩子", "hooks"], ["网页搜索", "search"], ["访问授权", "access"], ["索引库", "index"], ["移动端同步", "sync"], ["使用统计", "usage"], ["Worktrees", "worktrees"], ["关于", "about"], ["已归档的聊天", "archived"]];
	for (const [label, id] of pages) {
		const selector = await app.evaluate<string>(`(() => {const buttons=[...document.querySelectorAll('button')];const at=buttons.findIndex(b=>b.checkVisibility({visibilityProperty:true})&&b.textContent.trim()===${JSON.stringify(label)});if(at<0)throw new Error(${JSON.stringify(label)});buttons[at].setAttribute('data-qa-section',${JSON.stringify(id)});return '[data-qa-section="'+${JSON.stringify(id)}+'"]';})()`);
		await click(selector);
		t.diagnostic(`${label}: ${await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-current')`)}`);
		await until(`[...document.querySelectorAll('[data-view="${id}"]')].some(e=>e.checkVisibility({visibilityProperty:true}))`);
		assert.equal(await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-current')`), "page");
	}
	t.diagnostic(`${pages.length} settings entries opened their own page`);
	if (process.platform === "darwin") { await click('[data-qa-section="screenshot"]'); await frames(); await shot("screenshot-settings"); }
});

test("skills have fades at the actual hidden edges and retain their reading position across tabs", async (t) => {
	await click('[data-qa-section="plugins"]');
	await until(`[...document.querySelectorAll('[data-view="plugins"]')].some(e=>e.checkVisibility({visibilityProperty:true}))`);
	await app.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.checkVisibility({visibilityProperty:true})&&/^技能/.test(b.textContent));b.setAttribute('data-qa-skills','');})()`);
	await click('[data-qa-skills]');
	await until(`document.querySelector('.ly-rule-excerpt')?.checkVisibility({visibilityProperty:true})`);
	const read = () => app.evaluate<{ top: string; bottom: string; position: number; height: number; content: number }>(`(()=>{const el=document.querySelector('.ly-rule-excerpt .ly-scroll-view');return {top:el.style.getPropertyValue('--ly-fade-top'),bottom:el.style.getPropertyValue('--ly-fade-bottom'),position:el.scrollTop,height:el.clientHeight,content:el.scrollHeight};})()`);
	await frames(); const start = await read();
	assert.equal(start.top, "0px"); assert.equal(start.bottom, `${Math.min(48, start.height / 5)}px`); assert.ok(start.content > start.height * 3);
	const at = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector('.ly-rule-excerpt').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...at, deltaX: 0, deltaY: 250 }); await frames();
	const middle = await read(); assert.equal(middle.top, `${Math.min(36, middle.height / 5)}px`); assert.equal(middle.bottom, `${Math.min(48, middle.height / 5)}px`);
	await shot("skills-middle");
	await click('[data-qa-section="general"]'); await frames(); await click('[data-qa-section="plugins"]'); await frames();
	assert.equal((await read()).position, middle.position);
	await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...at, deltaX: 0, deltaY: 1600 }); await frames();
	const end = await read(); assert.equal(end.top, `${Math.min(36, end.height / 5)}px`); assert.equal(end.bottom, "0px");
	t.diagnostic(JSON.stringify({ start, middle, end }));
});

test("Git uses Index counts, colours added C# syntax, aligns checkout branches and wraps long tooltips", async (t) => {
	await app.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.checkVisibility({visibilityProperty:true})&&b.textContent.trim()==='返回工作区');b.setAttribute('data-qa-return','');})()`);
	await click('[data-qa-return]');
	await click('button[aria-label^="Git "]');
	await until(`document.querySelector('[data-dock-pane="review"]')?.textContent.includes('未暂存')`);
	const rows = await app.evaluate<string[]>(`[...document.querySelectorAll('[data-dock-pane="review"] button[data-ly-tip="Hello.cs"]')].map(b=>b.innerText)`);
	assert.equal(rows.length, 2); assert.match(rows[0], /\+4/); assert.match(rows[1], /\+1\s*−1/);
	await click('[data-dock-pane="review"] button[data-ly-tip="Hello.cs"]');
	await until(`document.querySelectorAll('.ly-diff-add span[class^="ͼ"]').length > 2`);
	const colors = await app.evaluate<{ token: string; color: string }[]>(`[...document.querySelectorAll('.ly-diff-add span[class^="ͼ"]')].map(e=>({token:e.textContent,color:getComputedStyle(e).color}))`);
	assert.ok(new Set(colors.map((entry) => entry.color)).size >= 3, JSON.stringify(colors));
	await shot("git-csharp");
	await click('[data-dock-pane="review"] [data-ly-tip="分支"]');
	await until(`document.querySelector('[data-view="branches"]')?.textContent.includes('second-checkout')`);
	const aligned = await app.evaluate<number[]>(`[...document.querySelectorAll('[data-view="branches"] button[data-ly-tip]')].filter(b=>b.dataset.lyTip.includes('project')||b.dataset.lyTip.includes('second-checkout')).map(b=>b.lastElementChild.getBoundingClientRect().right)`);
	assert.equal(aligned.length, 2); assert.ok(Math.abs(aligned[0] - aligned[1]) < 1, JSON.stringify(aligned));
	const at = await app.evaluate<{ x: number; y: number }>(`(()=>{const b=[...document.querySelectorAll('[data-view="branches"] button[data-ly-tip]')].find(b=>b.dataset.lyTip.includes('second-checkout'));const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at }); await frames(45);
	const tooltip = await app.evaluate<{ height: number; line: number; right: number; bottom: number; width: number; viewport: number; viewportHeight: number }>(`(()=>{const e=document.querySelector('[role="tooltip"]');const r=e.getBoundingClientRect();return {height:r.height,line:parseFloat(getComputedStyle(e).lineHeight),right:r.right,bottom:r.bottom,width:r.width,viewport:innerWidth,viewportHeight:innerHeight};})()`);
	assert.ok(tooltip.height > tooltip.line * 2, JSON.stringify(tooltip));
	assert.ok(tooltip.right <= tooltip.viewport - 5 && tooltip.bottom <= tooltip.viewportHeight - 5);
	await shot("branch-tooltip");
	t.diagnostic(JSON.stringify({ rows, colors, aligned, tooltip }));
});
