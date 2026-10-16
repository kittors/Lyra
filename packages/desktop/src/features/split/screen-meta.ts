/**
 * Which conversation a screen is showing, wherever its metadata happens to be.
 *
 * The live one has it in the store, a warmed screen in the session cache, anything else only in the
 * sidebar's list. Shared by the desktop's title bar and the phone's, which name the same thing.
 */

import { useApp } from "../../store/index.ts";

export function useScreenMeta(sessionId: string | null) {
	return useApp((s) =>
		!sessionId
			? s.activeSessionId
				? null
				: s.meta
			: s.activeSessionId === sessionId
				? s.meta
				: (s.sessionCache[sessionId]?.meta ?? s.sessions.find((session) => session.id === sessionId) ?? null),
	);
}
