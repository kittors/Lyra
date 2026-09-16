/* oxlint-disable no-console -- real-window verification prints measured evidence */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, closeListeningServer, type RunningApp } from "./app.ts";
import { startRecording, encode, type Frame } from "./record.ts";
import { issueModel, seedIssues } from "./issues-fixture.ts";

process.env.LYRA_E2E_SLOW_TRANSCRIPT = "450";

const out = join(homedir(), "Desktop", "Lyra未完成问题修复测试");
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
	app = await startApp({ port: 9751, seed: (home) => seedIssues(home, address.port) });
	const page = app;
	stopRecording = await startRecording(9751, frames);
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

	await until(`Boolean(document.querySelector('[data-ly-row="issue-cold"]'))`);
	await pause(800);

	const switchover = await page.evaluate<{ surfaces: string[]; skeleton: boolean; conversation: boolean; gaps: number[]; maxFrameMs: number }>(`new Promise(resolve=>{
		const rec={surfaces:[],skeleton:false,conversation:false,last:performance.now(),begun:performance.now(),gaps:[]};
		function surface(){return document.querySelector('[data-ly-chat-surface]')?.getAttribute('data-ly-chat-surface')??''}
		function tick(now){
			rec.gaps.push(now-rec.last); rec.last=now;
			const next=surface();
			if(next && rec.surfaces.at(-1)!==next) rec.surfaces.push(next);
			if(next==='skeleton') rec.skeleton=true;
			if(next==='conversation') rec.conversation=true;
			const measured=rec.gaps.slice(1);
			if(rec.conversation && measured.length>8) return resolve({surfaces:rec.surfaces,skeleton:rec.skeleton,conversation:rec.conversation,gaps:measured,maxFrameMs:Math.max(...measured)});
			if(now-rec.begun>12000) return resolve({surfaces:rec.surfaces,skeleton:rec.skeleton,conversation:rec.conversation,gaps:measured,maxFrameMs:measured.length?Math.max(...measured):0});
			requestAnimationFrame(tick);
		}
		document.querySelector('[data-ly-row="issue-cold"] > button')?.click();
		requestAnimationFrame(tick);
	})`);
	check("cold session shows the transcript skeleton before content", switchover.skeleton && switchover.surfaces[0] !== "conversation", switchover.surfaces);
	check("cold session settles on the conversation", switchover.conversation, switchover.surfaces);
	check("cold session first paint does not lock a frame over 200ms", switchover.maxFrameMs < 200, { maxFrameMs: switchover.maxFrameMs, frames: switchover.gaps.length });
	await pause();

	await click('[data-ly-row="issue-demo"] > button');
	await until(`Boolean(document.querySelector('[data-ly-chat-surface="conversation"]') && document.querySelector('[data-ly-transcript-rows]'))`);
	await pause();

	const processButton = '[data-ly-turn-process] button[aria-expanded="false"]';
	if (await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(processButton)}))`)) {
		await click(processButton);
		await pause(700);
	}

	const spacing = await page.evaluate<{
		flowHeights: number[];
		flowGaps: number[];
		rowGaps: number[];
	}>(`(()=>{
		const flows=[...document.querySelectorAll('.ly-flow-row')].map(el=>el.getBoundingClientRect()).filter(r=>r.height>0);
		const kids=[...document.querySelector('[data-ly-transcript-rows]')?.children??[]].map(el=>el.getBoundingClientRect()).filter(r=>r.height>0);
		const gap=(boxes)=>boxes.slice(1).map((box,i)=>box.top-boxes[i].bottom);
		return {flowHeights:flows.map(r=>r.height),flowGaps:gap(flows),rowGaps:gap(kids)};
	})()`);
	check("flow rows stay on the 24px grid", spacing.flowHeights.length > 0 && spacing.flowHeights.every((height) => Math.abs(height - 24) <= 0.5), spacing.flowHeights);
	check("adjacent transcript rows are 10px apart", spacing.rowGaps.length > 0 && spacing.rowGaps.every((gap) => Math.abs(gap - 10) <= 0.5), spacing.rowGaps);
	if (spacing.flowGaps.length) {
		check("adjacent visible flow rows are 10px apart", spacing.flowGaps.every((gap) => Math.abs(gap - 10) <= 0.5), spacing.flowGaps);
	}

	model.set("hold");
	await click('[data-dock-pane="conversation"] textarea');
	await page.send("Input.insertText", { text: "保持运行，验证排队动画帧间隔。" });
	await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await until("Boolean(document.querySelector('[data-composer-send=stop]'))");
	await page.send("Input.insertText", { text: "排队一条用来量帧。" });
	await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await until("document.querySelectorAll('[data-queue-row]').length>=1");
	const queueFrames = await page.evaluate<{ gaps: number[]; values: number[] }>(`new Promise(resolve=>{
		const target=document.querySelector('[data-composer-queue]');
		const values=[target.getBoundingClientRect().height],gaps=[];
		let last=performance.now(),start;
		function sample(now){
			start??=now;
			gaps.push(now-last); last=now;
			values.push(target.getBoundingClientRect().height);
			if(now-start<700) requestAnimationFrame(sample);
			else resolve({gaps:gaps.sort((a,b)=>a-b),values});
		}
		requestAnimationFrame(sample);
		document.querySelector('[data-queue-remove]')?.click();
	})`);
	const p95 = queueFrames.gaps[Math.floor(queueFrames.gaps.length * 0.95)] ?? 0;
	check("queue exit stays at 60fps in this window", p95 <= 18 && Math.max(...queueFrames.gaps) <= 20, { p95, max: Math.max(...queueFrames.gaps), intermediate: queueFrames.values.filter((value, _, all) => value > Math.min(...all) + 0.5 && value < Math.max(...all) - 0.5).length });
	model.finish();
	await pause();

	await mkdir(out, { recursive: true });
	const shot = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, `${stamp}_remaining.png`), Buffer.from(shot.data, "base64"));
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
	const name = `${stamp}_未完成issue彻底修复_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ fixture: "Isolated LYRA_HOME, local SSE model, real Electron window", checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
