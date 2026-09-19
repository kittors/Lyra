/* oxlint-disable no-console -- measured real-window evidence accompanies the recording */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type AppWindow } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";
import { seed, IDS } from "./split-dock-fixture.ts";
import { paneFloor } from "../src/features/dock/geometry.ts";

const port = 9835;
const app = await startApp({ port, inspectPort: 9836, seed: async (home) => {
	await seed(home);
	await writeFile(join(home, "project", "alpha.ts"), 'export const alpha = "saved alpha";\n');
	await writeFile(join(home, "project", "beta.ts"), 'export const beta = "saved beta";\n');
	await writeFile(join(home, "project", "gamma.ts"), 'export const gamma = "saved gamma";\n');
} });
const d = driver(app);
const frames: Frame[] = [];
const floating: Frame[] = [];
const stop = await startRecording(port, frames);
const checks: { name: string; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
	assert.ok(ok, name);
	checks.push({ name, measured });
};
async function hold(win: Pick<AppWindow, "send"> = app, into = frames) {
	for (let n = 0; n < 10; n++) {
		const shot = await win.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 85 });
		into.push({ at: Date.now(), data: Buffer.from(shot.data, "base64") });
		await pause(100);
	}
}
async function click(win: Pick<AppWindow, "send" | "evaluate">, selector: string) {
	const p = await win.evaluate<{ x: number; y: number }>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e?.checkVisibility({visibilityProperty:true}))throw Error('missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await win.send("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: 1 });
}
async function edit(win: Pick<AppWindow, "send" | "evaluate">, text: string) {
	await click(win, ".cm-content");
	await win.send("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", windowsVirtualKeyCode: 35, modifiers: process.platform === "darwin" ? 4 : 2 });
	await win.send("Input.dispatchKeyEvent", { type: "keyUp", key: "End", code: "End", windowsVirtualKeyCode: 35 });
	await win.send("Input.insertText", { text });
	await pause(150);
}
const report = (win: Pick<AppWindow, "evaluate">) => win.evaluate<{ text: string; tabs: string[]; active: string[] }>(`({text:document.querySelector('.cm-content')?.innerText??'',tabs:[...document.querySelectorAll('[data-file-tab]')].map(e=>e.dataset.fileTab.split(/[\\\\/]/).at(-1)),active:[...document.querySelectorAll('[data-file-tab]:has([aria-selected="true"])')].map(e=>e.dataset.fileTab.split(/[\\\\/]/).at(-1))})`);
async function fileWindow() {
	for (let n = 0; n < 50; n++) {
		const win = (await app.windows()).find(w => w.boot.kind === "panel" && w.boot.panelKind === "file");
		if (win && await win.evaluate(`Boolean(document.querySelector('[data-ly-restore-panel]'))`)) return win;
		await pause(150);
	}
	throw new Error("file window did not paint");
}
async function windowClosed(win: AppWindow) {
	for (let n = 0; n < 80; n++) {
		if (!(await app.windows()).some(w => w.boot.id === win.boot.id)) return;
		await pause(100);
	}
	throw new Error(`file window remains open: ${JSON.stringify((await app.windows()).map(w => w.boot))}`);
}
async function returned(win: AppWindow) {
	await windowClosed(win);
	for (let n = 0; n < 80; n++) {
		const visible = await app.evaluate(`Boolean([...document.querySelectorAll('[data-dock-pane="file"] .cm-content')].find(e=>e.checkVisibility({visibilityProperty:true,opacityProperty:true})&&!e.closest('[inert]')))`);
		if (visible) return;
		await pause(100);
	}
	console.log("RETURN_INCOMPLETE", JSON.stringify({ windows: (await app.windows()).map(w=>w.boot), main: await app.evaluate(`({body:document.body.innerText.slice(-500),files:[...document.querySelectorAll('[data-dock-pane="file"]')].map(e=>({visible:e.checkVisibility({opacityProperty:true,visibilityProperty:true}),inert:!!e.closest('[inert]'),text:e.innerText.slice(-100),rect:e.getBoundingClientRect().toJSON()}))})`) }));
	throw new Error("file handoff did not finish closing the source window");
}
let failed = false;
try {
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
	await d.click(`[data-ly-row="${IDS[0]}"] > button`);
	await d.click('button[aria-label="面板"]');
	await d.until(`document.querySelector('[role="menuitem"]')`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim().startsWith('文件')).click()`);
	await d.until(`document.querySelector('[role="treeitem"][data-path$="alpha.ts"]')`);
	await d.click('[role="treeitem"][data-path$="alpha.ts"]');
	await d.until(`document.querySelector('.cm-content')?.textContent.includes('saved alpha')`);
	await edit(app, "\n// ALPHA_UNSAVED");
	await d.click('[role="treeitem"][data-path$="beta.ts"]');
	await d.until(`document.querySelector('.cm-content')?.textContent.includes('saved beta')`);
	await edit(app, "\n// BETA_UNSAVED");
	await hold();
	const before = await report(app);
	check("two real files are open with the active unsaved draft", before.tabs.length === 2 && before.text.includes("BETA_UNSAVED"), before);
	await d.click('[data-ly-pop-out="file"]');
	let win = await fileWindow();
	await hold(win, floating);
	const detached = await report(win);
	check("new window keeps both tabs and the active unsaved draft", detached.tabs.join() === before.tabs.join() && detached.text.includes("BETA_UNSAVED"), detached);
	await click(win, '[data-file-tab$="alpha.ts"] button');
	await hold(win, floating);
	const alpha = await report(win);
	check("inactive tab keeps its unsaved draft", alpha.text.includes("ALPHA_UNSAVED"), alpha);
	await edit(win, "\n// EDITED_IN_FLOATING");
	await hold(win, floating);
	await d.click('[role="treeitem"][data-path$="gamma.ts"]');
	await hold(win, floating);
	const requested = await report(win);
	check("opening another source file targets the existing floating editor", requested.tabs.length === 3 && requested.text.includes("saved gamma"), requested);
	await click(win, '[data-file-tab$="alpha.ts"] button');
	await hold(win, floating);
	check("a source open never overwrites the newer floating draft", (await report(win)).text.includes("EDITED_IN_FLOATING"), await report(win));
	await click(win, "[data-ly-restore-panel]");
	await returned(win);
	await hold();
	const restored = await report(app);
	check("return keeps the latest floating-window edit", restored.text.includes("ALPHA_UNSAVED") && restored.text.includes("EDITED_IN_FLOATING") && restored.tabs.length === 3, restored);
	await app.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 330, deviceScaleFactor: 1, mobile: false });
	win = await fileWindow();
	await hold(win, floating);
	const overflow = await report(win);
	check("insufficient space moves the editor without losing drafts", overflow.text.includes("EDITED_IN_FLOATING") && overflow.tabs.length === 3, overflow);
	const home = await app.evaluate<{ width: number; height: number }>(`document.querySelector('[data-dock-panes]').getBoundingClientRect().toJSON()`);
	const chatFloor = paneFloor("conversation"), fileFloor = paneFloor("file");
	assert.ok(home.width < chatFloor.width + fileFloor.width && home.height < chatFloor.height + fileFloor.height, "the fixture leaves neither axis enough space to return the file pane");
	await click(win, "[data-ly-restore-panel]");
	await pause(250);
	const restoreWindows = await app.windows();
	check("an undersized home keeps the floating editor open", restoreWindows.some(w => w.boot.id === win.boot.id), { home, windows: restoreWindows.map(w => w.boot) });
	await hold(win, floating);
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
	await hold();
	await click(win, "[data-ly-restore-panel]");
	await returned(win);
	await hold();
	check("expanding the home permits a lossless return", (await report(app)).text.includes("EDITED_IN_FLOATING"), await report(app));
	const disk = await Promise.all(["alpha.ts", "beta.ts"].map(name => readFile(join(app.home, "project", name), "utf8")));
	check("window movement never silently saves editor drafts", disk.every(text => !text.includes("UNSAVED") && !text.includes("FLOATING")), disk);
	await d.click('[data-ly-pop-out="file"]');
	win = await fileWindow();
	await hold(win, floating);
	await click(win, 'button:has(svg.lucide-save)');
	await hold(win, floating);
	const saved = await readFile(join(app.home, "project", "alpha.ts"), "utf8");
	check("explicit save in the floating editor writes the latest draft", saved.includes("EDITED_IN_FLOATING"), saved);
	await click(win, "[data-ly-restore-panel]");
	await returned(win);
	await hold();
	check("return after save displays the new disk baseline", (await report(app)).text.includes("EDITED_IN_FLOATING") && await app.evaluate(`!document.querySelector('[data-dock-pane="file"] button:has(svg.lucide-save)')`), await report(app));
	await d.click('[data-ly-pop-out="file"]');
	win = await fileWindow();
	await hold(win, floating);
	await click(win, '[data-file-tab$="beta.ts"] button');
	await hold(win, floating);
	await click(win, ".cm-content");
	await win.send("Input.insertText", { text: "LAST_EDIT_BEFORE_CLOSE" });
	await app.main(`(async()=>{for(const w of process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows()){const b=await w.webContents.executeJavaScript('window.lyra?.bootWindow');if(b?.kind==='panel'&&b.panelKind==='file'){w.close();break}}})()`);
	await windowClosed(win);
	await hold();
	await d.click('button[aria-label="面板"]');
	await d.until(`document.querySelector('[role="menuitem"]')`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim().startsWith('文件内容')).click()`);
	await d.until(`document.querySelector('[data-dock-pane="file"] .cm-content')?.textContent.includes('LAST_EDIT_BEFORE_CLOSE')`);
	await hold();
	check("native close hands the final keystroke back to its owner", (await report(app)).text.includes("BETA_UNSAVED"), await report(app));
} catch (error) { failed = true; console.error(error); }
finally {
	await stop();
	const directory = join(homedir(), "Desktop", "Lyra文件窗口交接测试");
	await mkdir(directory, { recursive: true });
	const base = join(directory, `${new Date().toISOString().replaceAll(":", "-")}_文件与未保存草稿_${checks.length}of13${failed ? "_failed" : ""}`);
	await writeFile(base + ".json", JSON.stringify({ checks, failed }, null, 2));
	await encode(frames, base + ".mp4", 30);
	if (floating.length) await encode(floating, base + "_独立窗口.mp4", 30);
	await app.stop();
	if (failed) process.exitCode = 1;
}
