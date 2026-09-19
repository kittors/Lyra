/* oxlint-disable no-console -- real-window evidence includes the measured assertion values */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";
import { seed, IDS } from "./split-dock-fixture.ts";

const port = 9817;
const output = join(homedir(), "Desktop", "Lyra分屏拖拽测试");
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const frames: Frame[] = [];
const app = await startApp({ port, inspectPort: 9818, seed });
const stopRecording = await startRecording(port, frames);
const d = driver(app);
const tile = `[data-ly-split-pane="${IDS[0]}"]`;
const panel = `${tile} [data-dock-pane="terminal"]`;
const grip = `${tile} [data-dock-grip="terminal"]`;
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};
type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
async function box(selector: string): Promise<Rect> {
	return app.evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
}
async function hold(ms = 900) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 80 });
		frames.push({ at: Date.now(), data: Buffer.from(shot.data, "base64") });
		await pause(100);
	}
}
async function mouse(type: string, p: Point, buttons: number) {
	await app.send("Input.dispatchMouseEvent", { type, ...p, buttons, button: "left", clickCount: 1 });
}
async function begin(selector: string) {
	const r = await box(selector);
	const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	await mouse("mouseMoved", p, 0);
	await mouse("mousePressed", p, 1);
	return p;
}
async function move(from: Point, to: Point) {
	for (let step = 1; step <= 12; step++) {
		await mouse("mouseMoved", { x: from.x + (to.x - from.x) * step / 12, y: from.y + (to.y - from.y) * step / 12 }, 1);
		await pause(30);
	}
}
async function retain() {
	return app.evaluate<{ connected: boolean; same: boolean; x: number; y: number; width: number; height: number; fixed: boolean; topLayer: boolean }>(`(() => {
		const el=document.querySelector(${JSON.stringify(panel)}); const r=el?.getBoundingClientRect();
		return {connected: Boolean(window.__carriedPanel?.isConnected), same: el===window.__carriedPanel,
			x:r?.x??0,y:r?.y??0,width:r?.width??0,height:r?.height??0,
			fixed:el?getComputedStyle(el).position==='fixed':false,topLayer:el?.matches(':popover-open')??false};
	})()`);
}

