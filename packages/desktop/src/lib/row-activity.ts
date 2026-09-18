/**
 * What a sidebar row should show, given the main turn and the side chat.
 *
 * The list only used to watch the main agent. A side chat can run while that turn is idle, and
 * the row then looked finished — the thing the user asked to see as a breathing light.
 *
 * The side chat only contributes "still going". Its own finish is not an unread result on this
 * row: the transcript it wrote is in another pane.
 */

import { visibleActivity, type SessionActivity } from "@lyra/core/activity";

export interface SideRunningSource {
	sessionId: string | null;
	running: boolean;
	sessionCache: Readonly<Record<string, { running?: boolean }>>;
}

export function sideChatRunning(state: SideRunningSource, sessionId: string): boolean {
	if (state.sessionId === sessionId) return state.running;
	return state.sessionCache[sessionId]?.running === true;
}

export function rowActivity(
	activity: SessionActivity | null,
	sideRunning: boolean,
	isActive: boolean,
): SessionActivity | null {
	const visible = visibleActivity(activity, isActive);
	if (visible === "running" || visible === "waiting") return visible;
	if (sideRunning) return "running";
	return visible;
}
