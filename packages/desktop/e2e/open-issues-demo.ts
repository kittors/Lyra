/* oxlint-disable no-console -- real-window verification prints measured evidence */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, closeListeningServer, type RunningApp } from "./app.ts";
import { startRecording, encode, type Frame } from "./record.ts";
import { issueModel, seedIssues } from "./issues-fixture.ts";

const out = join(homedir(), "Desktop", "Lyra未修复问题测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Singapore" }).replace(/[: ]/g, "-");
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

const model = issueModel();
await new Promise<void>((resolve) => model.server.listen(0, "127.0.0.1", resolve));
const address = model.server.address();
if (!address || typeof address === "string") throw new Error("No fixture port");

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];
const pause = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

try {
	app = await startApp({ port: 9764, seed: (home) => seedIssues(home, address.port) });
	const page = app;
	stopRecording = await startRecording(9764, frames);
	await page.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 15_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await page.evaluate(expression)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function click(selector: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
		const at = await page.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
		for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
	}
	async function mouseTo(selector: string) {
		const at = await page.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
		await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
		return at;
	}

	await until(`Boolean(document.querySelector('[data-ly-row="issue-long"]'))`);
	await pause(800);

	/* ---------- 2150 sidebar title width ---------- */
	const sidebar = await page.evaluate<{ rest: number; hover: number; after: number }>(`(()=>{
		const row=document.querySelector('[data-ly-row="issue-demo"]');
		const title=row?.querySelector('.ly-fade-tail');
		const rest=title?.getBoundingClientRect().width??0;
		row?.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
		const hover=title?.getBoundingClientRect().width??0;
		row?.dispatchEvent(new MouseEvent('mouseleave',{bubbles:true}));
		const after=title?.getBoundingClientRect().width??0;
		return {rest,hover,after};
	})()`);
	check("sidebar title width does not change on hover", Math.abs(sidebar.hover - sidebar.rest) <= 0.5 && Math.abs(sidebar.after - sidebar.rest) <= 0.5, sidebar);

	const marks = await page.evaluate<number[]>(`[...document.querySelectorAll('[data-ly-status-mark]')].map(el=>el.getBoundingClientRect().width)`);
	check("sidebar status discs are a 7px disc", marks.length >= 2 && marks.every((width) => Math.abs(width - 7) <= 1), marks);

	/* ---------- 2145 send bounce on a >20-turn session ---------- */
	await click('[data-ly-row="issue-long"] > button');
	await until(`Boolean(document.querySelector('[data-ly-chat-surface="conversation"]') && document.querySelector('[data-ly-show-earlier]'))`);
	await pause();
	for (let i = 0; i < 6 && await page.evaluate(`Boolean(document.querySelector('[data-ly-show-earlier]'))`); i++) {
		await click("[data-ly-show-earlier]");
		await pause(400);
	}
	await until(`!document.querySelector('[data-ly-show-earlier]')`);
	await pause(600);

	const beforeSend = await page.evaluate<{ y: number; earlier: boolean; head: boolean }>(`(()=>{
		const walk=[...document.querySelectorAll('[data-ly-transcript-rows] *')].find(el=>el.textContent?.includes('LONG_HEAD') && el.children.length===0);
		return {y:walk?.getBoundingClientRect().y??-1,earlier:Boolean(document.querySelector('[data-ly-show-earlier]')),head:Boolean(walk)};
	})()`);
	check("long session keeps the first turn after loading earlier", beforeSend.head && !beforeSend.earlier, beforeSend);

	await click('[data-dock-pane="conversation"] textarea');
	await page.send("Input.insertText", { text: "发送后视口不该下沉回弹。" });
	const sendMotionP = page.evaluate<{ start: number; min: number; max: number; decreased: number; increased: number; earlier: boolean; head: boolean }>(`new Promise(resolve=>{
		const view=document.querySelector('[data-ly-chat-surface="conversation"] .ly-scroll-view');
		const pick=()=>[...document.querySelectorAll('[data-ly-transcript-rows] *')].find(el=>el.textContent?.includes('LONG_HEAD') && el.children.length===0);
		const start=view?.scrollTop??0;
		let min=start,max=start,decreased=0,increased=0,last=start,earlier=false;
		const begun=performance.now();
		function tick(){
			const top=view?.scrollTop??last;
			min=Math.min(min,top); max=Math.max(max,top);
			if(top<last) decreased+=last-top;
			if(top>last) increased+=top-last;
			last=top;
			if(document.querySelector('[data-ly-show-earlier]')) earlier=true;
			if(performance.now()-begun>900) return resolve({start,min,max,decreased,increased,earlier,head:Boolean(pick())});
			requestAnimationFrame(tick);
		}
		requestAnimationFrame(tick);
	})`);
	await pause(30);
	await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	const sendMotion = await sendMotionP;
	await pause(400);
	const afterSend = await page.evaluate<{ earlier: boolean; head: boolean }>(`(()=>{
		const walk=[...document.querySelectorAll('[data-ly-transcript-rows] *')].find(el=>el.textContent?.includes('LONG_HEAD') && el.children.length===0);
		return {earlier:Boolean(document.querySelector('[data-ly-show-earlier]')),head:Boolean(walk)};
	})()`);
	check("sending does not remount the top of a widened window", afterSend.head && !afterSend.earlier && !sendMotion.earlier, { ...afterSend, ...sendMotion });
	check("sending does not bounce scrollTop down then up", sendMotion.decreased <= 24, sendMotion);

	/* ---------- 2100 scroll stickiness ---------- */
	const viewport = await page.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector('[data-ly-chat-surface="conversation"] .ly-scroll-view')?.getBoundingClientRect();return {x:(r?.x??0)+(r?.width??0)/2,y:(r?.y??0)+(r?.height??0)/2}})()`);
	const beforeWheel = await page.evaluate<number>(`document.querySelector('[data-ly-chat-surface="conversation"] .ly-scroll-view')?.scrollTop??0`);
	await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...viewport });
	await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...viewport, deltaX: 0, deltaY: -80 });
	await pause(80);
	const afterWheel = await page.evaluate<number>(`document.querySelector('[data-ly-chat-surface="conversation"] .ly-scroll-view')?.scrollTop??0`);
	await pause(200);
	const held = await page.evaluate<number>(`document.querySelector('[data-ly-chat-surface="conversation"] .ly-scroll-view')?.scrollTop??0`);
	check("a small wheel-up leaves the bottom instead of sticking", afterWheel < beforeWheel - 8, { beforeWheel, afterWheel, held });
	check("the wheel-up is not snapped back within 200ms", Math.abs(held - afterWheel) <= 4, { afterWheel, held });

	const thumb = await page.evaluate<{ x: number; y: number; top: number } | null>(`(()=>{
		const el=document.querySelector('[data-ly-chat-surface="conversation"] .ly-thumb');
		const view=document.querySelector('[data-ly-chat-surface="conversation"] .ly-scroll-view');
		if(!el||!view) return null;
		const r=el.getBoundingClientRect();
		return {x:r.x+r.width/2,y:r.y+r.height/2,top:view.scrollTop};
	})()`);
	if (thumb) {
		await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: thumb.x, y: thumb.y });
		await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: thumb.x, y: thumb.y, button: "left", clickCount: 1 });
		await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: thumb.x, y: thumb.y - 80 });
		await pause(80);
		const dragged = await page.evaluate<number>(`document.querySelector('[data-ly-chat-surface="conversation"] .ly-scroll-view')?.scrollTop??0`);
		await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: thumb.x, y: thumb.y - 80, button: "left", clickCount: 1 });
		await pause(200);
		const afterDrag = await page.evaluate<number>(`document.querySelector('[data-ly-chat-surface="conversation"] .ly-scroll-view')?.scrollTop??0`);
		check("thumb drag leaves the bottom with the pointer", dragged < thumb.top - 8, { from: thumb.top, dragged, afterDrag });
		check("thumb drag is not snapped back within 200ms", Math.abs(afterDrag - dragged) <= 8, { dragged, afterDrag });
	} else {
		check("thumb drag leaves the bottom with the pointer", false, "no .ly-thumb");
	}

	/* ---------- 2100 spacing ---------- */
	const spacing = await page.evaluate<{ rowGaps: number[] }>(`(()=>{
		const kids=[...document.querySelector('[data-ly-transcript-rows]')?.children??[]].map(el=>el.getBoundingClientRect()).filter(r=>r.height>0);
		return {rowGaps:kids.slice(1).map((box,i)=>box.top-kids[i].bottom)};
	})()`);
	check("adjacent transcript rows stay 10px apart", spacing.rowGaps.length > 0 && spacing.rowGaps.every((gap) => Math.abs(gap - 10) <= 0.5), spacing.rowGaps);

	/* ---------- 2220 false paused ---------- */
	await click('[data-ly-row="issue-demo"] > button');
	await until(`Boolean(document.querySelector('[data-ly-chat-surface="conversation"]'))`);
	await pause();
	if (await page.evaluate(`Boolean(document.querySelector('[data-ly-turn-process]:not([data-ly-turn-open]) > .ly-flow-row, [data-ly-turn-process]:not([data-ly-turn-open]) > button'))`)) {
		await click("[data-ly-turn-process] > .ly-flow-row, [data-ly-turn-process] > button");
		await until(`Boolean(document.querySelector('[data-ly-turn-process][data-ly-turn-open]'))`);
		await pause(600);
	}
	const processSpacing = await page.evaluate<{ rowGaps: number[]; flowHeights: number[]; headerGap: number | null }>(`(()=>{
		const body=document.querySelector('[data-ly-turn-process][data-ly-turn-open] .ly-reveal[data-open="true"] .flex.flex-col');
		const kids=[...body?.children??[]].map(el=>el.getBoundingClientRect()).filter(r=>r.height>0);
		const header=document.querySelector('[data-ly-turn-process][data-ly-turn-open] > .ly-flow-row')?.getBoundingClientRect();
		const first=kids[0];
		return {
			rowGaps:kids.slice(1).map((box,i)=>box.top-kids[i].bottom),
			flowHeights:[...document.querySelectorAll('[data-ly-turn-process] .ly-flow-row')].map(el=>el.getBoundingClientRect().height).filter(h=>h>0),
			headerGap:header&&first?first.top-header.bottom:null,
		};
	})()`);
	check("process rows stay 10px apart", processSpacing.rowGaps.length > 0 && processSpacing.rowGaps.every((gap) => Math.abs(gap - 10) <= 0.5), processSpacing.rowGaps);
	check("process header to first row is 10px", processSpacing.headerGap === null || Math.abs(processSpacing.headerGap - 10) <= 0.5, processSpacing.headerGap);
	check("flow rows stay 24px tall", processSpacing.flowHeights.length > 0 && processSpacing.flowHeights.every((height) => Math.abs(height - 24) <= 0.5), processSpacing.flowHeights);
	model.set("plan");
	await click('[data-dock-pane="conversation"] textarea');
	await page.send("Input.insertText", { text: "写一份计划然后正常结束。" });
	await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await until(`Boolean(document.querySelector('[data-dock-pane="conversation"]')?.innerText.includes('已暂停')===false) && document.querySelector('[data-dock-pane="conversation"]')?.innerText.includes('旧目标待取消')`, 20_000);
	await pause(1500);
	const taskCopy = await page.evaluate<string>(`document.querySelector('[data-dock-pane="conversation"]')?.innerText??''`);
	check("a clean finish with leftover todos does not say 已暂停", !taskCopy.includes("已暂停"), taskCopy.includes("旧目标待取消"));

	/* ---------- 2200 hover delay while running ---------- */
	model.set("hold");
	await click('[data-dock-pane="conversation"] textarea');
	await page.send("Input.insertText", { text: "保持运行好量悬停。" });
	await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await until(`Boolean(document.querySelector('[data-composer-send=stop]'))`);
	const listToggle = await page.evaluate<string | null>(`(()=>{
		const button=[...document.querySelectorAll('button[aria-expanded]')].find(el=>/旧目标|待用户|计划/.test(el.innerText));
		if(!button) return null;
		button.setAttribute('data-ly-task-toggle','');
		return button.getAttribute('aria-expanded');
	})()`);
	if (listToggle && listToggle !== "true") await click("[data-ly-task-toggle]");
	await until(`Boolean(document.querySelector('[data-ly-step-offer]'))`);
	await mouseTo("[data-ly-step-offer]");
	await pause(200);
	const early = await page.evaluate<string | null>(`document.querySelector('[data-ly-step-offer]')?.getAttribute('data-ly-step-offer')??null`);
	check("a brief hover does not swap the spinner for pause", early === "off", early);
	await pause(1100);
	const late = await page.evaluate<string | null>(`document.querySelector('[data-ly-step-offer]')?.getAttribute('data-ly-step-offer')??null`);
	check("a one-second hover offers pause", late === "on", late);
	model.finish();
	await pause();

	await mkdir(out, { recursive: true });
	const shot = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, `${stamp}_open-issues.png`), Buffer.from(shot.data, "base64"));
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	model.finish();
	await stopRecording?.();
	await app?.stop();
	await closeListeningServer(model.server);
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_未修复issue_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ fixture: "Isolated LYRA_HOME, local SSE model, real Electron window", checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