try {
	await d.until(`document.querySelector('[data-ly-row="${IDS[0]}"]')`);
	await d.click(`[data-ly-row="${IDS[0]}"] > button`);
	await d.until(`document.querySelector(${JSON.stringify(tile)})`);
	await hold();
	const from = await begin(`[data-ly-row="${IDS[1]}"] > button`);
	const root = await box("[data-ly-split-root]");
	const right = { x: root.x + root.width / 2, y: root.y + root.height - 30 };
	await move(from, right);
	await hold();
	await mouse("mouseReleased", right, 0);
	await d.until(`document.querySelector('[data-ly-split-root]')?.dataset.lySplitCount==='2'`);
	await hold();
	await d.click(`${tile} button[aria-label^="终端"]`);
	await d.until(`document.querySelector(${JSON.stringify(grip)})`);
	await hold();
	await app.evaluate(`window.__carriedPanel=document.querySelector(${JSON.stringify(panel)}); true`);
	const before = await box(panel);
	const normalShadow = await app.evaluate<string>(`getComputedStyle(document.querySelector(${JSON.stringify(panel + " .ly-dock-card")})).boxShadow`);
	const start = await begin(grip);
	const t = await box(tile);
	const centre = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
	await move(start, centre);
	await hold();
	const carried = await retain();
	check("two-pane drag retains its actual content in the centre dead zone", carried.same && carried.connected && carried.fixed, carried);
	const expected = { x: before.x + centre.x - start.x, y: before.y + centre.y - start.y };
	check("floating content follows viewport coordinates without the tile offset", Math.abs(carried.x - expected.x) < 2 && Math.abs(carried.y - expected.y) < 2, { expected, actual: carried });
	const carryStyle = await app.evaluate<{shadow:string;radius:number}>(`(()=>{const s=getComputedStyle(document.querySelector(${JSON.stringify(panel+" .ly-dock-card")}));return {shadow:s.boxShadow,radius:parseFloat(s.borderRadius)}})()`);
	check("the carried surface has rounded corners and its elevated shadow", carryStyle.radius>0 && carryStyle.shadow!==normalShadow && carryStyle.shadow!=="none", carryStyle);
	await d.key("Escape", 27);
	await mouse("mouseReleased", centre, 0);
	await hold();
	check("Escape restores the same terminal instance", (await retain()).same, await retain());
	const second = await begin(grip);
	const top = { x: t.x + t.width / 2, y: t.y + 35 };
	await move(second, top);
	await hold();
	await mouse("mouseReleased", top, 0);
	const landingFrames = await app.evaluate<Rect[]>(`new Promise(resolve=>{const samples=[];const start=performance.now();function sample(){const r=document.querySelector(${JSON.stringify(panel)}).getBoundingClientRect();samples.push({x:r.x,y:r.y,width:r.width,height:r.height});if(performance.now()-start<400)requestAnimationFrame(sample);else resolve(samples)}requestAnimationFrame(sample)})`);
	check("landing interpolates through intermediate visible geometry", new Set(landingFrames.map(r=>Math.round(r.width))).size>2 && (await retain()).same, { frames:landingFrames.length, distinctWidths:new Set(landingFrames.map(r=>Math.round(r.width))).size, first:landingFrames[0],last:landingFrames.at(-1) });
	await hold();
	const placed = await box(panel);
	check("terminal can land above the conversation", Math.abs(placed.y - t.y) < 4, { tile: t, panel: placed });
	check("a successful drop preserves the terminal instance", (await retain()).same, await retain());
	const keyboardBefore = await box(panel);
	await app.evaluate(`document.querySelector(${JSON.stringify(grip)}).focus()`);
	await d.key("ArrowRight", 39); await hold();
	check("an ordinary arrow previews its destination without changing geometry", await app.evaluate(`Boolean(document.querySelector('[data-dock-keyboard-drop="right"]'))`) && JSON.stringify(await box(panel))===JSON.stringify(keyboardBefore), await box(panel));
	await d.key("Escape", 27); await hold();
	check("Escape removes the keyboard preview", await app.evaluate(`!document.querySelector('[data-dock-keyboard-drop]')`) && JSON.stringify(await box(panel))===JSON.stringify(keyboardBefore), await box(panel));
	await d.key("ArrowRight", 39); await hold(); await d.key("Enter", 13); await hold();
	check("Enter commits an even two-pane keyboard split", Math.abs((await box(panel)).width-t.width/2)<2 && (await retain()).same, await box(panel));
	const seam = `${tile} [role="separator"][aria-orientation="vertical"]`;
	const seamStart = await begin(seam);
	const seamEnd = { x: t.x+t.width*0.4, y: seamStart.y };
	await move(seamStart, seamEnd); await mouse("mouseReleased", seamEnd, 0); await hold();
	check("a divider drag changes the two pane widths", Math.abs((await box(panel)).width-t.width*0.6)<4, { tile:t,panel:await box(panel) });
	const beforeArrow = await box(panel);
	await app.evaluate(`document.querySelector(${JSON.stringify(grip)}).focus()`);
	await d.key("ArrowLeft", 37); await hold();
	const afterArrow = await box(panel);
	check("a parallel arrow immediately swaps panes with their widths intact", Math.abs(afterArrow.x-t.x)<2 && Math.abs(afterArrow.width-beforeArrow.width)<2 && await app.evaluate(`!document.querySelector('[data-dock-keyboard-drop]')`) && (await retain()).same, { before:beforeArrow,after:afterArrow });
	await d.key("ArrowRight", 39); await hold();
	check("the opposite arrow restores the exact prior geometry", JSON.stringify(await box(panel))===JSON.stringify(beforeArrow) && (await retain()).same, await box(panel));
	const seamBox = await box(seam);
	for (const clickCount of [1, 2]) for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, x:seamBox.x+seamBox.width/2,y:seamBox.y+seamBox.height/2, button:"left",clickCount });
	await hold();
	check("double-clicking the divider restores equal shares", Math.abs((await box(panel)).width-t.width/2)<2, await box(panel));
	await app.main(`process._linkedBinding('electron_browser_app').app.focus({steal:true}); process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/screenshot-overlay')).focus()`);
	await d.until("document.hasFocus()");
	await app.evaluate("window.__blurEvents=0;window.addEventListener('blur',()=>window.__blurEvents++); true");
	const blurBefore = await box(panel);
	const blurFrom = await begin(grip);
	await move(blurFrom, centre); await hold();
	await app.main(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/screenshot-overlay')).blur()`);
	await hold(); await mouse("mouseReleased", centre, 0);
	check("window blur cancels a carry and restores its exact position", JSON.stringify(await box(panel))===JSON.stringify(blurBefore) && !(await retain()).topLayer, {box:await box(panel),events:await app.evaluate("window.__blurEvents"),windows:await app.main("process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().map(w=>({id:w.id,title:w.getTitle(),focused:w.isFocused(),visible:w.isVisible(),url:w.webContents.getURL()}))")});
	await app.main(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/screenshot-overlay')).focus()`);
	const resizedFrom = await begin(grip);
	await move(resizedFrom, centre); await hold();
	await app.main(`(()=>{const w=process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/screenshot-overlay'));const b=w.getBounds();w.setSize(b.width+60,b.height)})()`);
	await hold(); await mouse("mouseReleased", centre, 0);
	check("resizing the native window cancels the carry without retaining an overlay", !(await retain()).topLayer && !(await retain()).fixed && (await retain()).same, await retain());
	await app.main(`(()=>{const w=process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/screenshot-overlay'));const b=w.getBounds();w.setSize(b.width-60,b.height)})()`);
	await hold();
	await app.evaluate(`document.querySelector(${JSON.stringify(grip)}).focus()`);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, modifiers: 1 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, modifiers: 1 });
	await hold();
	check("Alt+Down moves a panel without pointer dragging", (await box(panel)).y > t.y + 100, await box(panel));
	const expanded = await app.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(panel + ' button[aria-label^="全屏"]')}))`);
	check("each split panel has a local expand control", expanded, { expanded });
	if (expanded) {
		const beforeExpand = await box(panel);
		await d.click(panel + ' button[aria-label^="全屏"]');
		await hold();
		const full = await box(panel);
		check("expanded panel fills only its owning tile", Math.abs(full.width-t.width)<2 && Math.abs(full.height-t.height)<2, {full,tile:t});
		check("expansion keeps the terminal instance", (await retain()).same, await retain());
		check("local expansion hides its move grip, matching the reference", await app.evaluate(`!document.querySelector(${JSON.stringify(grip)})`), { expanded: true });
		await d.key("Escape", 27);
		await hold();
		check("Escape restores the saved panel geometry", Math.abs((await box(panel)).height-beforeExpand.height)<2 && Math.abs((await box(panel)).y-beforeExpand.y)<2, {before:beforeExpand,after:await box(panel)});
	}
	await app.main(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/screenshot-overlay')).setFullScreen(true)`);
	await hold(1600);
	const nativeFullscreen = await app.main<boolean>(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/screenshot-overlay')).isFullScreen()`);
	check("the visible workspace enters native fullscreen", nativeFullscreen, { nativeFullscreen, tile:await box(tile) });
	const fullStart = await begin(grip);
	const fullTile = await box(tile);
	const fullTop = { x: fullTile.x + fullTile.width / 2, y: fullTile.y + 35 };
	await move(fullStart, fullTop);
	await hold();
	check("native fullscreen carries the real terminal above clipping ancestors", (await retain()).same && (await retain()).topLayer, await retain());
	await mouse("mouseReleased", fullTop, 0);
	await hold();
	await app.main(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/screenshot-overlay')).setFullScreen(false)`);
	await hold(1400);
} catch (error) {
	check("scenario completed", false, String(error));
} finally {
	await stopRecording();
	await app.stop();
	await mkdir(output, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const name = `${stamp}_分屏拖拽_${checks.filter(c=>c.ok).length}of${checks.length}`;
	await writeFile(join(output, name + ".json"), JSON.stringify(checks, null, 2));
	if (frames.length) await encode(frames, join(output, name + ".mp4"), 30);
	console.log(join(output, name + ".mp4"));
	if (checks.some(c=>!c.ok)) process.exitCode=1;
}
