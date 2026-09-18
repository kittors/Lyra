import { visibleActivity } from "@lyra/core/activity";
import type { SessionMeta } from "@lyra/core";
import { translate } from "../../i18n/translate.ts";
import { useApp, useSideChatRunningKey } from "../../store/index.ts";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { groupActivity } from "./group-activity.ts";

export function GroupActivity({ sessions, collapsed, count }: { sessions: readonly Pick<SessionMeta, "id">[]; collapsed: boolean; count: number }) {
	const ids = sessions.map((session) => session.id);
	// Primitive returns, so a heading only wakes when its own count or occupants change.
	const mainRunning = useApp((state) =>
		collapsed ? groupActivity(ids, state.activity, state.activeSessionId).counts.running : 0,
	);
	const occupied = useApp((state) =>
		collapsed
			? ids
					.filter((id) => {
						const visible = visibleActivity(state.activity[id] ?? null, id === state.activeSessionId);
						return visible === "running" || visible === "waiting";
					})
					.join("\0")
			: "",
	);
	const sideKey = useSideChatRunningKey(collapsed ? ids : []);
	if (!collapsed) return null;
	const live = new Set(occupied ? occupied.split("\0") : []);
	let running = mainRunning;
	for (const id of sideKey ? sideKey.split("\0") : []) {
		if (!live.has(id)) running += 1;
	}
	// Only running work is loading. Settled or waiting sessions keep their own row indicators.
	if (running === 0) return count > 0 ? count : null;
	return (
		<span
			className="inline-flex h-3.5 w-3.5 items-center justify-center"
			data-ly-group-running={running}
			aria-label={translate("groupActivity.running", { n: running })}
		>
			<ActionSpinner size={14} />
		</span>
	);
}
