/**
 * Load a background pane's transcript without stealing the live slot.
 *
 * A restored four-pane window only `openSession`s the focused one. The others would sit on a
 * skeleton until clicked, which is the hitch the recording does not have — Codex's other panes
 * already show their chat. This writes the cache `SessionScope` reads, and refuses to touch
 * `activeSessionId`.
 */

import type { SessionMeta } from "@lyra/core";
import { intact } from "../../lib/transcript.ts";
import { bridge } from "../../services/index.ts";
import { howItStopped, prune, rebuildToolRuns, todosFrom } from "../../store/derive.ts";
import { useApp } from "../../store/index.ts";
import { useSubAgents } from "../../store/subAgents.ts";

const inflight = new Set<string>();

export async function warmSession(meta: SessionMeta): Promise<void> {
	const state = useApp.getState();
	if (state.activeSessionId === meta.id) return;
	const cached = state.sessionCache[meta.id];
	if (cached && !cached.dirty && cached.messages.length > 0) return;
	if (inflight.has(meta.id)) return;
	inflight.add(meta.id);
	// Its sub-agents too: the bar and panel in this screen show this conversation's, not the focused one's.
	void bridge.subAgents.list(meta.id).then((list) => {
		if (Array.isArray(list) && useApp.getState().activeSessionId !== meta.id) useSubAgents.getState().retain(meta.id, list);
	}).catch(() => {});
	try {
		const snapshot = await bridge.sessions.transcript(meta.projectId, meta.id);
		if (!snapshot) return;
		if (useApp.getState().activeSessionId === meta.id) return;
		const messages = intact(snapshot.messages);
		const toolRuns = rebuildToolRuns(messages);
		const live = useApp.getState();
		useApp.setState({
			sessionCache: prune(
				{
					...live.sessionCache,
					[meta.id]: {
						meta: snapshot.meta,
						messages,
						toolRuns,
						state: {
							running: snapshot.running,
							commandRuns: snapshot.commandRuns ?? [],
							todos: todosFrom(messages),
							compactions: (snapshot.compactions ?? []).map((at) => ({ at, before: 0, after: 0 })),
							approvals: snapshot.pendingApprovals,
							stopped: snapshot.running ? null : howItStopped(messages),
							retrying: null,
							capabilities: null,
							pendingUserMessage: null,
						},
					},
				},
				live.activeSessionId ?? meta.id,
			),
		});
	} catch {
		// A pane that cannot warm still opens when focused; a throw here would blank the workspace.
	} finally {
		inflight.delete(meta.id);
	}
}
