import { useEffect } from "react";
import { create } from "zustand";
import type { BrowserCommand, BrowserState, BrowserTab } from "../../../shared/browser.ts";
import { bridge, onPhone } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { useDock, useSide } from "../dock/index.ts";

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
export function browserMounted(tabs: BrowserTab[], owner: string, recent: string[], running: Record<string, unknown>): BrowserTab[] {
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
			 * Only the conversation on screen may open the panel.
			 *
			 * `reveal` means a page was opened, and it used to open the browser for whoever was
			 * watching — so an agent working in another conversation dropped a panel over your work
			 * showing a tab that belongs to that conversation and is therefore blank here.
			 */
			const revealed = state.tabs.find((tab) => tab.id === state.activeId);
			if (state.reveal && revealed && browserOwner(revealed.sessionId) === browserOwner(useApp.getState().activeSessionId)) useDock.getState().open("browser");
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
