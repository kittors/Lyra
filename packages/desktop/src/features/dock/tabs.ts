/**
 * 标签页式的面板排法——设置 › 外观 › 面板。
 *
 * 存的树不变：打开、关闭、弹出、持久化照旧按树走，`has(tree, kind)` 在哪儿都还是「开着没有」，
 * 切回分栏时面板也就回到原来的位置。变的只是画法：所有面板收进右侧同一格，只画当前那个，其余隐藏
 * 但不卸载——终端的 shell、浏览器的页面切标签不会重来。
 */

import type { AppearanceSettings } from "@lyra/core";
import { useApp } from "../../store/index.ts";
import { kinds, leafOf, type DockNode, type PaneKind } from "./tree.ts";

type PanelLayout = NonNullable<AppearanceSettings["panelLayout"]>;

export const usePanelLayout = (): PanelLayout => useApp((s) => s.settings?.appearance.panelLayout ?? "tabs");
export const panelLayout = (): PanelLayout => useApp.getState().settings?.appearance.panelLayout ?? "tabs";

/** 标签的顺序就是树的顺序：新开的面板落在最后，标签也排在最后。 */
export const panelsOf = (tree: DockNode): PaneKind[] => kinds(tree).filter((kind) => kind !== "conversation");

/** 当前标签：记着的那个还开着就是它，否则是最后一个。一个面板都没开时为 null。 */
export function activeTab(tree: DockNode, remembered: PaneKind | undefined): PaneKind | null {
	const panels = panelsOf(tree);
	if (remembered && panels.includes(remembered)) return remembered;
	return panels.at(-1) ?? null;
}

/** 画的时候用的树：对话在左，当前标签在右，占 `share`。 */
export function tabbedTree(active: PaneKind | null, share: number): DockNode {
	if (!active) return leafOf("conversation");
	return { type: "split", dir: "row", children: [leafOf("conversation"), leafOf(active)], sizes: [1 - share, share] };
}

/** 标签面板占多宽，全窗口共用一份：它是「右边那一栏」，不是某个会话的布局。 */
const SHARE_KEY = "dw:panedock:tab-share";
const DEFAULT_SHARE = 0.4;
/** 两边都至少留这么多；再窄由 `fitTree` 按像素下限兜住。 */
const SHARE_LIMIT = 0.15;

export const clampTabShare = (share: number): number =>
	Number.isFinite(share) ? Math.min(1 - SHARE_LIMIT, Math.max(SHARE_LIMIT, share)) : DEFAULT_SHARE;

export function readTabShare(): number {
	try {
		const raw = window.localStorage.getItem(SHARE_KEY);
		return raw === null ? DEFAULT_SHARE : clampTabShare(Number(raw));
	} catch {
		return DEFAULT_SHARE;
	}
}

export function writeTabShare(share: number): void {
	try {
		window.localStorage.setItem(SHARE_KEY, String(share));
	} catch {
		// 存储关了，这次会话里照样按拖到的宽度画，下次回到默认宽度。
	}
}
