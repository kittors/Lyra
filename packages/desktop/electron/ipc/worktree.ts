/**
 * A conversation's own worktree, over IPC: where it stands against the branch it was cut from, merging
 * it back, syncing it. By conversation id, with the meta read fresh — a live conversation's from memory,
 * any other from the store. See ADR-0038.
 */

import { ipcMain } from "electron";
import type { SessionMeta, SessionStorage } from "@lyra/core";
import type { MergeOutcome, SyncOutcome } from "../ipc-shapes.ts";
import { sessions } from "../session-hub.ts";
import { worktreeState } from "../worktree-lifecycle.ts";
import { abortSync, mergeIntoBase, syncFromBase } from "../worktree-merge.ts";

export interface WorktreeIpcDeps {
	store(): SessionStorage;
}

export function registerWorktreeIpc({ store }: WorktreeIpcDeps): void {
	const metaOf = async (sessionId: string): Promise<SessionMeta | null> =>
		sessions.get(sessionId)?.meta ?? (await store().listSessions()).find((meta) => meta.id === sessionId) ?? null;
	/*
	 * Merging and syncing change what a running turn is reading and writing, so neither starts while one
	 * runs — refused, the way moving a conversation is (`sessions:move`), rather than interleaved.
	 */
	const running = (sessionId: string) => sessions.get(sessionId)?.running === true;

	ipcMain.handle("worktree:state", async (_event, sessionId: string) => {
		const meta = await metaOf(sessionId);
		return meta ? worktreeState(meta) : null;
	});

	ipcMain.handle("worktree:merge", async (_event, sessionId: string): Promise<MergeOutcome> => {
		const meta = await metaOf(sessionId);
		if (!meta?.worktree) return { kind: "refused", reason: "gone" };
		if (running(sessionId)) return { kind: "refused", reason: "running" };
		return mergeIntoBase(meta);
	});

	ipcMain.handle("worktree:sync", async (_event, sessionId: string): Promise<SyncOutcome> => {
		const meta = await metaOf(sessionId);
		if (!meta?.worktree) return { kind: "refused", reason: "gone" };
		if (running(sessionId)) return { kind: "refused", reason: "running" };
		return syncFromBase(meta);
	});

	ipcMain.handle("worktree:abortSync", async (_event, sessionId: string) => {
		const meta = await metaOf(sessionId);
		if (!meta?.worktree || running(sessionId)) return false;
		return abortSync(meta);
	});
}
