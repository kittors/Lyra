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
import { has, type DropAt } from "./tree.ts";
import type { PanelKind } from "./sideStore.ts";

export interface PanelWindowRef {
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

export const usePanelWindows = create<{ panels: PanelWindowRef[] }>(() => ({ panels: [] }));

export function isPopped(scope: string, kind: string): boolean {
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

export function dockBack(kind: PanelKind, scope: string): boolean {
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
