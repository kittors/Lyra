/**
 * Which conversation a mounted pane is drawing.
 *
 * The app store still has one live transcript slot. A split window mounts more than one
 * conversation, so each pane names the session it is responsible for. The focused pane reads
 * the live fields; the others read the cache that `openSession` parks on the way out.
 *
 * `undefined` means "not inside a pane" — Composer on the empty state, the skeleton — and
 * falls back to the store's active id. `null` is the blank conversation that has not been sent.
 *
 * A pane reads the live fields only when its conversation is the one in the live slot — the blank
 * one included. A split can show a blank screen while a conversation beside it holds the slot, and
 * that screen reading the live fields drew the other conversation's state: its running turn, its
 * stop button, its project.
 */

import { createContext, useContext, useEffect } from "react";
import type { Message, SessionMeta, SubAgentSummary } from "@lyra/core";
import type { WorkspaceInfo } from "../../electron/ipc-types.ts";
import { isProjectLess } from "../lib/project-scope.ts";
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

/**
 * Put a screen's conversation in the live slot — what pressing anywhere on that screen does.
 *
 * Registered by the split workspace, which owns the screens; a window without one shows a single
 * conversation that is live already. Kept here beside `SessionScope` so a composer can ask without
 * importing the split, which draws the composer and would close a loop.
 */
let focusScreen: ((sessionId: string | null) => void) | null = null;

export function provideScreenFocus(focus: ((sessionId: string | null) => void) | null): void {
	focusScreen = focus;
}

/** For the keyboard, which reaches a screen's controls without the press that would have focused it. */
export function focusScreenOf(sessionId: string | null): void {
	focusScreen?.(sessionId);
}

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TODOS: AppState["todos"] = [];
const EMPTY_APPROVALS: AppState["approvals"] = [];
const EMPTY_RUNS: AppState["commandRuns"] = [];
const EMPTY_HICCUPS: AppState["hiccups"] = [];
const EMPTY_TOOLS: Record<string, ToolRun> = {};
const EMPTY_AGENTS: SubAgentSummary[] = [];

/** A screen's parked copy — none for a blank screen away from the live slot, which has said nothing yet. */
function parked(s: AppState, id: string | null): Cache[string] | undefined {
	return id === null ? undefined : s.sessionCache[id];
}

export function useScopedSessionId(): string | null {
	const scoped = useContext(SessionScope);
	const active = useApp((s) => s.activeSessionId);
	return scoped === undefined ? active : scoped;
}

export function useScopedMessages(): Message[] {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (id === s.activeSessionId) return s.messages;
		return parked(s, id)?.messages ?? EMPTY_MESSAGES;
	});
}

/**
 * One fact read off this screen's transcript, redrawing only when the fact changes.
 *
 * For a row that needs something about the whole transcript — which message was said last — and
 * would otherwise redraw on every streamed token by holding the list itself.
 */
export function useScopedFromMessages<T>(read: (messages: Message[]) => T): T {
	const id = useScopedSessionId();
	return useApp((s) => read(id === s.activeSessionId ? s.messages : (parked(s, id)?.messages ?? EMPTY_MESSAGES)));
}

export function useScopedRunning(): boolean {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (id === s.activeSessionId) return s.running;
		return parked(s, id)?.state?.running ?? (id !== null && s.activity[id] === "running");
	});
}

/**
 * 这场对话此刻有没有活在干：主会话这一轮在跑，或者它放到后台的子智能体还没跑完。
 *
 * 清单和「接着做」那一行看这个，而不是 `useScopedRunning`。人在主会话等子智能体时插了话，主会话
 * 回应完就收尾了——可活并没有停：后台那几个跑完，结果会送回来，主会话接着干。那时候清单说「停在
 * 这一步」、再给一个 ▶，是请人把一件本来就在进行的事再启动一遍（按下去还会让它重派一遍）。
 *
 * 输入框不看这个：它问的是「现在说话会不会插进一轮」，而后台的子智能体不占着主会话。
 */
export function useScopedWorking(): boolean {
	const running = useScopedRunning();
	const background = useScopedSubAgents().some((one) => one.background && (one.status === "running" || one.status === "queued"));
	return running || background;
}

export function useScopedStopped() {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (id === s.activeSessionId) return s.stopped;
		return parked(s, id)?.state?.stopped ?? null;
	});
}

export function useScopedTodos() {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (id === s.activeSessionId) return s.todos;
		return parked(s, id)?.state?.todos ?? EMPTY_TODOS;
	});
}

export function useScopedApprovals(): AppState["approvals"] {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (id === s.activeSessionId) return s.approvals;
		return parked(s, id)?.state?.approvals ?? EMPTY_APPROVALS;
	});
}

export function useScopedCompactions() {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (id === s.activeSessionId) return s.compactions;
		return parked(s, id)?.state?.compactions ?? EMPTY_RUNS;
	});
}

export function useScopedCommandRuns() {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (id === s.activeSessionId) return s.commandRuns;
		return parked(s, id)?.state?.commandRuns ?? EMPTY_RUNS;
	});
}

export function useScopedHiccups() {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (id === s.activeSessionId) return s.hiccups;
		return parked(s, id)?.state?.hiccups ?? EMPTY_HICCUPS;
	});
}

