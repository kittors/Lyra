export interface BrowserViewport { width: number; height: number }
export interface BrowserPointer { x: number; y: number; action: "click" | "type" | "hover" | "scroll" | "press"; sequence: number }
export interface BrowserTab {
	id: string;
	sessionId: string | null;
	url: string;
	title: string;
	loading: boolean;
	error?: string;
	canGoBack: boolean;
	canGoForward: boolean;
	zoom: number;
	viewport: BrowserViewport | null;
	pointer?: BrowserPointer;
	/**
	 * The main process is waiting for this tab's page to exist.
	 *
	 * Tabs belonging to conversations you are not looking at are unmounted to get their renderer
	 * processes back, which is fine until an agent in one of them reaches for its own tab. This is
	 * how it asks for it back: set before the wait, cleared once the page attaches.
	 */
	wanted?: boolean;
}
export interface BrowserState { tabs: BrowserTab[]; activeId: string | null }
export interface BrowserSelection {
	url: string;
	title: string;
	selector: string;
	html: string;
	text: string;
	styles: Record<string, string>;
	bounds: { x: number; y: number; width: number; height: number };
	screenshot: string;
}
export type BrowserCommand =
	| { type: "open"; url: string; sessionId: string | null; newTab?: boolean }
	| { type: "select" | "close" | "back" | "forward" | "reload" | "devtools"; id: string }
	| { type: "zoom"; id: string; factor: number }
	| { type: "resize"; id: string; width: number; height: number }
	| { type: "viewport"; id: string; viewport: BrowserViewport | null };

export function browserUrl(raw: string): string {
	const text = raw.trim();
	if (!text) return "about:blank";
	const url = new URL(/^[a-z][\w+.-]*:/i.test(text) && !/^[\w.-]+:\d/.test(text) ? text : `https://${text}`);
	if (!["http:", "https:", "ly-preview:"].includes(url.protocol) && url.href !== "about:blank") throw new Error("只允许网页地址或 Lyra 本地预览");
	return url.href;
}

export type BrowserSearchEngine = "bing" | "google" | "baidu" | "duckduckgo" | "custom";
export interface BrowserSearchSettings { searchEngine?: BrowserSearchEngine; searchUrl?: string }

/**
 * The engines the address bar can hand a query to, in the order the settings page lists them.
 *
 * `%s` is where the query goes, spelled the way every browser spells it, so a template copied
 * from one of them works here. `custom` is absent because it has no template of its own — it is
 * the user's, kept in `searchUrl`.
 *
 * Baidu is asked for UTF-8 explicitly: without `ie`, it reads the query as GBK and a Chinese
 * search returns mojibake rather than results.
 */
export const BROWSER_SEARCH_ENGINES: { id: Exclude<BrowserSearchEngine, "custom">; label: string; template: string }[] = [
	{ id: "bing", label: "必应", template: "https://www.bing.com/search?q=%s" },
	{ id: "google", label: "Google", template: "https://www.google.com/search?q=%s" },
	{ id: "baidu", label: "百度", template: "https://www.baidu.com/s?ie=utf-8&wd=%s" },
	{ id: "duckduckgo", label: "DuckDuckGo", template: "https://duckduckgo.com/?q=%s" },
];

/** Reads as a noun in `用${label}搜索`, which is where it is used — so `custom` is 自定义, not 自定义搜索. */
export function browserSearchLabel(settings?: BrowserSearchSettings): string {
	if (settings?.searchEngine === "custom") return "自定义";
	return BROWSER_SEARCH_ENGINES.find((engine) => engine.id === settings?.searchEngine)?.label ?? BROWSER_SEARCH_ENGINES[0]!.label;
}

/**
 * Whether what was typed is an address, or something to look up.
 *
 * The address bar used to send everything through `browserUrl`, which prefixes `https://` and asks
 * the network for it — so `天气` became `https://xn--rss235b/` and the page said
 * `ERR_ADDRESS_UNREACHABLE`. Typing words into the address bar is not a mistake; it is how the
 * thing has worked everywhere else for fifteen years.
 *
 * Two decisions are load-bearing:
 *
 * - A scheme without `//` — `javascript:alert(1)`, `mailto:x@y.com`, `data:text/html,hi` — is a
 *   query, not an address. Searching for it is inert; treating it as a location is how an address
 *   bar becomes an execution surface. `scheme://` still goes to `browserUrl`, which allows exactly
 *   `http`, `https` and `ly-preview` and rejects the rest with a message.
 * - A host counts only if its last label is two or more letters. That keeps `3.14` and `1.5.0` out
 *   (a number is not a TLD) while letting `例子.中国` in, which a hard-coded TLD list would not.
 */
