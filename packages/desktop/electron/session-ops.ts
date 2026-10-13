/**
 * The desktop's half of `archive_session`: filing a conversation away once the turn that asked for
 * it is over.
 *
 * The tool cannot archive in place. The ordinary path (`sessions:setArchived`) disposes the session
 * first, and disposing aborts the turn — the very turn still waiting for the tool to return. So the
 * tool leaves a request here and ends its turn (`terminate`); this watches the session's events,
 * archives it after its `agent_end`, and lets the session go once nothing is running on it any more.
 * See ADR-0038.
 */

import type { AgentEvent } from "@lyra/core";

export interface ArchiveDeps {
	/** Write the archive mark. Through the observed store, so every window and paired phone hears of it. */
	archive(sessionId: string): Promise<void>;
	/** Whether the session is still doing something: the turn's wind-down, or work queued behind it. */
	busy(sessionId: string): boolean;
	/** Whether it is still archived when it is finally idle — it may have been brought back meanwhile. */
	archived(sessionId: string): Promise<boolean>;
	dispose(sessionId: string): Promise<void>;
	/** How long to wait between looks while the session is busy. */
	pollMs?: number;
}

export interface ArchiveAfterTurn {
	/** Called by the tool: archive this session when its current turn ends. */
	request(sessionId: string): void;
	/** Every event of every session passes here; only the end of a turn that asked matters. */
	observe(sessionId: string, event: AgentEvent): void;
}

export function archiveAfterTurn(deps: ArchiveDeps): ArchiveAfterTurn {
	const requested = new Set<string>();
	const pause = () => new Promise<void>((resolve) => setTimeout(resolve, deps.pollMs ?? 250));

	const settle = async (sessionId: string) => {
		await deps.archive(sessionId);
		/*
		 * Disposed only once it is idle, never at `agent_end` itself: `running` stays true through the
		 * turn's wind-down (the correction check) and through anything queued behind it, and disposing
		 * aborts whatever is in flight — the cut this whole detour exists to avoid.
		 */
		while (deps.busy(sessionId)) await pause();
		if (await deps.archived(sessionId)) await deps.dispose(sessionId);
	};

	return {
		request(sessionId) {
			requested.add(sessionId);
		},
		observe(sessionId, event) {
			// One request, one turn: whichever way that turn ends, the next one starts without it.
			if (event.type !== "agent_end" || !requested.delete(sessionId)) return;
			/*
			 * Only a turn that ended the way it was asked to. Stopped or failed, the conversation stays
			 * where the person can see what happened — a stop pressed after the call is the newer word,
			 * and an archive would carry the failure out of sight.
			 */
			if (event.reason !== "done") return;
			void settle(sessionId).catch((error: unknown) => console.error("[session-ops] archive after turn failed", error));
		},
	};
}
