/* oxlint-disable no-console -- measured assertions accompany BrowserWindow recordings */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type AppWindow } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";
import { seed, IDS } from "./split-dock-fixture.ts";

const baseline = process.argv.includes("--baseline");
const port = 9829;
const app = await startApp({ port, inspectPort: 9830, seed });
const d = driver(app);
const mainWindowId = await app.main<number>("process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/')).id");
const frames: Frame[] = [];
const windows: Frame[] = [];
const stop = await startRecording(port, frames);
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const tile = (id: string) => `[data-ly-split-pane="${id}"]`;
const check = (name: string, ok: boolean, measured: unknown) => { checks.push({ name, ok, measured }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`); };
async function hold(ms = 1000, target: Pick<AppWindow, "send"> = app, into = frames) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const shot = await target.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 85 });
		into.push({ at: Date.now(), data: Buffer.from(shot.data, "base64") });
		await pause(120);
	}
}
async function resize(width: number, height: number) {
	const client = await app.main<{width:number;height:number}>(`(()=>{const w=process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.id===${mainWindowId});w.setBounds({x:20,y:33,width:${width},height:${height}});return w.getContentBounds()})()`);
	await d.until(`innerWidth===${client.width} && innerHeight===${client.height}`, 10000);
	await hold(1300);
}
async function measure() {
	return app.evaluate<{ kind: string; width: number; height: number; text: number; input: number }[]>(`[...document.querySelectorAll('[data-ly-pane-dock] [data-dock-pane]')].filter(el=>el.checkVisibility({opacityProperty:true,visibilityProperty:true})).map(el=>{const r=el.getBoundingClientRect();return {kind:el.dataset.dockPane,width:r.width,height:r.height,text:el.querySelector('[data-ly-transcript-rows]')?.getBoundingClientRect().width??0,input:el.querySelector('textarea')?.getBoundingClientRect().width??0}})`);
}
const split = { type: "split", dir: "row", children: IDS.slice(0, 2).map(sessionId => ({ type: "leaf", sessionId })), sizes: [0.5, 0.5] };
const leaf = (kind: string) => ({ type: "leaf", kind });
async function loadLayout(dock: object, outer = split) {
	await app.main(`(()=>{for(const w of process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows())if(w.id!==${mainWindowId}&&!w.webContents.getURL().includes('#/screenshot-overlay'))w.close();return true})()`);
	await app.evaluate(`localStorage.setItem('ly:split:primary',${JSON.stringify(JSON.stringify({ version: 1, tree: outer, focused: IDS[0] }))});localStorage.setItem('dw:panedock:${IDS[0]}',${JSON.stringify(JSON.stringify({ v: 1, tree: dock }))});localStorage.removeItem('dw:panedock:${IDS[1]}');localStorage.removeItem('dw:homes');true`);
	await app.send("Page.reload");
	await d.until(`document.querySelector(${JSON.stringify(tile(IDS[0]) + " textarea")}) && document.querySelector(${JSON.stringify(tile(IDS[1]) + " textarea")})`, 25000);
	await hold(2200);
}
async function clickText(text: string) {
	await d.until(`[...document.querySelectorAll('[role="menuitem"]')].some(el=>el.textContent.trim().startsWith(${JSON.stringify(text)}))`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent.trim().startsWith(${JSON.stringify(text)})).click()`);
	await hold();
}
async function openTool(kind: string) {
	await d.click(`${tile(IDS[0])} [data-ly-split-chrome] button[aria-label="面板"]`);
	await clickText(kind);
}
async function restore(win: AppWindow) {
	const point = await win.evaluate<{x:number;y:number}>("(()=>{const r=document.querySelector('[data-ly-restore-panel]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
	for (const type of ["mousePressed", "mouseReleased"]) await win.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
	await hold();
}
async function panel(kind: string) {
	for (let i = 0; i < 40; i++) {
		const win = (await app.windows()).find(w => w.boot.kind === "panel" && w.boot.panelKind === kind);
		if (win && await win.evaluate("Boolean(document.querySelector('[data-ly-restore-panel]'))")) return win;
		await pause(100);
	}
	throw new Error(`missing detached ${kind}`);
}
try {
	await d.until(`document.querySelector('[data-ly-row="${IDS[0]}"]')`, 25000);
	await d.click(`[data-ly-row="${IDS[0]}"] > button`); await hold();
	await loadLayout({ type: "split", dir: "row", children: [leaf("conversation"), { type: "split", dir: "col", children: [leaf("browser"), leaf("terminal")], sizes: [0.5, 0.5] }, leaf("tasks")], sizes: [0.1, 0.45, 0.45] });
	await app.main(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.id===${mainWindowId}).focus()`);
	if (!baseline) await d.until(`![...document.querySelectorAll(${JSON.stringify(tile(IDS[0]) + ' [data-dock-pane]:not([data-dock-pane="conversation"])')})].some(e=>e.checkVisibility({opacityProperty:true,visibilityProperty:true}))`, 15000);
	const restored = await measure();
	check("restoring the screenshot's dense layout preserves readable conversation containers", restored.filter(p=>p.kind==="conversation").every(p=>p.width>=419 && p.text>=340 && p.input>=300), restored);
	const detached = (await app.windows()).filter(w=>w.boot.kind==="panel");
	check("tools that no longer fit the saved layout open as real independent windows", detached.length===3, detached.map(w=>w.boot));
	if (!baseline) {
		for (const win of detached) await hold(1000, win, windows);
		await loadLayout(leaf("conversation"));
		await resize(1360, 484);
		await openTool("终端");
		const stacked = await measure();
		check("a narrow tile stacks its first tool while retaining both width and height minima", stacked.some(p=>p.kind==="terminal" && p.width>=300 && p.height>=149) && stacked.filter(p=>p.kind==="conversation").every(p=>p.width>=419 && p.height>=259), stacked);
		await openTool("浏览器");
		const browser = await panel("browser");
		await hold(1200, browser, windows);
		check("the next tool opens a window instead of squeezing the conversation or terminal", !(await measure()).some(p=>p.kind==="browser") && (await measure()).filter(p=>p.kind==="conversation").every(p=>p.width>=419 && p.input>=300), await measure());
		await openTool("浏览器");
		check("opening an already detached tool focuses the existing window", (await app.windows()).filter(w=>w.boot.kind==="panel" && w.boot.panelKind==="browser").length===1, (await app.windows()).map(w=>w.boot));
		await restore(browser);
		check("return is refused while neither axis has enough room", (await app.windows()).some(w=>w.boot.id===browser.boot.id) && !(await measure()).some(p=>p.kind==="browser"), await measure());
		await resize(1360, 800);
		await restore(browser);
		check("after enlarging the window the panel returns with every container above its minimum", (await measure()).some(p=>p.kind==="browser") && (await measure()).every(p=>p.width>=(p.kind==="conversation"?419:299)), await measure());
		await resize(1360, 484);
		check("shrinking an existing layout moves overflowing tools to windows", (await app.windows()).some(w=>w.boot.kind==="panel") && (await measure()).filter(p=>p.kind==="conversation").every(p=>p.width>=419 && p.height>=259), await measure());
		await loadLayout(leaf("conversation"), { ...split, sizes: [0.08, 0.92] });
		check("restored outer split ratios cannot compress a conversation below its minimum", (await measure()).every(p=>p.width>=419 && p.input>=300), await measure());
		await resize(950, 700);
		check("a window narrower than two chats moves the overflow conversation into a new window", (await measure()).filter(p=>p.kind==="conversation").length===1 && (await measure()).every(p=>p.width>=419 && p.input>=300) && (await app.windows()).some(w=>w.boot.kind==="session"), { panes:await measure(),windows:(await app.windows()).map(w=>w.boot) });
		await resize(1360, 700);
		await loadLayout(leaf("conversation"));
		await app.evaluate(`window.__widthComposer=document.querySelector(${JSON.stringify(tile(IDS[0]) + " textarea")});window.__widthComposer.focus();true`);
		await app.send("Input.insertText", { text: "宽度回归：草稿保留" });
		const root = await app.evaluate<{x:number;y:number;w:number;h:number}>("(()=>{const r=document.querySelector('[data-ly-split-root]').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()");
		const handle = '[data-ly-split-handle][aria-orientation="vertical"]';
		const origin = await app.evaluate<{x:number;y:number}>(`(()=>{const r=document.querySelector(${JSON.stringify(handle)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
		await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...origin, button: "left", buttons: 1, clickCount: 1 });
		for (let i=1;i<=15;i++) { await app.send("Input.dispatchMouseEvent", { type:"mouseMoved",x:origin.x+(root.x+30-origin.x)*i/15,y:origin.y,button:"left",buttons:1 }); await pause(40); }
		await app.send("Input.dispatchMouseEvent", { type:"mouseReleased",x:root.x+30,y:origin.y,button:"left",buttons:0,clickCount:1 }); await hold();
		check("dragging the outer divider stops at the readable floor and retains the composer", (await measure()).every(p=>p.width>=419) && await app.evaluate(`window.__widthComposer===document.querySelector(${JSON.stringify(tile(IDS[0]) + " textarea")}) && window.__widthComposer.value==='宽度回归：草稿保留'`), await measure());
	}
} catch (error) {
	check("scenario completed", false, String(error));
} finally {
	await stop(); await app.stop();
	const output = join(homedir(), "Desktop", "Lyra最小宽度测试");
	await mkdir(output, { recursive: true });
	const name = `${new Date().toISOString().replace(/[:.]/g,"-")}_${baseline ? "修复前" : "最小宽度与自动窗口"}_${checks.filter(c=>c.ok).length}of${checks.length}`;
	await writeFile(join(output, name+".json"), JSON.stringify(checks,null,2));
	if (frames.length) await encode(frames, join(output,name+".mp4"),30);
	if (windows.length) await encode(windows, join(output,name+"_独立窗口.mp4"),30);
	console.log(join(output,name+".mp4"));
	if (checks.some(c=>!c.ok)) process.exitCode=1;
}
