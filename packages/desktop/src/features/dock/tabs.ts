/**
 * The tabbed panel layout — Settings › Appearance › Panels.
 *
 * The stored tree does not change: opening, closing, popping out and persisting all go by the tree as
 * before, `has(tree, kind)` still means "is it open" everywhere, and switching back to split puts each
 * panel back where it was. Only the drawing changes: every panel goes into one cell on the right, only
 * the current one is drawn, and the rest are hidden but not unmounted — switching tabs does not restart
 * a terminal's shell or reload a browser's page.
 */

import type { AppearanceSettings } from "@lyra/core";
import { useApp } from "../../store/index.ts";
import { kinds, leafOf, type DockNode, type PaneKind } from "./tree.ts";

type PanelLayout = NonNullable<AppearanceSettings["panelLayout"]>;

export const usePanelLayout = (): PanelLayout => useApp((s) => s.settings?.appearance.panelLayout ?? "split");
export const panelLayout = (): PanelLayout => useApp.getState().settings?.appearance.panelLayout ?? "split";

/** Tabs are in tree order: a newly opened panel lands last in the tree, so its tab comes last too. */
export const panelsOf = (tree: DockNode): PaneKind[] => kinds(tree).filter((kind) => kind !== "conversation");

/** The current tab: the remembered one if it is still open, otherwise the last. Null when no panel is open. */
export function activeTab(tree: DockNode, remembered: PaneKind | undefined): PaneKind | null {
	const panels = panelsOf(tree);
	if (remembered && panels.includes(remembered)) return remembered;
	return panels.at(-1) ?? null;
}

/** The tree to draw: the conversation on the left, the current tab on the right taking `share`. */
export function tabbedTree(active: PaneKind | null, share: number): DockNode {
	if (!active) return leafOf("conversation");
	return { type: "split", dir: "row", children: [leafOf("conversation"), leafOf(active)], sizes: [1 - share, share] };
}

/** How wide the tab column is, one value for the whole window: it is "the column on the right", not part of one conversation's layout. */
const SHARE_KEY = "dw:panedock:tab-share";
const DEFAULT_SHARE = 0.4;
/** The least either side keeps; narrower than that, `fitTree`'s pixel floors take over. */
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
		// Storage is off: the dragged width still holds until the app closes, and the next launch starts from the default.
	}
}
