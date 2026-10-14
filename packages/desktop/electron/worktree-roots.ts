/**
 * The folders conversations run their own worktrees in, as extra roots for the window's path gate.
 *
 * A conversation's worktree is made under `~/.lyra/worktrees` now, which is a root already. The ones
 * made before — beside the repository, or under a `worktrees.rootDir` that has changed since — are
 * not: their file tree came up empty, their terminal opened in the home folder and committing from
 * them was refused. `allowedRoots` in `main.ts` is synchronous and asked on every listing, so the
 * answer is kept in memory: loaded from the session list at start, then changed with every session
 * write this process reports (`observeSessionStorage`) — a worktree made, a conversation filed back
 * (`worktree-repair.ts`), moved elsewhere or deleted.
 *
 * Why widening the gate by these is safe: a path gets here only as the `cwd` of a conversation whose
 * meta carries `worktree`, and only the main process writes that field — after making the worktree
 * itself (`session-hub.ts`) or after git confirmed a linked worktree on a `lyra/session-` branch
 * (`worktree-repair.ts`). Nothing a window or a phone sends can set it: `move` without one clears it,
 * and a new conversation's choice of worktree is a yes or no (`prompt-input.ts`), never a path.
 */

import type { SessionMeta } from "@lyra/core";
import type { SessionChange } from "./ipc-shapes.ts";

export interface WorktreeRoots {
	/** The whole list, once at start. A conversation already reported through `observe` keeps what that said. */
	load(sessions: readonly SessionMeta[]): void;
	/** One committed session write, as `observeSessionStorage` reports it. */
	observe(change: SessionChange): void;
	/** Each conversation's own worktree, for `allowedRoots`. */
	roots(): string[];
}

export function worktreeRoots(): WorktreeRoots {
	const byId = new Map<string, string>();
	/*
	 * Writes heard before the list was read. The list is read asynchronously, and a write landing
	 * meanwhile — a conversation deleted, filed or moved — is newer than the list: letting the list
	 * win would put a deleted conversation's folder back on the gate. Dropped once loaded.
	 */
	let heard: Set<string> | null = new Set();
	const record = (id: string, meta: SessionMeta | null) => {
		if (meta?.worktree && meta.cwd) byId.set(id, meta.cwd);
		else byId.delete(id);
	};
	return {
		load(sessions) {
			for (const meta of sessions) if (!heard?.has(meta.id)) record(meta.id, meta);
			heard = null;
		},
		observe(change) {
			heard?.add(change.id);
			record(change.id, change.meta);
		},
		roots: () => [...new Set(byId.values())],
	};
}
