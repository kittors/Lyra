import type { WebContents } from "electron";
import { browserContents, browserState, browserScale, pointBrowser, selectBrowser } from "./browser-workspace.ts";

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
	/**
	 * A credential's value to type instead of `text`, and where it may be typed. Filled in by
	 * `browser-tools.ts` from the conversation's credentials; it never leaves this process.
	 */
	secret?: { value: string; expect?: { protocol: string; host: string; port?: string } };
}

/**
 * Check the page and fill the field in one synchronous script, in the isolated world.
 *
 * One script, because two steps — check the origin, then type — leave the page a moment to navigate
 * itself between them: Browser Use's domain check only ever saw the agent's own navigations, and a
 * page's script, a redirect or `window.open` went straight past it (browser-use#5815). Here the page
 * cannot move between the check and the write. The native setter and an `input` event are what a
 * framework's controlled input listens to; the page's own scripts never see this one.
 *
 * The field is masked as it is filled (`-webkit-text-security`), so a screenshot shows dots even if
 * the model presses "show password" — measured: the style stays on the element when its type flips.
 */
function fillScript(selector: string, secret: NonNullable<BrowserAction["secret"]>): string {
	return `(() => {
		const expect = ${JSON.stringify(secret.expect ?? null)};
		if (expect && (location.protocol !== expect.protocol + ":" || location.hostname.toLowerCase() !== expect.host || (expect.port && location.port !== expect.port))) return { refused: location.origin };
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return { notInput: true };
		const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(secret.value)});
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
		el.style.setProperty("-webkit-text-security", "disc", "important");
		return { origin: location.origin, echoed: (document.body?.innerText ?? "").includes(${JSON.stringify(secret.value)}) };
	})()`;
}

/**
 * Masks every field holding one of `values`, before a picture of the page is taken.
 *
 * Found by what is in them rather than remembered from the fill, because a framework that rebuilds
 * a node rebuilds it without the style. Left in place afterwards: the person sees dots in the panel
 * too. Best effort — a page that cannot be reached is a page with nothing to mask.
 */
export async function maskFilled(id: string, values: readonly string[], sessionId?: string): Promise<void> {
	if (values.length === 0) return;
	const code = `((values) => {
		for (const el of document.querySelectorAll("input, textarea, [contenteditable]")) {
			const text = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? "");
			if (text && values.some((value) => text.includes(value))) el.style.setProperty("-webkit-text-security", "disc", "important");
		}
	})(${JSON.stringify(values)})`;
	await browserContents(id, sessionId).executeJavaScriptInIsolatedWorld(WORLD, [{ code }]).catch(() => {});
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
	// Selected, never revealed: the panel is the person's to open. See `openBrowser`.
	await selectBrowser(id, false);
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
	/*
	 * Native input is queued in the guest; a frame observes its committed focus and DOM effects.
	 *
	 * A frame, or a tenth of a second if none comes. An agent's page whose conversation is off screen
	 * sits in a `visibility: hidden` host and draws no frames — while telling itself it is visible:
	 * measured, `document.visibilityState` reads "visible" there, so it cannot be asked. Waiting on
	 * the frame alone timed out at 15 seconds and reported the page unresponsive after a click that
	 * had in fact landed, on every click, for as long as the person looked at another conversation.
	 * Press and release are discrete events and are not held for a frame, so the fallback still
	 * waits on something real; on screen the frame arrives first and nothing changes.
	 */
	await evaluatePage(contents, "new Promise((resolve) => { requestAnimationFrame(() => resolve()); setTimeout(resolve, 100); })");
	if (action.action === "type" && action.secret) {
		const outcome = (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: fillScript(action.selector, action.secret) }])) as { refused?: string; notInput?: true; origin?: string; echoed?: boolean };
		if (outcome?.refused) {
			const expect = action.secret.expect!;
			throw new Error(`This page is not where the credential may be used: it is ${outcome.refused}, and the credential is only for ${expect.protocol}://${expect.host}${expect.port ? `:${expect.port}` : ""}.`);
		}
		if (outcome?.notInput) throw new Error("A credential can only be typed into an input or a textarea.");
		// What was typed is not said back; only where, and whether the page shows it.
		return { action: "type", filled: true, origin: outcome?.origin, ...(outcome?.echoed ? { warning: "The page shows the value that was typed." } : {}) };
	}
	if (action.action === "type") {
		if (action.text === undefined) throw new Error("type 需要 text");
		await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(() => {const el=document.activeElement;if(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement){el.select();}else if(el?.isContentEditable){const s=getSelection();const r=document.createRange();r.selectNodeContents(el);s.removeAllRanges();s.addRange(r);}else{throw new Error('目标不是输入框');}})()` }]);
		await contents.insertText(action.text);
	}
	return { action: action.action, url: contents.getURL(), point };
}
