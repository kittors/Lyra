import type { WebContents } from "electron";
import { browserContents, browserCommand, browserState, browserScale, pointBrowser } from "./browser-workspace.ts";

/** Automation chrome lives in an isolated world, never in a page's JavaScript globals. */
const WORLD = 999;
async function evaluatePage(contents: WebContents, expression: string): Promise<unknown> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			contents.executeJavaScript(expression, true),
			new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("页面 15 秒内没有响应")), 15_000); }),
		]);
	} finally { clearTimeout(timer); }
}

export async function readBrowser(id: string): Promise<unknown> {
	return evaluatePage(browserContents(id), `({ title: document.title, url: location.href,
		text: (document.querySelector('main,article,[role=main]') || document.body).innerText.slice(0,40000),
		elements: [...document.querySelectorAll('a,button,input,textarea,select,[role=button]')].filter(e=>e.getClientRects().length).slice(0,120).map(e=>({tag:e.tagName, id:e.id, role:e.getAttribute('role'), label:e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder'), type:e.getAttribute('type')})) })`);
}

export interface BrowserAction {
	action: "click" | "type" | "links" | "eval" | "read" | "scroll" | "press" | "hover";
	selector?: string;
	text?: string;
	expression?: string;
	x?: number;
	y?: number;
}

async function pointAt(contents: WebContents, selector?: string): Promise<{ x: number; y: number }> {
	const result: unknown = await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(() => {
		const selector = ${JSON.stringify(selector ?? null)};
		if (selector === null) return {x: innerWidth / 2, y: innerHeight / 2};
		const el = document.querySelector(selector);
		if (!el) throw new Error('没有找到元素，请重新读取页面');
		el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
		const r = el.getBoundingClientRect();
		const left = Math.max(0,r.left), top = Math.max(0,r.top), right = Math.min(innerWidth,r.right), bottom = Math.min(innerHeight,r.bottom);
		if (right <= left || bottom <= top) throw new Error('元素不可见');
		return {x:(left+right)/2,y:(top+bottom)/2};
	})()` }]);
	if (!result || typeof result !== "object" || !("x" in result) || !("y" in result) || typeof result.x !== "number" || typeof result.y !== "number" || !Number.isFinite(result.x) || !Number.isFinite(result.y)) throw new Error("无法定位元素");
	return { x: result.x, y: result.y };
}

export async function actBrowser(id: string, action: BrowserAction, sessionId?: string): Promise<unknown> {
	const contents = browserContents(id, sessionId);
	await browserCommand({ type: "select", id });
	if (action.action === "read") return readBrowser(id);
	if (action.action === "links") return evaluatePage(contents, `Array.from(document.querySelectorAll('a[href]')).slice(0,200).map(a=>({text:a.innerText,href:a.href}))`);
	if (action.action === "eval") {
		if (!action.expression) throw new Error("eval 需要 expression");
		return evaluatePage(contents, action.expression);
	}
	if (action.action === "scroll") {
		if (![action.x ?? 0, action.y ?? 0].every(Number.isFinite)) throw new Error("滚动距离必须为数字");
		pointBrowser(id, { ...await pointAt(contents), action: "scroll" });
		return evaluatePage(contents, `window.scrollBy({left:${action.x ?? 0},top:${action.y ?? 0},behavior:'instant'})`);
	}
	if (action.action === "press") {
		const key = action.text;
		if (!key || !["Enter", "Tab", "Escape", "Backspace", "Delete", "Up", "Down", "Left", "Right", "Space", "Home", "End"].includes(key)) throw new Error("press 需要 Enter/Tab/Escape/Backspace/Delete/Up/Down/Left/Right/Space/Home/End");
		contents.focus();
		const pointer = browserState().tabs.find((tab) => tab.id === id)?.pointer;
		pointBrowser(id, { ...pointer ?? await pointAt(contents), action: "press" });
		contents.sendInputEvent({ type: "keyDown", keyCode: key });
		contents.sendInputEvent({ type: "keyUp", keyCode: key });
		return { pressed: key };
	}
	if (!action.selector) throw new Error("操作需要当前页面中确认过的 selector");
	contents.focus();
	const point = await pointAt(contents, action.selector);
	pointBrowser(id, { ...point, action: action.action });
	const zoom = browserState().tabs.find((tab) => tab.id === id)?.zoom ?? 1;
	const position = { x: Math.round(point.x * zoom * browserScale(id)), y: Math.round(point.y * zoom * browserScale(id)) };
	contents.sendInputEvent({ type: "mouseMove", ...position });
	if (action.action === "hover") return point;
	contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...position });
	contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...position });
	// Native input is queued in the guest; a frame observes its committed focus and DOM effects.
	await evaluatePage(contents, "new Promise(requestAnimationFrame)");
	if (action.action === "type") {
		if (action.text === undefined) throw new Error("type 需要 text");
		await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(() => {const el=document.activeElement;if(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement){el.select();}else if(el?.isContentEditable){const s=getSelection();const r=document.createRange();r.selectNodeContents(el);s.removeAllRanges();s.addRange(r);}else{throw new Error('目标不是输入框');}})()` }]);
		await contents.insertText(action.text);
	}
	return { action: action.action, url: contents.getURL(), point };
}
