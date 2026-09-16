import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { startRecording, encode, type Frame } from "./record.ts";
import { after, afterEach, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";
import { LONG_OPTIONS, LONG_QUESTION, questionModel, seedQuestions } from "./mention-question-fixture.ts";

let app: RunningApp;
const frames: Frame[] = [];
let stopRecording: (() => Promise<void>) | undefined;
let passed = 0;
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Singapore" }).replace(/[: ]/g, "-");
const { server } = questionModel();
const targets = {
	session: '[data-ly-row="qa-long"] > button',
	otherSession: '[data-ly-row="qa-short"] > button',
	composer: 'main textarea',
	toggle: 'button[aria-label="自定义回答"]',
	input: 'input[aria-label="自定义回答"]',
	submit: 'button[aria-label="发送回答"]',
	thumb: '.ly-approval-scroll .ly-thumb',
	lastChoice: '[data-approval-card] label:last-of-type',
	confirm: 'button[aria-label="确认选择"]',
};

before(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string");
	app = await startApp({ port: 9688, seed: (home) => seedQuestions(home, address.port) });
	await app.evaluate("document.fonts.ready");
	stopRecording = await startRecording(9688, frames);
});
afterEach(async () => { if (app) await shot("approval-question-last-screen"); });
after(async () => {
	await stopRecording?.();
	await cleanupFixture(() => app?.stop(), () => closeListeningServer(server));
	const out = join(homedir(), "Desktop", "Lyra未完成问题修复测试");
	await mkdir(out, { recursive: true });
	if (frames.length) await encode(frames, join(out, `${stamp}_长提问滚动主题输入法_${passed}of2.mp4`), 30);
});

async function until(condition: () => Promise<boolean>) {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (await condition()) return;
		await app.evaluate("new Promise(requestAnimationFrame)");
	}
	throw new Error("Approval UI did not reach the expected visible state");
}

async function settle() {
	await app.evaluate("Promise.all(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))");
}

async function point(target: keyof typeof targets) {
	return app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(targets[target])}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
}

async function click(target: keyof typeof targets) {
	await until(async () => app.evaluate(`Boolean(document.querySelector(${JSON.stringify(targets[target])})?.checkVisibility())`));
	await settle();
	await app.evaluate(`document.querySelector(${JSON.stringify(targets[target])}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...await point(target) });
	await settle();
	await until(async () => app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(targets[target])}),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`));
	const at = await point(target);
	for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
}

async function enter() {
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
}

