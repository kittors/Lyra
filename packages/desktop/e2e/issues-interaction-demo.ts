/* oxlint-disable no-console -- measured real-window evidence */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, closeListeningServer } from "./app.ts";
import { startRecording, encode, type Frame } from "./record.ts";
import { issueModel, seedIssues } from "./issues-fixture.ts";

const out = join(homedir(), "Desktop", "Lyra未完成问题修复测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Singapore" }).replace(/[: ]/g, "-");
const checks: { name: string; ok: boolean; value: unknown }[] = [];
const check = (name: string, ok: boolean, value: unknown) => { checks.push({ name, ok, value }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(value)}`); };
const model = issueModel();
await new Promise<void>(resolve => model.server.listen(0, "127.0.0.1", resolve));
const address = model.server.address();
if (!address || typeof address === "string") throw new Error("No fixture port");
const app = await startApp({ port: 9747, seed: home => seedIssues(home, address.port) });
const frames: Frame[] = [];
const stop = await startRecording(9747, frames);
const pause = (ms = 1000) => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression: string) {
	for (let i = 0; i < 150; i++) { if (await app.evaluate(expression)) return; await pause(100); }
	throw new Error(`Missing UI state: ${expression}`);
}
async function click(selector: string) {
	await until(`Boolean(document.querySelector(${JSON.stringify(selector)})?.checkVisibility())`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await pause(100);
	const at = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
}
async function send(text: string) {
	await click('[data-dock-pane="conversation"] textarea');
	await app.send("Input.insertText", { text });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
}
async function shot(name: string) {
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(out, `${stamp}_${name}.png`), Buffer.from(result.data, "base64"));
}
try {
	await mkdir(out, { recursive: true });
	await app.evaluate("document.fonts.ready");
	await click('[data-ly-row="issue-demo"] > button'); await pause();
	await app.evaluate('window.dispatchEvent(new KeyboardEvent("keydown", {key:"R",code:"KeyR",metaKey:true,shiftKey:true,bubbles:true}))');
	await until("Boolean(document.querySelector('[data-dock-pane=review]'))"); await pause();
	const push = await app.evaluate<string[]>("[...document.querySelectorAll('[data-dock-pane=review] button')].filter(e=>e.checkVisibility()&&/推送/.test(e.getAttribute('aria-label')||e.textContent)).map(e=>e.getAttribute('aria-label')||e.textContent)");
	check("one push entry for clean ahead branch", push.length === 1, push); await shot("git-one-push");
	await click('button[aria-label="在「Issue 验证」里新建会话"]'); await pause();
	if (!await app.evaluate("Boolean(document.querySelector('[data-dock-pane=review]'))")) { await app.evaluate('window.dispatchEvent(new KeyboardEvent("keydown", {key:"R",code:"KeyR",metaKey:true,shiftKey:true,bubbles:true}))'); await pause(); }
	const geometry = await app.evaluate<{ left: number; right: number; composerLeft: number; composerRight: number }>("(()=>{const p=document.querySelector('[data-dock-pane=conversation]').getBoundingClientRect(),g=document.querySelector('.grid.grid-cols-4').getBoundingClientRect(),c=document.querySelector('.ly-composer').getBoundingClientRect();return {left:g.left-p.left,right:p.right-g.right,composerLeft:c.left-p.left,composerRight:p.right-c.right}})()");
	check("empty cards centred in three panes", Math.abs(geometry.left - geometry.right) <= 1, geometry);
	check("composer centred in three panes", Math.abs(geometry.composerLeft - geometry.composerRight) <= 1, geometry);
	const screenshot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await app.evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(screenshot.data)}), c=>c.charCodeAt(0))],'fixture-window.png',{type:'image/png'}));const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
	await until("Boolean(document.querySelector('[data-ly-attachment]'))"); await pause();
	const attachment = await app.evaluate<{ tile: number; text: number; delta: number }>("(()=>{const a=document.querySelector('[data-ly-attachment]').getBoundingClientRect(),t=document.querySelector('textarea'),r=t.getBoundingClientRect(),x=r.left+parseFloat(getComputedStyle(t).paddingLeft);return {tile:a.left,text:x,delta:a.left-x}})()");
	check("attachment and text share left edge", Math.abs(attachment.delta) <= 1, attachment); await shot("layout-and-attachment");
	await click('[data-ly-row="issue-demo"] > button'); await pause();
	model.set("question"); await send("验证 Full Access 下的选择题。");
	await until("Boolean(document.querySelector('[data-approval-card]'))"); await pause();
	const meter = await app.evaluate<string>("document.querySelector('[data-ly-running]').innerText");
	check("turn meter labels fresh tokens and cache ratio", /本轮\s*120\s*tokens/.test(meter) && /缓存\s*90%/.test(meter), meter);
	const selected = await app.evaluate("document.querySelectorAll('[data-approval-card] input:checked').length");
	check("recommendation is not implicit consent", selected === 0, selected);
	await click('button[aria-label="自定义回答"]'); await click('input[aria-label="自定义回答"]');
	await app.send("Input.insertText", { text: "收起后仍应保留中文草稿" }); await pause();
	await click('button[aria-label="收起提问或审批"]'); await pause();
	await click('button[aria-label="展开提问或审批"]'); await pause();
	const draft = await app.evaluate("document.querySelector('input[aria-label=\"自定义回答\"]').value");
	check("collapse preserves answer draft", draft === "收起后仍应保留中文草稿", draft);
	for (const width of [1500, 375]) for (const theme of ["dark", "light"]) {
		await app.send("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: false });
		await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${JSON.stringify(theme)}}})})()`);
		await pause();
		const boxes = await app.evaluate<{ left: number; right: number; top: number; bottom: number; transcriptBottom: number; overflow: number }>("(()=>{const c=document.querySelector('[data-approval-card]'),r=c.getBoundingClientRect(),region=document.querySelector('[data-approval-region]'),scroll=region.parentElement.previousElementSibling.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,transcriptBottom:scroll.bottom,overflow:c.scrollWidth-c.clientWidth}})()");
		check(`question visible without overlap ${width} ${theme}`, boxes.left >= 0 && boxes.right <= width && boxes.top >= boxes.transcriptBottom - 1 && boxes.bottom <= 950 && boxes.overflow <= 1, boxes);
		const meterBox = await app.evaluate<{ left: number; right: number; fieldLeft: number; fieldRight: number; overflow: number }>("(()=>{const e=document.querySelector('[data-ly-running]'),m=[...e.querySelectorAll('span')].find(s=>s.textContent.includes('本轮')),r=e.getBoundingClientRect(),f=m.getBoundingClientRect();return {left:r.left,right:r.right,fieldLeft:f.left,fieldRight:f.right,overflow:e.scrollWidth-e.clientWidth}})()");
		check(`turn usage completely visible ${width} ${theme}`, meterBox.fieldLeft>=meterBox.left-1&&meterBox.fieldRight<=meterBox.right+1&&meterBox.overflow<=1, meterBox);
		await shot(`question-${width}-${theme}`);
	}
	await app.evaluate("[...document.querySelectorAll('[data-approval-card] button')].find(e=>e.textContent.includes('跳过')).click()");
	await until("!document.querySelector('[data-approval-card]')&&!document.querySelector('[data-composer-send=stop]')"); await pause();
	const skipped = model.answers.at(-1) ?? "";
	check("skip resumes without an invented answer", skipped.includes("未回答") || skipped.includes("No answer or permission"), skipped.includes("未回答") ? "explicit unanswered result" : "see request result");
	await app.send("Emulation.clearDeviceMetricsOverride"); await pause();
	model.set("multi"); await send("验证多选。");
	await until("Boolean(document.querySelector('[data-approval-card] input[type=checkbox]'))");
	await click('[data-approval-card] label:nth-of-type(1)'); await pause();
	await click('[data-approval-card] label:nth-of-type(2)'); await pause();
	const selectedCount = await app.evaluate("document.querySelectorAll('[data-approval-card] input:checked').length");
	check("two choices remain selected until confirmation", selectedCount === 2, selectedCount);
	await click('button[aria-label="确认选择"]');
	await until("!document.querySelector('[data-approval-card]')&&!document.querySelector('[data-composer-send=stop]')"); await pause();
	const results = await app.evaluate<string[]>("(async()=>{const s=(await window.lyra.sessions.list()).find(s=>s.id==='issue-demo');const t=await window.lyra.sessions.transcript(s.projectId,s.id);return t.messages.filter(m=>m.role==='toolResult'&&m.toolName==='ask_user').flatMap(m=>m.content.filter(c=>c.type==='text').map(c=>c.text));})()");
	check("multiple answers reach the model once", results.length === 2 && results[1].includes("保留现有行为") && results[1].includes("更新实现"), results);
	await shot("completed-questions");
	const beforePlan = model.answers.length;
	model.set("plan"); await send("建立两步清单，然后只输出分析并等待确认。");
	await until("document.body.innerText.includes('旧目标待取消')&&!document.querySelector('[data-composer-send=stop]')"); await pause();
	check("unfinished plan does not force another request", model.answers.length === beforePlan + 2, { requests: model.answers.length - beforePlan, expected: 2 });
	check("stopped plan is visibly paused", await app.evaluate("document.body.innerText.includes('已暂停')"), await app.evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('旧目标待取消'))?.textContent"));
	await shot("paused-plan");
	model.set("discard");
	await app.evaluate("window.lyra.sideChat.ask('issue-demo',[{type:'text',text:'明确取消旧目标，停止并废除旧清单。'}])");
	await until("![...document.querySelectorAll('button')].some(e=>e.textContent.includes('旧目标待取消'))"); await pause();
	check("side chat cancellation removes stale task card", await app.evaluate("![...document.querySelectorAll('button')].some(e=>e.textContent.includes('旧目标待取消'))"), "no task card");
	await app.send("Page.reload"); await until("Boolean(document.querySelector('[data-ly-row=issue-demo]'))");
	await click('[data-ly-row="issue-demo"] > button'); await pause();
	check("cancelled plan stays absent after reload", await app.evaluate("![...document.querySelectorAll('button')].some(e=>e.textContent.includes('旧目标待取消'))"), "restored transcript has cancellation marker");
	await shot("cancelled-plan");
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	model.finish(); await stop(); await app.stop(); await closeListeningServer(model.server);
	const pass = checks.filter(item => item.ok).length;
	const name = `${stamp}_提问布局Git验收_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ fixture: "Local deterministic provider and isolated repository, real Electron renderer", checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)}`);
	if (checks.some(item => !item.ok)) process.exitCode = 1;
}
