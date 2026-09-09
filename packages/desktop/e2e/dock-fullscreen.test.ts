import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Message } from "@lyra/core";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

// Synthetic workload matching the report, rendered through the real app's session/file readers.
async function seed(home: string) {
	const cwd = join(home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	await mkdir(cwd);
	await writeFile(join(cwd, "AGENTS.md"), Array.from({ length: 100 }, (_, i) =>
		`## Rule ${i + 1}\n\n${"保留文件阅读位置，验证面板全屏与还原时的布局性能。".repeat(8)}\n\n- Read the current project instructions.\n- Verify the visible result.\n`).join("\n"));
	await writeFile(join(cwd, "large.ts"), Array.from({ length: 5000 }, (_, i) => `export const value${i} = "editable line ${i}";`).join("\n"));
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const messages: Message[] = [];
	let run = 0;
	for (let turn = 0; turn < 120; turn++) {
		messages.push({ role: "user", content: [{ type: "text", text: `问题 ${turn + 1}：验证工作区。` }], timestamp: turn * 100 });
		const calls = Array.from({ length: turn < 64 ? 20 : 19 }, () => ({ type: "toolCall" as const, id: `run-${run++}`, name: "read", arguments: { path: "AGENTS.md" } }));
		messages.push({ role: "assistant", content: calls, api: "anthropic-messages", provider: "fixture", model: "fixture", usage, stopReason: "toolUse", timestamp: turn * 100 + 1 });
		for (const call of calls) messages.push({ role: "toolResult", toolCallId: call.id, toolName: "read", content: [{ type: "text", text: "fixture output" }], isError: false, timestamp: turn * 100 + 2 });
		messages.push({ role: "assistant", content: [{ type: "text", text: `### 完成 ${turn + 1}\n\n${"实际应用读取隔离测试会话，确保还原时保留内容和滚动位置。".repeat(12)}` }], api: "anthropic-messages", provider: "fixture", model: "fixture", usage, stopReason: "stop", timestamp: turn * 100 + 3 });
	}
	assert.equal(run, 2344);
	const meta = { id: "fullscreen", title: "全屏性能验证", projectId, projectName: "性能验证", cwd, createdAt: 1, updatedAt: 2, modelId: null, messageCount: messages.length, usage, seq: messages.length + 1 };
	await writeFile(join(home, "sessions", projectId, "fullscreen.jsonl"), [JSON.stringify({ type: "meta", meta, seq: 0, ts: 1 }), ...messages.map((message, i) => JSON.stringify({ type: "message", message, seq: i + 1, ts: 1 })), JSON.stringify({ type: "meta", meta, seq: meta.seq, ts: 2 })].join("\n") + "\n");
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta]));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({ providers: [], mcpServers: [], hooks: [], sync: { enabled: false }, projects: [{ id: projectId, name: "性能验证", path: cwd, pinned: true, lastOpenedAt: 1 }] }));
}

before(async () => {
	app = await startApp({ port: 9700, seed });
	await app.evaluate(`document.querySelector('[data-ly-row="fullscreen"] > button').click()`);
	await until(`document.querySelector('.ly-transcript')`);
	await openPane("任务");
	await openPane("终端");
	await openPane("文件");
	await until(`document.querySelector('[role="treeitem"][data-path$="AGENTS.md"]')`);
	await app.evaluate(`document.querySelector('[role="treeitem"][data-path$="AGENTS.md"]').click()`);
	await until(`document.querySelector('[data-dock-pane="file"] .prose-dw h2')`);
	await app.evaluate(`document.querySelector('[data-dock-header="files"] button[aria-label^="关闭"]').click()`);
	await frames(30);
});
after(async () => { await app?.stop(); });

async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{let n=600;const tick=()=>{if(${expression})resolve();else if(--n)requestAnimationFrame(tick);else reject(new Error(${JSON.stringify(expression)}));};tick();})`);
}
async function frames(count: number) {
	await app.evaluate(`new Promise(resolve=>{let n=${count};const tick=()=>--n?requestAnimationFrame(tick):resolve();requestAnimationFrame(tick);})`);
}
async function openPane(label: string) {
	await app.evaluate(`document.querySelector('button[aria-label="面板"]').click()`);
	await until(`document.querySelector('[role="menuitem"]')`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)})).click()`);
	await frames(20);
}

interface Sample {
	interval: number;
	left: number;
	top: number;
	width: number;
	height: number;
	layoutWidth: number;
	layoutHeight: number;
}
interface Measurement {
	frames: Sample[];
	motion: { setting: string | null; systemReduced: boolean };
	resizes: number;
	retained: Record<string, boolean>;
	scrollBefore: number;
	scrollAfter: number;
	longTasks: number[];
	longFrames: unknown[];
}

