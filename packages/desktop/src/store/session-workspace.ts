/**
 * The workspace a conversation shows: where it runs, named for the project it belongs to.
 *
 * A conversation given a worktree of its own (`SessionMeta.worktree`) runs there — the branch, the
 * uncommitted changes and the files on screen have to be the worktree's — but it is still part of the
 * project it was made from. Read straight from its folder, the project chip said `Lyra-3f9a1c2e`, and
 * a new conversation started from it was made inside the worktree, which then got a worktree of its
 * own: `Lyra-3f9a1c2e-9b0d77aa`.
 */

import type { SessionMeta } from "@lyra/core";
import type { WorkspaceInfo } from "../../electron/ipc-types.ts";
import { baseName } from "../lib/paths.ts";
import { bridge } from "../services/index.ts";

export async function sessionWorkspace(meta: Pick<SessionMeta, "cwd" | "worktree">): Promise<WorkspaceInfo | null> {
	const workspace = await bridge.workspace.info(meta.cwd);
	if (!meta.worktree) return workspace;
	/*
	 * Taken back — archived, or cleaned up — the folder is not there until the conversation is used
	 * again. It is still this project's conversation, so it is named as one rather than shown in no
	 * project at all; with nothing checked out there is no branch to show and nothing to list.
	 */
	return workspace
		? worktreeWorkspace(workspace, meta.worktree.project)
		: { path: meta.cwd, name: baseName(meta.worktree.project), isGitRepo: false, branch: null, worktreeOf: meta.worktree.project };
}

/** What git says about a worktree's folder, named for the project it belongs to. */
export function worktreeWorkspace(workspace: WorkspaceInfo, project: string): WorkspaceInfo {
	return { ...workspace, name: baseName(project) || workspace.name, worktreeOf: project };
}

/**
 * The project a worktree's conversation belongs to, as the workspace a new conversation starts in.
 *
 * Synchronous on purpose: 新对话 must not wait on git to clear the window. The branch is unknown until
 * it is read again, and an empty branch chip for a moment is better than the worktree's branch shown
 * against the project.
 */
export function projectWorkspace(workspace: WorkspaceInfo): WorkspaceInfo {
	if (!workspace.worktreeOf) return workspace;
	const { worktreeOf, ...rest } = workspace;
	return { ...rest, path: worktreeOf, name: baseName(worktreeOf) || workspace.name, branch: null };
}
