/**
 * Starting a conversation in one particular project.
 *
 * Its own file because two places offer it — the button on the project row and the row's context
 * menu — and those two live in directories that already import each other. Putting the action in
 * either one makes the cycle real.
 */

import { useApp } from "../../store/index.ts";

/**
 * Switching project already blanks the conversation (see `openWorkspace`), so on another project
 * the second call is what makes the rest of the state whole — todos, sub-agents, the turn meter —
 * rather than a second way of doing the same thing. Unfolds the group on the way, because the row
 * about to appear is the point of the press and a folded project would swallow it.
 */
export async function startProjectSession(path: string, expand?: () => void): Promise<void> {
	const { workspace, openWorkspace, newSession } = useApp.getState();
	expand?.();
	if (workspace?.path !== path) await openWorkspace(path);
	await newSession();
}
