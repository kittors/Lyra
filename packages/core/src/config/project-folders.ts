/**
 * Reading `ProjectEntry.folders`, and nothing else.
 *
 * Its own file, and deliberately free of every runtime import — not even `node:path`. Both the
 * renderer and the runtime have to agree on what a project's folders are: the sidebar decides which
 * project a conversation belongs to, the read boundary decides which paths need asking about, and
 * those two disagreeing is a project whose second folder shows its chats but still prompts on every
 * file. A shared answer requires a module a browser can import, which rules out `settings.ts`.
 *
 * Exported through `@lyra/core/project-folders`; see the `exports` map in `package.json`.
 */

/** The shape this needs — a full `ProjectEntry` satisfies it, and so does a half-built draft. */
export interface ProjectLike {
	path: string;
	folders?: string[];
}

/**
 * The folders a project covers, whatever its entry looks like.
 *
 * `path` is forced to the front and duplicates dropped, so callers can treat the answer as "the
 * main folder, then the others" without checking. An entry whose `folders` somehow lost its own
 * path still answers with it: a project that does not contain the directory its sessions run in is
 * not a state worth carrying into a read boundary or a file tree.
 *
 * An entry from before this field existed has no `folders` and answers `[path]`, which is exactly
 * what it has always meant.
 */
export function projectFolders(entry: ProjectLike): string[] {
	const rest = (entry.folders ?? []).filter((folder) => folder && folder !== entry.path);
	return [entry.path, ...new Set(rest)];
}
