import { randomUUID } from "node:crypto";
import { webContents, type BrowserWindow, type WebContents } from "electron";
import { browserUrl, browserViewport, browserZoom, type BrowserCommand, type BrowserPointer, type BrowserState, type BrowserTab } from "../shared/browser.ts";

interface Tab { size?: {width: number; height: number}; scale?: number; state: BrowserTab; contents?: WebContents; ready: Promise<WebContents>; resolve: (contents: WebContents) => void; reject: (error: Error) => void }
const tabs = new Map<string, Tab>();
let activeId: string | null = null;
/**
 * The tab each conversation is on, keyed by session id (`""` for none).
 *
 * `activeId` is one value for the whole app — the last tab anybody selected — and reusing it for
 * "the tab to load into" meant an agent whose conversation was off screen either wrote over the
 * tab the user was looking at, or, once tabs were scoped per conversation, opened a new one on
 * every call. A conversation's current tab is a property of that conversation.
 */
const activeBySession = new Map<string, string>();
const sessionKey = (sessionId: string | null): string => sessionId ?? "";
function selectTab(tab: Tab): void {
	activeId = tab.state.id;
	activeBySession.set(sessionKey(tab.state.sessionId), tab.state.id);
}
let host: (() => BrowserWindow | null) = () => null;
let preferences: () => { defaultZoom?: number } = () => ({});
export function configureBrowser(window: () => BrowserWindow | null, settings: () => { defaultZoom?: number }): void { host = window; preferences = settings; }
export function browserState(): BrowserState { return { tabs: [...tabs.values()].map((tab) => ({ ...tab.state })), activeId }; }
function publish(reveal = false): void {
	const window = host();
	if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("browser:changed", { ...browserState(), reveal });
}
export function browserContents(id: string, sessionId?: string): WebContents {
	const tab = tabs.get(id);
	if (!tab || !tab.contents || tab.contents.isDestroyed()) throw new Error("浏览器标签已关闭");
	if (sessionId !== undefined && tab.state.sessionId !== sessionId) throw new Error("这个浏览器标签属于其他会话");
	return tab.contents;
}

/**
 * The same page, waited for rather than demanded.
 *
 * A tab whose conversation is off screen has no page behind it — the panel drops those to give the
 * renderer processes back — so an agent working in one would otherwise be told its own tab was
 * closed. Asking marks it `wanted`, which is the panel's cue to mount it again; the page comes back
 * at the address the tab still holds, which is the same recovery a discarded tab gets anywhere else.
 */
export async function awakeBrowser(id: string, sessionId?: string): Promise<WebContents> {
	const tab = tabs.get(id);
	if (!tab) throw new Error("浏览器标签已关闭");
	if (sessionId !== undefined && tab.state.sessionId !== sessionId) throw new Error("这个浏览器标签属于其他会话");
	if (tab.contents && !tab.contents.isDestroyed()) return tab.contents;
	tab.state.wanted = true;
	publish();
	return readyBrowser(tab);
}
function refresh(tab: Tab): void {
	const contents = tab.contents;
	if (!contents) return;
	if (contents.isDestroyed()) return;
	tab.state = { ...tab.state, title: contents.getTitle(), url: contents.getURL(), loading: contents.isLoading(),
		canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward() };
	publish();
}

export async function openBrowser(url: string, sessionId: string | null, newTab = false): Promise<string> {
	const location = browserUrl(url);
	const current = tabs.get(activeBySession.get(sessionKey(sessionId)) ?? "");
	const existing = !newTab && current?.state.sessionId === sessionId ? current : undefined;
	if (existing) {
		existing.state.error = undefined;
		existing.state.url = location;
		// `wanted`, because this tab may be asleep: nothing mounts it while its conversation is off
		// screen, and `readyBrowser` below would wait out its full timeout for a page nobody built.
		existing.state.wanted = true;
		selectTab(existing);
		publish(true);
		const contents = await readyBrowser(existing);
		await contents.loadURL(location);
		return existing.state.id;
	}
	if (tabs.size >= 20) throw new Error("最多打开 20 个标签，请先关闭不用的页面");
	const id = randomUUID();
	let resolve!: (contents: WebContents) => void;
	let reject!: (error: Error) => void;
	const ready = new Promise<WebContents>((done, fail) => { resolve = done; reject = fail; });
	// A closed pending tab may have no waiter after an open timeout.
	void ready.catch(() => {});
	const tab: Tab = { resolve, reject, ready, state: { id, sessionId, url: location, title: "新标签页", loading: true, canGoBack: false, canGoForward: false, zoom: browserZoom(preferences().defaultZoom ?? 1), viewport: null, wanted: true } };
	tabs.set(id, tab);
	selectTab(tab);
	publish(true);
	await readyBrowser(tab);
	return id;
}

async function readyBrowser(tab: Tab): Promise<WebContents> {
	let timer: NodeJS.Timeout | undefined;
	try {
		if (tab.contents && !tab.contents.isDestroyed()) return tab.contents;
		return await Promise.race([tab.ready, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("浏览器面板没有在 30 秒内就绪")), 30_000); })]);
	} finally { clearTimeout(timer); }
}

