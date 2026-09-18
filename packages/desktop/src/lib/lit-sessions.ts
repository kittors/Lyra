/**
 * Which conversation rows should read as open.
 *
 * The sidebar used to light only `activeSessionId`. A tiled pane and a detached conversation
 * window are also on screen, and Codex lights every one of those at once.
 *
 * A pending click lights that row in the same turn. The conversation being left goes dark
 * unless it is still open somewhere else (another tile, or a detached window).
 *
 * The focused leaf is the live transcript slot. Until `show()` replaces it, the tree still
 * names the conversation we just left. That is not "still open in another pane", and lighting
 * it again is the flash after `pendingSessionId` clears.
 */

export function litSessionIds(
	activeSessionId: string | null,
	tiled: readonly (string | null)[],
	detached: readonly string[],
	pendingSessionId: string | null = null,
	focused: string | null = null,
): Set<string> {
	const ids = new Set<string>();
	const selected = pendingSessionId ?? activeSessionId;
	if (selected) ids.add(selected);
	for (const id of tiled) {
		if (!id) continue;
		if (id === focused && id !== selected) continue;
		// A pending click is replacing the live pane. Keep lighting the other tiles, not the one being left.
		if (pendingSessionId && id === activeSessionId && id !== pendingSessionId) continue;
		ids.add(id);
	}
	for (const id of detached) {
		if (id) ids.add(id);
	}
	return ids;
}

/** One row's share of `litSessionIds`, so a click only wakes the rows whose fill actually changes. */
export function rowLit(
	id: string,
	activeSessionId: string | null,
	tiled: boolean,
	detached: boolean,
	pendingSessionId: string | null = null,
	focused: string | null = null,
): boolean {
	const selected = pendingSessionId ?? activeSessionId;
	if (selected === id) return true;
	if (pendingSessionId && activeSessionId === id) return detached;
	if (focused === id && selected && selected !== id) return detached;
	return tiled || detached;
}

/**
 * Same answer, from the three-way a row can subscribe to without seeing every other id.
 *
 * `on` is this row. `leaving` is the live pane a pending click is replacing. `off` is
 * everyone else — still lit if they are tiled or detached, unless this id is only the
 * stale focused leaf of a switch that has already moved on.
 */
export function rowLitFromFocus(
	focus: "on" | "leaving" | "off",
	tiled: boolean,
	detached: boolean,
	staleFocus = false,
): boolean {
	if (focus === "on") return true;
	if (focus === "leaving" || staleFocus) return detached;
	return tiled || detached;
}
