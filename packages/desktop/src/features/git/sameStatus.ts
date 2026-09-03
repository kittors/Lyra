/**
 * Whether two readings of `git status` say the same thing.
 *
 * The panel polls every 1.5s while a turn runs, and each poll returns a freshly built object — so
 * every tick was a new identity for state that had not changed. Anything downstream keyed on that
 * identity re-ran: most expensively `ChangesView`, whose effect fetches the full working-tree diff.
 * A 1.8s read, started every 1.5s, forever — the panel could never catch up with itself, which is
 * what "the git panel stutters and takes ages" was.
 *
 * Comparing the content instead lets the poll keep the previous object when nothing moved, and the
 * effects downstream simply do not fire. Two files with the same path and the same line counts are
 * the same file as far as anything reading this is concerned; the diff is fetched separately and
 * changing it always changes those counts.
 */

import type { GitStatus, GitStatusFile } from "../../../electron/git.ts";

function sameFiles(a: GitStatusFile[], b: GitStatusFile[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((file, i) => {
		const other = b[i];
		return (
			file.path === other.path &&
			file.status === other.status &&
			file.added === other.added &&
			file.removed === other.removed &&
			file.staged === other.staged &&
			file.unstaged === other.unstaged
		);
	});
}

export function sameStatus(a: GitStatus | null, b: GitStatus | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.branch === b.branch &&
		a.upstream === b.upstream &&
		a.ahead === b.ahead &&
		a.behind === b.behind &&
		/*
		 * The remote standing, which changes with no file moving at all.
		 *
		 * This is exactly the shape of change the comparison above would miss: publish a branch and
		 * the tree is as clean afterwards as it was before, the counts are all still zero, and every
		 * file list is still empty — the only thing that moved is that the branch now has an
		 * upstream. Left out of here, the panel would go on offering 「发布分支」 for a branch that
		 * had just been published, until something unrelated happened to change a file.
		 */
		a.remoteState === b.remoteState &&
		a.remote === b.remote &&
		a.operation === b.operation &&
		a.unpushed === b.unpushed &&
		sameFiles(a.staged, b.staged) &&
		sameFiles(a.unstaged, b.unstaged)
	);
}
