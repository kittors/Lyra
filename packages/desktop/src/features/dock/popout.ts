/**
 * A docked panel leaving for a real window, and coming back to the slot it left.
 *
 * The tile never receives a pane that would crush its conversation — when `placePanel`
 * returns nothing, this is what happens instead. The same path is the header button:
 * browser, terminal, files, git, all of them.
 *
 * Restore checks the current tile size. If its home is gone, the floating window
 * stays open until that conversation is available again.
 */

import { create } from "zustand";
import { flushSync } from "react-dom";
import { bridge } from "../../services/index.ts";
import { paneFloor, tilePaneFloor } from "./geometry.ts";
import { clearsFloors, fitTree } from "./layout.ts";
import { dropFits, homeOf, placePanel } from "./place.ts";
import { usePaneDock } from "./pane-store.ts";
import { useDock } from "./store.ts";
import { has, insert, kinds, remove, type DockNode, type DropAt, type DropSide, type PaneKind } from "./tree.ts";
import { sanitize } from "./persist.ts";
import type { PanelKind } from "./sideStore.ts";

interface PanelWindowRef {
	kind: string;
	scope: string;
	sessionId?: string | null;
}

interface Home {
	dock: "window" | "pane";
	scope: string;
	at: DropAt | null;
	before?: unknown;
	rest?: unknown;
}

/**
 * 面板弹出去之前是从哪儿走的——这份记录要活过刷新。
 *
 * 从前它是一个模块作用域的 `Map`：主窗口一刷新就空了，而弹出去的那个面板窗口还好好地开着。
 * 人在它上面点「收回」，回来的记录已经没了，于是落到窗口 dock 的默认位置，而不是它离开的
 * 那个槽。面板窗口的寿命本来就独立于主窗口的刷新，所以这份记录的寿命也该如此。
 *
 * 存 localStorage，和 dock 布局同一个去处：它很小（kind → dock/scope/at），而且和布局同生
 * 共死正是它该有的生命周期。
 */
const HOMES_KEY = "dw:homes";

function readHomes(): Record<string, Home> {
	try {
		const raw = window.localStorage.getItem(HOMES_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, Home>) : {};
	} catch {
		// 坏数据、存储关了、没有 window——都当作「没有记录」，收回时落默认位置而已。
		return {};
	}
}

function writeHomes(next: Record<string, Home>): void {
	try {
		window.localStorage.setItem(HOMES_KEY, JSON.stringify(next));
	} catch {
		// 存不下不该让弹出这件事失败。
	}
}

const homes = {
	get(key: string): Home | undefined {
		return readHomes()[key];
	},
	set(key: string, home: Home): void {
		writeHomes({ ...readHomes(), [key]: home });
	},
	delete(key: string): void {
		const all = readHomes();
		if (!(key in all)) return;
		delete all[key];
		writeHomes(all);
	},
};

const homeKey = (scope: string, kind: string): string => `${scope}:${kind}`;

export const usePanelWindows = create<{ panels: PanelWindowRef[]; opening: PanelWindowRef[] }>(() => ({ panels: [], opening: [] }));

function isPopped(scope: string, kind: string): boolean {
	const { panels, opening } = usePanelWindows.getState();
	return [...panels, ...opening].some((panel) => panel.scope === scope && panel.kind === kind);
}

function sessionOf(scope: string): string | null {
	return !scope || scope === "@draft" || scope === "window" ? null : scope;
}

