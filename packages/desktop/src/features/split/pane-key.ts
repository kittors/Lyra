/** DOM id for a pane. The blank conversation has no session id, so it still needs a stable key. */
export const paneKey = (sessionId: string | null): string => sessionId ?? "@draft";

export interface PaneIdentity { sessionId: string | null; key: number }

/** Moves retain their instance; replacing a session retains the slot's transcript cache. */
export function assignPaneKeys(previous: PaneIdentity[], sessions: (string | null)[]): PaneIdentity[] {
	const released = previous.filter((slot) => !sessions.includes(slot.sessionId));
	let next = Math.max(-1, ...previous.map((slot) => slot.key)) + 1;
	return sessions.map((sessionId) => previous.find((slot) => slot.sessionId === sessionId)
		?? { sessionId, key: released.shift()?.key ?? next++ });
}
