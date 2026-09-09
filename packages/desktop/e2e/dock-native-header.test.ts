import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
const pane = '[data-dock-pane="review"]';
const button = `${pane} button[aria-label*="全屏"]`;
before(async () => {
	app = await startApp({ port: 9653, seed: seedInteractions });
	await until(`document.querySelector('[data-ly-row="qa-short"] > button')`);
	await app.evaluate(`document.querySelector('[data-ly-row="qa-short"] > button').click()`);
});
after(async () => { await app?.stop(); });

async function frames(count: number): Promise<void> {
	await app.evaluate(`new Promise(resolve=>{let n=${count};function tick(){if(--n<=0)resolve();else requestAnimationFrame(tick)}requestAnimationFrame(tick)})`);
}
async function until(expression: string): Promise<void> {
	await app.evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+10000;function tick(){if(${expression})resolve();else if(performance.now()>end)reject(Error(${JSON.stringify(expression)}));else requestAnimationFrame(tick)}tick()})`);
}

interface ButtonFrame {
	x: number;
	y: number;
	width: number;
	height: number;
	rightGap: number;
	paneRight: number;
	paddingEnd: number;
	headingGap: number;
	cardGap: number;
}
interface Evidence {
	frames: (ButtonFrame | null)[];
	clicks: (string | null)[];
	retained: boolean;
	finalLabel: string | null;
	nativePlatform: string;
}

test("rapid native fullscreen clicks keep the header sized and anchored without hitting close", async (t) => {
	const failures: string[] = [];
	for (const theme of ["light", "dark"]) for (const width of [1200, 1024]) {
		await app.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
		await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${JSON.stringify(theme)},reduceMotion:'off'}})})()`);
		await until(`document.documentElement.classList.contains(${JSON.stringify(theme)})`);
		if (!await app.evaluate(`Boolean(document.querySelector('${pane}'))`)) {
			await until(`document.querySelector('button[aria-label^="Git "]')`);
			await app.evaluate(`document.querySelector('button[aria-label^="Git "]').click()`);
		}
		await until(`document.querySelector('${button}')`);
		await until(`document.querySelector('${pane} [data-view="changes"]')`);
		await frames(30);
		const point = await app.evaluate<{ x: number; y: number }>(`(()=>{const e=document.querySelector('${button}'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
		await app.evaluate(`(()=>{
			const pane=document.querySelector('${pane}'),original=pane.querySelector('[data-view="changes"]');
			const trace=window.__headerTrace={active:true,frames:[],clicks:[],pane,original};
			function tick(){const e=document.querySelector('${button}'),r=e?.getBoundingClientRect(),p=pane.getBoundingClientRect(),h=pane.querySelector('[data-dock-header]'),heading=pane.querySelector('[data-dock-heading-slot] > [data-dock-heading]'),surface=pane.querySelector('[data-dock-motion]'),card=pane.querySelector('.ly-dock-card');trace.frames.push(r?{x:r.x,y:r.y,width:r.width,height:r.height,rightGap:p.right-r.right,paneRight:p.right,paddingEnd:parseFloat(getComputedStyle(h).paddingRight),headingGap:heading.getBoundingClientRect().left-surface.getBoundingClientRect().left,cardGap:heading.getBoundingClientRect().left-card.getBoundingClientRect().left}:null);if(trace.active)requestAnimationFrame(tick)}requestAnimationFrame(tick);
			trace.listener=e=>trace.clicks.push(e.target.closest('button')?.getAttribute('aria-label')??null);
			document.addEventListener('click',trace.listener,true);
		})()`);
		// Deliberately reuse the initial position while animations are still running, as a person does.
		for (let i = 0; i < 8; i++) {
			await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
			await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
			await frames(2);
		}
		await frames(30);
		const evidence = await app.evaluate<Evidence>(`(()=>{const trace=window.__headerTrace;trace.active=false;document.removeEventListener('click',trace.listener,true);return {frames:trace.frames,clicks:trace.clicks,retained:trace.pane===document.querySelector('${pane}')&&trace.original?.isConnected,finalLabel:document.querySelector('${button}')?.getAttribute('aria-label')??null,nativePlatform:navigator.platform}})()`);
		const visible = evidence.frames.filter((frame) => frame !== null);
		const xRange = visible.length ? Math.max(...visible.map((frame) => frame.x)) - Math.min(...visible.map((frame) => frame.x)) : Infinity;
		const headingRange = Math.max(...visible.map((frame) => frame.headingGap)) - Math.min(...visible.map((frame) => frame.headingGap));
		t.diagnostic(JSON.stringify({ theme, width, platform: evidence.nativePlatform, clicks: evidence.clicks, frames: visible.length, xRange, headingRange, cardGap: [Math.min(...visible.map(f=>f.cardGap)),Math.max(...visible.map(f=>f.cardGap))], paddingEnd: visible[0]?.paddingEnd }));
		if (evidence.frames.some((frame) => frame === null)) failures.push(`${theme}/${width}: Git was closed by a fullscreen click`);
		if (!evidence.retained || evidence.finalLabel !== "全屏：Git") failures.push(`${theme}/${width}: content or final state was lost`);
		if (evidence.clicks.length !== 8 || evidence.clicks.some((label, i) => label !== (i % 2 ? "退出全屏：Git" : "全屏：Git"))) failures.push(`${theme}/${width}: a native click missed its fullscreen control`);
		if (xRange > 0.5 || visible.some((frame) => Math.abs(frame.width - 20) > 0.5 || Math.abs(frame.height - 20) > 0.5 || Math.abs(frame.rightGap - (visible[0]?.rightGap ?? 0)) > 0.5)) failures.push(`${theme}/${width}: header geometry drifted while its right boundary stayed fixed`);
		if (headingRange > 0.5 || visible.some((frame) => frame.cardGap < 0)) failures.push(`${theme}/${width}: title left its visual card during reversal`);
		if (/Win/.test(evidence.nativePlatform) && !(visible[0] && visible[0].paddingEnd > 6)) failures.push(`${theme}/${width}: Windows titlebar controls were not reserved`);
		if (process.env.LYRA_E2E_ARTIFACTS) {
			await mkdir(process.env.LYRA_E2E_ARTIFACTS, { recursive: true });
			await writeFile(join(process.env.LYRA_E2E_ARTIFACTS, `native-header-${theme}-${width}.json`), JSON.stringify(evidence, null, 2));
			const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
			await writeFile(join(process.env.LYRA_E2E_ARTIFACTS, `native-header-${theme}-${width}.png`), Buffer.from(shot.data, "base64"));
		}
	}
	assert.deepEqual(failures, [], failures.join("\n"));
});

test("a window resize finishes the visual flight before taking over pane geometry", async (t) => {
	const started = await app.evaluate<boolean>(`(async()=>{
		const pane=document.querySelector('${pane}'),surface=pane.querySelector('[data-dock-motion]');
		pane.querySelector('button[aria-label^="全屏"]').click();
		await new Promise(requestAnimationFrame);
		return surface.getAnimations().some(a=>a.id==='ly-dock-geometry'&&a.playState==='running');
	})()`);
	assert.equal(started, true, "the resize interrupts an actual in-flight animation");
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1160, height: 820, deviceScaleFactor: 1, mobile: false });
	await frames(2);
	const state = await app.evaluate<{ active: number; width: number; height: number; retained: boolean }>(`(()=>{
		const pane=document.querySelector('${pane}'),surface=pane.querySelector('[data-dock-motion]'),r=pane.querySelector('button[aria-label*="全屏"]').getBoundingClientRect();
		return {active:pane.getAnimations({subtree:true}).filter(a=>a.id==='ly-dock-geometry'&&a.playState==='running').length,width:r.width,height:r.height,retained:!!pane.querySelector('[data-view="changes"]')};
	})()`);
	t.diagnostic(JSON.stringify(state));
	assert.deepEqual(state, { active: 0, width: 20, height: 20, retained: true });
});

test("translated terminal tabs stay clipped before the fixed controls and reverse continuously", async (t) => {
	await app.evaluate(`document.querySelector('${button}').click()`);
	await frames(30);
	await app.evaluate(`document.querySelector('button[aria-label="面板"]').click()`);
	await until(`document.querySelector('[role="menuitem"]')`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim().startsWith('终端')).click()`);
	await until(`document.querySelector('[data-dock-pane="terminal"] [data-tab]')`);
	for (let i = 0; i < 7; i++) {
		await app.evaluate(`document.querySelector('button[aria-label="新建终端"]').click()`);
		await until(`document.querySelectorAll('[data-dock-pane="terminal"] [data-tab]').length===${i + 2}`);
	}
	const reports = [];
	for (const theme of ["light", "dark"]) for (const width of [1200, 1024]) {
		await app.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
		await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${JSON.stringify(theme)}}})})()`);
		await until(`document.documentElement.classList.contains(${JSON.stringify(theme)})`);
		await app.evaluate(`document.querySelector('[data-dock-grip="terminal"]').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(width === 1200 ? "ArrowRight" : "ArrowLeft")},altKey:true,bubbles:true}))`);
		await frames(30);
		type Sample = { hit: boolean; boundary: boolean; noDrag: boolean; titleVisible: boolean; width: number; height: number; round: number; frame: number; tabs: { left: number; right: number; wide: boolean; own: boolean }[]; strip: { left: number; right: number }; edge: number; paneWidth: number };
		const report = await app.evaluate<{ samples: Sample[]; deltas: number[]; retained: boolean }>(`(async()=>{
			const pane=document.querySelector('[data-dock-pane="terminal"]'),title=pane.querySelector('[data-dock-heading-slot] > [data-dock-heading]'),original=pane.querySelector('.xterm-screen');
			const frame=()=>new Promise(requestAnimationFrame),rect=()=>[...pane.querySelectorAll('[data-dock-heading]')].flatMap(e=>{const r=e.getBoundingClientRect();return [r.x,r.y]});
			const samples=[],deltas=[];
			for(let i=0;i<8;i++){
				const from=rect();pane.querySelector('button[aria-label*="全屏"]').click();await Promise.resolve();const to=rect();deltas.push(Math.max(...from.map((n,i)=>Math.abs(n-to[i]))));
				for(let j=0;j<(i<2?20:2);j++){
					await frame();const actions=pane.querySelector('[data-dock-actions]'),slot=pane.querySelector('[data-dock-heading-slot]'),r=pane.querySelector('button[aria-label*="全屏"]').getBoundingClientRect();
					const strip=title.querySelector('.ly-fade-tail').getBoundingClientRect(),edge=actions.getBoundingClientRect().left;
					const boundary=[...pane.querySelectorAll('[data-dock-heading]')].every(e=>{const clip=getComputedStyle(e).clipPath,inset=clip==='none'?0:parseFloat(clip.slice(6,-1).split(' ')[1]);return e.getBoundingClientRect().right-inset<=edge+.5});
					// 每个标签自己的可见窗口，留着给失败时看：宽度归零还是中心点被别人接了，改的地方不一样。
					const tabs=[...title.querySelectorAll('[data-tab] > button:first-child')].map(b=>{const q=b.getBoundingClientRect(),left=Math.max(q.left,strip.left,0),right=Math.min(q.right,strip.right,edge,innerWidth);return {left:Math.round(left),right:Math.round(right),wide:right-left>1,own:b.contains(document.elementFromPoint((left+right)/2,q.y+q.height/2))};});
					/*
					 * 有没有宽度，而不是中心点归不归它。
					 *
					 * 这条在 Windows 上反复红，诊断指到 round 1 的第 7 帧：六个标签都还有 35px 可见，
					 * 但 elementFromPoint 全部落到别的元素上——那一刻整条标签栏正随着全屏切换在滑，
					 * 命中测试量的是动画时序，不是可见性。
					 *
					 * 去掉它不留缺口：actions 有没有被盖住由 hit 独立守着（每个按钮九个采样点都要
					 * 命中自己），标签有没有越过 actions 由 boundary 守着。这里要守的是最后一件事
					 * ——裁剪不能把标签裁到一个不剩。
					 */
					const titleVisible=tabs.some(t=>t.wide);
					samples.push({hit:[...actions.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return [.15,.5,.85].every(x=>[.15,.5,.85].every(y=>b.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y))))}),boundary:boundary&&slot.getBoundingClientRect().right<=edge,noDrag:getComputedStyle(title.firstElementChild).getPropertyValue('-webkit-app-region')==='no-drag',titleVisible,width:r.width,height:r.height,round:i,frame:j,tabs,strip:{left:Math.round(strip.left),right:Math.round(strip.right)},edge:Math.round(edge),paneWidth:Math.round(pane.getBoundingClientRect().width)});
				}
			}
			for(let i=0;i<30;i++)await frame();return {samples,deltas,retained:original===pane.querySelector('.xterm-screen')};
		})()`);
		reports.push({ theme, width, ...report });
		t.diagnostic(JSON.stringify({ theme, width, samples: report.samples.length, maxReversal: Math.max(...report.deltas), hit: report.samples.every(s=>s.hit), retained: report.retained }));
		/*
		 * 六个条件揉在一句里，坏了也不说是哪一个。
		 *
		 * 这条在 Windows 上红过，日志里只有这句话——按钮被盖住、标签越界、尺寸不是 20，读起来
		 * 一模一样。把第一个不合格的采样连同它自己的字段打出来，下次的报告自己会说是哪一条。
		 */
		const bad = report.samples.find(s => !(s.hit && s.boundary && s.noDrag && s.titleVisible && s.width === 20 && s.height === 20));
		assert.ok(!bad, `terminal tabs remain visible without covering or scaling pane actions — ${JSON.stringify({ theme, width, bad })}`);
		assert.ok(report.deltas.every(delta=>delta < 1), "title and grip reverse from their visible positions");
		assert.equal(report.retained, true);
	}
	if (process.env.LYRA_E2E_ARTIFACTS) await writeFile(join(process.env.LYRA_E2E_ARTIFACTS, "terminal-header-motion.json"), JSON.stringify(reports, null, 2));
});
