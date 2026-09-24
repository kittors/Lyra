import { useEffect, useState, useCallback } from "react";
import type { Entry } from "@lyra/core/trajectory-view";
import { useScopedMeta } from "../../../app/session-scope.tsx";
import { bridge } from "../../../services/index.ts";

import { applyTrajectoryChanges } from "./trajectory-state.ts";

interface Snapshot { cursor: string; entries: Entry[] }
const cache = new Map<string, Snapshot>();
const durable = new Set(["command_status", "compacted", "message_end", "tool_start", "tool_end", "context", "request", "agent_start", "agent_end", "subagent", "subagent_done", "subagent_message", "subagent_event", "notice", "retry", "approval_request", "rewound"]);

/** Subscribe before reading; a single in-flight read drains invalidations without polling. */
export function useTrajectory() {
	// The trajectory of the conversation whose screen asks, not of whichever one has the focus.
	const meta = useScopedMeta();
	const sessionId = meta?.id, projectId = meta?.projectId;
	const key = `${projectId}:${sessionId}`;
	const [value, setValue] = useState<{ key: string; entries: Entry[] } | null>(null);
	const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
	const [readingKey, setReadingKey] = useState<string | null>(null);
	const [revision, setRevision] = useState(0);
	const refresh = useCallback(() => setRevision(value => value + 1), []);
	useEffect(() => {
		if (!sessionId || !projectId) return;
		let live = true, reading = false, dirty = false;
		let snapshot = cache.get(key);
		const read = async () => {
			dirty = true;
			if (reading) return;
			reading = true;
			setReadingKey(key);
			try {
				do {
					dirty = false;
					const changes = await bridge.sessions.trajectoryChanges(projectId, sessionId, snapshot?.cursor);
					if (!live) return;
					const entries = applyTrajectoryChanges(snapshot?.entries ?? [], changes);
					snapshot = { cursor: changes.cursor, entries };
					cache.delete(key); cache.set(key, snapshot);
					while (cache.size > 4) { const oldest = cache.keys().next().value; if (oldest) cache.delete(oldest); }
					setValue(previous => previous?.key === key && previous.entries === entries ? previous : { key, entries }); setFailure(null);
				} while (dirty);
			} catch (error) { if (live) setFailure({ key, message: String(error) }); }
			finally { reading = false; if (live) setReadingKey(null); }
		};
		const off = bridge.agent.onEvent(payload => { if (payload.sessionId === sessionId && durable.has(payload.event.type)) void read(); });
		// Reconnecting restores transcripts but cannot replay the durable events this panel missed.
		const onConnection = (event: Event) => { if (event instanceof CustomEvent && event.detail === "connected") void read(); };
		const onForeground = () => { if (document.visibilityState === "visible") void read(); };
		window.addEventListener("lyra:connection", onConnection);
		window.addEventListener("focus", onForeground);
		document.addEventListener("visibilitychange", onForeground);
		void read();
		return () => {
			live = false; off();
			window.removeEventListener("lyra:connection", onConnection);
			window.removeEventListener("focus", onForeground);
			document.removeEventListener("visibilitychange", onForeground);
		};
	}, [projectId, sessionId, key, revision]);
	const all = value?.key === key ? value.entries : cache.get(key)?.entries;
	return { all: all ?? [], loading: Boolean(sessionId && !all && failure?.key !== key), refreshing: readingKey === key, error: failure?.key === key ? failure.message : "", refresh };
}
