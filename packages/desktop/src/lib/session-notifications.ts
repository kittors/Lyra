import { translate } from "../i18n/translate.ts";
import type { AgentEvent } from "@lyra/core";
import type { SessionActivity } from "@lyra/core/activity";

/** A repeated end event does not announce the same unread result twice. */
export function completionNotice(event: AgentEvent, previous: SessionActivity | null): { level: "info" | "error"; text: string } | null {
	if (event.type !== "agent_end") return null;
	if (event.reason === "done") return previous === "done" ? null : { level: "info", text: translate("notify.done") };
	if (event.reason === "error" || event.reason === "max_turns") {
		return previous === "failed" ? null : { level: "error", text: translate("notify.failed") };
	}
	return null;
}

/** Pending decisions take priority over unread failures and completed work. */
export function unreadActivity(activity: Record<string, SessionActivity>, activeSessionId: string | null): "waiting" | "failed" | "done" | null {
	const unread = new Set(Object.entries(activity).filter(([id]) => id !== activeSessionId).map(([, state]) => state));
	return unread.has("waiting") ? "waiting" : unread.has("failed") ? "failed" : unread.has("done") ? "done" : null;
}