export function useScopedToolRuns(): Record<string, ToolRun> {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (id === s.activeSessionId) return s.toolRuns;
		return parked(s, id)?.toolRuns ?? EMPTY_TOOLS;
	});
}

/** One fact read off this screen's tool runs, redrawing only when the fact changes — see `useScopedFromMessages`. */
export function useScopedFromToolRuns<T>(read: (runs: Record<string, ToolRun>) => T): T {
	const id = useScopedSessionId();
	return useApp((s) => read(id === s.activeSessionId ? s.toolRuns : (parked(s, id)?.toolRuns ?? EMPTY_TOOLS)));
}

/**
 * This screen's turn meter: when its turn began, and what it has spent so far.
 *
 * `turnStartedAt` and `turnTokens` mirror `turns[activeSessionId]` — the live slot's. A conversation
 * running beside it keeps its own meter in `turns`; read from the pair, its running line showed the
 * focused conversation's clock and count.
 */
export function useScopedTurnMeter(): { startedAt: number | null; tokens: number } {
	const id = useScopedSessionId();
	const startedAt = useApp((s) => (id === s.activeSessionId ? s.turnStartedAt : id === null ? null : (s.turns[id]?.startedAt ?? null)));
	const tokens = useApp((s) => (id === s.activeSessionId ? s.turnTokens : id === null ? 0 : (s.turns[id]?.tokens ?? 0)));
	return { startedAt, tokens };
}

/** Whether this screen's turn is waiting out a dropped connection. */
export function useScopedRetrying(): AppState["retrying"] {
	const id = useScopedSessionId();
	return useApp((s) => (id === s.activeSessionId ? s.retrying : (parked(s, id)?.state?.retrying ?? null)));
}

/** When this screen's history was last summarised, for the running line's passing mention of it. */
export function useScopedCompactedAt(): number | null {
	const id = useScopedSessionId();
	return useApp((s) => (id === s.activeSessionId ? s.compactedAt : (parked(s, id)?.state?.compactedAt ?? null)));
}

export function useScopedMeta(): SessionMeta | null {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (id === s.activeSessionId) return s.meta;
		return parked(s, id)?.meta ?? (id === null ? null : (s.sessions.find((session) => session.id === id) ?? null));
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
	if (id === active) return live;
	return retained ?? EMPTY_AGENTS;
}

/**
 * The project this screen's conversation works in, as its path — null for one in no project.
 *
 * The same answer `useScopedWorkspace` gives as `workspace.path`, for the many small readers that
 * need only the path: every relative link in a transcript resolves against it, and one subscription
 * each is what a long transcript can afford where a dozen is not.
 */
export function useScopedProjectPath(): string | null {
	const id = useScopedSessionId();
	return useApp((s) => {
		if (id === s.activeSessionId) return s.workspace?.path ?? null;
		if (id === null) return s.parkedDraft?.workspace?.path ?? null;
		const cwd = (s.sessionCache[id]?.meta ?? s.sessions.find((one) => one.id === id))?.cwd ?? null;
		return cwd !== null && !isProjectLess(cwd, s.scratchRoots) ? cwd : null;
	});
}

const NO_WORKSPACE: { workspace: WorkspaceInfo | null; scratchCwd: string | null } = { workspace: null, scratchCwd: null };

/**
 * Where this screen's conversation runs: its own project, not the one that has focus.
 *
 * `workspace` and `scratchCwd` describe the live slot. Another conversation's screen takes its
 * project from that conversation's directory, split into project and project-less the way
 * `openSession` splits it, and named from what the project was when it last held the live slot — or
 * read once, for one that never did. A blank screen away from the live slot runs where it was parked.
 */
export function useScopedWorkspace(): { workspace: WorkspaceInfo | null; scratchCwd: string | null } {
	const id = useScopedSessionId();
	const live = useApp((s) => id === s.activeSessionId);
	const workspace = useApp((s) => s.workspace);
	const scratchCwd = useApp((s) => s.scratchCwd);
	const draft = useApp((s) => (id === null ? s.parkedDraft : null));
	const meta = useApp((s) => (id === null ? null : (s.sessionCache[id]?.meta ?? s.sessions.find((one) => one.id === id) ?? null)));
	const cwd = meta?.cwd ?? null;
	const projectLess = useApp((s) => cwd !== null && isProjectLess(cwd, s.scratchRoots));
	const known = useApp((s) => (cwd === null ? undefined : s.workspaceByPath[cwd]));
	const named = useApp((s) => (cwd === null ? undefined : s.settings?.projects.find((project) => project.path === cwd)?.name));
	const describe = useApp((s) => s.describeWorkspace);
	const unread = !live && cwd !== null && !projectLess && !known;
	useEffect(() => {
		if (unread && cwd) void describe(cwd);
	}, [unread, cwd, describe]);
	if (live) return { workspace, scratchCwd };
	if (id === null) return draft ?? NO_WORKSPACE;
	if (cwd === null) return NO_WORKSPACE;
	if (projectLess) return { workspace: null, scratchCwd: cwd };
	// Named at once from the conversation; the branch arrives with the read.
	return { workspace: known ?? { path: cwd, name: named ?? meta?.projectName ?? cwd, isGitRepo: false, branch: null }, scratchCwd: null };
}
