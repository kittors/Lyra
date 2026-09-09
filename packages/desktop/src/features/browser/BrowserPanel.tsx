import { ArrowLeft, ArrowRight, Bookmark, ChevronLeft, ChevronRight, CodeXml, Ellipsis, Globe, Minus, MousePointer2, Plus, RotateCw, Scan, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BrowserCommand, BrowserSelection } from "../../../shared/browser.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { PanelEmpty } from "../../ui/layout/PanelEmpty.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Popover, MenuBody, MenuItem, MenuSeparator, usePopover } from "../../ui/overlay/Popover.tsx";
import { AddressBar } from "./AddressBar.tsx";
import { BrowserPage } from "./BrowserPage.tsx";
import { BrowserSelectionCard } from "./BrowserSelectionCard.tsx";
import { browserChose, browserMounted, browserOwner, browserVisited, commandBrowser, useBrowser, useBrowserView } from "./browser-store.ts";

export function BrowserPanel() {
	const all = useBrowser((state) => state.tabs);
	const activeId = useBrowser((state) => state.activeId);
	const sessionId = useApp((state) => state.activeSessionId);
	const turns = useApp((state) => state.turns);
	const recent = useBrowserView((state) => state.recent);
	const chosen = useBrowserView((state) => state.chosen);
	const owner = browserOwner(sessionId);
	useEffect(() => { browserVisited(sessionId); }, [sessionId]);
	/*
	 * A conversation sees its own tabs, and only its own.
	 *
	 * They were always owned by one — that is what scopes the agent's tools — but the panel showed
	 * every tab there was, so switching conversations left the same page on screen and made the
	 * ownership invisible. The tab on screen is this conversation's current one: what the main
	 * process last selected if that belongs here, else the one this conversation was left on.
	 */
	const tabs = all.filter((entry) => browserOwner(entry.sessionId) === owner);
	const tab = tabs.find((entry) => entry.id === activeId) ?? tabs.find((entry) => entry.id === chosen[owner]) ?? tabs.at(-1);
	const mounted = browserMounted(all, owner, recent, turns);
	const settings = useApp((state) => state.settings);
	const saveSettings = useApp((state) => state.saveSettings);
	const addressInput = useRef<HTMLInputElement>(null);
	const [selection, setSelection] = useState<BrowserSelection | null>(null);
	const [inspecting, setInspecting] = useState<string | null>(null);
	const inspection = useRef({ generation: 0, id: "" });
	const [width, setWidth] = useState("1440"), [height, setHeight] = useState("900");
	useEffect(() => () => { inspection.current.generation++; if (inspection.current.id) void bridge.browser.cancelInspect(inspection.current.id).catch(() => {}); }, [tab?.id, tab?.url]);
	const options = usePopover();
	const [menu, setMenu] = useState<"actions" | "bookmarks" | "viewport">("actions");
	const blank = !tab || tab.url === "about:blank";
	useEffect(() => { setSelection(null); setInspecting(null); }, [tab?.id, tab?.url]);
	const command = (type: "back" | "forward" | "reload" | "devtools") => { if (tab) void commandBrowser({ type, id: tab.id }); };
	const open = (url: string, newTab = false) => void commandBrowser({ type: "open", url, sessionId: useApp.getState().activeSessionId, newTab });
	const mark = async () => {
		if (!tab || !settings) return;
		const list = settings.browser?.bookmarks ?? [];
		await saveSettings({ ...settings, browser: { ...settings.browser, bookmarks: list.some((entry) => entry.url === tab.url) ? list.filter((entry) => entry.url !== tab.url) : [...list, { url: tab.url, title: tab.title || tab.url }] } });
	};
	const inspect = async (mode: "element" | "region") => {
		if (!tab) return;
		const generation = ++inspection.current.generation; inspection.current.id = tab.id;
		setInspecting(tab.id);
		try { const result = await bridge.browser.inspect(tab.id, mode); if (generation === inspection.current.generation) setSelection(result); }
		catch (error) { useApp.getState().notify(String(error), "error"); }
		finally { if (generation === inspection.current.generation) { setInspecting(null); inspection.current.id = ""; } }
	};
	const saved = settings?.browser?.bookmarks?.some((entry) => entry.url === tab?.url);
	return <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-browser-panel>
		{tabs.length > 1 && <div className="flex h-8 shrink-0 items-center gap-1 px-2" role="tablist" aria-label="浏览器标签">
			<div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto ly-scrollbar-hidden">
				{tabs.map((entry) => <div key={entry.id} className={`group/tab flex min-w-[70px] max-w-[170px] flex-1 items-center rounded-md ${entry.id === tab?.id ? "bg-card-hover text-ink" : "text-ink-faint"}`}>
					<button type="button" role="tab" aria-selected={entry.id === tab?.id} onClick={() => { browserChose(sessionId, entry.id); void commandBrowser({ type: "select", id: entry.id }); }} className="ly-scroll flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-detail">
						<Globe size={12} className={`shrink-0 ${entry.loading ? "ly-pulse" : ""}`} /><ScrollText text={entry.title || "新标签页"} className="min-w-0 flex-1 text-left" />
					</button>
					<IconButton size="sm" label={`关闭 ${entry.title || "标签页"}`} icon={<X size={11} />} onClick={() => void commandBrowser({ type: "close", id: entry.id })} />
				</div>)}
			</div>
			<IconButton size="sm" label="新标签页" icon={<Plus size={14} />} onClick={() => open("about:blank", true)} />
		</div>}
		<div className="flex h-10 shrink-0 items-center gap-1 px-2" data-browser-toolbar>
			<IconButton size="sm" label="后退" icon={<ArrowLeft size={13} />} disabled={!tab?.canGoBack} onClick={() => command("back")} />
			<IconButton size="sm" label="前进" icon={<ArrowRight size={13} />} disabled={!tab?.canGoForward} onClick={() => command("forward")} />
			<IconButton size="sm" label="刷新" icon={<RotateCw size={13} className={tab?.loading ? "ly-pulse" : ""} />} disabled={!tab} onClick={() => command("reload")} />
			<AddressBar url={tab?.url ?? "about:blank"} bookmarks={settings?.browser?.bookmarks ?? []} search={settings?.browser} onOpen={(url) => open(url)} inputRef={addressInput} />
			<button type="button" aria-label="浏览器菜单" aria-haspopup="menu" aria-expanded={options.open} onClick={(event) => { setMenu("actions"); options.toggle(event); }} className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md hover:bg-card-hover ${options.open || inspecting ? "bg-card-hover text-ink" : "text-ink-faint hover:text-ink"}`}>
				<Ellipsis size={16} />
			</button>
		</div>
		{inspecting && <div role="status" className="flex shrink-0 items-center justify-between px-3 py-1 text-caption text-ink-muted">
			<span>选取页面 · Esc 退出</span><IconButton size="sm" label="退出检查" icon={<X size={12} />} onClick={() => void bridge.browser.cancelInspect(inspecting)} />
		</div>}
		{tab?.error && <p role="status" className="px-3 py-2 text-detail text-danger">{tab.error}</p>}
		<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-shell">
			{mounted.map((entry) => <BrowserPage key={entry.id} tab={entry} active={entry.id === tab?.id} />)}
			{blank && <div className="absolute inset-0 flex flex-col bg-shell" data-browser-empty><PanelEmpty icon={Globe} title="打开一个网页">在上方输入网址，或直接输入要搜的东西<button type="button" className="mx-auto mt-3 block rounded px-3 py-1 text-info hover:bg-hover" onClick={() => addressInput.current?.focus()}>输入网址或搜索</button></PanelEmpty></div>}
		</div>
		{selection && <BrowserSelectionCard selection={selection} onClose={() => setSelection(null)} />}
		{options.open && <Popover anchor={options.anchor} onClose={options.close} placement="bottom" width="default" maxHeight={340} label="浏览器菜单"
			header={menu !== "actions" && <button type="button" onClick={() => setMenu("actions")} className="flex h-9 w-full items-center gap-2 px-3 text-detail text-ink-muted"><ChevronLeft size={13} />{menu === "bookmarks" ? "书签" : "视口尺寸"}</button>}
			footer={menu === "viewport" && tab && <form className="flex items-center gap-1.5 p-2" onSubmit={(event) => { event.preventDefault(); void commandBrowser({ type: "viewport", id: tab.id, viewport: { width: Number(width), height: Number(height) } }); options.close(); }}>
				<Input aria-label="视口宽度" type="number" min={240} max={3840} required value={width} onChange={(event) => setWidth(event.target.value)} className="min-w-0 flex-1 rounded bg-input px-1.5 py-1 text-center text-detail tabular-nums" />×
				<Input aria-label="视口高度" type="number" min={240} max={2160} required value={height} onChange={(event) => setHeight(event.target.value)} className="min-w-0 flex-1 rounded bg-input px-1.5 py-1 text-center text-detail tabular-nums" />
				<button type="submit" className="shrink-0 rounded px-2 py-1 text-detail text-ink-muted hover:bg-card-hover">应用</button>
			</form>}>
			<MenuBody>
				{menu === "actions" && <>
					<MenuItem icon={<Plus size={14} />} onClick={() => { open("about:blank", true); options.close(); }}>新标签页</MenuItem>
					<MenuItem icon={<X size={14} />} disabled={!tab} onClick={() => { if (tab) void commandBrowser({ type: "close", id: tab.id }); options.close(); }}>关闭标签页</MenuItem>
					<MenuItem icon={<Bookmark size={14} fill={saved ? "currentColor" : "none"} />} disabled={blank} onClick={() => { void mark(); options.close(); }}>{saved ? "取消收藏网页" : "收藏网页"}</MenuItem>
					<MenuItem icon={<Bookmark size={14} />} trailing={<ChevronRight size={13} />} onClick={() => setMenu("bookmarks")}>书签</MenuItem>
					<MenuSeparator />
					<MenuItem icon={<MousePointer2 size={14} />} disabled={blank} onClick={() => { options.close(); if (inspecting) void bridge.browser.cancelInspect(inspecting); else void inspect("element"); }}>{inspecting ? "退出检查" : "检查元素"}</MenuItem>
					<MenuItem icon={<Scan size={14} />} disabled={blank} onClick={() => { options.close(); void inspect("region"); }}>框选区域</MenuItem>
					<MenuItem icon={<CodeXml size={14} />} disabled={blank} onClick={() => { command("devtools"); options.close(); }}>开发者工具</MenuItem>
					<MenuSeparator />
					<div className="flex h-8 items-center gap-1 px-2 text-label text-ink-muted">
						<span className="flex-1">缩放</span>
						<IconButton size="sm" label="缩小网页" icon={<Minus size={13} />} disabled={!tab || tab.zoom <= 0.25} onClick={() => { if (tab) void commandBrowser({ type: "zoom", id: tab.id, factor: Math.max(0.25, Math.round((tab.zoom - 0.25) * 100) / 100) }); }} />
						<button type="button" aria-label="重置网页缩放" disabled={!tab} onClick={() => { if (tab) void commandBrowser({ type: "zoom", id: tab.id, factor: 1 }); }} className="h-6 w-11 rounded text-detail tabular-nums hover:bg-card-hover disabled:opacity-40">{Math.round((tab?.zoom ?? 1) * 100)}%</button>
						<IconButton size="sm" label="放大网页" icon={<Plus size={13} />} disabled={!tab || tab.zoom >= 3} onClick={() => { if (tab) void commandBrowser({ type: "zoom", id: tab.id, factor: Math.min(3, Math.round((tab.zoom + 0.25) * 100) / 100) }); }} />
					</div>
					<MenuItem icon={<Scan size={14} />} disabled={!tab} hint={tab?.viewport ? `${tab.viewport.width} × ${tab.viewport.height}` : "自适应"} trailing={<ChevronRight size={13} />} onClick={() => { setWidth(String(tab?.viewport?.width ?? 1440)); setHeight(String(tab?.viewport?.height ?? 900)); setMenu("viewport"); }}>视口尺寸</MenuItem>
				</>}
				{menu === "viewport" && tab && [{ label: "自适应窗口", viewport: null }, { label: "手机 · 390 × 844", viewport: { width: 390, height: 844 } }, { label: "平板 · 768 × 1024", viewport: { width: 768, height: 1024 } }, { label: "桌面 · 1440 × 900", viewport: { width: 1440, height: 900 } }].map((preset) => <MenuItem key={preset.label} selected={tab.viewport?.width === preset.viewport?.width && tab.viewport?.height === preset.viewport?.height} onClick={() => { void commandBrowser({ type: "viewport", id: tab.id, viewport: preset.viewport } satisfies BrowserCommand); options.close(); }}>{preset.label}</MenuItem>)}
				{menu === "bookmarks" && (settings?.browser?.bookmarks?.length ? settings.browser.bookmarks.map((entry) => <MenuItem key={entry.url} detail={entry.url} onClick={() => { open(entry.url, true); options.close(); }}>{entry.title}</MenuItem>) : <p className="px-2 py-4 text-center text-detail text-ink-faint">暂无书签</p>)}
			</MenuBody>
		</Popover>}
	</div>;
}