export async function popOutPanel(input: {
	dock: "window" | "pane";
	scope: string;
	kind: PanelKind;
	sessionId: string | null;
}): Promise<boolean> {
	if (!bridge.windows?.openPanel) return false;
	if (isPopped(input.scope, input.kind)) return true;
	const tree = input.dock === "pane" ? usePaneDock.getState().tree(input.scope) : useDock.getState().tree;
	const previousHome = !has(tree, input.kind) ? homes.get(homeKey(input.scope, input.kind)) : undefined;
	const home = previousHome ?? {
		dock: input.dock,
		scope: input.scope,
		at: has(tree, input.kind) ? homeOf(tree, input.kind) : null,
		before: tree,
		rest: remove(tree, input.kind),
	};
	homes.set(homeKey(input.scope, input.kind), home);
	// Commit the ownership transfer before another document can attach the same browser tab.
	flushSync(() => {
		usePanelWindows.setState((state) => ({ opening: [...state.opening, input] }));
		if (input.dock === "pane") usePaneDock.getState().close(input.scope, input.kind);
		else useDock.getState().close(input.kind);
	});
	let opened = false;
	try {
		opened = (await bridge.windows.openPanel({ kind: input.kind, scope: input.scope, sessionId: input.sessionId })).ok;
	} finally {
		if (!opened) {
			usePanelWindows.setState((state) => ({ opening: state.opening.filter((panel) => panel.scope !== input.scope || panel.kind !== input.kind) }));
			// Rollback is a transaction, not a new placement request: a failed window must not lose its pane.
			const current = input.dock === "pane" ? usePaneDock.getState().tree(input.scope) : useDock.getState().tree;
			if (has(tree, input.kind) && !has(current, input.kind)) {
				const restored = JSON.stringify(home.rest) === JSON.stringify(current) ? tree : insert(current, input.kind, home.at ?? { side: "right", kind: null });
				if (input.dock === "pane") usePaneDock.getState().restoreLayout(input.scope, restored);
				else useDock.getState().restoreLayout(restored);
			}
			if (previousHome) homes.set(homeKey(input.scope, input.kind), previousHome);
			else homes.delete(homeKey(input.scope, input.kind));
		}
	}
	return opened;
}

/** Restore exact geometry only while the remaining dock still matches the departure snapshot. */
export function restoredHomeTree(home: { before?: unknown; rest?: unknown } | undefined, tree: DockNode, kind: PaneKind): DockNode | null {
	if (!home?.before || JSON.stringify(home.rest) !== JSON.stringify(tree)) return null;
	const restored = sanitize(home.before, [...kinds(tree), kind]);
	return has(restored, kind) ? restored : null;
}

function dockBack(kind: PanelKind, scope: string): boolean {
	const home = homes.get(homeKey(scope, kind));
	const dock = home?.dock ?? (scope === "window" ? "window" : "pane");
	const paneLive = Boolean(usePaneDock.getState().size(scope));
	if (dock === "window") {
		const { tree, viewport } = useDock.getState();
		if (has(tree, kind)) {
			homes.delete(homeKey(scope, kind));
			return true;
		}
		if (!viewport) return false;
		const floor = (pane: PaneKind) => pane === "conversation" ? viewport.conversation : paneFloor(pane);
		const fits = (candidate: DockNode) => viewport.compact || clearsFloors(fitTree(candidate, viewport, floor), viewport, floor);
		const snapshot = restoredHomeTree(home, tree, kind);
		if (snapshot && fits(snapshot)) useDock.getState().restoreLayout(snapshot);
		else {
			const fitted = fitTree(tree, viewport, floor);
			const preferred = home?.at ? insert(fitted, kind, home.at) : null;
			const at = placePanel(fitted, viewport, floor, kind);
			const next = preferred && fits(preferred) ? preferred : at ? insert(fitted, kind, at) : null;
			if (!next) return false;
			useDock.getState().restoreLayout(next);
		}
		homes.delete(homeKey(scope, kind));
		return true;
	}
	// The home tile is gone. Keep the floating window rather than parking a tile
	// panel on the window dock — that is the layout this feature must not recreate.
	if (!paneLive) return false;
	if (has(usePaneDock.getState().tree(scope), kind)) {
		homes.delete(homeKey(scope, kind));
		return true;
	}
	const tree = usePaneDock.getState().tree(scope);
	const span = usePaneDock.getState().size(scope);
	if (!span) return false;
	const snapshot = restoredHomeTree(home, tree, kind);
	if (snapshot && clearsFloors(snapshot, span, tilePaneFloor)) {
		usePaneDock.getState().restoreLayout(scope, snapshot);
		homes.delete(homeKey(scope, kind));
		return true;
	}
	const preferred = home?.at ?? null;
	const at =
		preferred && dropFits(tree, span, tilePaneFloor, kind, preferred)
			? preferred
			: placePanel(tree, span, tilePaneFloor, kind);
	if (!at) return false;
	if (!usePaneDock.getState().open(scope, kind, at)) return false;
	homes.delete(homeKey(scope, kind));
	return true;
}

