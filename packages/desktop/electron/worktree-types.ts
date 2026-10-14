/**
 * What the window is told about a conversation's own worktree (`worktree-lifecycle.ts`,
 * `worktree-merge.ts`, ADR-0038).
 *
 * Types only, importing nothing: `ipc-shapes.ts` re-exports them, and the git modules that produce
 * them reaching back into `ipc-shapes.ts` closed a loop through the session hub.
 */

export interface WorktreeState {
	branch: string;
	/** What merging back goes into and syncing brings in; null when there is no branch to name. */
	base: string | null;
	/** The folder is on disk; false once it has been taken back (`reclaimWorktree`). */
	present: boolean;
	/** Commits on the branch its base does not have, and the other way round. */
	ahead: number;
	behind: number;
	/** Files with changes not committed, untracked ones included. */
	uncommitted: number;
	/** A sync stopped on conflicts and is waiting for them: these files still have them. */
	merging: boolean;
	conflicted: string[];
}

/** Why merging back or syncing did nothing. */
export type Refusal = "gone" | "no-base" | "running" | "syncing" | "busy" | "elsewhere" | "failed";

export type MergeOutcome =
	| { kind: "merged"; commits: number; base: string }
	| { kind: "nothing"; base: string }
	| { kind: "uncommitted"; files: number }
	| { kind: "conflict"; files: string[]; base: string }
	| { kind: "refused"; reason: Refusal; detail?: string };

export type SyncOutcome =
	| { kind: "synced"; commits: number; base: string }
	| { kind: "up-to-date"; base: string }
	| { kind: "uncommitted"; files: number }
	| { kind: "conflict"; files: string[]; base: string }
	| { kind: "refused"; reason: Refusal; detail?: string };
