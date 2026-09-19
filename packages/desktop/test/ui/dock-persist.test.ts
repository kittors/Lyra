/**
 * 布局存到盘上这条路，两件事。
 *
 * 一是**按 key 排队**：待写值从前是一个槽，后一次写把前一次顶掉。只有窗口 dock 一个写者时
 * 永远看不出来——它每次写的都是同一把钥匙。分屏里每一屏各有一棵 dock 树，同一个 120ms 窗口
 * 里就会有好几把钥匙争那个槽，先来的静静丢掉。这一类 bug 不会在单写者的世界里显形，所以得
 * 专门钉住。
 *
 * 二是**分屏里那一屏的布局要能活过刷新**。窗口 dock 一直有持久化，pane dock 从前没有：两屏
 * 好好地恢复着，屏里调好的终端和文件树却没了——「恢复了一半」比整个不恢复更让人摸不着头脑。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { dropTree, flushTree, paneStorageKey, readTree, storageKey, writeTree } from "../../src/features/dock/persist.ts";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { leafOf, type DockNode, type PaneKind } from "../../src/features/dock/tree.ts";

const ALLOWED: PaneKind[] = ["conversation", "terminal", "browser", "files"];

const pair = (a: PaneKind, b: PaneKind): DockNode => ({
	type: "split",
	dir: "row",
	children: [leafOf(a), leafOf(b)],
	sizes: [0.6, 0.4],
});

function clear(): void {
	window.localStorage.clear();
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null });
}

test("两把钥匙在同一拍里写，谁都不许丢", () => {
	clear();
	writeTree(storageKey("alpha"), pair("conversation", "browser"));
	writeTree(paneStorageKey("beta"), pair("conversation", "terminal"));
	writeTree(paneStorageKey("gamma"), pair("conversation", "files"));
	flushTree();

	assert.ok(readTree(storageKey("alpha"), ALLOWED), "窗口 dock 那份被后来的顶掉了");
	assert.ok(readTree(paneStorageKey("beta"), ALLOWED), "第一屏那份被顶掉了");
	assert.ok(readTree(paneStorageKey("gamma"), ALLOWED), "第二屏那份被顶掉了");
});

test("同一把钥匙连写多次，只落最后一个", () => {
	clear();
	writeTree(paneStorageKey("one"), pair("conversation", "browser"));
	writeTree(paneStorageKey("one"), pair("conversation", "terminal"));
	flushTree();
	const back = readTree(paneStorageKey("one"), ALLOWED);
	// 一次拖拽会调六十次 writeTree，落一次就够——留最新的那个。
	assert.ok(back && JSON.stringify(back).includes("terminal"), "留下的不是最后写的那一份");
});

test("空树要把那一行删掉，不是存一个空壳", () => {
	clear();
	writeTree(paneStorageKey("two"), pair("conversation", "terminal"));
	flushTree();
	assert.ok(window.localStorage.getItem(paneStorageKey("two")));
	dropTree(paneStorageKey("two"));
	flushTree();
	assert.equal(window.localStorage.getItem(paneStorageKey("two")), null, "留着的话下次会把一棵空树读回来");
});

test("分屏里开的面板存得下，也读得回来", () => {
	clear();
	usePaneDock.getState().open("sess-a", "terminal");
	flushTree();
	assert.ok(window.localStorage.getItem(paneStorageKey("sess-a")), "开完没落盘，刷新一次就没了");

	// 换一个干净的内存状态，模拟刷新之后
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null });
	usePaneDock.getState().hydrate("sess-a", ALLOWED);
	const tree = usePaneDock.getState().tree("sess-a");
	assert.ok(JSON.stringify(tree).includes("terminal"), "刷新之后那一屏的终端没回来");
});

test("内存里已经有的那份说了算，不被盘上的旧值盖掉", () => {
	clear();
	usePaneDock.getState().open("sess-b", "terminal");
	flushTree();
	usePaneDock.getState().open("sess-b", "browser");
	const live = JSON.stringify(usePaneDock.getState().tree("sess-b"));
	usePaneDock.getState().hydrate("sess-b", ALLOWED);
	assert.equal(JSON.stringify(usePaneDock.getState().tree("sess-b")), live, "盘上那份把内存里更新的盖掉了");
});

test("这一屏从界面上消失，盘上那份要留着", () => {
	clear();
	usePaneDock.getState().open("sess-c", "terminal");
	flushTree();
	/*
	 * `forget` 是 PaneDock 卸载时调的，而卸载既可能是关掉了这一屏，也可能只是刷新或换页。
	 * 把盘上那份一起删掉，就等于「刷新一次布局就没了」——正是这次要修的毛病。
	 */
	usePaneDock.getState().forget("sess-c");
	assert.ok(window.localStorage.getItem(paneStorageKey("sess-c")), "忘掉内存那份时把盘上的也删了");
	assert.equal(usePaneDock.getState().trees["sess-c"], undefined, "内存里没清干净");
});

test("关掉那一屏里最后一个面板，盘上那行跟着消失", () => {
	clear();
	usePaneDock.getState().open("sess-d", "terminal");
	flushTree();
	assert.ok(window.localStorage.getItem(paneStorageKey("sess-d")));
	usePaneDock.getState().close("sess-d", "terminal");
	flushTree();
	assert.equal(window.localStorage.getItem(paneStorageKey("sess-d")), null, "只剩转录的空树不该占一行");
});

test("盘上是坏数据时，当作没有，而不是把界面弄崩", () => {
	clear();
	window.localStorage.setItem(paneStorageKey("sess-e"), "{ 这不是 JSON");
	usePaneDock.getState().hydrate("sess-e", ALLOWED);
	const tree = usePaneDock.getState().tree("sess-e");
	assert.equal(tree.type, "leaf", "坏数据应该退回默认的空树");
});

test("盘上写着一个已经不存在的面板，只丢那一个", () => {
	clear();
	// 插件卸载之后，它那个面板的 kind 就不在注册表里了。
	writeTree(paneStorageKey("sess-f"), pair("terminal", "ghost-panel" as PaneKind));
	flushTree();
	usePaneDock.getState().hydrate("sess-f", ALLOWED);
	const tree = JSON.stringify(usePaneDock.getState().tree("sess-f"));
	assert.ok(!tree.includes("ghost-panel"), "认不出的面板该被丢掉");
	assert.ok(tree.includes("terminal"), "不该连带把认得出的那个一起丢了");
});
