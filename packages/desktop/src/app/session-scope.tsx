/**
 * Which conversation a mounted pane is drawing.
 *
 * The app store still has one live transcript slot. A split window mounts more than one
 * conversation, so each pane names the session it is responsible for. The focused pane reads
 * the live fields; the others read the cache that `openSession` parks on the way out.
 *
 * `undefined` means "not inside a pane" — Composer on the empty state, the skeleton — and
 * falls back to the store's active id. `null` is the blank conversation that has not been sent.
 */

import { createContext, useContext } from "react";
import type { Message, SessionMeta, SubAgentSummary } from "@lyra/core";
import { useApp, type AppState } from "../store/index.ts";
import { useSubAgents } from "../store/subAgents.ts";
import type { Cache } from "../store/derive.ts";
import type { ToolRun } from "../store/tool-run.ts";

export const SessionScope = createContext<string | null | undefined>(undefined);

/**
 * Which screen's dock a pane is drawn in: that screen's key — its session id, or `@draft`.
 *
 * Null outside any screen, which is a panel window: it holds one panel and is that panel. Kept here
 * beside `SessionScope` rather than in the dock so a panel can ask without importing the dock.
 */
export const DockScope = createContext<string | null>(null);

export function useDockScope(): string | null {
	return useContext(DockScope);
}

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TODOS: AppState["todos"] = [];
const EMPTY_APPROVALS: AppState["approvals"] = [];
const EMPTY_RUNS: AppState["commandRuns"] = [];
const EMPTY_HICCUPS: AppState["hiccups"] = [];
const EMPTY_TOOLS: Record<string, ToolRun> = {};
const EMPTY_AGENTS: SubAgentSummary[] = [];

export function useScopedSessionId(): string | null {
	const scoped = useContext(SessionScope);
	const active = useApp((s) => s.activeSessionId);
	return scoped === undefined ? active : scoped;
}

export function useScopedMessages(): Message[] {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.messages;
		return s.sessionCache[id]?.messages ?? EMPTY_MESSAGES;
	});
}

export function useScopedRunning(): boolean {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.running;
		return s.sessionCache[id]?.state?.running ?? s.activity[id] === "running";
	});
}

export function useScopedStopped() {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.stopped;
		return s.sessionCache[id]?.state?.stopped ?? null;
	});
}

export function useScopedTodos() {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.todos;
		return s.sessionCache[id]?.state?.todos ?? EMPTY_TODOS;
	});
}

export function useScopedApprovals(): AppState["approvals"] {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.approvals;
		return s.sessionCache[id]?.state?.approvals ?? EMPTY_APPROVALS;
	});
}

export function useScopedCompactions() {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.compactions;
		return s.sessionCache[id]?.state?.compactions ?? EMPTY_RUNS;
	});
}

export function useScopedCommandRuns() {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.commandRuns;
		return s.sessionCache[id]?.state?.commandRuns ?? EMPTY_RUNS;
	});
}

export function useScopedHiccups() {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.hiccups;
		return s.sessionCache[id]?.state?.hiccups ?? EMPTY_HICCUPS;
	});
}

export function useScopedToolRuns(): Record<string, ToolRun> {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.toolRuns;
		return s.sessionCache[id]?.toolRuns ?? EMPTY_TOOLS;
	});
}

export function useScopedMeta(): SessionMeta | null {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.meta;
		return s.sessionCache[id]?.meta ?? s.sessions.find((session) => session.id === id) ?? null;
	});
}

export function useScopedLoading(): boolean {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id) return false;
		if (s.activeSessionId === id) return s.loadingSession;
		const cached = s.sessionCache[id] as Cache[string] | undefined;
		return !cached;
	});
}

/**
 * This conversation's sub-agents: the live roster when it is the live conversation, and the last one
 * it broadcast otherwise — a second screen shows its own delegated work, not the focused one's.
 */
export function useScopedSubAgents(): SubAgentSummary[] {
	const id = useScopedSessionId();
	const active = useApp((s) => s.activeSessionId);
	const live = useSubAgents((s) => s.agents);
	const retained = useSubAgents((s) => (id ? s.rosters[id] : undefined));
	if (!id || id === active) return live;
	return retained ?? EMPTY_AGENTS;
}
