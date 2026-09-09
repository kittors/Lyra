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
import { test } from "node:test";
import { act, createElement as h } from "react";
import type { BrowserTab } from "../../shared/browser.ts";
import { BrowserPanel } from "../../src/features/browser/BrowserPanel.tsx";
import { useBrowser, useBrowserView } from "../../src/features/browser/browser-store.ts";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

function tab(id: string, sessionId: string | null, extra: Partial<BrowserTab> = {}): BrowserTab {
	return { id, sessionId, url: `https://${id}.example.com/`, title: id, loading: false, canGoBack: false, canGoForward: false, zoom: 1, viewport: null, ...extra };
}

const TABS = [tab("a1", "a"), tab("a2", "a"), tab("b1", "b"), tab("c1", "c"), tab("d1", "d")];

async function panel(sessionId: string | null, turns: Record<string, { startedAt: number; tokens: number }> = {}) {
	useBrowser.setState({ tabs: TABS, activeId: "a1" });
	useBrowserView.setState({ recent: [], chosen: {} });
	useApp.setState({ activeSessionId: sessionId, turns, settings: null });
	const view = await mount(h(BrowserPanel));
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
