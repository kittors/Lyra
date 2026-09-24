/**
 * 浏览器面板按会话分家：看到的是这个会话的标签，活着的页面比看到的多一点。
 *
 * 「多一点」是这一版的全部难点。标签一直是有主的——agent 的工具就是靠这个判定谁能操作谁——但
 * 面板从前把所有标签一起画出来，于是切会话时页面不换，隔离在界面上根本不存在。改成只画自己的
 * 之后，另一个问题立刻顶上来：每个 `<webview>` 是一个渲染进程，要是每个会话的页面都留着，浏览
 * 器的开销就随「你曾经在几个会话里开过网页」一直涨。
 *
 * 所以这里量三件事：看得见的是不是只有自己的；来回切一次页面还在不在（在，否则表单和滚动位置
 * 每切一次丢一次）；切得够远之后旧的有没有真的被卸掉。外加一条不能退让的：另一个会话的 agent
 * 正在跑，它的页面必须活着，哪怕你根本没在看它——那正是它替你干活的时候。
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { BrowserTab } from "../../shared/browser.ts";
import { BrowserPanel } from "../../src/features/browser/BrowserPanel.tsx";
import { useBrowser, useBrowserView } from "../../src/features/browser/browser-store.ts";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";
import { DockScope, SessionScope } from "../../src/app/session-scope.tsx";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { usePanelWindows } from "../../src/features/dock/popout.ts";
import { insert, leafOf } from "../../src/features/dock/tree.ts";
import type { LyraApi } from "../../electron/ipc-types.ts";

beforeEach(() => {
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		bootWindow: { id: "test", kind: "primary", sessionId: null, panelKind: null, panelScope: null },
	} satisfies Pick<LyraApi, "bootWindow"> });
});
afterEach(() => { Reflect.deleteProperty(window, "lyra"); });

function tab(id: string, sessionId: string | null, extra: Partial<BrowserTab> = {}): BrowserTab {
	return { id, sessionId, url: `https://${id}.example.com/`, title: id, loading: false, canGoBack: false, canGoForward: false, zoom: 1, viewport: null, ...extra };
}

const TABS = [tab("a1", "a"), tab("a2", "a"), tab("b1", "b"), tab("c1", "c"), tab("d1", "d")];

/** One conversation's screen, with its browser panel mounted the way `DockView` mounts it. */
function screen(scope: string, sessionId: string | null) {
	return h(DockScope.Provider, { value: scope }, h(SessionScope.Provider, { value: sessionId }, h("section", { id: `screen-${scope}` }, h(BrowserPanel))));
}

test("the screen that keeps background pages yields a conversation's pages to the screen showing them, and to its own window", async () => {
	useBrowser.setState({ tabs: TABS, activeId: "a1" });
	useBrowserView.setState({ recent: ["a", "b"], chosen: {} });
	useApp.setState({ activeSessionId: "a", turns: { d: { startedAt: 1, tokens: 0 } }, settings: null });
	const tree = insert(leafOf("conversation"), "browser", { kind: "conversation", side: "right" });
	// Two screens, both with their browser open; `a` has been on screen longest, so it keeps the rest.
	usePaneDock.setState({ trees: { a: tree, b: tree }, sizes: { a: { width: 600, height: 800 }, b: { width: 600, height: 800 } }, host: "a" });
	const view = await mount(h("div", null, screen("a", "a"), screen("b", "b")));
	try {
		assert.deepEqual(view.all("#screen-a webview").map((el) => el.dataset.browserPage).sort(), ["a1", "a2", "d1"], "its own, and the agent working off screen");
		assert.deepEqual(view.all("#screen-b webview").map((el) => el.dataset.browserPage), ["b1"], "b's page lives in b's screen, once");
		assert.equal(view.all("webview").length, 4, "one page per tab, never two");
		await act(() => { usePanelWindows.setState({ opening: [{ kind: "browser", scope: "a", sessionId: "a" }] }); });
		assert.equal(view.all('[data-browser-page="a1"]').length, 0, "a window of its own takes a's pages");
		await act(() => { usePanelWindows.setState({ opening: [] }); });
		assert.equal(view.all('[data-browser-page="a1"]').length, 1);
	} finally {
		await view.unmount();
		usePaneDock.setState({ trees: {}, sizes: {}, host: null });
		usePanelWindows.setState({ opening: [], panels: [] });
	}
});

