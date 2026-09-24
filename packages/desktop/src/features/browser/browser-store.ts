import { useEffect } from "react";
import { create } from "zustand";
import type { BrowserCommand, BrowserState, BrowserTab } from "../../../shared/browser.ts";
import { bridge, onPhone } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { useSide, openScopedPanel, usePaneDock, usePanelWindows } from "../dock/index.ts";

export const useBrowser = create<BrowserState>(() => ({ tabs: [], activeId: null }));
export async function commandBrowser(command: BrowserCommand): Promise<void> {
	try { useBrowser.setState(await bridge.browser.command(command)); }
	catch (error) { useApp.getState().notify(String(error), "error"); }
}

/** Conversations and tabs are keyed together; a tab with no conversation gets the empty key. */
export const browserOwner = (sessionId: string | null | undefined): string => sessionId ?? "";

/**
 * How many conversations keep their pages loaded at once.
 *
 * Every visible tab is a `<webview>`, and every `<webview>` is a renderer process of its own —
 * with tabs scoped per conversation, keeping them all mounted would mean the browser's cost grew
 * with the number of conversations you had ever opened a page in, for pages nobody was looking at.
 *
 * Three, not one: switching to a conversation and straight back is the common move, and dropping
 * the page on the way out reloads it on the way back — losing scroll position, and anything typed
 * into a form. Three covers that without letting the count run away. A conversation whose agent is
 * mid-turn is kept regardless of this — see `browserMounted`.
 */
const LOADED_SESSIONS = 3;

/** The conversations whose pages stay loaded, most recently looked at first. */
export const useBrowserView = create<{ recent: string[]; chosen: Record<string, string> }>(() => ({ recent: [], chosen: {} }));

export function browserVisited(sessionId: string | null): void {
	const owner = browserOwner(sessionId);
	useBrowserView.setState((state) => state.recent[0] === owner
		? state
		: { recent: [owner, ...state.recent.filter((entry) => entry !== owner)].slice(0, LOADED_SESSIONS) });
}

/** Remembers which tab a conversation was on, so coming back does not land on a different page. */
export function browserChose(sessionId: string | null, tabId: string): void {
	useBrowserView.setState((state) => ({ chosen: { ...state.chosen, [browserOwner(sessionId)]: tabId } }));
}

/**
 * The tabs that get a page, as opposed to the tabs that get a row.
 *
 * Wider than what is on screen, and deliberately: an agent working in a conversation you are not
 * watching drives a real page, so its tabs stay loaded while its turn is in flight, and `wanted`
 * covers the moment between the main process asking for a page and the store hearing that the turn
 * has started.
 */
function browserMounted(tabs: BrowserTab[], owner: string, recent: string[], running: Record<string, unknown>): BrowserTab[] {
	return tabs.filter((tab) => {
		const key = browserOwner(tab.sessionId);
		return key === owner || tab.wanted === true || recent.includes(key) || (tab.sessionId !== null && tab.sessionId in running);
	});
}

export function useBrowserWorkspace(): void {
	useEffect(() => {
		if (onPhone()) return;
		const unsubscribe = bridge.browser.onChanged((state) => {
			useBrowser.setState({ tabs: state.tabs, activeId: state.activeId });
			/*
			 * Only the conversation on screen may open the panel, and only when a person asked.
			 *
			 * `reveal` is set by the main process for the address bar, a bookmark, a preview link or a
			 * card's 「打开」 — never for an agent's own pages, which run with the panel closed (see
			 * `openBrowser`). It used to mean any page opening, which dropped the panel over your work
			 * each time an agent opened or clicked something — in another conversation too, showing a
			 * tab that belongs there and is therefore blank here.
			 */
			const revealed = state.tabs.find((tab) => tab.id === state.activeId);
			// Into the screen of the conversation that owns the page — the one the address bar was in.
			if (state.reveal && revealed && browserOwner(revealed.sessionId) === browserOwner(useApp.getState().activeSessionId)) openScopedPanel("browser", undefined, revealed.sessionId ?? "@draft");
		});
		void bridge.browser.state().then((state) => useBrowser.setState(state));
		const unwatch = useSide.subscribe((state, previous) => {
			if (state.browserTarget === previous.browserTarget || !state.browserTarget) return;
			const target = state.browserTarget;
			const url = target.kind === "url" ? target.url : `ly-preview://${target.preview.sessionId}/${target.preview.id}/${target.preview.entry}`;
			void commandBrowser({ type: "open", url, sessionId: useApp.getState().activeSessionId, newTab: true });
		});
		return () => { unsubscribe(); unwatch(); };
	}, []);
}

/**
 * Which pages this browser panel gives a `<webview>` to.
 *
 * A page lives in exactly one place, because a `<webview>` moved or re-created is a page reloaded —
 * its scroll, its form, whatever the agent had done in it. So each page has one host:
 *
 * - A detached browser window hosts its own conversation's pages.
 * - A screen hosts its own conversation's pages, whether its browser panel is open or not. Every
 *   screen's panel is mounted, hidden when closed, so closing it and opening it again shows the
 *   page that was already running rather than loading it again.
 * - Pages of conversations that are on no screen but still have to stay loaded — the few looked at
 *   most recently, anything an agent is driving — are hosted by the screen that has been on screen
 *   longest (`host`).
 *
 * Nothing here depends on the focus. There used to be a window-level browser as well, and pages
 * were handed between it and a screen's according to which screen had the focus — a reload on
 * every click between two screens. After that, a screen closing its panel handed its pages to the
 * host and took them back on reopening — a reload each way, and the form typed into was gone.
 *
 * A screen counts from the moment it has been measured (`sizes`), on both sides of the rule at
 * once: before that its pages stay with the host, so no page is ever drawn in two places.
 */
export function useBrowserPages(tabs: BrowserTab[], sessionId: string | null, scope: string | null): BrowserTab[] {
	const recent = useBrowserView((state) => state.recent);
	const turns = useApp((state) => state.turns);
	const sizes = usePaneDock((state) => state.sizes);
	const host = usePaneDock((state) => state.host);
	const panels = usePanelWindows((state) => state.panels);
	const opening = usePanelWindows((state) => state.opening);
	const owner = browserOwner(sessionId);
	const own = tabs.filter((tab) => browserOwner(tab.sessionId) === owner);
	if (bridge.bootWindow?.kind === "panel") return own;
	const external = [...panels, ...opening].filter((panel) => panel.kind === "browser");
	const outside = (tab: BrowserTab) => external.some((panel) =>
		browserOwner(panel.sessionId === undefined ? panel.scope === "@draft" ? null : panel.scope : panel.sessionId) === browserOwner(tab.sessionId));
	const onScreen = (key: string) => Boolean(sizes[key]);
	if (!scope) return [];
	if (scope !== host) return onScreen(scope) ? own.filter((tab) => !outside(tab)) : [];
	return browserMounted(tabs, owner, recent, turns).filter((tab) => {
		if (outside(tab)) return false;
		const key = tab.sessionId ?? "@draft";
		return key === scope || !onScreen(key);
	});
}
