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

/**
 * 这条刚发出去的话，后台受理了没有。
 *
 * `pendingUserMessage` 是「已经乐观画进转录、但还没听见后台承认」的那一条。后台真正开始
 * 处理它的时候会把它作为 `message_start` 广播回来，那一刻这里就空了（见 `message-event`）。
 *
 * 所以它不在了 ≠ 一定被答复了，而是**这一条已经轮到了**。上一轮还在写的时候又发一条，那条
 * 消息在后台只是被记下来等着，`message_start` 迟迟不来——这段时间正是「排在后面」，而屏幕上
 * 从前把它画成「正在想」。返回布尔而不是那条消息本身：问的是有没有，订阅整条消息会让每次
 * 流式更新都重渲染一次。
 */
export function useScopedAwaitingTurn(): boolean {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (!id || s.activeSessionId === id) return s.pendingUserMessage !== null;
		return (s.sessionCache[id]?.state?.pendingUserMessage ?? null) !== null;
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
