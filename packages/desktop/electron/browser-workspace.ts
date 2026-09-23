import { randomUUID } from "node:crypto";
import { nativeImage, webContents, type BrowserWindow, type NativeImage, type WebContents } from "electron";
import { browserUrl, browserViewport, browserZoom, type BrowserCommand, type BrowserPointer, type BrowserState, type BrowserTab } from "../shared/browser.ts";
import { eachAppWindow } from "./window.ts";

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
	const recipients = new Set<WebContents>();
	if (window && !window.isDestroyed()) recipients.add(window.webContents);
	// Empty detached browsers need the first tab before they have a guest of their own.
	eachAppWindow((win) => recipients.add(win.webContents));
	for (const recipient of recipients) {
		if (!recipient.isDestroyed()) recipient.send("browser:changed", { ...browserState(), reveal });
	}
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

/**
 * Load a page into this conversation's current tab, or into a new one.
 *
 * `reveal` is whether the panel comes forward for it, and only a person asks for that: the address
 * bar, a bookmark, a preview link. An agent opening a page to debug it used to pull the panel over
 * the conversation, and then again on every click it made there (`selectBrowser`), even after it
 * had just been closed. Its pages load and run the same either way — the panel is kept mounted
 * while closed, see `DockView` — and the conversation shows a card to open them from.
 */
export async function openBrowser(url: string, sessionId: string | null, newTab = false, reveal = true): Promise<string> {
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
		publish(reveal);
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
	publish(reveal);
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
	// A page opening a window is not a person asking to look — least of all a page an agent is clicking through.
	contents.setWindowOpenHandler(({ url: next }) => {
		void openBrowser(next, tab.state.sessionId, true, false).catch((error: unknown) => { tab.state.error = String(error); publish(); });
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
		// From the renderer, which means a person picked it.
		case "select": await selectBrowser(command.id, true); break;
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
/**
 * Make a tab its conversation's current one.
 *
 * `reveal` as in `openBrowser`. An agent selects a tab before every action it takes in it, so this
 * is the path that brought a closed panel back on each click.
 */
export async function selectBrowser(id: string, reveal: boolean): Promise<void> {
	const tab = tabs.get(id);
	if (!tab) throw new Error("浏览器标签已关闭");
	const contents = await awakeBrowser(id);
	selectTab(tab);
	// Chromium shares zoom by origin; restore this tab's preference when bringing it forward.
	contents.setZoomFactor(tab.state.zoom);
	fitViewport(tab);
	publish(reveal);
}

/** Pointer coordinates belong to the tab, so navigation and page top layers cannot erase them. */
export function pointBrowser(id: string, point: Omit<BrowserPointer, "sequence">): void {
	const tab = tabs.get(id);
	if (!tab) throw new Error("浏览器标签已关闭");
	tab.state.pointer = { ...point, sequence: (tab.state.pointer?.sequence ?? 0) + 1 };
	publish();
}
function closeBrowser(id: string): void {
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

/** The card's picture: pixels across (its 420 CSS pixels on a 2× screen), and its shape — the top of the page. */
const THUMB_WIDTH = 840;
const THUMB_RATIO = 0.5;

/**
 * The top of what a tab shows, small, as JPEG — the picture on the conversation's browser card.
 *
 * `capturePage` takes its rectangle in the page's CSS pixels and hands back device pixels; `resize`
 * then counts output pixels. So the crop is asked for in the one and the width given in the other.
 * `null` for a tab with no page behind it: a picture is not worth waking a sleeping page for.
 */
export async function browserThumbnail(id: string): Promise<Buffer | null> {
	const tab = tabs.get(id);
	const contents = tab?.contents;
	if (!tab?.size || !contents || contents.isDestroyed()) return null;
	const width = Math.round(tab.size.width);
	const height = Math.round(Math.min(tab.size.height, tab.size.width * THUMB_RATIO));
	if (width <= 0 || height <= 0) return null;
	const image = await contents.capturePage({ x: 0, y: 0, width, height });
	if (image.isEmpty()) return null;
	return onWhite(image.resize({ width: THUMB_WIDTH, quality: "good" })).toJPEG(72);
}

/**
 * A capture flattened onto white — the canvas any browser draws under a page.
 *
 * A guest paints nothing where its page sets no background; on screen the `<webview>`'s white shows
 * through, but a capture is of the guest alone. On a page with no background of its own, 98% of what
 * `capturePage` returned was transparent: black once a thumbnail was made a JPEG, and a backdrop the
 * model could only guess at behind a screenshot's text — whose antialiased edges are themselves
 * half-transparent. Done on the pixels rather than by giving the page a background, so what an agent
 * reads from the page, its computed styles included, stays the page's own.
 *
 * `toBitmap` is premultiplied, so the white that shows through is added to each channel as it is;
 * clamped all the same, since the layout is the platform's to choose. The pixel size is read off the
 * buffer, because which of pixels or points `getSize` reports is not something the API promises.
 */
export function onWhite(image: NativeImage): NativeImage {
	const scaleFactor = Math.max(1, ...image.getScaleFactors());
	const size = image.getSize(scaleFactor);
	const pixels = image.toBitmap({ scaleFactor });
	const scale = Math.round(Math.sqrt(pixels.length / 4 / Math.max(1, size.width * size.height))) || 1;
	const width = size.width * scale;
	const height = size.height * scale;
	if (width * height * 4 !== pixels.length) return image;
	let clear = false;
	for (let alpha = 3; alpha < pixels.length; alpha += 4) {
		const through = 255 - pixels[alpha];
		if (through === 0) continue;
		clear = true;
		pixels[alpha - 3] = Math.min(255, pixels[alpha - 3] + through);
		pixels[alpha - 2] = Math.min(255, pixels[alpha - 2] + through);
		pixels[alpha - 1] = Math.min(255, pixels[alpha - 1] + through);
		pixels[alpha] = 255;
	}
	return clear ? nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: scale }) : image;
}