/**
 * 人此刻看着的是哪一个 dock——答案由分屏那一层注入进来。
 *
 * 这里不直接去问 `useSplit`，虽然那样写起来最短：dock 反过来依赖分屏会连出一个环
 * （dock → split → app store → dock），而把这段挪进分屏那一域也一样——它要用 dock 的东西，
 * 走前门就把整个 dock 域拉了进来，绕一圈还是回到分屏。前门规则和无环规则在这种「跨域协调」
 * 的代码上是正面冲突的，注入是唯一两边都不破的解法。
 *
 * 默认答案是 null，也就是「只有窗口 dock」。没有分屏的窗口（会话窗口、面板窗口）根本不会加载
 * `SplitWorkspace`，于是这个默认值正好就是它们的正确答案。
 */
let readScope: () => string | null = () => null;

export function provideScope(fn: () => string | null): void {
	readScope = fn;
}

/**
 * 从会话内容里打开一个面板——点一个文件链接、点「审核」、点子智能体、「在终端运行」。
 *
 * 和工具条上那排按钮走同一套规矩。从前这十几个入口一律写死 `useDock.open`，不问人在哪一屏：
 * 同一个「打开文件」，从工具条点落在这一屏，从转录里点却横在两屏旁边，看不出规律。而
 * `SplitWorkspace` 的注释早就定了规矩——「从 tile 打开的面板属于那个 tile 的 dock；已经在
 * 窗口 dock 上的留在那儿」。这个函数就是那条规矩的唯一实现。
 */
export function openScopedPanel(kind: PanelKind, beside?: { kind: PaneKind; side: DropSide; share?: number }): void {
	/*
	 * 已经在窗口 dock 上的，留在那儿，只把焦点给它。
	 *
	 * 把它从窗口 dock 搬进某一屏，等于替人做了一个他没提的决定——他上次把它放在那里是有意的。
	 */
	if (has(useDock.getState().tree, kind)) {
		useDock.getState().focus(kind);
		return;
	}
	const scope = readScope();
	if (!scope) {
		useDock.getState().open(kind, beside);
		return;
	}
	if (isPopped(scope, kind)) {
		if (bridge.windows?.openPanel) void bridge.windows.openPanel({ kind, scope, sessionId: sessionOf(scope) });
		return;
	}
	if (has(usePaneDock.getState().tree(scope), kind)) return;
	// 那一屏挤不下就弹成独立窗口——和工具条上那排按钮同一条退路。
	if (usePaneDock.getState().open(scope, kind, beside)) return;
	void popOutPanel({ dock: "pane", scope, kind, sessionId: sessionOf(scope) });
}

export function toggleScopedPanel(scope: string | null, kind: PanelKind): void {
	if (scope && has(useDock.getState().tree, kind)) {
		useDock.getState().focus(kind);
		return;
	}
	const key = scope ?? "window";
	if (isPopped(key, kind)) {
		if (!bridge.windows?.openPanel) return;
		void bridge.windows.openPanel({ kind, scope: key, sessionId: sessionOf(key) });
		return;
	}
	if (scope) {
		const tree = usePaneDock.getState().tree(scope);
		if (has(tree, kind)) {
			usePaneDock.getState().close(scope, kind);
			return;
		}
		if (usePaneDock.getState().open(scope, kind)) return;
		void popOutPanel({ dock: "pane", scope, kind, sessionId: sessionOf(scope) });
		return;
	}
	const tree = useDock.getState().tree;
	if (has(tree, kind)) {
		useDock.getState().close(kind);
		return;
	}
	useDock.getState().open(kind);
}

