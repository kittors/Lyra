import { isDescendantPath } from "./paths.ts";

/**
 * Whether a conversation counts as part of a project, given the folders that project is made of.
 *
 * Takes one folder or several, because a project may name more than one source folder (see
 * `ProjectEntry.folders`) and a conversation started in any of them belongs to it. One string is
 * still accepted so the many callers that only ever have a path read as they always did.
 *
 * A chat started in a subfolder belongs to the project too. The sidebar keys its groups on
 * `session.cwd` verbatim, so one opened in `proj/packages/core` builds its own group instead of
 * joining `proj`'s — and matching only on equality left those behind. Removing the project then
 * dropped the entry and a group with the same name came straight back from the sessions one
 * directory down: the 「删不掉」 report again, wearing a different path.
 *
 * `isDescendantPath` is strict about the separator, so `proj-old` is not inside `proj`. The
 * trailing slash goes first because a configured project path and a session's `cwd` reach us from
 * different places and only one of them tends to carry one.
 *
 * Deliberately in `lib` rather than beside its caller in the store: the store module pulls in the
 * bridge and the sub-agent registry, neither of which exists outside a window, and this rule is
 * worth testing on its own.
 */
export function sessionUnderProject(project: string | readonly string[], cwd: string): boolean {
	const folders = typeof project === "string" ? [project] : project;
	return folders.some((folder) => {
		const root = folder.replace(/[/\\]+$/, "") || folder;
		return cwd === root || cwd === folder || isDescendantPath(root, cwd);
	});
}
