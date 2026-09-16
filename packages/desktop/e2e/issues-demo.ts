/* oxlint-disable no-console -- real-window verification prints measured evidence */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, closeListeningServer, type RunningApp } from "./app.ts";
import { startRecording, encode, type Frame } from "./record.ts";
import { issueModel, seedIssues } from "./issues-fixture.ts";

const baseline = process.argv.includes("--baseline");
const out = join(homedir(), "Desktop", "Lyra未完成问题修复测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Singapore" }).replace(/[: ]/g, "-");
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => { checks.push({ name, ok, measured }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`); };
const model = issueModel();
await new Promise<void>(resolve => model.server.listen(0, "127.0.0.1", resolve));
const address = model.server.address();
if (!address || typeof address === "string") throw new Error("No fixture port");
let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];
const pause = (ms = 1000) => new Promise(resolve => setTimeout(resolve, ms));
try {
	app = await startApp({ port: 9746, seed: home => seedIssues(home, address.port) });
	const page = app;
	stopRecording = await startRecording(9746, frames);
	await page.evaluate("document.fonts.ready");
	async function until(expression: string) {
		for (let i = 0; i < 150; i++) { if (await page.evaluate(expression)) return; await pause(100); }
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function click(selector: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
		const at = await page.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
		for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
	}
	async function send(text: string) {
		await click('[data-dock-pane="conversation"] textarea');
		await page.send("Input.insertText", { text });
		await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
		await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	}
	async function sample(button: string, box: string, reverse = false) {
		return page.evaluate<{ values: number[]; times: number[] }>(`new Promise(resolve=>{const target=document.querySelector(${JSON.stringify(box)}),trigger=document.querySelector(${JSON.stringify(button)}),values=[target.getBoundingClientRect().height],times=[];let start;function step(now){start??=now;times.push(now);values.push(target.getBoundingClientRect().height);if(now-start<650)requestAnimationFrame(step);else resolve({values,times})}requestAnimationFrame(step);trigger.click();if(${reverse})setTimeout(()=>trigger.click(),70)})`);
	}
	function motion(name: string, sample: number[] | { values: number[]; times: number[] }) {
		const values = Array.isArray(sample) ? sample : sample.values;
		const gaps = Array.isArray(sample) ? [] : sample.times.slice(1).map((at, i) => at - sample.times[i]).sort((a, b) => a - b);
		const max = Math.max(...values), min = Math.min(...values);
		const intermediate = values.filter(value => value > min + 0.5 && value < max - 0.5);
		check(name, max - min > 5 && intermediate.length >= 3, { from: values[0], to: values.at(-1), intermediate: intermediate.length, frames: values.length, frameP95Ms: gaps[Math.floor(gaps.length * 0.95)], maxFrameMs: gaps.at(-1), maxHeightStep: Math.max(...values.slice(1).map((height, i) => Math.abs(height - values[i]))) });
	}
	await click('[data-ly-row="issue-demo"] > button'); await pause();
	for (let i = 0; i < (baseline ? 1 : 5); i++) {
		motion(`process open ${i + 1}`, await sample('[data-ly-turn-process] > button', '[data-ly-turn-process] > div'));
		await pause();
		motion(`thinking open ${i + 1}`, await sample('[data-ly-thinking] > button', '[data-ly-thinking] > div'));
		await pause();
		motion(`thinking close ${i + 1}`, await sample('[data-ly-thinking] > button', '[data-ly-thinking] > div'));
		await pause();
		motion(`tools open ${i + 1}`, await sample('[data-ly-run] > button', '[data-ly-run] > div'));
		await pause();
		motion(`tools close ${i + 1}`, await sample('[data-ly-run] > button', '[data-ly-run] > div'));
		await pause();
		motion(`process close ${i + 1}`, await sample('[data-ly-turn-process] > button', '[data-ly-turn-process] > div'));
		await pause();
	}
	if (!baseline) {
		const rapid = await sample('[data-ly-turn-process] > button', '[data-ly-turn-process] > div', true);
		motion("rapid reversal remains animated", rapid);
		check("rapid reversal settles closed", rapid.values.at(-1) === 0, rapid.values.at(-1)); await pause();
	}
	model.set("hold"); await send("保持运行，验证排队与撤回。"); await until("Boolean(document.querySelector('[data-composer-send=stop]'))");
	await send("排队消息第一条"); await pause();
	await send("排队消息第二条\n第二行内容\n第三行内容\n第四行内容\n第五行内容\n第六行内容\n第七行内容\n第八行内容"); await pause();
	check("two queued messages", await page.evaluate("document.querySelectorAll('[data-queue-row]').length===2"), await page.evaluate("document.querySelector('[data-composer-queue]').innerText"));
	await click('[data-queue-row]:last-child [data-queue-more]'); await pause();
	const recall = await page.evaluate<{ heights: number[]; widths: number[] }>(`new Promise(resolve=>{const field=document.querySelector('[data-dock-pane="conversation"] textarea'),button=document.querySelector('[data-dock-pane="conversation"] .ly-queue-send'),heights=[field.getBoundingClientRect().height],widths=[button.getBoundingClientRect().width];let start;function sample(now){start??=now;heights.push(field.getBoundingClientRect().height);widths.push(button.getBoundingClientRect().width);if(now-start<650)requestAnimationFrame(sample);else resolve({heights,widths})}const menu=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('编辑'));if(!menu)throw new Error('Edit menu missing');requestAnimationFrame(sample);menu.click()})`);
	motion("recalled textarea grows continuously", recall.heights);
	motion("queue send enters continuously", recall.widths); await pause();
	check("recalled draft retained", await page.evaluate("document.querySelector('textarea').value.includes('排队消息第二条')"), await page.evaluate("document.querySelector('textarea').value"));
	await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 }); await pause();
	check("recalled draft can be queued again", await page.evaluate("document.querySelectorAll('[data-queue-row]').length===2&&document.querySelector('textarea').value===''") , await page.evaluate("document.querySelector('[data-composer-queue]').innerText"));
	await click('[data-queue-row]:last-child [data-queue-more]'); await pause();
	await page.evaluate("[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('编辑')).click()"); await pause();
	check("second recall keeps full multiline content", await page.evaluate("document.querySelector('textarea').value.includes('第八行内容')&&document.querySelectorAll('[data-queue-row]').length===1"), await page.evaluate("document.querySelector('textarea').value"));
	const queueHeights = await page.evaluate<number[]>(`new Promise(resolve=>{const values=[];let start;function sample(now){start??=now;values.push(document.querySelector('[data-composer-queue]')?.getBoundingClientRect().height??0);if(now-start<650)requestAnimationFrame(sample);else resolve(values)}values.push(document.querySelector('[data-composer-queue]').getBoundingClientRect().height);requestAnimationFrame(sample);document.querySelector('[data-queue-remove]').click()})`);
	motion("last queue item exits continuously", queueHeights); await pause();
	check("queue fully removed", await page.evaluate("!document.querySelector('[data-composer-queue]')"), queueHeights.at(-1));
	const stopMotion = await page.evaluate<{ widths: number[]; opacity: number[]; sameButton: boolean }>(`new Promise(resolve=>{const button=document.querySelector('[data-composer-send=stop]'),queue=document.querySelector('[data-dock-pane="conversation"] .ly-queue-send'),icon=button.querySelector('.ly-send-icon'),widths=[queue.getBoundingClientRect().width],opacity=[Number(getComputedStyle(icon).opacity)];let start;function sample(now){start??=now;widths.push(queue.getBoundingClientRect().width);opacity.push(Number(getComputedStyle(icon).opacity));if(now-start<650)requestAnimationFrame(sample);else resolve({widths,opacity,sameButton:button.isConnected&&button.dataset.composerSend!=='stop'})}requestAnimationFrame(sample);button.click()})`);
	motion("queue send leaves continuously", stopMotion.widths);
	check("stop icon fades on the original button", stopMotion.sameButton && stopMotion.opacity.filter(value=>value>0.01&&value<0.99).length>=3 && stopMotion.opacity.at(-1)===0, stopMotion); model.finish(); await pause();
	await mkdir(out, { recursive: true });
	const shot = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, `${stamp}_${baseline ? "before" : "after"}.png`), Buffer.from(shot.data, "base64"));
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	model.finish();
	await stopRecording?.();
	await app?.stop();
	await closeListeningServer(model.server);
	await mkdir(out, { recursive: true });
	const pass = checks.filter(check => check.ok).length;
	const name = `${stamp}_${baseline ? "修复前基线" : "修复后验收"}_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ fixture: "Local deterministic model and isolated repository; real Electron renderer", checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (!baseline && checks.some(check => !check.ok)) process.exitCode = 1;
}
