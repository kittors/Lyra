/**
 * Whether this sidebar row is drawn as open.
 *
 * Each row asks only about itself. A click writes `pendingSessionId`; rows whose answer is
 * still "off" see the same selector result and stay put. Lighting used to recompute a Set
 * in the pane and re-render every row so the one you pressed could change colour.
 */

import { useApp } from "../../store/index.ts";
import { rowLitFromFocus } from "../../lib/lit-sessions.ts";
import { contains, useSessionWindows, useSplit } from "../split/index.ts";

export function useRowLit(id: string): boolean {
	const focus = useApp((s): "on" | "leaving" | "off" => {
		if (s.pendingSessionId === id) return "on";
		if (s.pendingSessionId != null && s.activeSessionId === id) return "leaving";
		if (s.activeSessionId === id) return "on";
		return "off";
	});
	const tiled = useSplit((s) => contains(s.tree, id));
	const staleFocus = useSplit((s) => s.focused === id);
	const detached = useSessionWindows((s) => s.sessions.includes(id));
	return rowLitFromFocus(focus, tiled, detached, staleFocus && focus === "off");
}
