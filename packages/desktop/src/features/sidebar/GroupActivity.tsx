import { translate } from "../../i18n/translate.ts";
import type { SessionMeta } from "@lyra/core";
import { useApp } from "../../store/index.ts";
import { Spinner } from "../../ui/motion/loaders.tsx";
import { groupActivity } from "./group-activity.ts";

export function GroupActivity({ sessions, collapsed, count }: { sessions: readonly Pick<SessionMeta, "id">[]; collapsed: boolean; count: number }) {
	// A primitive selector avoids waking every heading for unrelated session updates.
	const running = useApp((state) => collapsed
		? groupActivity(sessions.map((session) => session.id), state.activity, state.activeSessionId).counts.running
		: 0);
	if (!collapsed) return null;
	// Only running work is loading. Settled or waiting sessions keep their own row indicators.
	if (running === 0) return count > 0 ? count : null;
	return (
		<span className="inline-flex h-3.5 w-3.5 items-center justify-center" aria-label={translate("groupActivity.running", { n: running })}>
			<Spinner size={14} />
		</span>
	);
}
