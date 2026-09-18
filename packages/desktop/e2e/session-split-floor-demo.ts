/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 分屏地板、窗口停靠、格内停靠：窗口里已打开的终端仍在格子外可拖；从某一格打开的面板只留在那一格。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/session-split-floor-demo.ts`
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { evaluateRenderer, startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";
import { SCREEN_MIN_HEIGHT_PX, SCREEN_MIN_WIDTH_PX } from "../src/features/split/geometry.ts";
import { PANEL_MIN_WIDTH_PX } from "../src/features/dock/geometry.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra分屏地板测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9793;
const IDS = ["floor-a", "floor-b", "floor-c", "floor-d", "floor-e"] as const;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

async function seed(home: string): Promise<void> {
	const cwd = join(home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# floor\n");
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const metas = [];
	for (const [index, id] of IDS.entries()) {
		const messages = [
			{ role: "user", content: [{ type: "text", text: `会话 ${id} 用来验证分屏地板` }], timestamp: index * 10 },
			{ role: "assistant", content: [{ type: "text", text: `${id} 的回复。` }], api: "anthropic-messages", provider: "qa", model: "qa", usage, stopReason: "stop", timestamp: index * 10 + 1 },
		];
		const meta = {
			id,
			title: `地板 ${id.slice(-1).toUpperCase()}`,
			projectId,
			projectName: "分屏地板",
			cwd,
			createdAt: 1 + index,
			updatedAt: 100 - index,
			modelId: "qa/model",
			messageCount: messages.length,
			usage,
			seq: 3,
		};
		metas.push(meta);
		await writeFile(
			join(home, "sessions", projectId, `${id}.jsonl`),
			[
				JSON.stringify({ type: "meta", meta, seq: 0, ts: 1 }),
				...messages.map((message, i) => JSON.stringify({ type: "message", message, seq: i + 1, ts: 1 })),
				JSON.stringify({ type: "meta", meta, seq: 3, ts: 2 }),
			].join("\n") + "\n",
		);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: projectId, path: cwd, name: "分屏地板", pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4588, token: null },
			uiLocale: "zh-CN",
			appearance: { theme: "dark" },
		}),
	);
}

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

try {
	app = await startApp({ port: PORT, seed });
	const page = app;
	stopRecording = await startRecording(PORT, frames);
	await page.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 30_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await page.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function hold(ms = 800) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await page.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 78 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(180, Math.max(0, end - Date.now())));
		}
	}
	async function center(selector: string): Promise<{ x: number; y: number }> {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		return page.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	}
	async function click(selector: string) {
		const at = await center(selector);
		await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at, buttons: 0 });
		await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, buttons: 1, ...at });
		await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, buttons: 0, ...at });
	}
	async function pointOn(selector: string, where: "center" | "left" | "right" | "top" | "bottom"): Promise<{ x: number; y: number }> {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		return page.evaluate<{ x: number; y: number }>(`(()=>{
			const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
			const inset=28;
			if(${JSON.stringify(where)}==='left') return {x:r.x+inset,y:r.y+r.height/2};
			if(${JSON.stringify(where)}==='right') return {x:r.x+r.width-inset,y:r.y+r.height/2};
			if(${JSON.stringify(where)}==='top') return {x:r.x+r.width/2,y:r.y+inset};
			if(${JSON.stringify(where)}==='bottom') return {x:r.x+r.width/2,y:r.y+r.height-inset};
			return {x:r.x+r.width/2,y:r.y+r.height/2};
		})()`);
	}
	async function slide(from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, button: "left", buttons: 1 });
			await pause(20);
		}
	}
	async function dragTo(from: string, to: { x: number; y: number }) {
		const a = await center(from);
		await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...a, buttons: 0 });
		await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, buttons: 1, ...a });
		await slide(a, to);
		return to;
	}
	async function drop(at: { x: number; y: number }) {
		await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, buttons: 0, ...at });
	}
	async function overlay() {
		return page.evaluate<{ kind: string | null; side: string | null }>(`(()=>{
			const el=document.querySelector('[data-ly-split-overlay]');
			return {kind:el?.getAttribute('data-ly-split-overlay')||null,side:el?.getAttribute('data-ly-split-side')||null};
		})()`);
	}
	async function floors() {
		return page.evaluate<{
			count: number;
			minW: number;
			minH: number;
			terminal: { w: number; h: number; top: number } | null;
			terminalNested: number;
			browserInPane: number;
			windowBrowser: number;
			convMinW: number;
			convMinH: number;
		}>(`(()=>{
			const panes=[...document.querySelectorAll('[data-ly-split-pane]')].map(el=>{
				const r=el.getBoundingClientRect();
				return {w:r.width,h:r.height};
			});
			const term=document.querySelector('[data-dock-pane="terminal"]');
			const tr=term?.checkVisibility()?term.getBoundingClientRect():null;
			const slots=[...document.querySelectorAll('[data-ly-pane-slot="conversation"]')].map((el)=>{
				const r=el.getBoundingClientRect();
				return {w:r.width,h:r.height};
			});
			return {
				count:panes.length,
				minW:Math.round(Math.min(...panes.map(p=>p.w))),
				minH:Math.round(Math.min(...panes.map(p=>p.h))),
				terminal:tr?{w:Math.round(tr.width),h:Math.round(tr.height),top:Math.round(tr.top)}:null,
				terminalNested:[...document.querySelectorAll('[data-ly-split-pane] [data-dock-pane="terminal"]')].filter(el=>el.checkVisibility()).length,
				browserInPane:[...document.querySelectorAll('[data-ly-split-pane] [data-dock-pane="browser"]')].filter(el=>el.checkVisibility()).length,
				windowBrowser:[...document.querySelectorAll('[data-dock-pane="browser"]')].filter(el=>el.checkVisibility()&&!el.closest('[data-ly-split-pane]')).length,
				convMinW:slots.length?Math.round(Math.min(...slots.map((s)=>s.w))):0,
				convMinH:slots.length?Math.round(Math.min(...slots.map((s)=>s.h))):0,
			};
		})()`);
	}

	await until(`document.querySelectorAll('[data-ly-row]').length>0`);
	if (await page.evaluate(`Boolean(document.querySelector('[data-ly-tab="chats"]'))`)) {
		await click('[data-ly-tab="chats"]');
		await hold(500);
	}
	await click(`[data-ly-row="${IDS[0]}"] > button`);
	await until(`document.querySelector('[data-ly-split-pane="${IDS[0]}"]')`);
	await hold(700);

	await click('button[aria-label^="终端"]');
	await until(`Boolean(document.querySelector('[data-dock-pane="terminal"]')?.checkVisibility())`);
	await hold(900);
	const one = await floors();
	check("scene 1: one conversation plus a window terminal stays usable", Boolean(one.terminal && one.terminal.w >= PANEL_MIN_WIDTH_PX - 2 && one.minW >= SCREEN_MIN_WIDTH_PX - 2), one);

	const blockedRight = await dragTo(`[data-ly-row="${IDS[1]}"] > button`, await pointOn("[data-ly-split-root]", "right"));
	await hold(400);
	const noRight = await overlay();
	check("scene 2: a conversation column narrowed by a terminal refuses a left/right split", noRight.kind === null, noRight);
	const allowBottom = await pointOn("[data-ly-split-root]", "bottom");
	await slide(blockedRight, allowBottom, 8);
	await hold(400);
	const yesBottom = await overlay();
	check("scene 3: the same layout still accepts a top/bottom split", yesBottom.kind === "split" && yesBottom.side === "bottom", yesBottom);
	const overlayPaint = await page.evaluate<{ position: string }>(`(()=>{
		const el=document.querySelector('[data-ly-split-overlay]');
		return {position:el?getComputedStyle(el).position:''};
	})()`);
	check("scene 3b: the frost is laid out in the tree, not measured into fixed pixels", overlayPaint.position === "absolute", overlayPaint);
	await drop(allowBottom);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='2'`);
	await hold(800);
	const two = await floors();
	check(
		"scene 4: two stacked chats beside the terminal stay on both floors",
		two.count === 2 && two.minW >= SCREEN_MIN_WIDTH_PX - 2 && two.minH >= SCREEN_MIN_HEIGHT_PX - 2 && Boolean(two.terminal),
		two,
	);
	const grip = await page.evaluate<{ windowGrip: boolean; nested: number }>(`(()=>{
		const grip=document.querySelector('[data-dock-grip="terminal"]');
		const pane=document.querySelector('[data-dock-pane="terminal"]');
		return {
			windowGrip:Boolean(grip&&pane&&!pane.closest('[data-ly-split-pane]')),
			nested:[...document.querySelectorAll('[data-ly-split-pane] [data-dock-pane="terminal"]')].length,
		};
	})()`);
	check("scene 4b: the terminal still has a window-dock grip after the split", grip.windowGrip && grip.nested === 0, grip);
	const dragged = await page.evaluate<{ moved: boolean; dropSeen: boolean; stillWindow: boolean }>(`(async()=>{
		const wait=(ms)=>new Promise((done)=>setTimeout(done,ms));
		const frame=()=>new Promise((done)=>requestAnimationFrame(done));
		const handle=document.querySelector('[data-dock-grip="terminal"]');
		const dock=document.querySelector('[data-dock-panes]');
		const pane=document.querySelector('[data-dock-pane="terminal"]');
		if(!handle||!dock||!pane) return {moved:false,dropSeen:false,stillWindow:false};
		const before=pane.getBoundingClientRect();
		const from=handle.getBoundingClientRect();
		const origin={x:from.left+from.width/2,y:from.top+from.height/2};
		const box=dock.getBoundingClientRect();
		const to={x:box.left+box.width*0.5,y:box.bottom-36};
		const at=(type,x,y,buttons)=>new PointerEvent(type,{pointerId:41,isPrimary:true,bubbles:true,cancelable:true,clientX:x,clientY:y,buttons});
		handle.dispatchEvent(at('pointerdown',origin.x,origin.y,1));
		await frame();
		let dropSeen=false;
		for(let i=1;i<=14;i++){
			window.dispatchEvent(at('pointermove',origin.x+(to.x-origin.x)*(i/14),origin.y+(to.y-origin.y)*(i/14),1));
			await frame();
			if(document.querySelector('[data-dock-drop]')) dropSeen=true;
		}
		window.dispatchEvent(at('pointerup',to.x,to.y,0));
		await wait(500);
		const after=document.querySelector('[data-dock-pane="terminal"]')?.getBoundingClientRect();
		const still=document.querySelector('[data-dock-pane="terminal"]');
		return {
			moved:Boolean(after&&(Math.abs(after.top-before.top)>24||Math.abs(after.left-before.left)>24||dropSeen)),
			dropSeen,
			stillWindow:Boolean(still?.checkVisibility()&&!still.closest('[data-ly-split-pane]')),
		};
	})()`);
	check("scene 4c: dragging that terminal still rearranges the window dock", dragged.moved && dragged.stillWindow, dragged);
	await page.evaluate(`(()=>{
		const grip=document.querySelector('[data-dock-grip="terminal"]');
		grip?.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}));
	})()`);
	await until(`(()=>{
		const pane=document.querySelector('[data-ly-split-pane]');
		const term=document.querySelector('[data-dock-pane="terminal"]');
		if(!pane||!term||!term.checkVisibility()) return false;
		const a=pane.getBoundingClientRect();
		const b=term.getBoundingClientRect();
		return b.left>=a.right-4 && a.width<760;
	})()`);
	await hold(800);

	const overLeft = await dragTo(`[data-ly-row="${IDS[2]}"] > button`, await pointOn(`[data-ly-split-pane="${IDS[0]}"]`, "left"));
	await hold(400);
	const noLeft = await overlay();
	const overBottomHalf = await pointOn(`[data-ly-split-pane="${IDS[0]}"]`, "bottom");
	await slide(overLeft, overBottomHalf, 8);
	await hold(400);
	const noBottomHalf = await overlay();
	check(
		"scene 5: a tile that is under two floors on both axes offers no split",
		noLeft.kind === null && noBottomHalf.kind === null,
		{ noLeft, noBottomHalf },
	);
	const park = await center('[data-ly-tab="chats"], [data-ly-sidebar]');
	await slide(overBottomHalf, park, 8);
	await drop(park);
	await hold(400);

	const closedTerm = await page.evaluate<boolean>(`(()=>{
		const pane=[...document.querySelectorAll('[data-dock-pane="terminal"]')].find(el=>el.checkVisibility());
		const button=pane?.querySelector('[data-dock-actions] button[aria-label="关闭终端"]');
		if(!button) return false;
		button.click();
		return true;
	})()`);
	check("scene 5b: the window terminal close control is reachable", closedTerm, { closedTerm });
	await until(`![...document.querySelectorAll('[data-dock-pane="terminal"]')].some(el=>el.checkVisibility())`);
	await hold(700);
	await click(`[data-ly-split-close="${IDS[1]}"]`);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='1'`);
	await hold(600);

	const wide = await dragTo(`[data-ly-row="${IDS[1]}"] > button`, await pointOn("[data-ly-split-root]", "right"));
	await hold(400);
	await drop(wide);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='2'`);
	await hold(700);
	const twoWide = await floors();
	check("scene 6: without the terminal, a right split produces two screens at or above 420px", twoWide.count === 2 && twoWide.minW >= SCREEN_MIN_WIDTH_PX - 2, twoWide);

	const third = await dragTo(`[data-ly-row="${IDS[2]}"] > button`, await pointOn(`[data-ly-split-pane="${IDS[0]}"]`, "bottom"));
	await hold(400);
	await drop(third);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='3'`);
	const fourth = await dragTo(`[data-ly-row="${IDS[3]}"] > button`, await pointOn(`[data-ly-split-pane="${IDS[1]}"]`, "bottom"));
	await hold(400);
	await drop(fourth);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='4'`);
	await hold(800);
	const grid = await floors();
	check("scene 7: a 2×2 grid keeps every chat at or above 420×260", grid.count === 4 && grid.minW >= SCREEN_MIN_WIDTH_PX - 2 && grid.minH >= SCREEN_MIN_HEIGHT_PX - 2, grid);

	await click(`[data-ly-split-pane="${IDS[0]}"] button[aria-label^="终端"]`);
	await pause(500);
	const withTerm = await floors();
	check(
		"scene 8: opening a terminal onto a 2×2 stays inside that tile",
		withTerm.count === 4 && withTerm.minW >= SCREEN_MIN_WIDTH_PX - 2 && withTerm.minH >= SCREEN_MIN_HEIGHT_PX - 2 && Boolean(withTerm.terminal) && withTerm.terminalNested === 1,
		withTerm,
	);
	const chrome = await page.evaluate<{ overlap: boolean; inSlot: boolean }>(`(()=>{
		const screen=document.querySelector('[data-ly-split-pane="${IDS[0]}"]');
		const bar=screen?.querySelector('[data-ly-split-chrome]');
		const term=screen?.querySelector('[data-dock-pane="terminal"]');
		const cr=bar?.getBoundingClientRect();
		const tr=term?.checkVisibility()?term.getBoundingClientRect():null;
		return {
			overlap:Boolean(cr&&tr&&cr.left<tr.right-8&&cr.right>tr.left+8&&cr.top<tr.bottom-8&&cr.bottom>tr.top+8),
			inSlot:Boolean(bar?.closest('[data-ly-pane-slot="conversation"]')),
		};
	})()`);
	check("scene 8b: the tile title bar does not paint over that in-tile terminal", !chrome.overlap && chrome.inSlot, chrome);
	check(
		"scene 8c: that tile's conversation is still a usable pane",
		withTerm.convMinW >= 200 && withTerm.convMinH >= 240,
		{ convMinW: withTerm.convMinW, convMinH: withTerm.convMinH },
	);
	check(
		"scene 9: that terminal is a usable pane, not a sliver",
		Boolean(withTerm.terminal && (withTerm.terminal.w >= PANEL_MIN_WIDTH_PX - 2 || withTerm.terminal.h >= 140)),
		withTerm.terminal,
	);

	await click(`[data-ly-split-pane="${IDS[0]}"] button[aria-label^="浏览器"]`);
	let panelUrl: string | null = null;
	for (let i = 0; i < 40; i++) {
		await pause(150);
		const list = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())) as Array<{
			type: string;
			webSocketDebuggerUrl?: string;
		}>;
		for (const item of list) {
			if (item.type !== "page" || !item.webSocketDebuggerUrl) continue;
			const hit = await evaluateRenderer<boolean>(
				item.webSocketDebuggerUrl,
				`document.documentElement.dataset.lyWindowKind==="panel"||Boolean(document.querySelector("[data-ly-panel-window]"))`,
			).catch(() => false);
			if (hit) {
				panelUrl = item.webSocketDebuggerUrl;
				break;
			}
		}
		if (panelUrl) break;
	}
	const second = await floors();
	check(
		"scene 8d: a second panel leaves the tile instead of crushing the conversation",
		second.terminalNested === 1 && second.browserInPane === 0 && second.convMinH >= 240 && second.convMinW >= 200 && Boolean(panelUrl),
		{ ...second, panelUrl: Boolean(panelUrl) },
	);
	if (panelUrl) {
		await evaluateRenderer(panelUrl, `document.querySelector("[data-ly-restore-panel]")?.click()`);
		await hold(700);
		const stillFull = await floors();
		check(
			"scene 8e: restore stays out while the tile has no room",
			stillFull.browserInPane === 0 && stillFull.terminalNested === 1 && stillFull.convMinH >= 240,
			stillFull,
		);
	}

	await click(`[data-ly-split-pane="${IDS[1]}"] button[aria-label^="浏览器"]`);
	await pause(400);
	const placed = await floors();
	check(
		"scene 10: a browser opened from a tiled screen stays inside that tile",
		placed.browserInPane >= 1 && placed.windowBrowser === 0 && placed.minW >= SCREEN_MIN_WIDTH_PX - 2,
		placed,
	);
	await hold(900);

	const crushed = await page.evaluate<{ minW: number; minH: number; reversals: number; frozen: boolean } | null>(`(()=>new Promise((resolve)=>{
		const handle=document.querySelector('[data-ly-split-handle][aria-orientation="vertical"]')
			|| document.querySelector('[data-ly-split-handle]');
		if(!handle){ resolve(null); return; }
		const box=handle.getBoundingClientRect();
		const x=box.x+box.width/2;
		const y=box.y+box.height/2;
		const pane=document.querySelector('[data-ly-split-pane]');
		const widths=[];
		const frame=()=>new Promise((done)=>requestAnimationFrame(()=>requestAnimationFrame(done)));
		(async()=>{
			handle.dispatchEvent(new PointerEvent('pointerdown',{pointerId:21,isPrimary:true,bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:1}));
			await frame();
			const frozen=Boolean(pane?.hasAttribute('data-ly-frozen'));
			for(let step=1;step<=24;step++){
				window.dispatchEvent(new PointerEvent('pointermove',{pointerId:21,isPrimary:true,bubbles:true,clientX:x-step*36,clientY:y,buttons:1}));
				await frame();
				if(pane) widths.push(Math.round(pane.getBoundingClientRect().width));
			}
			window.dispatchEvent(new PointerEvent('pointerup',{pointerId:21,isPrimary:true,bubbles:true,clientX:x-860,clientY:y,buttons:0}));
			await new Promise((done)=>setTimeout(done,80));
			const panes=[...document.querySelectorAll('[data-ly-split-pane]')].map(el=>el.getBoundingClientRect());
			let reversals=0;
			for(let i=2;i<widths.length;i++){
				const a=widths[i-1]-widths[i-2];
				const b=widths[i]-widths[i-1];
				if(a!==0 && b!==0 && Math.sign(a)!==Math.sign(b)) reversals++;
			}
			resolve({minW:Math.round(Math.min(...panes.map(r=>r.width))),minH:Math.round(Math.min(...panes.map(r=>r.height))),reversals,frozen});
		})();
	}))()`);
	check("scene 11: dragging a splitter cannot go under the width floor", Boolean(crushed && crushed.minW >= SCREEN_MIN_WIDTH_PX - 2), crushed);
	check("scene 11b: a handle drag does not bounce the pane back and forth", Boolean(crushed && crushed.reversals <= 1), crushed);
	check("scene 11c: tiled screens are held still for the length of the drag", Boolean(crushed?.frozen), crushed);

	const row = await center(`[data-ly-row="${IDS[4]}"] > button`);
	await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...row, buttons: 0 });
	await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "right", clickCount: 1, buttons: 2, ...row });
	await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "right", clickCount: 1, buttons: 0, ...row });
	await until(`[...document.querySelectorAll('[role="menuitem"]')].some(el=>el.textContent?.includes('打开方式'))`);
	const openIn = await center("[data-ly-open-in]");
	await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...openIn, buttons: 0 });
	await until(`[...document.querySelectorAll('[role="menuitem"]')].some(el=>el.textContent?.trim()==='分屏')`);
	await hold(500);
	const disabled = await page.evaluate<boolean>(`Boolean((()=>{const el=[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent?.trim()==='分屏');return el&&('disabled' in el)&&el.disabled;})())`);
	check("scene 12: menu split is disabled once four screens fill the window", disabled, { disabled });
	await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" });
	await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape" });
	await hold(500);

	await click(`[data-ly-split-close="${IDS[3]}"]`);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='3'`);
	const afterClose = await floors();
	check("scene 13: closing a screen leaves the rest on the floor", afterClose.count === 3 && afterClose.minW >= SCREEN_MIN_WIDTH_PX - 2, afterClose);
	await hold(700);

	const fifth = await dragTo(`[data-ly-row="${IDS[4]}"] > button`, await pointOn("[data-ly-split-focused]", "center"));
	await hold(400);
	const replace = await overlay();
	const canAdd = afterClose.count < 4;
	check(
		"scene 14: a drag after a close either splits a roomy edge or shows no frost",
		canAdd ? replace.kind === "split" || replace.kind === null : replace.kind === "replace",
		{ replace, canAdd, count: afterClose.count },
	);
	await drop(fifth);
	await hold(800);
	const last = await floors();
	check("scene 15: the layout after that drop still clears the conversation floors", last.minW >= SCREEN_MIN_WIDTH_PX - 2 && last.minH >= SCREEN_MIN_HEIGHT_PX - 2, last);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_分屏地板_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