async function measure(kind: string, restore: boolean): Promise<Measurement> {
	const label = restore ? "退出全屏" : "全屏";
	return app.evaluate(`(async()=>{
		const pane = document.querySelector('[data-dock-pane="${kind}"]');
		// The root owns final layout; its retained visual surface owns the composited movement.
		const surface = pane.querySelector('[data-dock-motion]');
		const peers = [...document.querySelectorAll('[data-dock-pane]')].map(e=>[e.dataset.dockPane,e,e.querySelector('.ly-scroll-view,.xterm-screen,.cm-editor,webview')]);
		const scroller = pane.querySelector('.ly-scroll-view,.cm-scroller');
		const scrollBefore = scroller?.scrollTop ?? 0;
		let resizes=0; const observer=new ResizeObserver(()=>resizes++); observer.observe(pane);
		const longTasks=[]; const tasks=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))); tasks.observe({entryTypes:['longtask']});
		const longFrames=[]; const loaf=new PerformanceObserver(list=>longFrames.push(...list.getEntries().map(e=>({...e.toJSON(),scripts:e.scripts.map(s=>s.toJSON())})))); loaf.observe({entryTypes:['long-animation-frame']});
		await new Promise(requestAnimationFrame); resizes=0;
		const out=[]; let previous=performance.now();
		pane.querySelector('button[aria-label^="${label}"]').click();
		for(let i=0;i<40;i++) {
			await new Promise(requestAnimationFrame); const now=performance.now(), box=surface.getBoundingClientRect();
			out.push({interval:now-previous,left:box.left,top:box.top,width:box.width,height:box.height,layoutWidth:pane.offsetWidth,layoutHeight:pane.offsetHeight}); previous=now;
		}
		observer.disconnect();tasks.disconnect();loaf.disconnect();
		return {frames:out,motion:{setting:document.documentElement.dataset.reduceMotion??null,systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches},resizes,retained:Object.fromEntries(peers.map(([kind,old,content])=>[kind,old===document.querySelector('[data-dock-pane="'+kind+'"]')&&(!content||content.isConnected)])),scrollBefore,scrollAfter:scroller?.scrollTop??0,longTasks,longFrames};
	})()`);
}

// A runner's work area can stack the dock vertically without changing any pane's width.
function geometry(frame: Sample): string {
	return [frame.left, frame.top, frame.width, frame.height].map(Math.round).join(",");
}

test("fullscreen and restore retain heavy pane contents and resize each surface once", async (t) => {
	const measurements = [];
	for (const kind of ["file", "tasks", "terminal"]) {
		for (const restore of [false, true]) {
			const result = await measure(kind, restore);
			measurements.push({ kind, restore, ...result });
			t.diagnostic(JSON.stringify({ kind, restore, motion: result.motion, resizes: result.resizes, retained: result.retained, maxFrame: Math.max(...result.frames.map(f=>f.interval)), longTasks: result.longTasks }));
		}
	}
	const directory = process.env.LYRA_E2E_ARTIFACTS;
	if (directory) {
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, "dock-fullscreen.json"), JSON.stringify(measurements, null, 2));
		const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		await writeFile(join(directory, "dock-fullscreen.png"), Buffer.from(shot.data, "base64"));
	}
	for (const result of measurements) {
		assert.equal(result.motion.setting, "off", "normal motion uses an explicit fixture preference rather than the runner's accessibility setting");
		assert.ok(Object.values(result.retained).every(Boolean), `${result.kind} restore=${result.restore}: pane contents were unmounted: ${JSON.stringify(result.retained)}`);
		assert.ok(result.resizes <= 3, `${result.kind} restore=${result.restore}: ${result.resizes} layouts during one transition`);
		assert.ok(new Set(result.frames.map(geometry)).size > 2, `${result.kind} restore=${result.restore}: the pane visibly travels instead of cutting to its destination`);
	}
});

