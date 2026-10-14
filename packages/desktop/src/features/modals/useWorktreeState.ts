/**
 * Where a conversation's own worktree stands against the branch it was cut from — read from git, for
 * the chip that names it and the menu behind the chip.
 *
 * Read again whenever it can have moved on its own: the conversation opened, a turn ended (the model
 * commits), the window came back to the front (a person committed in a terminal). Not on a timer — each
 * read is a handful of git calls, and nothing changes in a worktree that nobody is working in.
 */

import type { SessionMeta } from "@lyra/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorktreeState } from "../../../electron/ipc-types.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";

/** The last answer per conversation, so coming back to one shows it at once while it is read again. */
const lastSeen = new Map<string, WorktreeState>();

export interface WorktreeView {
	/** Null until the first answer, and for a conversation that has no worktree. */
	state: WorktreeState | null;
	refresh(): Promise<WorktreeState | null>;
}

export function useWorktreeState(meta: Pick<SessionMeta, "id" | "worktree" | "archived"> | null, running: boolean): WorktreeView {
	const sessionId = meta?.worktree ? meta.id : null;
	const [state, setState] = useState<WorktreeState | null>(() => (sessionId ? (lastSeen.get(sessionId) ?? null) : null));
	const refreshWorkspace = useApp((s) => s.refreshWorkspace);
	const current = useRef(sessionId);
	current.current = sessionId;
	const present = useRef<boolean | null>(null);

	const refresh = useCallback(async () => {
		if (!sessionId) return null;
		const next = await bridge.worktree.state(sessionId).catch(() => null);
		if (current.current !== sessionId) return next;
		if (next) lastSeen.set(sessionId, next);
		else lastSeen.delete(sessionId);
		setState(next);
		/*
		 * The folder came back — the conversation was taken out of the archive, or a turn checked it out
		 * again — and what was read while it was gone (no branch, nothing to list) is out of date.
		 */
		if (present.current === false && next?.present && useApp.getState().activeSessionId === sessionId) void refreshWorkspace();
		present.current = next?.present ?? null;
		return next;
	}, [sessionId, refreshWorkspace]);

	useEffect(() => {
		present.current = null;
		setState(sessionId ? (lastSeen.get(sessionId) ?? null) : null);
	}, [sessionId]);

	// Opened, and every time a turn ends or it comes out of (or goes into) the archive.
	useEffect(() => {
		if (!running) void refresh();
	}, [refresh, running, meta?.archived]);

	useEffect(() => {
		if (!sessionId) return;
		const onFocus = () => void refresh();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [sessionId, refresh]);

	return { state: sessionId ? state : null, refresh };
}