export function browserAddressLike(raw: string): boolean {
	const text = raw.trim();
	// A space is the one signal no host can carry, so it settles the question before anything else.
	if (!text || /\s/.test(text)) return false;
	if (text === "about:blank") return true;
	// `host:port` first: `localhost:3000` looks like a scheme to the pattern below it.
	if (/^[\w.-]+:\d+(?:[/?#]|$)/.test(text)) return true;
	if (/^[a-z][\w+.-]*:/i.test(text)) return /^[a-z][\w+.-]*:\/\//i.test(text);
	const host = text.split(/[/?#]/)[0] ?? "";
	if (host === "localhost") return true;
	if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || /^\[[\da-f:]+\](?::\d+)?$/i.test(host)) return true;
	const labels = host.split(".");
	// `\p{L}` and not `\w`: `\w` is ASCII-only, which would read `中国` as not a word at all.
	return labels.length > 1 && labels.every(Boolean) && /^\p{L}{2,}$/u.test(labels.at(-1) ?? "");
}

/** The search template in use, falling back to Bing whenever the custom one cannot carry a query. */
export function browserSearchTemplate(settings?: BrowserSearchSettings): string {
	const custom = settings?.searchEngine === "custom" ? settings.searchUrl?.trim() : undefined;
	const preset = BROWSER_SEARCH_ENGINES.find((engine) => engine.id === settings?.searchEngine)?.template;
	return (custom?.includes("%s") ? custom : preset) ?? BROWSER_SEARCH_ENGINES[0]!.template;
}

export function browserSearchUrl(query: string, settings?: BrowserSearchSettings): string {
	return browserUrl(browserSearchTemplate(settings).replaceAll("%s", encodeURIComponent(query)));
}

/** Rejects a custom template the address bar could not use, with the reason to show under the field. */
export function browserSearchCustom(raw: string): string {
	const text = raw.trim();
	if (!text.includes("%s")) throw new Error("地址里要有 %s，搜索词填在那个位置");
	const probe = browserUrl(text.replaceAll("%s", "lyra"));
	if (!probe.startsWith("http:") && !probe.startsWith("https:")) throw new Error("搜索地址只能是 http 或 https");
	return text;
}

export interface BrowserOmnibox { kind: "open" | "search"; url: string; query: string }

/** What the address bar does with what was typed. Throws for an address the browser must refuse. */
export function browserOmnibox(raw: string, settings?: BrowserSearchSettings): BrowserOmnibox {
	const text = raw.trim();
	if (!text || browserAddressLike(text)) return { kind: "open", url: browserUrl(text), query: text };
	return { kind: "search", url: browserSearchUrl(text, settings), query: text };
}

export function browserZoom(factor: number): number {
	if (!Number.isFinite(factor) || factor < 0.25 || factor > 3) throw new Error("缩放范围为 25%–300%");
	return factor;
}

export function browserViewport(value: BrowserViewport | null): BrowserViewport | null {
	if (value === null) return null;
	if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 240 || value.width > 3840 || value.height < 240 || value.height > 2160) throw new Error("视口范围为 240–3840 × 240–2160");
	return { width: value.width, height: value.height };
}

/** IPC data is not made safe by a TypeScript annotation. */
export function parseBrowserCommand(value: unknown): BrowserCommand {
	if (!value || typeof value !== "object" || !("type" in value)) throw new Error("无效的浏览器操作");
	if (value.type === "open") {
		if (!("url" in value) || typeof value.url !== "string" || !("sessionId" in value) || (value.sessionId !== null && typeof value.sessionId !== "string") || ("newTab" in value && typeof value.newTab !== "boolean")) throw new Error("无效的打开请求");
		return { type: "open", url: browserUrl(value.url), sessionId: value.sessionId, newTab: "newTab" in value && value.newTab === true };
	}
	if (!("id" in value) || typeof value.id !== "string") throw new Error("需要标签 ID");
	const id = value.id;
	switch (value.type) {
		case "select": case "close": case "back": case "forward": case "reload": case "devtools": return { type: value.type, id };
		case "zoom": if (!("factor" in value) || typeof value.factor !== "number") throw new Error("需要缩放比例"); return { type: "zoom", id, factor: browserZoom(value.factor) };
		case "resize": if (!("width" in value) || typeof value.width !== "number" || !("height" in value) || typeof value.height !== "number") throw new Error("需要页面尺寸"); return { type: "resize", id, width: value.width, height: value.height };
		case "viewport": {
			if (!("viewport" in value)) throw new Error("需要视口尺寸");
			const viewport = value.viewport;
			if (viewport === null) return { type: "viewport", id, viewport };
			if (!viewport || typeof viewport !== "object" || !("width" in viewport) || typeof viewport.width !== "number" || !("height" in viewport) || typeof viewport.height !== "number") throw new Error("无效的视口尺寸");
			return { type: "viewport", id, viewport: browserViewport({ width: viewport.width, height: viewport.height }) };
		}
		default: throw new Error("未知浏览器操作");
	}
}