test("thousands of records stay bounded, retain an open detail and reach both list boundaries", async (t) => {
	const result = await app.evaluate<{ initial: number; bottom: { count: number; last: string; openRetained: boolean }; top: { count: number; first: string; openRetained: boolean; height: number }; beforeHeight: number }>(`(async()=>{
		const pane=document.querySelector('[data-dock-pane="tasks"]'), scroll=pane.querySelector('.ly-scroll-view');
		const frame=()=>new Promise(requestAnimationFrame);
		const rows=()=>[...pane.querySelectorAll('[data-task-record]')];
		const initial=rows().length;
		rows()[0].querySelector('button').click();await frame();await frame();
		const opened=rows()[0], beforeHeight=opened.offsetHeight;
		scroll.scrollTop=scroll.scrollHeight;for(let i=0;i<5;i++)await frame();
		const bottom={count:rows().length,last:rows().at(-1).dataset.taskRecord,openRetained:opened.isConnected};
		scroll.scrollTop=0;for(let i=0;i<5;i++)await frame();
		const top={count:rows().length,first:rows()[0].dataset.taskRecord,openRetained:opened===rows()[0],height:rows()[0].offsetHeight};
		rows()[0].querySelector('button').click();await frame();await frame();
		return {initial,bottom,top,beforeHeight};
	})()`);
	t.diagnostic(JSON.stringify(result));
	assert.ok(result.initial < 80 && result.bottom.count < 80 && result.top.count < 80);
	assert.equal(result.bottom.last, "run-19"); assert.equal(result.bottom.openRetained, true);
	assert.equal(result.top.first, "run-2325"); assert.equal(result.top.openRetained, true);
	assert.equal(result.top.height, result.beforeHeight);
	const geometry = await app.evaluate<{ count: number; height: number; rowHeight: number }>(`(()=>{const list=document.querySelector('[data-task-records]');return {count:list.children.length,height:list.offsetHeight,rowHeight:list.firstElementChild.offsetHeight};})()`);
	assert.ok(geometry.count < 80); assert.equal(geometry.height, geometry.rowHeight * 2344);
	assert.deepEqual(await app.evaluate(`(()=>{const pane=document.querySelector('[data-dock-pane="tasks"]');const rows=pane.querySelectorAll('[data-task-record]');return {first:rows[0].dataset.taskRecord,open:rows[0].dataset.open};})()`), {first: "run-2325", open: "false"});
});

test("rapid fullscreen reversals preserve scroll and finish without a second drift", async (t) => {
	const result = await app.evaluate<{ deltas: number[]; tail: string[]; scroll: number; hiddenInteractive: boolean; animations: number }>(`(async()=>{
		const pane=document.querySelector('[data-dock-pane="file"]'), scroll=pane.querySelector('.ly-scroll-view');
		scroll.scrollTop=1200;
		const surface=pane.querySelector('[data-dock-motion]');
		const frame=()=>new Promise(requestAnimationFrame), rect=()=>{const r=surface.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
		const deltas=[];
		for(let i=0;i<8;i++) {
			await frame();await frame();const from=rect();
			pane.querySelector('button[aria-label^="'+(i%2?'退出全屏':'全屏')+'"]').click();
			await Promise.resolve();const to=rect();deltas.push(Math.max(...from.map((n,i)=>Math.abs(n-to[i]))));
		}
		for(let i=0;i<20;i++)await frame();const tail=[];
		for(let i=0;i<10;i++){await frame();tail.push(rect().map(Math.round).join(','));}
		return {deltas,tail,scroll:scroll.scrollTop,hiddenInteractive:[...document.querySelectorAll('[data-dock-pane][inert]')].some(e=>getComputedStyle(e).opacity!=='0'),animations:surface.getAnimations().length};
	})()`);
	t.diagnostic(JSON.stringify(result));
	assert.ok(result.deltas.every(delta => delta < 1), "reversal starts at the currently displayed position");
	assert.equal(new Set(result.tail).size, 1); assert.equal(result.scroll, 1200);
	assert.equal(result.hiddenInteractive, false); assert.equal(result.animations, 0);
});

test("a large editable file keeps its editor and unsaved text; reduced motion lands immediately", async () => {
	await openPane("文件");
	await until(`document.querySelector('[role="treeitem"][data-path$="large.ts"]')`);
	await app.evaluate(`document.querySelector('[role="treeitem"][data-path$="large.ts"]').click()`);
	await until(`document.querySelector('[data-dock-pane="file"] .cm-content')`);
	await app.evaluate(`document.querySelector('[data-dock-header="files"] button[aria-label^="关闭"]').click()`);
	await frames(20);
	await app.evaluate(`(()=>{const e=document.querySelector('[data-dock-pane="file"] .cm-content');e.focus();const range=document.createRange();range.setStart(e.querySelector('.cm-line'),0);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);})()`);
	await app.send("Input.insertText", { text: "// retained draft\n" });
	for (const restore of [false, true]) {
		const result = await measure("file", restore);
		assert.ok(Object.values(result.retained).every(Boolean)); assert.ok(result.resizes <= 3);
	}
	assert.match(await app.evaluate<string>(`document.querySelector('[data-dock-pane="file"] .cm-content').innerText`), /retained draft/);
	assert.doesNotMatch(await readFile(join(app.home, "project", "large.ts"), "utf8"), /retained draft/);
	await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,reduceMotion:'on'}}))`);
	await until(`document.documentElement.dataset.reduceMotion==='on'`);
	try {
		for (const restore of [false, true]) {
			const result = await measure("file", restore);
			assert.equal(result.motion.setting, "on");
			assert.equal(new Set(result.frames.map(geometry)).size, 1);
		}
	} finally {
		await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,reduceMotion:'off'}}))`);
	}
});
