/**
 * Which folders a session is allowed to treat as "this project".
 *
 * A project may name more than one source folder (see `ProjectEntry.folders`), and the session only
 * ever runs in one of them. Everything downstream that asks "is this path inside the project" —
 * today the read boundary, see `tools/read-access.ts` — has to ask it about all of them, or adding
 * a second folder buys a row in a dialog and an approval prompt per file.
 *
 * Derived from settings at the point of use rather than carried alongside the cwd: the project list
 * is already in every session's settings, and a second copy of the same fact is a second thing to
 * keep in step. It is read once per turn.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";

import { projectFolders } from "./project-folders.ts";
import type { ProjectEntry } from "./settings.ts";

/** The same containment rule `read-access.ts` uses: strict about the separator, so `p-old` ⊄ `p`. */
function within(root: string, path: string): boolean {
	const rel = relative(resolve(root), resolve(path));
	return rel === "" || !(rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel));
}

/**
 * The source folders of the project `cwd` is running in, or nothing if it is running in none.
 *
 * The *innermost* match wins. Projects nest — someone with `~/work` on the list and `~/work/api` on
 * it as well is saying those are two pieces of work, and a session in `api` should get `api`'s
 * folders rather than the wider ones it happens to sit inside. Depth is measured on the matched
 * folder, not on the entry's `path`, because the folder that matched is the one that makes the
 * claim.
 *
 * Returns the whole set including the folder that matched. The caller already allows its own cwd,
 * so the overlap is free, and handing back "the project" rather than "the extra bits of it" is the
 * answer that stays correct if a caller ever asks without a cwd of its own.
 */
export function projectRootsFor(
	projects: readonly Pick<ProjectEntry, "path" | "folders">[] | undefined,
	cwd: string,
): string[] {
	if (!projects?.length) return [];
	let best: { depth: number; roots: string[] } | undefined;
	for (const entry of projects) {
		const folders = projectFolders(entry);
		for (const folder of folders) {
			if (!within(folder, cwd)) continue;
			const depth = resolve(folder).split(sep).length;
			if (!best || depth > best.depth) best = { depth, roots: folders };
		}
	}
	return best?.roots ?? [];
}
