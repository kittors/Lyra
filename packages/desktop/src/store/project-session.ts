/**
 * Starting a conversation in one particular project.
 *
 * Its own file because more than one place offers it — the button on a project row, the row's
 * context menu — and those live in directories that already import each other. Putting the action
 * in either one makes the cycle real.
 *
 * Under `store/` rather than in `sidebar/`, which is where it used to sit. It reads nothing but
 * the store and renders nothing, so it was only a sidebar file by association — and being one cost
 * something: `modals/` could only reach it through `sidebar/index.ts`, which drags the entire
 * sidebar in behind it and closes the loop the comment above says this file exists to avoid.
 */

import { useApp } from "./index.ts";

/**
 * Switching project also resets the conversation before saving recency. Resetting again after
 * that write could discard a session submitted in the meantime. Unfold the group so its next
 * session is visible.
 */
export async function startProjectSession(path: string, expand?: () => void): Promise<void> {
	const { workspace, openWorkspace, newSession, setView } = useApp.getState();
	expand?.();
	if (workspace?.path !== path) {
		setView("chat");
		await openWorkspace(path);
	}
	else await newSession();
}
