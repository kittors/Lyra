/**
 * Loading a session's trajectory, and narrowing it.
 *
 * Read once when the conversation changes, filtered in memory afterwards. Search re-runs on every
 * keystroke, and re-reading a session with several hundred records for each one would make the
 * box feel broken.
 *
 * Reloaded when the turn ends rather than on every event: the file is being appended to while the
 * agent works, and a list that reshuffles under the cursor is worse than one that is a moment
 * behind.
 */

import { useEffect, useMemo, useState } from "react";
import { countBySource, filterTrajectory, type Entry as TrajectoryEntry, type Source as TrajectorySourceKind } from "@lyra/core/trajectory-view";
import { useApp } from "../../store.ts";
import { bridge } from "../../services/index.ts";

export interface TrajectoryView {
	entries: TrajectoryEntry[];
	counts: Record<string, number>;
	total: number;
	loading: boolean;
}

export function useTrajectory(sources: TrajectorySourceKind[], query: string): TrajectoryView {
	const meta = useApp((s) => s.meta);
	const running = useApp((s) => s.running);
	const [all, setAll] = useState<TrajectoryEntry[]>([]);
	const [loading, setLoading] = useState(false);

	const projectId = meta?.projectId;
	const sessionId = meta?.id;

	useEffect(() => {
		if (!projectId || !sessionId) {
			setAll([]);
			return;
		}
		let live = true;
		setLoading(true);
		void bridge.sessions
			.trajectory(projectId, sessionId)
			.then((entries) => {
				if (live) setAll(entries);
			})
			.finally(() => {
				if (live) setLoading(false);
			});
		return () => {
			live = false;
		};
		// `running` is in here so the trajectory refreshes once a turn finishes.
	}, [projectId, sessionId, running]);

	const counts = useMemo(() => countBySource(all), [all]);
	const entries = useMemo(() => filterTrajectory(all, { sources, query }), [all, sources, query]);

	return { entries, counts, total: all.length, loading };
}
