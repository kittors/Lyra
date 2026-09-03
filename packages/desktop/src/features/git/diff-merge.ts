import type { WorkspaceDiffFile } from "../../../electron/ipc-types.ts";

/**
 * The listed files, with contents filled in wherever they arrived.
 *
 * A commit's files are fetched twice: the list first, which is fast, and the diffs after, which are
 * not. Replacing one result with the other wholesale would undo the point of splitting them, for
 * two reasons.
 *
 * The list is the one that decides the layout, so it has to be the one that survives. The reader
 * only pays for the split once — when the list appears — and would pay again if the second answer
 * resized everything.
 *
 * And the second answer is not a superset. `diffRefs` drops a file whose blob is too large to read,
 * so a commit touching a lockfile lists more files than it can show diffs for. Taking the list as
 * the roster means those rows stay, saying they have nothing to compare line by line, which is both
 * true and better than the file vanishing from a review with no explanation.
 */
export function withContents(
	listed: WorkspaceDiffFile[],
	loaded: WorkspaceDiffFile[],
): WorkspaceDiffFile[] {
	// Nothing listed yet: the diffs beat the list here, which happens on a small commit.
	if (listed.length === 0) return loaded;
	const byPath = new Map(loaded.map((file) => [file.path, file]));
	return listed.map((file) => byPath.get(file.path) ?? file);
}
