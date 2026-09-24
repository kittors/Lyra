/**
 * Which screen's dock a panel is drawn in.
 *
 * A panel asks questions about its own screen — "is the file tree beside me?", "am I behind a
 * maximised neighbour?" — and the answer is that screen's tree, not whichever conversation has the
 * focus. `DockView` provides the scope; a panel window has none, because it holds one panel and is
 * that panel.
 */

import { bridge } from "../../services/index.ts";
import { useLayout } from "../../app/layout.tsx";
import { useDockScope } from "../../app/session-scope.tsx";
import { emptyDockTree, usePaneDock } from "./pane-store.ts";
import { kinds, type PaneKind } from "./tree.ts";
import { paneVisible } from "./visibility.ts";

/**
 * Whether `kind` is on screen in the dock this component is drawn in.
 *
 * Being open is not the same thing: a pane stays mounted behind a maximised neighbour and in every
 * other tab of a narrow window. Outside any dock — a panel window — the only pane on screen is the
 * one the window was opened for.
 */
export function usePaneOnScreen(kind: PaneKind): boolean {
	const scope = useDockScope();
	const { compact } = useLayout();
	const tree = usePaneDock((state) => (scope ? (state.trees[scope] ?? emptyDockTree) : null));
	const maximized = usePaneDock((state) => (scope ? (state.maximized[scope] ?? null) : null));
	const focused = usePaneDock((state) => (scope ? (state.focused[scope] ?? "conversation") : "conversation"));
	if (!scope || !tree) {
		try {
			return bridge.bootWindow?.kind === "panel" && bridge.bootWindow.panelKind === kind;
		} catch {
			return false;
		}
	}
	return paneVisible(kind, { present: kinds(tree), maximized: maximized?.panes ?? null, compact, focused });
}
