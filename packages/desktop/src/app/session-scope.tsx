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
import type { Message, SessionMeta } from "@lyra/core";
import { useApp, type AppState } from "../store/index.ts";
import type { Cache } from "../store/derive.ts";
import type { ToolRun } from "../store/tool-run.ts";

export const SessionScope = createContext<string | null | undefined>(undefined);

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TODOS: AppState["todos"] = [];
const EMPTY_APPROVALS: AppState["approvals"] = [];
const EMPTY_RUNS: AppState["commandRuns"] = [];
const EMPTY_HICCUPS: AppState["hiccups"] = [];
const EMPTY_TOOLS: Record<string, ToolRun> = {};

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

export function useScopedRetrying() {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.retrying;
		return s.sessionCache[id]?.state?.retrying ?? null;
	});
}
