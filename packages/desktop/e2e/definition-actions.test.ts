import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, afterEach, before, test, type TestContext } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { landsOn } from "./lands-on.ts";
import { named } from "./named.ts";
import { settleSharedWindow } from "./shared-window.ts";

let app: RunningApp;
let cwd: string;
let command: string;
let skill: string;
let rule: string;
const id = `lyra-row-qa-${randomUUID()}`;
const trashed: string[] = [];
/*
 * The confirmation's button, in this system's own words: the Trash is a Mac's, and Windows and Linux
 * call it the Recycle Bin (`removal.toTrash*`, see `lib/system-words.ts`). Written as the Mac's alone,
 * every deletion here waited for a button a Windows window never draws.
 */
const TO_TRASH = process.platform === "darwin" ? "移入废纸篓" : "移入回收站";
before(async () => {
	app = await startApp({ port: 9603, seed: async (home) => {
		cwd = join(home, "project");
		command = join(home, "commands", `${id}.md`);
		skill = join(cwd, ".lyra", "skills", `${id}-skill`, "SKILL.md");
		rule = join(cwd, ".lyra", "rules", `${id}-rule.md`);
		// Only these synthetic definitions travel through the real renderer, IPC and OS trash.
		for (const [path, body] of [
			[command, `---\nname: xiaorong\ndescription: 消融实验，验证悬停删除时内容与来源保持对齐。\nargument-hint: <可选：这个命令接受什么参数>\n---\nRun isolated checks.`],
			[skill, `---\nname: loose-qa\ndescription: A reusable isolated workflow used to verify the skill row and its delete action.\n---\nRead inputs.`],
			[rule, `---\ndescription: An isolated rule used to verify deletion without changing built-in rules.\n---\nUse isolated files.`],
		]) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, body); }
		await writeFile(join(dirname(skill), "resource.txt"), "skill resource");
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1200, height: 800 }));
		await writeFile(join(home, "settings.json"), JSON.stringify({ providers: [], sync: { enabled: false },
			// This test measures animation frames independently of the runner's accessibility settings.
			appearance: { reduceMotion: "off" },
			mcpServers: [{ id: "qa", name: "QA 服务", command: "unused", args: [], transport: "stdio", enabled: false }],
			hooks: [{ id: "qa", command: "echo isolated", tools: [], event: "before-tool", enabled: false, blocking: false }],
			projects: [{ id: "qa-project", path: cwd, name: "行操作验证", pinned: true, lastOpenedAt: 1 }],
		}));
	} });
});
after(async () => {
	await app?.stop();
	// Remove only UUID-named artifacts this test placed in the user's trash, never enumerate it.
	for (const name of trashed) {
		if (process.platform === "darwin") await rm(join(homedir(), ".Trash", name), { recursive: true, force: true });
		if (process.platform === "linux") {
			const trash = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "Trash");
			await rm(join(trash, "files", name), { recursive: true, force: true });
			await rm(join(trash, "info", `${name}.trashinfo`), { force: true });
		}
	}
});
// The second test starts on the settings page the first one leaves, and the first opens confirmations.
afterEach(async (context) => settleSharedWindow(app, context as TestContext, "definition-actions"));

