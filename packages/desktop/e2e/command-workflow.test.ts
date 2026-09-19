import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
let server: Server;
let hold = false;
let complete: (() => void) | undefined;
const requests: string[] = [];
function respond(res: ServerResponse) {
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: "command-qa", role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
	emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
	emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: "已保留当前任务、关键决策和未完成事项。" } });
	emit("content_block_stop", { index: 0 });
	emit("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } });
	emit("message_stop", {}); res.end();
}
before(async () => {
	server = createServer((req, res) => {
		let body = ""; req.on("data", (data) => { body += data; });
		req.on("end", () => {
			requests.push(body);
			res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders();
			if (hold) complete = () => respond(res); else respond(res);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string");
	app = await startApp({ port: 9604, seed: async (home) => {
		await seedInteractions(home, address.port);
		const directory = join(home, "commands"); await mkdir(directory);
		for (let index = 0; index < 24; index++) await writeFile(join(directory, `review-${index}.md`), `---\ndescription: 检查第 ${index} 个工作流程：${"保留参数、核对证据、验证回归和跨平台布局。".repeat(8)}\nargument-hint: 可选：文件路径和额外要求${index === 23 ? "、参数说明".repeat(20) : ""}\n---\n自定义命令执行：$ARGUMENTS`);
		const file = join(home, "settings.json"); const settings = JSON.parse(await readFile(file, "utf8"));
		settings.providers[0].models[0].contextWindow = 1_000_000;
		await writeFile(file, JSON.stringify(settings));
	} });
});
afterEach(async (t) => {
	if (!t.passed) {
		await shot("command-failure");
		t.diagnostic(JSON.stringify(await app.evaluate(`({value:document.querySelector('textarea')?.value.slice(0,160),focus:document.activeElement?.tagName,menus:document.querySelectorAll('[role="option"]').length,body:document.querySelector('main')?.innerText.slice(-600)})`)));
	}
});
after(async () => { await cleanupFixture(() => app?.stop(), () => closeListeningServer(server)); });

async function frames(n = 20) {
	await app.evaluate(`new Promise(resolve=>{let n=${n};const f=()=>--n?requestAnimationFrame(f):resolve();requestAnimationFrame(f);})`);
}
async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{let n=600;const f=()=>{if(${expression})resolve();else if(--n)requestAnimationFrame(f);else reject(new Error(${JSON.stringify(expression)}));};f();})`);
}
async function click(selector: string) {
	await until(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;const r=el.getBoundingClientRect();return el.checkVisibility()&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
	const at = await app.evaluate<{ x: number; y: number }>(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest',behavior:'instant'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...at });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...at }); await frames(2);
}
async function input(text: string) {
	await app.evaluate(`(()=>{const f=document.querySelector('main textarea');f.focus();f.select();})()`);
	await app.send("Input.insertText", { text }); await frames(3);
}
async function key(key: string, code: number, modifiers = 0) {
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code, modifiers, ...(key === "Enter" ? { text: "\r" } : {}) });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code, modifiers }); await frames(2);
}
async function shot(name: string) {
	const directory = process.env.LYRA_E2E_ARTIFACTS; if (!directory) return;
	await mkdir(directory, { recursive: true });
	const data = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(data.data, "base64"));
}

test("native input decorates commands, keeps arguments and undo, and lists inline descriptions with fades", async (t) => {
	await click('[data-ly-row="qa-long"]');
	await input("/"); await until(`document.querySelectorAll('[role="option"]').length >= 27`);
	await frames();
	const menu = await app.evaluate(`(()=>{const m=document.querySelector('[role="listbox"]'),f=document.querySelector('textarea').closest('.ly-composer');const a=m.getBoundingClientRect(),b=f.getBoundingClientRect();return {left:a.left,top:a.top,right:a.right,width:a.width,fieldLeft:b.left,fieldRight:b.right,descriptions:m.textContent.includes('保留参数'),fade:!!m.querySelector('.ly-fade-edge')};})()`);
	t.diagnostic(JSON.stringify(menu));
	assert.equal(menu.left, menu.fieldLeft); assert.equal(menu.right, menu.fieldRight); assert.ok(menu.top >= 0 && menu.descriptions && menu.fade);
	await shot("slash-menu");
	await input("/review-0");
	const labels = await app.evaluate(`document.querySelector('[role="listbox"]').textContent`);
	await key("Tab", 9);
	assert.equal(await app.evaluate(`document.querySelector('.ly-command-menu').textContent`), labels, "closing preserves the list throughout its fade");
	assert.equal(await app.evaluate(`document.querySelector('textarea').value`), "/review-0 ");
	await until(`document.querySelector('[data-command-mirror] .ly-command-token')`);
	assert.equal(await app.evaluate(`document.querySelector('[data-command-mirror] .ly-command-token').textContent`), "/review-0");
	assert.ok(await app.evaluate(`document.querySelector('.ly-command-hint').textContent.includes('可选')`));
	await app.send("Input.insertText", { text: '"C:\\Work Files" 中文参数 👩‍💻\n额外提示词' }); await frames(3);
	const value = '/review-0 "C:\\Work Files" 中文参数 👩‍💻\n额外提示词';
	assert.equal(await app.evaluate(`document.querySelector('textarea').value`), value);
	assert.equal(await app.evaluate(`document.querySelector('.ly-command-hint')`), null);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", windowsVirtualKeyCode: 90, modifiers: process.platform === "darwin" ? 4 : 2, commands: ["undo"] });
	await frames(3);
	assert.equal(await app.evaluate(`document.querySelector('textarea').value`), "/review-0 ");
	await input(value); await shot("command-input");
	const alignment = await app.evaluate(`(()=>{const f=document.querySelector('textarea'),m=document.querySelector('[data-command-mirror]');return {metrics:[f,m].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,font:s.fontFamily,size:s.fontSize,line:s.lineHeight,padding:s.padding,whiteSpace:s.whiteSpace};}),scrollTop:f.scrollTop,clientHeight:f.clientHeight,scrollHeight:f.scrollHeight,mirrorTransform:getComputedStyle(m).transform,mirrorOffset:new DOMMatrixReadOnly(getComputedStyle(m).transform).m42};})()`);
	const metrics = alignment.metrics;
	t.diagnostic(JSON.stringify(alignment));
	// The mirror follows the text origin, including the native field's scroll offset.
	assert.deepEqual(metrics[0], { ...metrics[1], y: metrics[1].y + alignment.scrollTop });
	assert.equal(alignment.mirrorOffset + alignment.scrollTop, 0);
	// Copyable source is the native value; the hint lives in an aria-hidden, unselectable layer.
	assert.equal(await app.evaluate(`(()=>{const f=document.querySelector('textarea');f.select();return f.value.slice(f.selectionStart,f.selectionEnd);})()`), value);
	await input("请保留这句 👩‍💻 /rev 后续内容");
	for (let index = 0; index < " 后续内容".length; index++) await key("ArrowLeft", 37);
	await until(`document.querySelectorAll('[role="option"]').length > 0`);
	await key("Tab", 9);
	assert.equal(await app.evaluate(`document.querySelector('textarea').value`), "请保留这句 👩‍💻 /review-0 后续内容");
});

test("narrow layouts, long drafts and IME keep the native input aligned and do not accidentally submit", async (t) => {
	await click('[data-ly-row="qa-long"]');
	const appearance = await app.evaluate(`window.lyra.settings.get().then(s => s.appearance)`);
	const viewport = await app.evaluate(`({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio,mobile:false})`);
	try {
		await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:'light',reduceMotion:'off'}});})()`);
		await app.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 740, deviceScaleFactor: 1.25, mobile: false });
		await input("/"); await until(`document.querySelectorAll('[role="option"]').length >= 27`); await frames();
		const bounds = await app.evaluate(`(()=>{const m=document.querySelector('[role="listbox"]'),f=document.querySelector('textarea');const r=m.getBoundingClientRect();return {width:innerWidth,dpr:devicePixelRatio,left:r.left,right:r.right,top:r.top,fieldLeft:f.getBoundingClientRect().left,fieldRight:f.getBoundingClientRect().right};})()`);
		t.diagnostic(JSON.stringify(bounds)); assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0);
		const row = '[role="option"][data-index="3"]';
		const center = await app.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row)}).getBoundingClientRect();return {x:r.x+50,y:r.y+r.height/2};})()`);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...center }); await frames(50);
		const movement = await app.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row)});return {x:new DOMMatrixReadOnly(getComputedStyle(r.querySelector('.ly-marquee-track')).transform).m41,icon:r.querySelector('svg').getBoundingClientRect().x,origin:r.lastElementChild.getBoundingClientRect().x};})()`);
		assert.ok(movement.x < -10, JSON.stringify(movement));
		await frames(20);
		assert.deepEqual(await app.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row)});return {icon:r.querySelector('svg').getBoundingClientRect().x,origin:r.lastElementChild.getBoundingClientRect().x};})()`), { icon: movement.icon, origin: movement.origin });
		await app.evaluate(`document.querySelector('[role="listbox"] .ly-scroll-view').scrollTop = 150`); await frames();
		const fades = await app.evaluate(`(()=>{const s=getComputedStyle(document.querySelector('[role="listbox"] .ly-scroll-view'));return [s.getPropertyValue('--ly-fade-top'),s.getPropertyValue('--ly-fade-bottom')];})()`);
		assert.deepEqual(fades, ["36px", "48px"]);
		await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,reduceMotion:'on'}});})()`); await frames();
		assert.equal(await app.evaluate(`getComputedStyle(document.querySelector('[role="listbox"] .ly-marquee-track')).animationName`), "none");
		await input("/review-0"); await click('[role="option"]');
		assert.equal(await app.evaluate(`document.querySelector('textarea').value`), "/review-0 ");
		const hint = await app.evaluate(`(()=>{const h=document.querySelector('.ly-command-hint'),f=document.querySelector('textarea');const r=h.getBoundingClientRect();return {right:r.right,fieldRight:f.getBoundingClientRect().right,mask:getComputedStyle(h).maskImage};})()`);
		t.diagnostic(JSON.stringify(hint)); await shot("command-narrow-light");
		assert.ok(hint.right <= hint.fieldRight, "hint stays within the input");
		const long = "/review-0 " + "参数、路径与普通提示词 👩‍💻\n".repeat(40);
		await input(long); await frames();
		for (const top of [0, 120, 400]) {
			await app.evaluate(`document.querySelector('textarea').scrollTop = ${top}`); await frames(3);
			const scroll = await app.evaluate(`(()=>{const f=document.querySelector('textarea'),m=document.querySelector('[data-command-mirror]');return {offset:f.scrollTop,translate:new DOMMatrixReadOnly(getComputedStyle(m).transform).m42,widthDelta:f.getBoundingClientRect().width-m.getBoundingClientRect().width,heightDelta:f.scrollHeight-m.scrollHeight};})()`);
			assert.equal(scroll.offset, top); assert.equal(scroll.offset + scroll.translate, 0); assert.equal(scroll.widthDelta, 0); assert.ok(Math.abs(scroll.heightDelta) <= 1, JSON.stringify(scroll));
		}
		await input("/compact ");
		const before = requests.length;
		await app.send("Input.imeSetComposition", { text: "保留", selectionStart: 2, selectionEnd: 2 }); await frames(3);
		// Composition stays on the mirror. Pulling the highlight off during IME collapsed every
		// attachment mark back to brackets for the whole of a Chinese word.
		assert.equal(await app.evaluate(`document.querySelector('textarea').dataset.highlighted`), "true");
		await app.evaluate(`document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true}))`); await frames(3);
		assert.equal(requests.length, before); assert.equal(await app.evaluate(`document.querySelector('textarea').value`), "/compact 保留");
		await app.send("Input.insertText", { text: "保留" }); await frames(3);
		assert.equal(await app.evaluate(`document.querySelector('textarea').value`), "/compact 保留");
		assert.equal(await app.evaluate(`document.querySelector('textarea').dataset.highlighted`), "true");
		await input("/review-23 ");
		const longHint = await app.evaluate(`(()=>{const h=document.querySelector('.ly-command-hint'),token=document.querySelector('.ly-command-token'),f=document.querySelector('textarea');const glyphs=(e)=>{const r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect();};return {hintTop:glyphs(h).top,tokenTop:glyphs(token).top,hintRight:h.getBoundingClientRect().right,fieldRight:f.getBoundingClientRect().right,mask:getComputedStyle(h.parentElement.parentElement).maskImage};})()`);
		t.diagnostic(JSON.stringify(longHint)); await shot("command-long-hint");
		assert.equal(longHint.hintTop, longHint.tokenTop, "a long hint must not wrap into a clipped second line");
		assert.notEqual(longHint.mask, "none", "overflowing placeholder fades at the field boundary");
		await input("");
	} finally {
		// Electron retains the emulated widget size after clear; restore the original viewport explicitly.
		await app.send("Emulation.setDeviceMetricsOverride", viewport);
		await until(`innerWidth === ${viewport.width} && innerHeight === ${viewport.height}`);
		await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:${JSON.stringify(appearance)}});})()`);
	}
});

test("pasted compact with parameters executes once, reports progress, and survives session switching", async (t) => {
	await click('[data-ly-row="qa-long"]');
	await until(`document.querySelector('[data-view="qa-long"][data-active="true"] button[aria-label^="上下文占用"]')`);
	const meterBefore = await app.evaluate<string>(`document.querySelector('[data-view="qa-long"][data-active="true"] button[aria-label^="上下文占用"] circle:last-child').getAttribute('stroke-dasharray')`);
	const contextBefore = await app.evaluate<{used:number}>(`window.lyra.sessions.contextBreakdown('qa-long')`);
	hold = true; complete = undefined; const before = requests.length;
	let finishCompaction: (() => void) | undefined;
	try {
		await input("/compact 保留关键决策和未完成事项");
		await key("Enter", 13);
		await until(`document.querySelector('[data-view="qa-long"][data-active="true"] [data-command-status="running"]')`);
		await until(`document.querySelector('[data-view="qa-long"][data-active="true"] button[aria-label="停止"]')`);
		assert.equal(await app.evaluate(`document.querySelector('[data-view="qa-long"][data-active="true"] textarea').value`), "");
		await shot("compact-running");
		for (let n = 0; n < 120 && requests.length === before; n++) await frames(1);
		finishCompaction = complete; complete = undefined;
		assert.equal(requests.length, before + 1);
		assert.match(requests.at(-1) ?? "", /保留关键决策和未完成事项/);
		assert.ok(finishCompaction, "the compact request must still be held by the fixture");
		hold = false;
		await click('[data-ly-row="qa-short"]');
		await until(`document.querySelector('[data-view="qa-short"][data-active="true"]')`);
		assert.equal(await app.evaluate(`document.querySelectorAll('[data-view="qa-short"][data-active="true"] [data-command-run]').length`), 0);
		await input("另一个会话仍可发送"); await key("Enter", 13);
		await until(`document.querySelector('[data-view="qa-short"][data-active="true"]').textContent.includes('另一个会话仍可发送') && !document.querySelector('[data-view="qa-short"][data-active="true"] button[aria-label="停止"]')`);
		assert.ok(requests.some((body) => body.includes("另一个会话仍可发送")));
		await click('[data-ly-row="qa-long"]');
		await until(`document.querySelector('[data-view="qa-long"][data-active="true"] [data-command-status="running"]')`);
		finishCompaction(); finishCompaction = undefined;
		await until(`document.querySelector('[data-view="qa-long"][data-active="true"] [data-command-status="done"]')`);
		const result = await app.evaluate(`document.querySelector('[data-view="qa-long"][data-active="true"] [data-command-status="done"]').textContent`);
		assert.match(result, /已压缩上下文/); t.diagnostic(result);
		await until(`document.querySelector('[data-view="qa-long"][data-active="true"] button[aria-label^="上下文占用"] circle:last-child').getAttribute('stroke-dasharray') !== ${JSON.stringify(meterBefore)}`);
		const contextAfter = await app.evaluate<{used:number}>(`window.lyra.sessions.contextBreakdown('qa-long')`);
		assert.ok(contextAfter.used < contextBefore.used * 0.7, JSON.stringify({contextBefore,contextAfter}));
		t.diagnostic(JSON.stringify({contextBefore,contextAfter}));
		await click('[data-view="qa-long"][data-active="true"] button[aria-label^="上下文占用"]');
		await until(`document.querySelector('[aria-label="上下文窗口用量"] section button[aria-expanded]')`);
		assert.deepEqual(await app.evaluate(`Array.from(document.querySelectorAll('[aria-label="上下文窗口用量"] section button[aria-expanded]')).map(e=>({open:e.getAttribute('aria-expanded'),title:e.textContent}))`), [{open:'false',title:'记忆文件'}]);
		await shot("context-after-compaction");
		await click('[data-view="qa-long"][data-active="true"] button[aria-label^="上下文占用"]');
		await shot("compact-done");
		// Use a clipboard sink so checking Copy never overwrites the user's system clipboard.
		await app.evaluate(`Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{document.documentElement.dataset.commandCopy=text;}})`);
		try {
			await click('[data-view="qa-long"][data-active="true"] [data-command-run] button[aria-label="复制这条消息"]');
			assert.equal(await app.evaluate(`document.documentElement.dataset.commandCopy`), "/compact 保留关键决策和未完成事项");
		} finally { await app.evaluate(`delete navigator.clipboard.writeText;delete document.documentElement.dataset.commandCopy`); }
		await click('[data-ly-row="qa-short"]'); await click('[data-ly-row="qa-long"]');
		await until(`document.querySelector('[data-view="qa-long"][data-active="true"] [data-command-status="done"]')`);
		assert.equal(await app.evaluate(`document.querySelectorAll('[data-view="qa-long"][data-active="true"] [data-command-run]').length`), 1);
	} finally {
		// An assertion before completion must not leave a background compact blocking later tests.
		hold = false;
		(finishCompaction ?? complete)?.();
		complete = undefined;
	}
});

test("bare commands execute from Enter and send; custom definitions expand fresh parameters", async () => {
	await click('[data-ly-row="qa-short"]'); hold = true; complete = undefined; const before = requests.length;
	await input("/compact"); await key("Enter", 13);
	await until(`document.querySelector('[data-view="qa-short"][data-active="true"] [data-command-status="running"]')`);
	for (let n = 0; n < 120 && requests.length === before; n++) await frames(1);
	await click('[data-view="qa-short"][data-active="true"] button[aria-label="停止"]'); hold = false;
	await until(`document.querySelector('[data-view="qa-short"][data-active="true"] [data-command-status="cancelled"]')`);
	await input('/review-0 "src/Main.cs" 额外说明');
	await click('[data-view="qa-short"][data-active="true"] button[aria-label="发送"]');
	await until(`document.querySelector('[data-view="qa-short"][data-active="true"]').textContent.includes('自定义命令执行："src/Main.cs" 额外说明')`);
	await until(`!document.querySelector('[data-view="qa-short"][data-active="true"] button[aria-label="停止"]')`);
	assert.ok(requests.some((request) => request.includes('自定义命令执行：')));
	await writeFile(join(app.home, "commands", "review-0.md"), "---\ndescription: updated\n---\n磁盘上的最新命令内容");
	await input("/review-0"); await click('[data-view="qa-short"][data-active="true"] button[aria-label="发送"]');
	await until(`document.querySelector('[data-view="qa-short"][data-active="true"]').textContent.includes('磁盘上的最新命令内容')`);
	await until(`!document.querySelector('[data-view="qa-short"][data-active="true"] button[aria-label="停止"]')`);
	await mkdir(join(app.home, "commands", "git"));
	await writeFile(join(app.home, "commands", "git", "audit.md"), "---\ndescription: nested command\n---\n无参数执行嵌套命令");
	await input("/audit");
	await until(`[...document.querySelectorAll('[role="option"]')].some(el => el.textContent.includes('git:audit'))`);
	await key("Enter", 13);
	await until(`document.querySelector('[data-view="qa-short"][data-active="true"]').textContent.includes('无参数执行嵌套命令') && !document.querySelector('[data-view="qa-short"][data-active="true"] button[aria-label="停止"]')`);
	const requestCount = requests.length;
	await input("/clear"); await key("Enter", 13);
	await until(`document.querySelector('[data-ly-split-pane="@draft"] textarea') && !document.querySelector('[data-ly-split-pane="@draft"] [data-question-index]')`);
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-ly-split-pane="@draft"] [data-command-run]').length`), 0);
	assert.equal(requests.length, requestCount, "clear opens a blank session without a model call");
	await input("/commands"); await key("Enter", 13);
	await until(`[...document.querySelectorAll('nav button[aria-current]')].some(b=>b.textContent.trim()==='命令')`);
});