test("moving the focus between two screens moves no page", async () => {
	/*
	 * Pages used to be handed between a window-level browser and a screen's according to which
	 * screen had the focus: a reload on every click between two screens. A page belongs to the screen
	 * showing it, and the focus has nothing to say about that.
	 */
	useBrowser.setState({ tabs: TABS, activeId: "a1" });
	useBrowserView.setState({ recent: ["a", "b"], chosen: {} });
	useApp.setState({ activeSessionId: "a", turns: {}, settings: null });
	const tree = insert(leafOf("conversation"), "browser", { kind: "conversation", side: "right" });
	usePaneDock.setState({ trees: { a: tree, b: tree }, sizes: { a: { width: 600, height: 800 }, b: { width: 600, height: 800 } }, host: "a" });
	const view = await mount(h("div", null, screen("a", "a"), screen("b", "b")));
	try {
		const a = view.find('[data-browser-page="a1"]');
		const b = view.find('[data-browser-page="b1"]');
		await act(() => { useApp.setState({ activeSessionId: "b" }); useBrowser.setState({ activeId: "b1" }); });
		assert.equal(view.find('[data-browser-page="a1"]'), a, "a's page is the same element — not reloaded");
		assert.equal(view.find('[data-browser-page="b1"]'), b);
		assert.equal(a.parentElement?.style.visibility, "");
		await act(() => { useApp.setState({ activeSessionId: "a" }); useBrowser.setState({ activeId: "a1" }); });
		assert.equal(view.find('[data-browser-page="b1"]'), b, "and back again");
	} finally {
		await view.unmount();
		usePaneDock.setState({ trees: {}, sizes: {}, host: null });
	}
});

test("a screen whose browser is closed still keeps its own pages; the host keeps the ones on no screen", async () => {
	useBrowser.setState({ tabs: TABS, activeId: "a1" });
	useBrowserView.setState({ recent: ["a", "b", "c"], chosen: {} });
	useApp.setState({ activeSessionId: "a", turns: {}, settings: null });
	usePaneDock.setState({ trees: {}, sizes: { a: { width: 600, height: 800 }, b: { width: 600, height: 800 } }, host: "a" });
	const view = await mount(h("div", null, screen("a", "a"), screen("b", "b")));
	try {
		assert.deepEqual(view.all("#screen-b webview").map((el) => el.dataset.browserPage), ["b1"], "closed panels still keep their pages running, in their own screen");
		assert.deepEqual(view.all("#screen-a webview").map((el) => el.dataset.browserPage).sort(), ["a1", "a2", "c1"], "its own, and a recent conversation that is on no screen");
	} finally {
		await view.unmount();
		usePaneDock.setState({ trees: {}, sizes: {}, host: null });
	}
});

test("closing a screen's browser and opening it again is not a reload, on any screen", async () => {
	/*
	 * The screen that is not the host used to hand its pages to the host when its panel closed and
	 * take them back when it opened: a new `<webview>` each way, and whatever was typed into the
	 * page was gone. The page stays where it is now; only its panel is hidden.
	 */
	useBrowser.setState({ tabs: TABS, activeId: "b1" });
	useBrowserView.setState({ recent: ["a", "b"], chosen: {} });
	useApp.setState({ activeSessionId: "b", turns: {}, settings: null });
	const open = insert(leafOf("conversation"), "browser", { kind: "conversation", side: "right" });
	const sizes = { a: { width: 600, height: 800 }, b: { width: 600, height: 800 } };
	usePaneDock.setState({ trees: { a: open, b: open }, sizes, host: "a" });
	const view = await mount(h("div", null, screen("a", "a"), screen("b", "b")));
	try {
		const b = view.find('#screen-b [data-browser-page="b1"]');
		await act(() => { usePaneDock.setState({ trees: { a: open, b: leafOf("conversation") } }); });
		// `assert.ok` on identity, never `assert.equal` on DOM nodes: a failing one hangs the whole file.
		assert.ok(view.find('[data-browser-page="b1"]') === b, "closed: the same page, hidden in its own screen");
		assert.equal(view.all('[data-browser-page="b1"]').length, 1);
		await act(() => { usePaneDock.setState({ trees: { a: open, b: open } }); });
		assert.ok(view.find('[data-browser-page="b1"]') === b, "and opened again: still that page");
	} finally {
		await view.unmount();
		usePaneDock.setState({ trees: {}, sizes: {}, host: null });
	}
});

test("a screen not measured yet leaves its pages with the host, so no page is ever drawn twice", async () => {
	useBrowser.setState({ tabs: TABS, activeId: "a1" });
	useBrowserView.setState({ recent: ["a", "b"], chosen: {} });
	useApp.setState({ activeSessionId: "a", turns: {}, settings: null });
	usePaneDock.setState({ trees: {}, sizes: { a: { width: 600, height: 800 } }, host: "a" });
	const view = await mount(h("div", null, screen("a", "a"), screen("b", "b")));
	try {
		assert.deepEqual(view.all('[data-browser-page="b1"]').map((el) => el.closest("section")?.id), ["screen-a"]);
		await act(() => { usePaneDock.setState({ sizes: { a: { width: 600, height: 800 }, b: { width: 600, height: 800 } } }); });
		assert.deepEqual(view.all('[data-browser-page="b1"]').map((el) => el.closest("section")?.id), ["screen-b"], "measured: it moves to its own screen, once");
	} finally {
		await view.unmount();
		usePaneDock.setState({ trees: {}, sizes: {}, host: null });
	}
});

