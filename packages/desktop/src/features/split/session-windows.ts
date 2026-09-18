/**
 * Conversations that are open in a detached window on this machine.
 *
 * The primary sidebar lights those rows the same way it lights a tiled pane. The list lives in
 * the main process; this is only the copy the renderer paints from.
 */

import { create } from "zustand";
import { bridge } from "../../services/index.ts";

interface SessionWindowsState {
	sessions: string[];
}

export const useSessionWindows = create<SessionWindowsState>(() => ({ sessions: [] }));

export function watchSessionWindows(): () => void {
	if (!bridge.windows?.list || !bridge.windows.onChanged) return () => {};
	const apply = (sessions: string[]) => useSessionWindows.setState({ sessions });
	void bridge.windows.list().then((result) => apply(result.sessions)).catch(() => {});
	return bridge.windows.onChanged(({ sessions }) => apply(sessions));
}
