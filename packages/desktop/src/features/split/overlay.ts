/**
 * The drop highlight, held apart from the tiling store.
 *
 * Updating the hovered edge on every pointermove must not re-render four conversations. This
 * atom is the only thing that changes during a drag over the workspace, and the overlay is the
 * only thing subscribed to it.
 */

import { create } from "zustand";
import type { DropSide } from "./tree.ts";

type OverlayKind = "split" | "replace";

export interface SplitOverlayState {
	/** Pane key: a session id, or `@draft` for the blank conversation. */
	sessionId: string | null;
	kind: OverlayKind | null;
	side: DropSide | null;
	show: (sessionId: string, kind: OverlayKind, side: DropSide | null) => void;
	clear: () => void;
}

export const useSplitOverlay = create<SplitOverlayState>((set) => ({
	sessionId: null,
	kind: null,
	side: null,
	show(sessionId, kind, side) {
		set((current) =>
			current.sessionId === sessionId && current.kind === kind && current.side === side
				? current
				: { sessionId, kind, side },
		);
	},
	clear() {
		set((current) => (current.sessionId === null ? current : { sessionId: null, kind: null, side: null }));
	},
}));