async function panel(sessionId: string | null, turns: Record<string, { startedAt: number; tokens: number }> = {}) {
	useBrowser.setState({ tabs: TABS, activeId: "a1" });
	useBrowserView.setState({ recent: [], chosen: {} });
	useApp.setState({ activeSessionId: sessionId, turns, settings: null });
	// The one screen there is, which is therefore the one that keeps pages.
	usePaneDock.setState({ trees: {}, sizes: {}, host: "screen" });
	const view = await mount(h(DockScope.Provider, { value: "screen" }, h(BrowserPanel)));
	return {
		view,
		// Through `act`, because the panel subscribes to the store: switching conversations is a
		// state update React has to finish committing before the next line looks at the DOM.
		async switchTo(next: string) {
			await act(async () => { useApp.setState({ activeSessionId: next }); });
		},
		/** The tabs with a page behind them — one `<webview>` each, one renderer process each. */
		loaded: () => view.all("[data-browser-page]").map((page) => page.dataset.browserPage).sort(),
		/** The tabs offered in the strip: what this conversation can switch between. */
		listed: () => view.all('[role="tab"]').map((entry) => entry.textContent),
	};
}

test("a conversation sees its own tabs and nobody else's", async () => {
	const app = await panel("a");
	try {
		assert.deepEqual(app.listed(), ["a1", "a2"]);
		/*
		 * The page on screen is this conversation's, and the other conversations' are not visible.
		 *
		 * Asked as "not hidden" rather than "declared visible", because the active page deliberately
		 * declares nothing — see the note in `BrowserPage`. `visibility` is inherited, and a
		 * descendant that asserts `visible` climbs back out of an ancestor that is `hidden`: opening
		 * settings puts the whole workspace away with `invisible`, and a webview that insisted on
		 * being visible went on painting the browser over the settings pane.
		 */
		const shell = (page: HTMLElement) => page.parentElement as HTMLElement;
		const visible = app.view.all("[data-browser-page]").filter((page) => shell(page).style.visibility !== "hidden");
		assert.deepEqual(visible.map((page) => page.dataset.browserPage), ["a1"]);
		assert.equal(shell(visible[0]).style.visibility, "", "活动那一页不能写死 visible，否则设置页盖不住它");
		await app.switchTo("b");
		assert.deepEqual(app.listed(), []);
		assert.equal(app.view.find("[data-browser-panel]").textContent?.includes("b1"), false);
	} finally { await app.view.unmount(); }
});

test("switching away and back keeps the page; switching far enough drops it", async () => {
	const app = await panel("a");
	try {
		assert.deepEqual(app.loaded(), ["a1", "a2"]);
		await app.switchTo("b");
		// Still loaded one conversation later: going back must not reload and lose what was typed.
		assert.deepEqual(app.loaded(), ["a1", "a2", "b1"]);
		await app.switchTo("c");
		await app.switchTo("d");
		// Four conversations deep, the first one's pages are gone rather than piling up.
		assert.deepEqual(app.loaded(), ["b1", "c1", "d1"]);
	} finally { await app.view.unmount(); }
});

test("a conversation with a turn in flight keeps its page wherever the user is", async () => {
	const app = await panel("a", { d: { startedAt: Date.now(), tokens: 0 } });
	try {
		// `d` is off screen and three conversations away, but its agent is working in it.
		assert.ok(app.loaded().includes("d1"));
		await app.switchTo("b");
		await app.switchTo("c");
		assert.ok(app.loaded().includes("d1"), "an agent's own page cannot be dropped under it");
	} finally { await app.view.unmount(); }
});

test("the main process can ask for a sleeping page back", async () => {
	const app = await panel("a");
	try {
		await app.switchTo("b");
		await app.switchTo("c");
		await app.switchTo("d");
		assert.equal(app.loaded().includes("a1"), false);
		// What `awakeBrowser` publishes when an agent reaches for a tab whose page was dropped.
		await act(async () => { useBrowser.setState({ tabs: TABS.map((entry) => entry.id === "a1" ? { ...entry, wanted: true } : entry), activeId: "a1" }); });
		assert.ok(app.loaded().includes("a1"));
	} finally { await app.view.unmount(); }
});