/**
 * 启动时发现的孤儿：盘上有回家记录，却没有对应的面板窗口。
 *
 * 这只有一种来法——人把面板弹出去，然后**没有收回就退出了应用**。窗口列表从来不存盘，所以
 * 重开之后那个面板既不在任何一棵 dock 树里（弹出时已经从树上删了），也没有窗口。它就这么
 * 没了，而盘上只剩一条指着空处的记录。
 *
 * 那条记录本来就是为这件事存在的：它记着这个面板属于哪里。窗口没了，就照它把面板放回去。
 * 用户重开应用看到终端还在它原来的位置，比「终端不见了」和「凭空多出一个终端窗口」都更接近
 * 他离开时的样子。
 *
 * 「人主动关掉那个面板窗口」不会走到这里——那一刻应用还活着，`apply` 当场就把记录清了，
 * 所以到下一次启动时它已经不在盘上。两条规则合起来才说得通，少一条另一条就会做错事。
 *
 * 一屏的 dock 要等它量出自己的尺寸才收得下面板，那比第一次窗口列表晚。所以这里重试，
 * 到点还放不回去就清掉记录：那一屏多半是真的不在了，而把它的面板停到窗口 dock 上，
 * 正是这个功能一开始要避免的布局。
 */
function adoptOrphans(deadline: number): void {
	const pending: string[] = [];
	for (const key of Object.keys(readHomes())) {
		const cut = key.lastIndexOf(":");
		if (cut <= 0) continue;
		const scope = key.slice(0, cut);
		const kind = key.slice(cut + 1) as PanelKind;
		if (isPopped(scope, kind)) continue;
		if (dockBack(kind, scope)) continue;
		const home = homes.get(key);
		const live = home?.dock === "window" ? useDock.getState().viewport : usePaneDock.getState().size(scope);
		if (home && live) {
			// A measured home with no room still owns its tool across application restarts.
			void popOutPanel({ dock: home.dock, scope, kind, sessionId: sessionOf(scope) }).catch((error: unknown) => {
				// oxlint-disable-next-line no-console -- retain the home and report native restoration failures for diagnosis.
				console.error("Failed to reopen detached panel", error);
			});
			continue;
		}
		pending.push(key);
	}
	if (pending.length === 0) return;
	if (typeof window === "undefined" || Date.now() >= deadline) {
		for (const key of pending) homes.delete(key);
		return;
	}
	window.setTimeout(() => adoptOrphans(deadline), 400);
}

export function watchPanelWindows(): () => void {
	if (!bridge.windows) return () => {};
	let first = true;
	const apply = (panels: PanelWindowRef[]) => {
		const before = usePanelWindows.getState().panels;
		usePanelWindows.setState((state) => ({ panels, opening: state.opening.filter((pending) => !panels.some((panel) => panel.scope === pending.scope && panel.kind === pending.kind)) }));
		if (first) {
			first = false;
			adoptOrphans(Date.now() + 6_000);
			return;
		}
		/*
		 * 一个面板窗口不见了，而它不是被「收回」收走的——那条路自己会清记录，清完窗口才关。
		 * 剩下的就是人主动关掉了它：关掉就是关掉，面板不该自己跑回来，但那条记录也不该留着。
		 */
		for (const gone of before) {
			if (panels.some((panel) => panel.scope === gone.scope && panel.kind === gone.kind)) continue;
			homes.delete(homeKey(gone.scope, gone.kind));
		}
	};
	void bridge.windows
		.list()
		.then((result) => { if (first) apply(result.panels ?? []); })
		.catch(() => {});
	const stopChanged = bridge.windows.onChanged((state) => apply(state.panels ?? []));
	const stopRestore = bridge.windows.onRestorePanel(({ kind, scope }) => {
		if (dockBack(kind as PanelKind, scope)) void bridge.windows.closePanel({ kind, scope });
	});
	return () => {
		stopChanged();
		stopRestore();
	};
}