async function appearance(theme: "dark" | "light", width: number) {
	await app.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
	await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${JSON.stringify(theme)}}});})()`);
	await until(async () => app.evaluate(`innerWidth===${width}&&document.documentElement.style.colorScheme===${JSON.stringify(theme)}&&!document.documentElement.hasAttribute('data-theme-switching')`));
	await settle();
}

async function shot(name: string) {
	const directory = process.env.LYRA_E2E_ARTIFACTS; if (!directory) return;
	await mkdir(directory, { recursive: true }); await settle();
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(data, "base64"));
}

async function scrollState() {
	return app.evaluate<{ top: number; max: number; fadeTop: number; fadeBottom: number; opacity: number }>("(()=>{const v=document.querySelector('.ly-approval-scroll > .ly-scroll-view'),t=document.querySelector('.ly-approval-scroll .ly-thumb'),s=getComputedStyle(v);return {top:v.scrollTop,max:v.scrollHeight-v.clientHeight,fadeTop:parseFloat(s.getPropertyValue('--ly-fade-top')),fadeBottom:parseFloat(s.getPropertyValue('--ly-fade-bottom')),opacity:Number(getComputedStyle(t).opacity)};})()");
}

test("long questions stay readable and actionable across themes and widths with native scrolling and IME", async (t) => {
	await click("session"); await click("composer");
	await app.send("Input.insertText", { text: "ASK_LONG" }); await enter();
	await until(async () => app.evaluate("Boolean(document.querySelector('[data-approval-card] .ly-thumb'))"));
	assert.equal(await app.evaluate("document.querySelector('[data-approval-card] pre').textContent"), LONG_QUESTION);
	assert.equal(await app.evaluate("document.querySelectorAll('[data-approval-card] input:not([type=radio]):not([type=checkbox])').length"), 0);
	assert.equal(await app.evaluate("document.querySelectorAll('[data-approval-card] .ly-scroll-host').length"), 1);
	for (const theme of ["dark", "light"] satisfies Array<"dark" | "light">) {
		for (const width of [1280, 375]) {
			await appearance(theme, width);
			await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...await point("thumb") }); await settle();
			const geometry = await app.evaluate<{ left: number; right: number; top: number; bottom: number; gutter: number; overflow: number; buttons: Array<{ left: number; right: number; top: number; bottom: number; icon: boolean }>; text: string; reasonCount: number; alignment: string[] }>("(()=>{const c=document.querySelector('[data-approval-card]'),r=c.getBoundingClientRect(),p=c.querySelector('pre'),v=c.querySelector('.ly-scroll-view'),b=c.querySelector('.ly-thumb').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,gutter:b.left-p.getBoundingClientRect().right,overflow:v.scrollWidth-v.clientWidth,buttons:[...c.querySelectorAll('button')].map(e=>{const x=e.getBoundingClientRect();return {left:x.left,right:x.right,top:x.top,bottom:x.bottom,icon:Boolean(e.querySelector('svg'))};}),text:p.textContent,reasonCount:c.querySelectorAll('.ly-approval-scroll p').length,alignment:[...c.querySelectorAll('button')].map(e=>getComputedStyle(e.parentElement).justifyContent)};})()");
			t.diagnostic(JSON.stringify({ theme, width, ...geometry, text: geometry.text.length }));
			assert.ok(geometry.left >= 0 && geometry.right <= width);
			assert.ok(geometry.top >= 0 && geometry.bottom <= 800, "the entire card stays in the viewport");
			assert.ok(geometry.gutter >= 7, `scrollbar gutter ${geometry.gutter}px`);
			assert.equal(geometry.overflow, 0);
			assert.equal(geometry.text, LONG_QUESTION); assert.equal(geometry.reasonCount, 0);
			for (const button of geometry.buttons) {
				assert.ok(button.icon);
				assert.ok(button.left >= geometry.left && button.right <= geometry.right);
			}
			assert.equal(await app.evaluate("getComputedStyle(document.querySelector('[data-approval-card] button[type=submit]').parentElement).justifyContent"), "flex-end");
			assert.deepEqual(await app.evaluate("[...document.querySelectorAll('[data-approval-card] label')].map(e=>e.textContent)"), LONG_OPTIONS);
			await shot(`approval-long-${theme}-${width}`);
		}
	}
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 8, y: 8 }); await settle();
	const initial = await scrollState(); assert.equal(initial.top, 0); assert.equal(initial.fadeTop, 0); assert.equal(initial.opacity, 0); assert.ok(initial.fadeBottom > 0);
	const viewport = await app.evaluate<{ x: number; y: number }>("(()=>{const r=document.querySelector('.ly-approval-scroll').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...viewport });
	await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...viewport, deltaX: 0, deltaY: 140 });
	await until(async () => (await scrollState()).top > 30); await settle();
	const middle = await scrollState(); assert.ok(middle.fadeTop > 0 && middle.fadeBottom > 0); assert.ok(middle.opacity >= 0.49);
	const thumb = await point("thumb");
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...thumb, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: thumb.x, y: 780, button: "left", buttons: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: thumb.x, y: 780, button: "left", clickCount: 1 });
	await until(async () => { const value = await scrollState(); return value.max - value.top < 1 && value.fadeBottom === 0; }); await settle();
	const end = await scrollState(); assert.equal(end.fadeBottom, 0); assert.ok(end.fadeTop > 0);
	t.diagnostic(JSON.stringify({ initial, middle, end })); await shot("approval-scrolled-to-end");
	await click("toggle"); await click("input");
	const expanded = await app.evaluate<{ top: number; bottom: number }>("(()=>{const r=document.querySelector('[data-approval-card]').getBoundingClientRect();return {top:r.top,bottom:r.bottom};})()");
	t.diagnostic(JSON.stringify({ expanded }));
	assert.ok(expanded.top >= 0 && expanded.bottom <= 800, "expanding custom input keeps the full card visible");
	await app.send("Input.imeSetComposition", { text: "中文输入", selectionStart: 4, selectionEnd: 4 });
	assert.equal(await app.evaluate("document.querySelector('input[aria-label=\"自定义回答\"]').value"), "中文输入");
	assert.equal(await app.evaluate("document.querySelectorAll('[data-approval-card]').length"), 1);
	const answer = "中文输入法确认后保留完整自定义答案。".repeat(40);
	await app.send("Input.insertText", { text: answer });
	assert.equal(await app.evaluate("document.querySelector('input[aria-label=\"自定义回答\"]').value"), answer);
	await shot("approval-custom-native-input"); await click("submit");
	await until(async () => app.evaluate("!document.querySelector('[data-approval-card]')&&!document.querySelector('button[aria-label=\"停止\"]')"));
	const results = await app.evaluate<string[]>("(async()=>{const s=(await window.lyra.sessions.list()).find(s=>s.id==='qa-long');const t=await window.lyra.sessions.transcript(s.projectId,s.id);return t.messages.filter(m=>m.role==='toolResult'&&m.toolName==='ask_user').flatMap(m=>m.content.filter(c=>c.type==='text').map(c=>c.text));})()");
	assert.deepEqual(results, [answer]);
	passed++;
});

test("a long final choice remains reachable through the same body scroller", async () => {
	await appearance("dark", 1280); await click("otherSession"); await click("composer");
	await app.send("Input.insertText", { text: "ASK_LONG" }); await enter();
	await until(async () => app.evaluate("Boolean(document.querySelector('[data-approval-card] .ly-thumb'))"));
	await appearance("light", 375);
	await app.evaluate(`document.querySelector(${JSON.stringify(targets.lastChoice)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await settle(); await shot("approval-options-light-375"); await click("lastChoice");
	assert.equal(await app.evaluate("document.querySelectorAll('[data-approval-card] input:checked').length"), 1);
	await click("confirm");
	await until(async () => app.evaluate("!document.querySelector('[data-approval-card]')&&!document.querySelector('button[aria-label=\"停止\"]')"));
	const results = await app.evaluate<string[]>("(async()=>{const s=(await window.lyra.sessions.list()).find(s=>s.id==='qa-short');const t=await window.lyra.sessions.transcript(s.projectId,s.id);return t.messages.filter(m=>m.role==='toolResult'&&m.toolName==='ask_user').flatMap(m=>m.content.filter(c=>c.type==='text').map(c=>c.text));})()");
	assert.deepEqual(results, [LONG_OPTIONS.at(-1)]);
	passed++;
});
