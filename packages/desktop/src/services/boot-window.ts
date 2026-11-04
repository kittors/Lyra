/**
 * Which window this renderer is — kept current for the one window whose answer changes.
 *
 * `bridge.bootWindow` is read from the preload's argv and frozen with the rest of the bridge. A
 * spare panel window (`electron/window.ts`) is built before anyone pops the next panel out, so it
 * boots knowing only that it is a panel window; the main process tells it which panel when it takes
 * it. Whatever asks which panel this window holds asks here, not `bridge.bootWindow`.
 */

import { useSyncExternalStore } from "react";
import type { LyraApi } from "../../electron/ipc-types.ts";
import { bridge } from "./bridge.ts";

type Boot = LyraApi["bootWindow"];

let assigned: Pick<Boot, "panelKind" | "panelScope" | "sessionId"> | null = null;
let merged: Boot | undefined;
const listeners = new Set<() => void>();

/** This window: the preload's answer, with a spare's assignment over it. Undefined without a preload. */
export function bootWindow(): Boot | undefined {
	let base: Boot | undefined;
	try {
		base = bridge.bootWindow;
	} catch {
		return undefined;
	}
	if (!base || !assigned) return base;
	// One object per assignment: `useSyncExternalStore` compares snapshots by identity.
	merged ??= { ...base, ...assigned };
	return merged;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useBootWindow(): Boot | undefined {
	return useSyncExternalStore(subscribe, bootWindow, bootWindow);
}

/** Take the main process's word for which panel this window is. A panel window listens from its first frame. */
export function watchPanelAssignment(): () => void {
	let windows: LyraApi["windows"] | undefined;
	try {
		windows = bridge.windows;
	} catch {
		return () => {};
	}
	if (!windows?.onAssignPanel) return () => {};
	return windows.onAssignPanel((next) => {
		assigned = { panelKind: next.panelKind, panelScope: next.panelScope, sessionId: next.sessionId ?? null };
		merged = undefined;
		for (const listener of listeners) listener();
	});
}
