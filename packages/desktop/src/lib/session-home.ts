/**
 * The project folder a conversation belongs to.
 *
 * The folder it runs in, unless it runs in a worktree of its own (`SessionMeta.worktree`): then the
 * checkout the worktree was made from. Asked by everything that files conversations under projects —
 * the sidebar, the archive, a project's menu — because a worktree's path is under no registered
 * project, and filing by it put every such conversation in a group of its own, under the project's
 * name again. Copying "the path" and running things still use `cwd`: that is where the files are.
 */

import type { SessionMeta } from "@lyra/core";

export function sessionHome(session: Pick<SessionMeta, "cwd" | "worktree">): string {
	return session.worktree?.project ?? session.cwd;
}
