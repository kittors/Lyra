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
import { useDock } from "../../src/features/dock/store.ts";
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

/*
 * 面板弹出去之前是从哪儿走的——这份记录要活过刷新。
 *
 * 从前它是一个模块作用域的 Map：主窗口一刷新就空了，而弹出去的那个面板窗口还好好地开着。
 * 人在它上面点「收回」，回来的记录已经没了，于是落到窗口 dock 的默认位置，而不是它离开的
 * 那个槽。面板窗口的寿命本来就独立于主窗口的刷新。
 */
/**
 * 最小的 `window.lyra` 桩。
 *
 * `popOutPanel` 在记完「从哪儿走的」之后会去叫主进程开窗口，而那条路在测试环境里不存在——
 * 没有桩就会在记录之后、断言之前抛掉。这里只需要它别抛。
 */
function stubBridge(): void {
	(window as unknown as { lyra: unknown }).lyra = {
		windows: { openPanel: async () => {}, closePanel: async () => {}, list: async () => ({ panels: [], sessions: [] }) },
	};
}

test("面板回家的那条路，存在盘上而不是内存里", async () => {
	clear();
	stubBridge();
	const { popOutPanel } = await import("../../src/features/dock/popout.ts");
	useDock.setState({ tree: pair("conversation", "browser"), scope: null, adopted: false, drag: null });
	await popOutPanel({ dock: "window", scope: "window", kind: "browser", sessionId: null });
	const raw = window.localStorage.getItem("dw:homes");
	assert.ok(raw, "回家的记录没落盘，刷新一次就找不到原位了");
	const homes = JSON.parse(raw ?? "{}") as Record<string, { dock: string; scope: string }>;
	assert.equal(homes["window:browser"]?.dock, "window");
	assert.equal(homes["window:browser"]?.scope, "window");
});

test("盘上那份坏了，当作没记录，而不是把收回这件事弄崩", async () => {
	clear();
	stubBridge();
	window.localStorage.setItem("dw:homes", "{ 这不是 JSON");
	const { popOutPanel } = await import("../../src/features/dock/popout.ts");
	useDock.setState({ tree: pair("conversation", "terminal"), scope: null, adopted: false, drag: null });
	// 坏数据会被当成空记录，写入照常覆盖它。
	await popOutPanel({ dock: "window", scope: "window", kind: "terminal", sessionId: null });
	const homes = JSON.parse(window.localStorage.getItem("dw:homes") ?? "{}") as Record<string, unknown>;
	assert.ok(homes["window:terminal"], "坏数据应该被覆盖掉，而不是让写入也失败");
});

/*
 * 面板窗口不是只有「收回」一条出路。
 *
 * 那条路自己会把记录清掉（`dockBack` 成功之后才关窗口），所以从前看起来什么都对。另外两条
 * 出路没人接：人直接关掉那个窗口，和整个应用重启。第一条留下一条永远没人读的垃圾记录；第二条
 * 更重——那个面板弹出时已经从 dock 树里删了，重开之后它既不在树里也没有窗口，就这么没了，
 * 盘上只剩一条指着空处的记录。
 *
 * 两条规则合起来才说得通：关窗口时当场清记录，于是到下一次启动，盘上还留着记录的就**只能是**
 * 「没收回就退出」的那一种，照记录放回去就是对的。少任何一条，另一条都会做错事。
 */

/** 能从外面推事件的 `window.lyra` 桩，用来摆「面板窗口来了又走」。 */
function stubPanelWindows(initial: { kind: string; scope: string }[]): {
	change: (panels: { kind: string; scope: string }[]) => void;
} {
	let changed: ((state: { panels: { kind: string; scope: string }[] }) => void) | null = null;
	(window as unknown as { lyra: unknown }).lyra = {
		windows: {
			openPanel: async () => {},
			closePanel: async () => {},
			list: async () => ({ panels: initial, sessions: [] }),
			onChanged: (handler: (state: { panels: { kind: string; scope: string }[] }) => void) => {
				changed = handler;
				return () => {};
			},
			onRestorePanel: () => () => {},
		},
	};
	return { change: (panels) => changed?.({ panels }) };
}

/** 第一次窗口列表是异步到的，而它决定了后面每一次变化算不算「消失」。 */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const homesOnDisk = (): Record<string, unknown> =>
	JSON.parse(window.localStorage.getItem("dw:homes") ?? "{}") as Record<string, unknown>;

test("人直接关掉面板窗口，那条回家记录跟着清掉", async () => {
	clear();
	const stub = stubPanelWindows([{ kind: "browser", scope: "window" }]);
	const { watchPanelWindows } = await import("../../src/features/dock/popout.ts");
	window.localStorage.setItem("dw:homes", JSON.stringify({ "window:browser": { dock: "window", scope: "window", at: null } }));
	const stop = watchPanelWindows();
	await settled();
	assert.ok(homesOnDisk()["window:browser"], "窗口还开着，这时候不该动那条记录");

	stub.change([]);
	assert.equal(homesOnDisk()["window:browser"], undefined, "窗口关掉了，记录还留在盘上");
	stop();
});

test("弹出去没收回就退出应用，重开时面板回到它记着的位置", async () => {
	clear();
	useDock.setState({ tree: leafOf("conversation"), scope: null, adopted: false, drag: null });
	// 重开之后一个面板窗口都没有——窗口列表从来不存盘。
	stubPanelWindows([]);
	const { watchPanelWindows } = await import("../../src/features/dock/popout.ts");
	window.localStorage.setItem("dw:homes", JSON.stringify({ "window:browser": { dock: "window", scope: "window", at: null } }));
	const stop = watchPanelWindows();
	await settled();

	const { has } = await import("../../src/features/dock/tree.ts");
	assert.ok(has(useDock.getState().tree, "browser"), "既没有窗口也不在 dock 里——那个面板就这么没了");
	assert.equal(homesOnDisk()["window:browser"], undefined, "放回去了，指向空处的记录该清掉");
	stop();
});
