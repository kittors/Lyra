/* oxlint-disable no-console -- measured evidence accompanies the real-window recording */
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, closeListeningServer, type AppWindow } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";
import { seed, IDS } from "./split-dock-fixture.ts";

const server = createServer((request, response) => {
	response.setHeader("content-type", "text/html; charset=utf-8");
	response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>分屏表单 ${request.url === "/b" ? "B" : "A"}</title><body><h1>浏览器测试 ${request.url === "/b" ? "B" : "A"}</h1><p>本地测试数据，用于验证拖动时页面不重载。</p><label>保留输入 <input id="draft" value="页面草稿"></label><p><a id="next" href="/after">验证独立窗口内导航</a></p><p style="height:1200px">滚动区域</p></body></html>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture server did not bind");
const site = `http://127.0.0.1:${address.port}`;
const port = 9827;
const app = await startApp({ port, inspectPort: 9828, seed });
const d = driver(app);
// Exercise four readable columns on a simulated ultrawide viewport; native-size limits have a separate recording.
await app.send("Emulation.setDeviceMetricsOverride", { width: 3200, height: 1400, deviceScaleFactor: 1, mobile: false });
const frames: Frame[] = [];
const extraFrames: Frame[] = [];
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const stop = await startRecording(port, frames);
const tile = (id: string) => `[data-ly-split-pane="${id}"]`;
const pane = (id: string, kind: string) => `${tile(id)} [data-dock-pane="${kind}"]`;
const check = (name: string, ok: boolean, measured: unknown) => { checks.push({ name, ok, measured }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`); };
type Rect = { x: number; y: number; width: number; height: number };
const box = (selector: string) => app.evaluate<Rect>(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('missing: '+${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
async function hold(ms = 900, win: Pick<AppWindow, "send"> = app, into = frames) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const shot = await win.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 85 });
		into.push({ at: Date.now(), data: Buffer.from(shot.data, "base64") });
		await pause(100);
	}
}
async function clickText(label: string) {
	const match = `b.getAttribute('role')==='menuitem' && b.textContent.trim().startsWith(${JSON.stringify(label)}) && !b.disabled`;
	await d.until(`[...document.querySelectorAll('button')].some(b=>${match})`, 15000);
	await app.evaluate(`(()=>{document.querySelector('[data-demo-menu]')?.removeAttribute('data-demo-menu');[...document.querySelectorAll('button')].find(b=>${match}).setAttribute('data-demo-menu','')})()`);
	await d.click("[data-demo-menu]");
	await hold();
}
async function sessionMenu(id: string) {
	const r = await box(`[data-ly-row="${id}"]`);
	for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, x: r.x + 60, y: r.y + r.height / 2, button: "right", clickCount: 1 });
	await hold();
}
async function split(id: string) {
	await sessionMenu(id); await clickText("打开方式"); await clickText("分屏");
}
async function tools(id: string, label: string) {
	await d.click(`${tile(id)} [data-ly-split-chrome] button[aria-label="面板"]`);
	await clickText(label);
}
async function navigate(id: string, path: string) {
	await tools(id, "浏览器");
	await d.click(`${tile(id)} [data-browser-omnibox] input`);
	await app.send("Input.insertText", { text: site + path });
	await d.key("Enter", 13);
	await hold(1800);
}
async function browserReport() {
	return app.evaluate<{ id: string; pages: { url: string; visible: boolean; guest: number }[] }[]>(`[...document.querySelectorAll('[data-ly-split-pane]')].map(tile=>({id:tile.dataset.lySplitPane,pages:[...tile.querySelectorAll('webview')].map(p=>({url:p.getURL(),visible:p.checkVisibility({visibilityProperty:true,opacityProperty:true}),guest:p.getWebContentsId()}))}))`);
}
async function auxiliary(kind: string) {
	for (let attempt = 0; attempt < 40; attempt++) {
		const win = (await app.windows()).find((entry) => entry.boot.kind === kind);
		if (win && await win.evaluate(`Boolean(document.querySelector('[data-ly-keep-on-top]'))`)) return win;
		await pause(250);
	}
	throw new Error(`no painted ${kind} window`);
}
async function clickAux(win: AppWindow, selector: string) {
	const r = await win.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await win.send("Input.dispatchMouseEvent", { type, ...r, button: "left", clickCount: 1 });
}

async function drag(selector: string, destination: { x: number; y: number }, cancel = false) {
	const r = await box(selector);
	const from = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 });
	for (let step = 1; step <= 16; step++) {
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (destination.x-from.x)*step/16, y: from.y+(destination.y-from.y)*step/16, button: "left", buttons: 1 });
		await pause(25);
	}
	await hold();
	const carried = await app.evaluate<{ floating: number; clipped: boolean }>("({floating:document.querySelectorAll('[data-dock-pane]:popover-open').length,clipped:[...document.querySelectorAll('[data-dock-pane]:popover-open')].some(el=>getComputedStyle(el).position!=='fixed')})");
	if (cancel) await d.key("Escape", 27);
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...destination, button: "left", buttons: 0, clickCount: 1 });
	await hold();
	return carried;
}

async function pageState() {
	return app.evaluate<{ guest: number; origin: number; draft: string }>(`(async()=>{const p=document.querySelector(${JSON.stringify(pane(IDS[0], "browser") + " webview")});return {guest:p.getWebContentsId(),...await p.executeJavaScript("({origin:performance.timeOrigin,draft:document.querySelector('#draft').value})")}})()`);
}

try {
	await d.until(`document.querySelector('[data-ly-row="${IDS[0]}"]')`, 25000);
	await d.click(`[data-ly-row="${IDS[0]}"] > button`);
	await hold();
	// Exercise layouts saved before tools gained per-conversation docks.
	await app.evaluate(`localStorage.setItem('dw:dock:${IDS[0]}',JSON.stringify({v:1,tree:{type:'split',dir:'row',children:[{type:'leaf',kind:'conversation'},{type:'leaf',kind:'browser'}],sizes:[0.6,0.4]}})); true`);
	await app.send("Page.reload");
	const windowBrowser = '[data-dock-panes] > [data-dock-pane="browser"]';
	await d.until(`document.querySelector(${JSON.stringify(windowBrowser + ' [data-browser-omnibox] input')})`, 25000);
	await d.click(windowBrowser + ' [data-browser-omnibox] input');
	await app.send("Input.insertText", { text: site + "/a" });
	await d.key("Enter", 13); await hold(1600);
	await d.click(windowBrowser + ' [data-ly-pop-out]');
	const legacyWindow = await auxiliary("panel");
	await hold(1600, legacyWindow, extraFrames);
	const legacyGuests = await app.evaluate<number>("document.querySelectorAll('webview').length");
	check("a window-level browser releases its guest before opening a new window", legacyGuests === 0, { mainGuests: legacyGuests });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 250, deviceScaleFactor: 1, mobile: false });
	await hold();
	await clickAux(legacyWindow, '[data-ly-restore-panel]'); await hold();
	const refused = { windowOpen: (await app.windows()).some(win => win.boot.id === legacyWindow.boot.id), visibleInDock: await app.evaluate(`Boolean(document.querySelector(${JSON.stringify(windowBrowser)})?.checkVisibility({opacityProperty:true,visibilityProperty:true}))`), viewport: await app.evaluate("({width:innerWidth,height:innerHeight})") };
	check("a window-level browser refuses to return when neither axis fits", refused.windowOpen && !refused.visibleInDock, refused);
	await app.send("Emulation.setDeviceMetricsOverride", { width: 3200, height: 1400, deviceScaleFactor: 1, mobile: false });
	await hold();
	await clickAux(legacyWindow, '[data-ly-restore-panel]'); await hold(1600);
	check("a window-level browser returns to its original dock", await app.evaluate(`document.querySelector(${JSON.stringify(windowBrowser)})?.checkVisibility({visibilityProperty:true})`) && !(await app.windows()).some((win) => win.boot.kind === "panel"), { windows: (await app.windows()).map((win) => win.boot.kind) });
	await d.click(windowBrowser + ' button[aria-label="关闭浏览器"]'); await hold();
	await app.evaluate(`window.__originalComposer=document.querySelector(${JSON.stringify(tile(IDS[0]) + " textarea")}); true`);
	await split(IDS[1]);
	check("adding a split retains the original composer", await app.evaluate(`window.__originalComposer===document.querySelector(${JSON.stringify(tile(IDS[0]) + " textarea")})`), { count: 2 });
	await navigate(IDS[0], "/a");
	await navigate(IDS[1], "/b");
	const report = await browserReport();
	check("two conversations display only their own browser pages", IDS.slice(0, 2).every((id, i) => {
		const pages = report.find((entry) => entry.id === id)?.pages;
		return pages?.length === 1 && pages[0].visible && pages[0].url === site + (i ? "/b" : "/a");
	}), report);
	const allGuestTabs = await app.evaluate<string[]>("[...document.querySelectorAll('webview')].map(page=>page.dataset.browserPage)");
	check("hidden window browser caches never duplicate scoped guests", new Set(allGuestTabs).size===allGuestTabs.length, allGuestTabs);
	const initialGuests = report.flatMap((entry) => entry.pages.map((page) => page.guest)).sort();
	await tools(IDS[0], "终端");
	await hold(1700);
	const activeTerminal = (id: string) => app.evaluate<string | null>(`document.querySelector(${JSON.stringify(pane(id, "terminal") + " [data-tab].bg-card-hover")})?.dataset.tab??null`);
	const firstTerminal = await activeTerminal(IDS[0]);
	await tools(IDS[1], "终端");
	await hold(1700);
	const secondTerminal = await activeTerminal(IDS[1]);
	check("terminal focus belongs to its conversation", Boolean(firstTerminal && secondTerminal && firstTerminal !== secondTerminal && await activeTerminal(IDS[0]) === firstTerminal), { firstTerminal, secondTerminal, after: await activeTerminal(IDS[0]) });
	await split(IDS[2]);
	const columns = await Promise.all(IDS.slice(0, 3).map((id) => box(tile(id))));
	check("the third menu split is a full-height equal column", columns.every((r) => Math.abs(r.height-columns[0].height)<2 && Math.abs(r.width-columns[0].width)<2), columns);
	await split(IDS[3]);
	const four = await Promise.all(IDS.map((id) => box(tile(id))));
	check("four menu splits stay in four equal columns", four.every((r) => Math.abs(r.width-four[0].width)<2 && Math.abs(r.height-four[0].height)<2), four);
	await d.click(`${tile(IDS[3])} [data-ly-split-close]`); await hold();
	await sessionMenu(IDS[2]); await clickText("将分屏移到左下方");
	const stacked = await box(tile(IDS[2]));
	check("a conversation moves below the preceding column", stacked.y > 100 && stacked.x > columns[0].x, stacked);
	await sessionMenu(IDS[2]); await clickText("向左移动分屏");
	await hold();
	const crossed = await box(tile(IDS[2]));
	check("a stacked conversation crosses into the adjacent column", Math.abs(crossed.x-columns[0].x)<2 && crossed.y>100, crossed);
	await sessionMenu(IDS[2]); await clickText("将分屏移到新列");
	check("new column appends on the right", (await box(tile(IDS[2]))).x > (await box(tile(IDS[1]))).x, await box(tile(IDS[2])));
	const movedGuests = (await browserReport()).flatMap((entry) => entry.pages.map((page) => page.guest)).sort();
	check("adding, moving, and closing neighboring splits keeps the real browser guests", JSON.stringify(initialGuests)===JSON.stringify(movedGuests), { initialGuests, movedGuests });
	await d.click(`${tile(IDS[2])} [data-ly-split-close]`);
	await tools(IDS[0], "文件");
	await tools(IDS[0], "Git");
	const dense = await app.evaluate<Rect[]>(`[...document.querySelectorAll(${JSON.stringify(tile(IDS[0]) + " [data-ly-pane-dock] [data-dock-pane]")})].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})`);
	check("five real panes stay inside their tile with no overlap", dense.length === 5 && dense.every((a, i) => dense.every((b, j) => i===j || a.x+a.width<=b.x+1 || b.x+b.width<=a.x+1 || a.y+a.height<=b.y+1 || b.y+b.height<=a.y+1)), dense);
	await app.evaluate(`document.querySelector(${JSON.stringify(pane(IDS[0], "browser") + " webview")}).executeJavaScript("document.querySelector('#draft').value='拖动后仍在的草稿'; true")`);
	const originalPage = await pageState();
	const beforeArrow = await box(pane(IDS[0], "browser"));
	await app.evaluate(`document.querySelector(${JSON.stringify(tile(IDS[0]) + ' [data-dock-grip="browser"]')}).focus()`);
	await d.key("ArrowDown", 40); await hold();
	const afterArrow = await box(pane(IDS[0], "browser"));
	check("a parallel arrow moves the browser immediately without reloading its live page", afterArrow.y>beforeArrow.y+100 && Math.abs(afterArrow.height-beforeArrow.height)<2 && JSON.stringify(await pageState())===JSON.stringify(originalPage) && await app.evaluate(`!document.querySelector('[data-dock-keyboard-drop]')`), { before:beforeArrow,after:afterArrow,page:await pageState() });
	await d.key("ArrowUp", 38); await hold();
	const area = await box(tile(IDS[0]));
	await drag(`${tile(IDS[0])} [data-dock-grip="browser"]`, { x: area.x + area.width / 2, y: area.y + 22 });
	const afterDrag = await pageState();
	check("dragging a browser preserves its guest, JavaScript page, and form input", JSON.stringify(afterDrag)===JSON.stringify(originalPage), { before: originalPage, after: afterDrag });
	await drag(`${tile(IDS[0])} [data-dock-grip="conversation"]`, { x: area.x + area.width - 20, y: area.y + area.height / 2 });
	check("the conversation itself is draggable without reloading its browser", JSON.stringify(await pageState())===JSON.stringify(originalPage), await pageState());
	await drag(`${tile(IDS[0])} [data-dock-grip="browser"]`, { x: area.x + area.width / 2, y: area.y + area.height / 2 }, true);
	check("cancelling a browser carry restores the same live page", JSON.stringify(await pageState())===JSON.stringify(originalPage), await pageState());
	await app.evaluate(`window.__savedBrowser=document.querySelector(${JSON.stringify(pane(IDS[0], "browser") + " webview")}); window.__savedTerminal=document.querySelector(${JSON.stringify(pane(IDS[0], "terminal") + " .xterm-screen")}); true`);
	await sessionMenu(IDS[0]); await clickText("向右移动分屏");
	const retained = await app.evaluate<{ browser: boolean; terminal: boolean }>(`({browser:window.__savedBrowser===document.querySelector(${JSON.stringify(pane(IDS[0], "browser") + " webview")}),terminal:window.__savedTerminal===document.querySelector(${JSON.stringify(pane(IDS[0], "terminal") + " .xterm-screen")})})`);
	check("moving a whole conversation retains its browser and terminal DOM", retained.browser && retained.terminal, retained);
	check("moving a whole conversation preserves the browser execution context", JSON.stringify(await pageState())===JSON.stringify(originalPage), await pageState());
	const home = await box(pane(IDS[0], "browser"));
	await d.click(`${pane(IDS[0], "browser")} [data-ly-pop-out]`);
	const detached = await auxiliary("panel");
	await hold(1200, detached, extraFrames);
	check("browser opens in a dedicated window with its address bar", await detached.evaluate(`Boolean(document.querySelector('[data-ly-panel-window="browser"] [data-browser-omnibox]'))`), detached.boot);
	await clickAux(detached, "[data-ly-keep-on-top]");
	await hold(1100, detached, extraFrames);
	const pinned = await detached.evaluate<{ enabled: boolean }>("window.lyra.windows.keepOnTop()");
	check("pin controls the native detached window", pinned.enabled, pinned);
	await clickAux(detached, "[data-ly-keep-on-top]");
	await hold(900, detached, extraFrames);
	check("unpin releases the detached window", !(await detached.evaluate<{ enabled: boolean }>("window.lyra.windows.keepOnTop()")).enabled, { enabled: false });
	await app.main(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.webContents.id===1).focus()`);
	const backgroundState = await detached.evaluate<{ tabs: unknown[] }>("window.lyra.browser.state()");
	check("a detached browser can initialize and synchronize without keyboard focus", backgroundState.tabs.length>=2, { tabs: backgroundState.tabs.length });
	await detached.evaluate(`document.querySelector('webview').executeJavaScript("document.querySelector('#next').click(); true")`);
	await hold(1700, detached, extraFrames);
	const navigated = await detached.evaluate<string>("document.querySelector('[data-browser-omnibox] input').value");
	check("navigation in a detached browser updates its own address bar", navigated.includes("/after"), { address: navigated });
	await clickAux(detached, 'button[aria-label="浏览器菜单"]');
	await detached.evaluate(`(()=>{[...document.querySelectorAll('button[role="menuitem"]')].find(b=>b.textContent.trim()==='关闭标签页').setAttribute('data-demo-close-tab','')})()`);
	await clickAux(detached, '[data-demo-close-tab]'); await hold(900,detached,extraFrames);
	await clickAux(detached, '[data-browser-omnibox] input');
	await detached.send("Input.insertText", { text:site+"/after" });
	for (const type of ["keyDown","keyUp"]) await detached.send("Input.dispatchKeyEvent", { type,key:"Enter",code:"Enter",windowsVirtualKeyCode:13 });
	await hold(1500,detached,extraFrames);
	const firstDetachedPage = await detached.evaluate<string | null>("document.querySelector('webview')?.getURL()??null");
	check("an empty detached browser can open its first page", firstDetachedPage===site+"/after", { url:firstDetachedPage });
	await clickAux(detached, "[data-ly-restore-panel]");
	await d.until(`document.querySelector(${JSON.stringify(pane(IDS[0], "browser"))})`, 15000);
	await hold(1400);
	check("returning a browser restores its owning conversation", !(await app.windows()).some((win) => win.boot.kind === "panel"), await browserReport());
	const back = await box(pane(IDS[0], "browser"));
	check("a returned browser recovers its previous placement and size", (["x", "y", "width", "height"] as const).every((key) => Math.abs(home[key]-back[key])<2), { home, back });
	const terminalBefore = await app.evaluate<string>(`document.querySelector(${JSON.stringify(pane(IDS[0], "terminal") + " [data-terminal-id]")}).dataset.terminalId`);
	await d.click(`${pane(IDS[0], "terminal")} [data-ly-pop-out]`);
	const shellWindow = await auxiliary("panel");
	await hold(1600, shellWindow, extraFrames);
	const terminalDetached = await shellWindow.evaluate<string>("document.querySelector('[data-terminal-id]').dataset.terminalId");
	check("a detached terminal keeps its shell and tab controls", terminalDetached===terminalBefore && await shellWindow.evaluate(`Boolean(document.querySelector('button[aria-label="新建终端"]'))`), { terminalBefore, terminalDetached });
	await app.main(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.webContents.id===1).focus()`);
	const streamCommand = "for i in 1 2 3 4 5; do printf 'WINDOW_STREAM_%s\\n' \"$i\"; sleep 0.2; done\r";
	await shellWindow.evaluate(`window.lyra.terminal.write(${JSON.stringify(terminalBefore)}, ${JSON.stringify(streamCommand)})`);
	await hold(2300, shellWindow, extraFrames);
	const backgroundText = await shellWindow.evaluate<string>("document.querySelector('.xterm-rows')?.textContent??''");
	check("a detached terminal continues painting output while the main window has focus", backgroundText.includes("WINDOW_STREAM_1")&&backgroundText.includes("WINDOW_STREAM_5"), { text:backgroundText });

	await clickAux(shellWindow, "[data-ly-restore-panel]");
	await hold(1800);
	check("a returned terminal reconnects to the same shell", await app.evaluate(`document.querySelector(${JSON.stringify(pane(IDS[0], "terminal") + " [data-terminal-id]")})?.dataset.terminalId===${JSON.stringify(terminalBefore)}`), { terminalBefore });
	await d.click(`${pane(IDS[1], "terminal")} [data-tab="${terminalBefore}"]`); await hold();
	const shared = await app.evaluate(`document.querySelector(${JSON.stringify(pane(IDS[1], "terminal") + " [data-terminal-id]")})?.dataset.terminalId===${JSON.stringify(terminalBefore)}`);
	await d.click(`${pane(IDS[1], "terminal")} button[aria-label="关闭终端"]`); await hold();
	await app.evaluate(`window.lyra.terminal.write(${JSON.stringify(terminalBefore)}, ${JSON.stringify("printf 'SHARED_VIEW_OK\\n'\r")})`);
	await hold();
	const sharedText = await app.evaluate<string[]>(`[...document.querySelectorAll(${JSON.stringify(pane(IDS[0], "terminal") + " .xterm-rows > div")})].map(row=>row.textContent.trim())`);
	check("closing one of two views of a shell leaves the other view receiving output", Boolean(shared)&&sharedText.includes("SHARED_VIEW_OK"), { shared,text:sharedText });
	await sessionMenu(IDS[0]); await clickText("打开方式"); await clickText("新窗口");
	const conversation = await auxiliary("session");
	await hold(1500, conversation, extraFrames);
	check("new window contains the selected conversation and return control", await conversation.evaluate(`Boolean(document.querySelector('[data-ly-session-window] textarea')&&document.querySelector('[data-ly-open-in-main]'))`), conversation.boot);
	await clickAux(conversation, "[data-ly-open-in-main]");
	await hold(1500);
	check("conversation returns without losing the main split layout", !(await app.windows()).some((win) => win.boot.kind === "session") && await app.evaluate(`document.querySelector('[data-ly-split-root]').dataset.lySplitCount==='2'`), { count: await app.evaluate(`document.querySelector('[data-ly-split-root]').dataset.lySplitCount`) });
	const beforeReload = await Promise.all(IDS.slice(0, 2).map((id) => box(tile(id))));
	const browserBeforeReload = await box(pane(IDS[0], "browser"));
	await app.send("Page.reload");
	await d.until(`${JSON.stringify(IDS.slice(0, 2))}.every(id=>document.querySelector('[data-ly-split-pane="'+id+'"]')) && document.querySelector(${JSON.stringify(pane(IDS[0], "browser"))}) && document.querySelector('[data-ly-split-root]')?.dataset.lySplitCount==='2'`, 25000);
	await hold(1800);
	const afterReload = await Promise.all(IDS.slice(0, 2).map((id) => box(tile(id))));
	check("reloading restores both conversation columns and the nested browser geometry", JSON.stringify(beforeReload)===JSON.stringify(afterReload) && JSON.stringify(browserBeforeReload)===JSON.stringify(await box(pane(IDS[0], "browser"))), { before: beforeReload, after: afterReload, browser: await box(pane(IDS[0], "browser")) });
	// Native fullscreen uses the physical viewport, after the ultrawide layout assertions finish.
	for (const [kind, label] of [["files", "文件"], ["review", "Git"], ["terminal", "终端"]]) {
		await d.click(`${pane(IDS[0], kind)} button[aria-label="关闭${label}"]`); await hold();
	}
	await d.click(`${tile(IDS[1])} [data-ly-split-close]`); await hold();
	await app.send("Emulation.clearDeviceMetricsOverride");
	await hold();
	const fullscreenPage = await pageState();
	await app.main(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/screenshot-overlay')).setFullScreen(true)`);
	await hold(1600);
	const nativeFullscreen = await app.main<boolean>(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/screenshot-overlay')).isFullScreen()`);
	const fullscreenTile = await box(tile(IDS[0]));
	const fullscreenCarry = await drag(`${tile(IDS[0])} [data-dock-grip="browser"]`, { x: fullscreenTile.x+25, y: fullscreenTile.y+fullscreenTile.height/2 });
	check("native fullscreen browser dragging keeps its page in the top layer", nativeFullscreen && fullscreenCarry.floating===1 && !fullscreenCarry.clipped && JSON.stringify(await pageState())===JSON.stringify(fullscreenPage), { nativeFullscreen, ...fullscreenCarry, page: await pageState() });
	await app.main(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.isVisible()&&!w.webContents.getURL().includes('#/screenshot-overlay')).setFullScreen(false)`);
	await hold(1500);
} catch (error) {
	check("scenario completed", false, String(error));
} finally {
	await stop();
	await app.stop();
	await closeListeningServer(server);
	const output = join(homedir(), "Desktop", "Lyra分屏拖拽测试");
	await mkdir(output, { recursive: true });
	const name = `${new Date().toISOString().replace(/[:.]/g, "-")}_分屏与独立窗口_${checks.filter((c) => c.ok).length}of${checks.length}`;
	await writeFile(join(output, name + ".json"), JSON.stringify(checks, null, 2));
	if (frames.length) await encode(frames, join(output, name + ".mp4"), 30);
	if (extraFrames.length) await encode(extraFrames, join(output, name + "_独立窗口.mp4"), 30, 1500);
	console.log(join(output, name + ".mp4"));
	if (checks.some((c) => !c.ok)) process.exitCode = 1;
}