async function frames(n = 20) {
	await app.evaluate(`new Promise(resolve=>{let n=${n};const f=()=>--n?requestAnimationFrame(f):resolve();requestAnimationFrame(f);})`);
}
async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{let n=300;const f=()=>{if(${expression})resolve();else if(--n)requestAnimationFrame(f);else reject(new Error(${JSON.stringify(expression)}));};f();})`);
}
async function point(selector: string) {
	return app.evaluate<{ x: number; y: number }>(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility({visibilityProperty:true}));if(!el)throw new Error(${JSON.stringify(selector)});el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
}
async function click(selector: string) {
	const at = await point(selector);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	// Row actions take the pointer only once it is inside their row, so ask what is under it after moving there.
	await app.evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility({visibilityProperty:true})),x=${at.x},y=${at.y};${landsOn(selector)}})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...at });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...at });
	await frames(2);
}
async function select(label: string, nav = false, counted = false) {
	const match = named(label, counted ? "stripCount" : "exact", "b");
	const matches = `b.checkVisibility({visibilityProperty:true})&&${match}`;
	await until(`[...document.querySelectorAll('${nav ? "nav " : ""}button')].some(b=>${matches})`);
	await app.evaluate(`(()=>{document.querySelector('[data-qa-pick]')?.removeAttribute('data-qa-pick');[...document.querySelectorAll('${nav ? "nav " : ""}button')].find(b=>${matches}).setAttribute('data-qa-pick','');})()`);
	await click('[data-qa-pick]');
}
async function shot(name: string) {
	const dir = process.env.LYRA_E2E_ARTIFACTS;
	if (!dir) return;
	await mkdir(dir, { recursive: true });
	const image = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(image.data, "base64"));
}

async function withTouchViewport(run: () => Promise<void>) {
	const targets: { url: string; webSocketDebuggerUrl?: string }[] = await fetch("http://127.0.0.1:9603/json/list").then((response) => response.json());
	const target = targets.find((entry) => entry.url.endsWith("/index.html"));
	assert.ok(target?.webSocketDebuggerUrl);
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("touch emulation connection failed")), { once: true });
	});
	let id = 0;
	const send = (method: string, params = {}) => new Promise<void>((resolve, reject) => {
		const request = ++id;
		const listener = (event: MessageEvent) => {
			const message: { id?: number; error?: { message: string } } = JSON.parse(String(event.data));
			if (message.id !== request) return;
			socket.removeEventListener("message", listener);
			if (message.error) reject(new Error(message.error.message)); else resolve();
		};
		socket.addEventListener("message", listener);
		socket.send(JSON.stringify({ id: request, method, params }));
	});
	try {
		// Touch overrides belong to the debugger session and disappear when its socket closes.
		await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 740, deviceScaleFactor: 1, mobile: true });
		await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
		await run();
	} finally {
		try { await send("Emulation.clearDeviceMetricsOverride"); }
		finally { socket.close(); }
		await frames();
	}
}

test("command deletion fades in without shifting its row, works with keyboard/touch, and respects cancel", async (t) => {
	await click('button[aria-label="在「行操作验证」里新建会话"]');
	await click('button:has(svg.lucide-settings)');
	await select("命令", true);
	const selector = '[aria-label="删除命令 xiaorong"]';
	await until(`document.querySelector('${selector}')`);
	const at = await point(selector);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 10 }); await frames();
	const measure = () => app.evaluate<{ opacity: number; x: number; width: number; height: number; actionX: number }>(`(()=>{const b=document.querySelector('${selector}');const row=b.closest('[data-row-actions]');const r=row.getBoundingClientRect();return {opacity:Number(getComputedStyle(b.parentElement).opacity),x:r.x,width:r.width,height:r.height,actionX:b.getBoundingClientRect().x};})()`);
	const resting = await measure(); assert.equal(resting.opacity, 0);
	t.diagnostic(JSON.stringify(await app.evaluate(`({reduceMotion:document.documentElement.dataset.reduceMotion,systemReducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,transition:getComputedStyle(document.querySelector('${selector}').parentElement).transitionDuration})`)));
	// Arm sampling before the pointer moves; opening another CDP socket can outlast the transition.
	await app.evaluate(`(()=>{const b=document.querySelector('${selector}');b.closest('[data-row-actions]').addEventListener('mouseenter',()=>{b._hoverSamples=(async()=>{const values=[];for(let n=0;n<20;n++){await new Promise(requestAnimationFrame);values.push(Number(getComputedStyle(b.parentElement).opacity));}return values;})()},{once:true});})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	const samples = await app.evaluate<number[]>(`document.querySelector('${selector}')._hoverSamples`);
	const hovering = await measure();
	t.diagnostic(JSON.stringify({ opacityFrames: samples }));
	assert.equal(hovering.opacity, 1);
	assert.ok(samples.some((value) => value > 0 && value < 1), "hover paints intermediate opacity frames");
	assert.deepEqual({ ...hovering, opacity: 0 }, resting);
	await shot("command-hover-delete");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 10 });
	await app.evaluate(`document.querySelector('[aria-label="编辑 xiaorong"]').focus()`);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }); await frames();
	assert.equal(await app.evaluate(`document.activeElement.getAttribute('aria-label')`), "删除命令 xiaorong");
	assert.equal((await measure()).opacity, 1);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
	await until(`document.querySelector('[role="dialog"]')`);
	assert.ok(await app.evaluate(`document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(command)})`));
	await select("取消"); await until(`!document.querySelector('[role="dialog"]')`); await access(command);
	await withTouchViewport(async () => {
		await frames(); await point(selector); await frames();
		const narrow = await measure();
		t.diagnostic(JSON.stringify(await app.evaluate(`({media:['(hover: hover)','(pointer: fine)','(any-pointer: coarse)'].map(q=>[q,matchMedia(q).matches]),touch:navigator.maxTouchPoints})`)));
		t.diagnostic(JSON.stringify({ resting, hovering, narrow, opacityFrames: samples }));
		await shot("command-touch-delete");
		assert.equal(narrow.opacity, 1);
		assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 375, JSON.stringify(narrow));
	});
	trashed.push(basename(command));
	await click(selector); await select(TO_TRASH);
	await until(`!document.querySelector('${selector}')`);
	await assert.rejects(access(command));
	const list = await app.evaluate<{ commands: { name: string }[] }>(`window.lyra.commands.list(${JSON.stringify(cwd)})`);
	assert.ok(!list.commands.some((item) => item.name === "xiaorong"));
});

test("loose skill and rule rows delete their own definitions while related configuration rows share hover actions", async () => {
	await select("插件", true); await select("技能", false, true);
	await until(`document.querySelector('[aria-label="删除技能 loose-qa"]')`);
	trashed.push(basename(dirname(skill)));
	await click('[aria-label="删除技能 loose-qa"]'); await select(TO_TRASH);
	await until(`!document.querySelector('[aria-label="删除技能 loose-qa"]')`);
	await assert.rejects(access(dirname(skill)));
	await select("规则", false, true);
	await until(`document.querySelector('[aria-label="删除规则 ${id}-rule"]')`);
	trashed.push(basename(rule));
	await click(`[aria-label="删除规则 ${id}-rule"]`); await select(TO_TRASH);
	await until(`!document.querySelector('[aria-label="删除规则 ${id}-rule"]')`);
	await assert.rejects(access(rule));
	assert.equal(await app.evaluate(`[...document.querySelectorAll('[data-row-actions]')].filter(row=>row.textContent.includes('内置')).some(row=>row.querySelector('.ly-row-action'))`), false);
	await select("MCP", false, true);
	await until(`document.querySelector('[aria-label="删除 QA 服务"]')`);
	await click('[aria-label="删除 QA 服务"]'); await select("取消"); await until(`!document.querySelector('[role="dialog"]')`);
	await select("钩子", true);
	await until(`document.querySelector('[aria-label="删除这个钩子"]')`);
	await click('[aria-label="删除这个钩子"]'); await select("取消"); await until(`!document.querySelector('[role="dialog"]')`);
	const settings = JSON.parse(await readFile(join(app.home, "settings.json"), "utf8"));
	assert.equal(settings.hooks.length, 1); assert.equal(settings.mcpServers.length, 1);
});
