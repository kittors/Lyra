/**
 * A docked panel leaving for a real window, and coming back to the slot it left.
 *
 * The tile never receives a pane that would crush its conversation — when `placePanel`
 * returns nothing, this is what happens instead. The same path is the header button:
 * browser, terminal, files, git, all of them.
 *
 * Restore asks the same floor question. If the home tile is gone, the pane lands on
 * the window dock rather than vanishing with a closed screen.
 */

import { create } from "zustand";
import { bridge } from "../../services/index.ts";
import { paneFloor } from "./geometry.ts";
import { dropFits, homeOf, placePanel } from "./place.ts";
import { usePaneDock } from "./pane-store.ts";
import { useDock } from "./store.ts";
import { has, type DropAt, type DropSide, type PaneKind } from "./tree.ts";
import type { PanelKind } from "./sideStore.ts";

interface PanelWindowRef {
	kind: string;
	scope: string;
}

interface Home {
	dock: "window" | "pane";
	scope: string;
	at: DropAt | null;
}

const homes = new Map<string, Home>();

const homeKey = (scope: string, kind: string): string => `${scope}:${kind}`;

const usePanelWindows = create<{ panels: PanelWindowRef[] }>(() => ({ panels: [] }));

function isPopped(scope: string, kind: string): boolean {
	return usePanelWindows.getState().panels.some((panel) => panel.scope === scope && panel.kind === kind);
}

function sessionOf(scope: string): string | null {
	return !scope || scope === "@draft" || scope === "window" ? null : scope;
}

export async function popOutPanel(input: {
	dock: "window" | "pane";
	scope: string;
	kind: PanelKind;
	sessionId: string | null;
}): Promise<void> {
	const tree = input.dock === "pane" ? usePaneDock.getState().tree(input.scope) : useDock.getState().tree;
	homes.set(homeKey(input.scope, input.kind), {
		dock: input.dock,
		scope: input.scope,
		at: has(tree, input.kind) ? homeOf(tree, input.kind) : null,
	});
	if (input.dock === "pane") usePaneDock.getState().close(input.scope, input.kind);
	else useDock.getState().close(input.kind);
	if (!bridge.windows?.openPanel) return;
	await bridge.windows.openPanel({
		kind: input.kind,
		scope: input.scope,
		sessionId: input.sessionId,
	});
}

function dockBack(kind: PanelKind, scope: string): boolean {
	const home = homes.get(homeKey(scope, kind));
	const dock = home?.dock ?? (scope === "window" ? "window" : "pane");
	const paneLive = Boolean(usePaneDock.getState().size(scope));
	if (dock === "window") {
		if (!has(useDock.getState().tree, kind)) useDock.getState().open(kind);
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
	const preferred = home?.at ?? null;
	const at =
		preferred && dropFits(tree, span, paneFloor, kind, preferred)
			? preferred
			: placePanel(tree, span, paneFloor, kind);
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

export function watchPanelWindows(): () => void {
	if (!bridge.windows) return () => {};
	const apply = (panels: PanelWindowRef[]) => usePanelWindows.setState({ panels });
	void bridge.windows
		.list()
		.then((result) => apply(result.panels ?? []))
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
