/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 对话分屏与新窗口：对照 Codex 录像的拖放、最多四屏、关闭归并、新窗口。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/session-split-demo.ts`
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { call, evaluateRenderer, startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra分屏新窗口测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9791;
const IDS = ["split-a", "split-b", "split-c", "split-d", "split-e"] as const;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

async function seed(home: string): Promise<void> {
	const cwd = join(home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# split\n");
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const metas = [];
	for (const [index, id] of IDS.entries()) {
		const messages = [
			{ role: "user", content: [{ type: "text", text: `会话 ${id} 用来验证分屏` }], timestamp: index * 10 },
			{ role: "assistant", content: [{ type: "text", text: `${id} 的回复。\n\n${"分屏内容行。".repeat(12)}` }], api: "anthropic-messages", provider: "qa", model: "qa", usage, stopReason: "stop", timestamp: index * 10 + 1 },
		];
		const meta = {
			id,
			title: `分屏 ${id.slice(-1).toUpperCase()}`,
			projectId,
			projectName: "分屏项目",
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
			projects: [{ id: projectId, path: cwd, name: "分屏项目", pinned: true, lastOpenedAt: 1 }],
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
const sessionFrames: Frame[] = [];

async function sessionPageUrl(): Promise<string | null> {
	const list = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())) as Array<{
		type: string;
		webSocketDebuggerUrl?: string;
	}>;
	for (const item of list) {
		if (item.type !== "page" || !item.webSocketDebuggerUrl) continue;
		const hit = await evaluateRenderer<boolean>(
			item.webSocketDebuggerUrl,
			`document.documentElement.dataset.lyWindowKind==="session"||Boolean(document.querySelector("[data-ly-session-window]"))`,
		).catch(() => false);
		if (hit) return item.webSocketDebuggerUrl;
	}
	return null;
}

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
	async function hold(ms = 900) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await page.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 80 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(180, Math.max(0, end - Date.now())));
		}
	}
	async function center(selector: string): Promise<{ x: number; y: number }> {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
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
	async function dragTo(from: string, to: { x: number; y: number }, steps = 16) {
		const a = await center(from);
		await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...a, buttons: 0 });
		await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, buttons: 1, ...a });
		await slide(a, to, steps);
		return to;
	}
	async function slide(from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			const x = from.x + (to.x - from.x) * t;
			const y = from.y + (to.y - from.y) * t;
			await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
			await pause(24);
		}
	}
	async function drag(from: string, to: string, steps = 18) {
		return dragTo(from, await center(to), steps);
	}
	async function drop(at: { x: number; y: number }) {
		await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, buttons: 0, ...at });
	}
	async function overlayHint() {
		return page.evaluate<{
			kind: string | null;
			side: string | null;
			blur: string;
			share: number;
			label: string;
			topGap: number;
			bottomGap: number;
			leftGap: number;
			rightGap: number;
			chromeGap: number | null;
		}>(`(()=>{
			const el=document.querySelector('[data-ly-split-overlay]');
			if(!el) return {kind:null,side:null,blur:'',share:0,label:'',topGap:99,bottomGap:99,leftGap:99,rightGap:99,chromeGap:null};
			const card=el.querySelector('.ly-split-drop');
			const pane=el.getBoundingClientRect();
			const column=document.querySelector('[data-ly-split-root]')?.getBoundingClientRect();
			const chrome=document.querySelector('[data-dock-header="conversation"]')?.getBoundingClientRect();
			const box=card?card.getBoundingClientRect():null;
			const style=card?getComputedStyle(card):null;
			const share=box&&pane.width>0&&pane.height>0?Math.min(box.width/pane.width,box.height/pane.height):0;
			return {
				kind:el.getAttribute('data-ly-split-overlay'),
				side:el.getAttribute('data-ly-split-side'),
				blur:style?style.backdropFilter||style.webkitBackdropFilter||'':'',
				share,
				label:(el.textContent||'').trim(),
				topGap:column&&box?box.top-column.top:99,
				bottomGap:column&&box?column.bottom-box.bottom:99,
				leftGap:column&&box?box.left-column.left:99,
				rightGap:column&&box?column.right-box.right:99,
				chromeGap:chrome&&box?box.top-chrome.top:null,
			};
		})()`);
	}

	await until(`document.querySelectorAll('[data-ly-row]').length>0`);
	if (await page.evaluate(`Boolean(document.querySelector('[data-ly-tab="chats"]'))`)) {
		await click('[data-ly-tab="chats"]');
		await hold(700);
	}
	await click(`[data-ly-row="${IDS[0]}"] > button`);
	await until(`document.querySelector('[data-ly-split-pane="${IDS[0]}"]')`);
	await hold(1000);

	const first = await page.evaluate<{ count: number; pane: string | null }>(`(()=>({
		count:Number(document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')||0),
		pane:document.querySelector('[data-ly-split-pane]')?.getAttribute('data-ly-split-pane')||null,
	}))()`);
	check("starts as one pane of the opened session", first.count === 1 && first.pane === IDS[0], first);

	const sides = ["left", "top", "right", "bottom"] as const;
	let last = await dragTo(`[data-ly-row="${IDS[1]}"] > button`, await pointOn("[data-ly-split-root]", "left"));
	const swept: string[] = [];
	for (const side of sides) {
		const at = await pointOn("[data-ly-split-root]", side);
		await slide(last, at, 10);
		last = at;
		await pause(80);
		const hint = await overlayHint();
		swept.push(hint.side ?? "");
		const toWindow = hint.chromeGap == null || hint.chromeGap < 8;
		const flush =
			side === "left" ? hint.bottomGap < 8 && hint.leftGap < 8 && toWindow :
			side === "right" ? hint.bottomGap < 8 && hint.rightGap < 8 && toWindow :
			side === "top" ? hint.leftGap < 8 && hint.rightGap < 8 && toWindow :
			hint.bottomGap < 8 && hint.leftGap < 8 && hint.rightGap < 8;
		check(
			`drag over ${side} paints that half flush to the window top`,
			hint.kind === "split" && hint.side === side && hint.blur.includes("blur") && hint.share > 0.35 && hint.share < 0.72 && hint.label.includes("分屏") && flush,
			hint,
		);
		await hold(600);
	}
	check("all four edges can be aimed at in one drag", swept.join(",") === "left,top,right,bottom", { swept });
	const right = await pointOn("[data-ly-split-root]", "right");
	await slide(last, right, 8);
	await hold(700);
	await drop(right);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='2'`);
	await hold(1100);
	const placed = await page.evaluate<{ a: number; b: number }>(`(()=>{
		const a=document.querySelector('[data-ly-split-pane="split-a"]')?.getBoundingClientRect();
		const b=document.querySelector('[data-ly-split-pane="split-b"]')?.getBoundingClientRect();
		return {a:a?.x??-1,b:b?.x??-1};
	})()`);
	check("dropping on the right puts the new chat on the right", placed.b > placed.a + 80, placed);

	const two = await page.evaluate<{
		count: number;
		composers: number;
		panes: number;
		chrome: number;
		dockConversation: boolean;
		heights: number[];
		tools: number[];
		closeIsToolbar: boolean;
	}>(`(()=>{
		const chrome=[...document.querySelectorAll('[data-ly-split-chrome]')];
		const dock=document.querySelector('[data-dock-header="conversation"]');
		return {
			count:Number(document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')||0),
			composers:document.querySelectorAll('[data-ly-split-pane] textarea.ly-composer-text').length,
			panes:document.querySelectorAll('[data-ly-split-pane]').length,
			chrome:chrome.length,
			dockConversation:Boolean(dock),
			heights:chrome.map(el=>Math.round(el.getBoundingClientRect().height)),
			tools:chrome.map(el=>el.querySelectorAll('[data-ly-split-tools] [data-ly-toolbar-button]').length),
			closeIsToolbar:Boolean(document.querySelector('[data-ly-split-close]')?.closest('[data-ly-toolbar-button]')),
		};
	})()`);
	check(
		"two independent screens with own title bars, no shared dock title",
		two.count === 2 && two.composers === 2 && two.chrome === 2 && !two.dockConversation && two.heights.every((height) => height >= 40 && height <= 48),
		two,
	);
	check(
		"every screen has the same header tool buttons",
		two.tools.length === 2 && two.tools.every((n) => n >= 1 && n === two.tools[0]) && two.closeIsToolbar,
		two,
	);

	const refuseAt = await dragTo(`[data-ly-row="${IDS[2]}"] > button`, await pointOn(`[data-ly-split-pane="${IDS[0]}"]`, "left"));
	await hold(500);
	const refused = await overlayHint();
	check("a half that is too narrow does not offer a left or right split", refused.kind === null, refused);
	const allowAt = await pointOn(`[data-ly-split-pane="${IDS[0]}"]`, "bottom");
	await slide(refuseAt, allowAt, 10);
	await hold(500);
	const allowed = await overlayHint();
	check("the same half still offers a top or bottom split", allowed.kind === "split" && allowed.side === "bottom", allowed);
	const park = await center('[data-ly-tab="chats"], [data-ly-sidebar]');
	await slide(allowAt, park, 8);
	await drop(park);
	await hold(400);
	const stillTwoAfterProbe = await page.evaluate<number>(`Number(document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')||0)`);
	check("backing out of that drag leaves two screens", stillTwoAfterProbe === 2, { stillTwoAfterProbe });

	await click(`[data-ly-split-pane="${IDS[1]}"] button[aria-label^="浏览器"]`);
	await until(`Boolean(document.querySelector('[data-ly-split-pane="${IDS[1]}"] [data-dock-pane="browser"]')?.checkVisibility())`);
	await hold(1100);
	const inside = await page.evaluate<{
		inside: boolean;
		foreign: number;
		windowLevel: number;
		grip: boolean;
		chromeOverPanel: boolean;
		chromeInSlot: boolean;
	}>(`(()=>{
		const screen=document.querySelector('[data-ly-split-pane="${IDS[1]}"]');
		const pane=screen?.getBoundingClientRect();
		const browser=screen?.querySelector('[data-dock-pane="browser"]');
		const box=browser?.checkVisibility()?browser.getBoundingClientRect():null;
		const chrome=screen?.querySelector('[data-ly-split-chrome]');
		const cr=chrome?.getBoundingClientRect();
		const overlap=Boolean(cr&&box&&cr.left<box.right-8&&cr.right>box.left+8&&cr.top<box.bottom-8&&cr.bottom>box.top+8);
		const visible=[...document.querySelectorAll('[data-dock-pane="browser"]')].filter((el)=>el.checkVisibility());
		return {
			inside:Boolean(pane&&box&&box.left>=pane.left-2&&box.right<=pane.right+2&&box.top>=pane.top-2&&box.bottom<=pane.bottom+2),
			foreign:[...document.querySelectorAll('[data-ly-split-pane="${IDS[0]}"] [data-dock-pane="browser"]')].filter((el)=>el.checkVisibility()).length,
			windowLevel:visible.filter((el)=>!el.closest('[data-ly-split-pane]')).length,
			grip:Boolean(screen?.querySelector('[data-dock-grip="browser"]')),
			chromeOverPanel:overlap,
			chromeInSlot:Boolean(chrome?.closest('[data-ly-pane-slot="conversation"]')),
		};
	})()`);
	check("a panel opened from a tiled screen stays inside that screen", inside.inside && inside.foreign === 0 && inside.windowLevel === 0 && inside.grip, inside);
	check("that screen's title bar does not paint over the in-tile panel", !inside.chromeOverPanel && inside.chromeInSlot, inside);
	const slot = await page.evaluate<{ w: number; h: number } | null>(`(()=>{
		const el=document.querySelector('[data-ly-split-pane="${IDS[1]}"] [data-ly-pane-slot="conversation"]');
		if(!el) return null;
		const r=el.getBoundingClientRect();
		return {w:Math.round(r.width),h:Math.round(r.height)};
	})()`);
	check("that tile's conversation is still a usable pane", Boolean(slot && slot.w >= 200 && slot.h >= 240), slot);

	const dragged = await page.evaluate<{
		moved: boolean;
		dropSeen: boolean;
		stillInside: boolean;
	}>(`(async()=>{
		const wait=(ms)=>new Promise((done)=>setTimeout(done,ms));
		const frame=()=>new Promise((done)=>requestAnimationFrame(done));
		const screen=document.querySelector('[data-ly-split-pane="${IDS[1]}"]');
		const grip=screen?.querySelector('[data-dock-grip="browser"]');
		const dock=screen?.querySelector('[data-ly-pane-dock]');
		const pane=screen?.querySelector('[data-dock-pane="browser"]');
		if(!grip||!dock||!pane||!screen) return {moved:false,dropSeen:false,stillInside:false};
		const before=pane.getBoundingClientRect();
		const from=grip.getBoundingClientRect();
		const origin={x:from.left+from.width/2,y:from.top+from.height/2};
		const box=dock.getBoundingClientRect();
		const to={x:box.left+box.width*0.5,y:box.bottom-28};
		const at=(type,x,y,buttons)=>new PointerEvent(type,{pointerId:31,isPrimary:true,bubbles:true,cancelable:true,clientX:x,clientY:y,buttons});
		grip.dispatchEvent(at('pointerdown',origin.x,origin.y,1));
		await frame();
		let dropSeen=false;
		for(let i=1;i<=14;i++){
			window.dispatchEvent(at('pointermove',origin.x+(to.x-origin.x)*(i/14),origin.y+(to.y-origin.y)*(i/14),1));
			await frame();
			if(screen.querySelector('[data-dock-drop]')) dropSeen=true;
		}
		window.dispatchEvent(at('pointerup',to.x,to.y,0));
		await wait(500);
		const after=screen.querySelector('[data-dock-pane="browser"]')?.getBoundingClientRect();
		const host=screen.getBoundingClientRect();
		const still=Boolean(after&&after.left>=host.left-2&&after.right<=host.right+2&&after.top>=host.top-2&&after.bottom<=host.bottom+2);
		return {
			moved:Boolean(after&&(Math.abs(after.top-before.top)>16||Math.abs(after.left-before.left)>16||dropSeen)),
			dropSeen,
			stillInside:still,
		};
	})()`);
	check("that screen's panel can still be dragged inside the same screen", dragged.moved && dragged.stillInside, dragged);

	const already = await dragTo(`[data-ly-row="${IDS[0]}"] > button`, await center("[data-ly-split-root]"));
	await hold(700);
	const windowHint = await overlayHint();
	check("dragging a session already on screen does not reuse the split frost", windowHint.kind === null, windowHint);
	const pagesBeforeDrag = ((await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())) as Array<{ type: string }>).filter((item) => item.type === "page").length;
	await drop(already);
	let pagesAfterDrag = pagesBeforeDrag;
	for (let i = 0; i < 40; i++) {
		await pause(150);
		pagesAfterDrag = ((await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())) as Array<{ type: string }>).filter((item) => item.type === "page").length;
		if (pagesAfterDrag > pagesBeforeDrag) break;
	}
	check("dropping an already-open session opens a real window", pagesAfterDrag > pagesBeforeDrag, { pagesBeforeDrag, pagesAfterDrag });
	const afterDrop = await page.evaluate<{ overlay: boolean; composers: number }>(`({
		overlay:Boolean(document.querySelector('[data-ly-split-overlay]')),
		composers:document.querySelectorAll('[data-ly-split-pane] textarea.ly-composer-text').length,
	})`);
	check("the main window is usable after the new window opens", !afterDrop.overlay && afterDrop.composers === 2, afterDrop);
	const stillTwo = await page.evaluate<number>(`Number(document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')||0)`);
	check("already-open drop does not add a fifth or third screen here", stillTwo === 2, { stillTwo });
	let sessionUrl: string | null = null;
	for (let i = 0; i < 50; i++) {
		sessionUrl = await sessionPageUrl();
		if (sessionUrl) break;
		await pause(150);
	}
	check("the new window is a conversation window", Boolean(sessionUrl), { found: Boolean(sessionUrl) });
	if (sessionUrl) {
		let chrome = { sessionWindow: false, sidebar: true, dock: true, split: true, openInMain: false, composer: false, tools: 0, title: "" };
		for (let i = 0; i < 40; i++) {
			chrome = await evaluateRenderer<typeof chrome>(
				sessionUrl,
				`(()=>{
					return {
						sessionWindow: Boolean(document.querySelector("[data-ly-session-window]")),
						sidebar: Boolean(document.querySelector("[data-ly-tab], .ly-sidebar-fill")),
						dock: Boolean(document.querySelector("[data-dock-pane]")),
						split: Boolean(document.querySelector("[data-ly-split-root]")),
						openInMain: Boolean(document.querySelector("[data-ly-open-in-main]")),
						composer: Boolean(document.querySelector("textarea.ly-composer-text")),
						tools: document.querySelectorAll("[data-ly-session-window-tools] button").length,
						title: (document.querySelector("[data-ly-session-window-title]")?.textContent || "").trim(),
					};
				})()`,
			);
			if (chrome.sessionWindow && chrome.composer && chrome.openInMain) break;
			await pause(150);
		}
		check(
			"new window shows only the conversation, with a way back",
			chrome.sessionWindow && !chrome.sidebar && !chrome.dock && !chrome.split && chrome.openInMain && chrome.composer && chrome.tools === 1,
			chrome,
		);
		for (let i = 0; i < 14; i++) {
			const picture = await call<{ data: string }>(sessionUrl, "Page.captureScreenshot", { format: "jpeg", quality: 82 });
			sessionFrames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(160);
		}
	}
	const lit = await page.evaluate<number>(`document.querySelectorAll('[data-ly-row] button[aria-current="page"]').length`);
	check("sidebar lights every conversation that is on screen", lit >= 2, { lit });
	if (sessionUrl) {
		const returning = evaluateRenderer(sessionUrl, `document.querySelector("[data-ly-open-in-main]")?.closest("button")?.click()`).catch(() => {});
		await Promise.race([returning, pause(1500)]);
		let gone = false;
		for (let i = 0; i < 40; i++) {
			await pause(150);
			gone = (await sessionPageUrl()) === null;
			if (gone) break;
		}
		check("Open in main window closes the conversation window", gone, { gone });
		const backOnSplit = await page.evaluate<number>(`Number(document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')||0)`);
		check("returning to the main window does not add a pane", backOnSplit === 2, { backOnSplit });
	}
	await hold(900);
	await click(`[data-ly-split-pane="${IDS[1]}"] button[aria-label^="浏览器"]`);
	await until(`![...document.querySelectorAll('[data-dock-pane="browser"]')].some((el)=>el.checkVisibility())`);
	await hold(600);

	const third = await dragTo(`[data-ly-row="${IDS[2]}"] > button`, await pointOn('[data-ly-split-pane="split-a"]', "bottom"));
	await hold(600);
	await drop(third);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='3'`);
	const three = await page.evaluate<{ count: number; chrome: number; dock: boolean; tools: number[] }>(`(()=>{
		const chrome=[...document.querySelectorAll('[data-ly-split-chrome]')];
		return {
			count:Number(document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')||0),
			chrome:chrome.length,
			dock:Boolean(document.querySelector('[data-dock-header="conversation"]')),
			tools:chrome.map(el=>el.querySelectorAll('[data-ly-split-tools] [data-ly-toolbar-button]').length),
		};
	})()`);
	check(
		"three independent screens, still no shared dock title",
		three.count === 3 && three.chrome === 3 && !three.dock && three.tools.length === 3 && three.tools.every((n) => n >= 1 && n === three.tools[0]),
		three,
	);
	await hold(1100);

	const fourth = await dragTo(`[data-ly-row="${IDS[3]}"] > button`, await pointOn('[data-ly-split-pane="split-b"]', "bottom"));
	await hold(600);
	await drop(fourth);
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='4'`);
	await hold(1000);
	const four = await page.evaluate<{
		count: number;
		ids: string[];
		overlap: boolean;
		composers: number;
		chrome: number;
		dockConversation: boolean;
		headers: number;
		tools: number[];
	}>(`(()=>{
		const panes=[...document.querySelectorAll('[data-ly-split-pane]')];
		const boxes=panes.map(el=>{const r=el.getBoundingClientRect();return {id:el.getAttribute('data-ly-split-pane'),x:r.x,y:r.y,w:r.width,h:r.height};});
		let overlap=false;
		for(let i=0;i<boxes.length;i++){
			for(let j=i+1;j<boxes.length;j++){
				const a=boxes[i],b=boxes[j];
				if(a.x+a.w-1>b.x && b.x+b.w-1>a.x && a.y+a.h-1>b.y && b.y+b.h-1>a.y) overlap=true;
			}
		}
		const dock=document.querySelector('[data-dock-header="conversation"]');
		const chrome=[...document.querySelectorAll('[data-ly-split-chrome]')];
		return {
			count:Number(document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')||0),
			ids:boxes.map(box=>box.id||''),
			overlap,
			composers:document.querySelectorAll('[data-ly-split-pane] textarea.ly-composer-text').length,
			chrome:chrome.length,
			dockConversation:Boolean(dock),
			headers:document.querySelectorAll('[data-ly-split-chrome], [data-dock-header="conversation"]').length,
			tools:chrome.map(el=>el.querySelectorAll('[data-ly-split-tools] [data-ly-toolbar-button]').length),
		};
	})()`);
	check(
		"four independent screens is the ceiling, never a fifth header",
		four.count === 4 &&
			four.composers === 4 &&
			four.chrome === 4 &&
			four.headers === 4 &&
			!four.dockConversation &&
			!four.overlap &&
			new Set(four.ids).size === 4 &&
			four.ids.includes(IDS[0]) &&
			!four.ids.includes("@draft") &&
			four.tools.length === 4 &&
			four.tools.every((n) => n >= 1 && n === four.tools[0]),
		four,
	);

	const fifth = await drag(`[data-ly-row="${IDS[4]}"] > button`, "[data-ly-split-focused]");
	const replaceHint = await page.evaluate<string | null>(`document.querySelector('[data-ly-split-overlay]')?.getAttribute('data-ly-split-overlay')||null`);
	check("fifth drag offers replace, not a fifth pane", replaceHint === "replace", { replaceHint });
	await hold(700);
	await drop(fifth);
	await pause(400);
	const stillFour = await page.evaluate<{ count: number; hasE: boolean; chrome: number }>(`(()=>({
		count:Number(document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')||0),
		hasE:Boolean(document.querySelector('[data-ly-split-pane="split-e"]')),
		chrome:document.querySelectorAll('[data-ly-split-chrome]').length,
	}))()`);
	check("dropping a fifth session replaces a pane and stays at four screens", stillFour.count === 4 && stillFour.hasE && stillFour.chrome === 4, stillFour);

	const beforeClose = stillFour.count;
	await click('[data-ly-split-close="split-e"]');
	await until(`document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')==='3'`);
	const afterClose = await page.evaluate<number>(`Number(document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')||0)`);
	check("close prunes a pane", afterClose === beforeClose - 1, { beforeClose, afterClose });
	await hold(900);

	const resized = await page.evaluate<{ before: number; after: number } | null>(`(()=>new Promise((resolve)=>{
		const handle=document.querySelector('[data-ly-split-handle][aria-orientation="vertical"]')
			|| document.querySelector('[data-ly-split-handle]');
		const first=document.querySelector('[data-ly-split-pane]');
		if(!handle || !first){ resolve(null); return; }
		const box=handle.getBoundingClientRect();
		const x=box.x+box.width/2;
		const y=box.y+box.height/2;
		const before=first.getBoundingClientRect().width;
		const row=handle.getAttribute('aria-orientation')==='vertical';
		const frame=()=>new Promise((done)=>requestAnimationFrame(()=>requestAnimationFrame(done)));
		(async()=>{
			handle.dispatchEvent(new PointerEvent('pointerdown',{pointerId:12,isPrimary:true,bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:1}));
			await frame();
			for(let step=1;step<=10;step++){
				const dx=row? step*12:0;
				const dy=row? 0: step*10;
				window.dispatchEvent(new PointerEvent('pointermove',{pointerId:12,isPrimary:true,bubbles:true,clientX:x+dx,clientY:y+dy,buttons:1}));
				await frame();
			}
			window.dispatchEvent(new PointerEvent('pointerup',{pointerId:12,isPrimary:true,bubbles:true,clientX:x+(row?120:0),clientY:y+(row?0:100),buttons:0}));
			await new Promise((done)=>setTimeout(done,80));
			resolve({before,after:first.getBoundingClientRect().width});
		})();
	}))()`);
	if (resized) {
		check("splitter drag resizes an independent screen", Math.abs(resized.after - resized.before) > 40, resized);
	} else {
		check("splitter handle exists for a tiled layout", false, null);
	}
	const crushed = await page.evaluate<{ min: number; max: number } | null>(`(()=>new Promise((resolve)=>{
		const handle=document.querySelector('[data-ly-split-handle][aria-orientation="vertical"]')
			|| document.querySelector('[data-ly-split-handle]');
		if(!handle){ resolve(null); return; }
		const box=handle.getBoundingClientRect();
		const x=box.x+box.width/2;
		const y=box.y+box.height/2;
		const row=handle.getAttribute('aria-orientation')==='vertical';
		const frame=()=>new Promise((done)=>requestAnimationFrame(()=>requestAnimationFrame(done)));
		(async()=>{
			handle.dispatchEvent(new PointerEvent('pointerdown',{pointerId:13,isPrimary:true,bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:1}));
			await frame();
			for(let step=1;step<=20;step++){
				window.dispatchEvent(new PointerEvent('pointermove',{pointerId:13,isPrimary:true,bubbles:true,clientX:x-step*40,clientY:y,buttons:1}));
				await frame();
			}
			window.dispatchEvent(new PointerEvent('pointerup',{pointerId:13,isPrimary:true,bubbles:true,clientX:x-800,clientY:y,buttons:0}));
			await new Promise((done)=>setTimeout(done,80));
			const widths=[...document.querySelectorAll('[data-ly-split-pane]')].map(el=>el.getBoundingClientRect().width);
			resolve({min:Math.round(Math.min(...widths)),max:Math.round(Math.max(...widths))});
		})();
	}))()`);
	if (crushed) {
		check("splitter cannot drag a screen narrower than 420px", crushed.min >= 418, crushed);
	} else {
		check("splitter handle exists to clamp a crush", false, null);
	}
	await hold(800);

	const row = await center(`[data-ly-row="${IDS[4]}"] > button`);
	await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...row, buttons: 0 });
	await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "right", clickCount: 1, buttons: 2, ...row });
	await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "right", clickCount: 1, buttons: 0, ...row });
	await until(`[...document.querySelectorAll('[role="menuitem"]')].some(el=>el.textContent?.includes('打开方式'))`);
	await hold(700);
	const openIn = await center("[data-ly-open-in]");
	await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...openIn, buttons: 0 });
	await until(`[...document.querySelectorAll('[role="menuitem"]')].some(el=>el.textContent?.trim()==='分屏')`);
	await hold(600);
	await page.evaluate(`([...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent?.trim()==='分屏')||{click(){}}).click()`);
	await pause(500);
	const afterMenu = await page.evaluate<number>(`Number(document.querySelector('[data-ly-split-root]')?.getAttribute('data-ly-split-count')||0)`);
	check("Open in → Split view adds or focuses a pane", afterMenu >= 3 && afterMenu <= 4, { afterMenu });
	await hold(900);

	await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...row, buttons: 0 });
	await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "right", clickCount: 1, buttons: 2, ...row });
	await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "right", clickCount: 1, buttons: 0, ...row });
	await until(`[...document.querySelectorAll('[role="menuitem"]')].some(el=>el.textContent?.includes('打开方式'))`);
	const openInAgain = await center("[data-ly-open-in]");
	await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...openInAgain, buttons: 0 });
	await until(`[...document.querySelectorAll('[role="menuitem"]')].some(el=>el.textContent?.trim()==='新窗口')`);
	await hold(700);
	const pagesBefore = ((await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())) as Array<{ type: string }>).filter((item) => item.type === "page").length;
	await page.evaluate(`([...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent?.trim()==='新窗口')||{click(){}}).click()`);
	let pagesAfter = pagesBefore;
	for (let i = 0; i < 40; i++) {
		await pause(150);
		pagesAfter = ((await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())) as Array<{ type: string }>).filter((item) => item.type === "page").length;
		if (pagesAfter > pagesBefore) break;
	}
	check("Open in → New window opens a real BrowserWindow", pagesAfter > pagesBefore, { pagesBefore, pagesAfter });
	await hold(1400);

	const composers = await page.evaluate<number>(`document.querySelectorAll('[data-ly-split-pane] textarea.ly-composer-text').length`);
	check("every remaining pane still has its own composer", composers === afterMenu, { composers, afterMenu });
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_分屏新窗口_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	if (sessionFrames.length) await encode(sessionFrames, join(out, `${name}_对话窗口.mp4`), 12);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