/** Only the main app may attach one of its sandboxed guests to a tab. */
export function attachBrowser(id: string, contentsId: number, sender: WebContents): void {
	const tab = tabs.get(id);
	const contents = webContents.fromId(contentsId);
	if (!tab || !contents || contents.getType() !== "webview" || contents.hostWebContents !== sender) throw new Error("无效的浏览器页面");
	if (tab.contents === contents) return;
	if (tab.contents && !tab.contents.isDestroyed()) throw new Error("标签已经连接另一个页面");
	tab.contents = contents;
	// The page exists; from here the panel decides on its own how long to keep it.
	tab.state.wanted = undefined;
	contents.on("did-start-loading", () => refresh(tab));
	contents.on("did-stop-loading", () => refresh(tab));
	contents.on("did-navigate", () => refresh(tab));
	contents.on("did-navigate-in-page", () => refresh(tab));
	contents.on("page-title-updated", () => refresh(tab));
	contents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
		if (code !== -3 && mainFrame) { tab.state.error = description; refresh(tab); }
	});
	contents.on("render-process-gone", (_event, detail) => { tab.state.error = `页面进程已停止：${detail.reason}`; publish(); });
	contents.on("will-navigate", (event, next) => {
		try { browserUrl(next); } catch { event.preventDefault(); }
	});
	contents.on("will-redirect", (event, next) => {
		try { browserUrl(next); } catch { event.preventDefault(); }
	});
	contents.setWindowOpenHandler(({ url: next }) => {
		void openBrowser(next, tab.state.sessionId, true).catch((error: unknown) => { tab.state.error = String(error); publish(); });
		return { action: "deny" };
	});
	contents.setZoomFactor(tab.state.zoom);
	contents.once("destroyed", () => {
		if (!tabs.has(id)) return;
		tab.contents = undefined;
		tab.ready = new Promise<WebContents>((resolve, reject) => { tab.resolve = resolve; tab.reject = reject; });
		void tab.ready.catch(() => {});
	});
	fitViewport(tab);
	refresh(tab);
	tab.resolve(contents);
}

export async function browserCommand(command: BrowserCommand): Promise<BrowserState> {
	if (command.type === "open") { await openBrowser(command.url, command.sessionId, command.newTab); return browserState(); }
	if (command.type === "close") { closeBrowser(command.id); return browserState(); }
	const tab = tabs.get(command.id);
	// A ResizeObserver notification may arrive after the user closed its guest.
	if (!tab && command.type === "resize") return browserState();
	if (!tab) throw new Error("浏览器标签已关闭");
	if (command.type === "resize") {
		if (!Number.isFinite(command.width) || !Number.isFinite(command.height) || command.width <= 0 || command.height <= 0) throw new Error("无效的页面尺寸");
		tab.size = { width: command.width, height: command.height }; fitViewport(tab); return browserState();
	}
	const contents = await awakeBrowser(command.id);
	switch (command.type) {
		// Chromium shares zoom by origin; restore this tab's preference when bringing it forward.
		case "select": selectTab(tab); contents.setZoomFactor(tab.state.zoom); fitViewport(tab); publish(true); break;
		case "back": if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); break;
		case "forward": if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward(); break;
		case "reload": tab.state.error = undefined; contents.reload(); break;
		case "devtools": contents.openDevTools({ mode: "detach" }); break;
		case "zoom": tab.state.zoom = browserZoom(command.factor); contents.setZoomFactor(tab.state.zoom); break;
		case "viewport": {
			tab.state.viewport = browserViewport(command.viewport);
			fitViewport(tab);
			break;
		}
		default: throw new Error("未知浏览器操作");
	}
	publish();
	return browserState();
}
/** Pointer coordinates belong to the tab, so navigation and page top layers cannot erase them. */
export function pointBrowser(id: string, point: Omit<BrowserPointer, "sequence">): void {
	const tab = tabs.get(id);
	if (!tab) throw new Error("浏览器标签已关闭");
	tab.state.pointer = { ...point, sequence: (tab.state.pointer?.sequence ?? 0) + 1 };
	publish();
}
export function closeBrowser(id: string): void {
	const tab = tabs.get(id);
	if (!tab) return;
	tabs.delete(id);
	// The conversation falls back to its own remaining tab, not to whatever tab is newest overall.
	const key = sessionKey(tab.state.sessionId);
	if (activeBySession.get(key) === id) {
		const fallback = [...tabs.values()].findLast((entry) => sessionKey(entry.state.sessionId) === key);
		if (fallback) activeBySession.set(key, fallback.state.id);
		else activeBySession.delete(key);
	}
	if (activeId === id) activeId = [...tabs.keys()].at(-1) ?? null;
	if (tab.contents && !tab.contents.isDestroyed()) tab.contents.close();
	else tab.reject(new Error("浏览器标签已关闭"));
	publish();
}
export function closeSessionBrowser(sessionId: string): void {
	for (const tab of tabs.values()) if (tab.state.sessionId === sessionId) closeBrowser(tab.state.id);
}

function fitViewport(tab: Tab): void {
	const contents = tab.contents;
	if (!contents || contents.isDestroyed()) return;
	const viewport = tab.state.viewport;
	tab.scale = viewport && tab.size ? Math.min(1, tab.size.width / viewport.width, tab.size.height / viewport.height) : 1;
	if (viewport) contents.enableDeviceEmulation({ screenPosition: "desktop", screenSize: viewport, viewSize: viewport, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, scale: tab.scale });
	else contents.disableDeviceEmulation();
}
export function browserScale(id: string): number { return tabs.get(id)?.scale ?? 1; }
