/**
 * Where this checkout stands in relation to a remote.
 *
 * The panel used to ask one question — `ahead` and `behind` — and take the answer at face value.
 * Both of those come from the `## …` line of `git status`, and that line only carries them when the
 * branch has an upstream. A branch that has never been pushed therefore reported `ahead: 0`, which
 * the panel read as "in sync" and said so, about a repository whose every commit was still local.
 *
 * So the question is asked properly here: which of the situations a checkout can be in is this one.
 * The classification is a pure function of a handful of probes, and it is a pure function on
 * purpose — the interesting cases (a rebase in progress, a remote that is not called `origin`, a
 * branch that exists on the remote but is not tracked) are all annoying to reach by hand and
 * trivial to write down.
 */

/**
 * Anything that suspends normal work: git will refuse to push or pull, and offering the buttons is
 * offering an error.
 *
 * `bisect` is in here for the same reason as the rest even though git would technically allow a
 * push: you are in the middle of a search, and the commit checked out is not one you chose.
 */
export type GitOperation = "rebase" | "merge" | "cherry-pick" | "revert" | "bisect";

export type RemoteState =
	/** No commit exists yet, so there is nothing that could be pushed. */
	| "no-commits"
	/** A rebase / merge / … is unfinished. Finish or abort it before anything else. */
	| "in-progress"
	/** Not on a branch. There is no "here" for a push to mean. */
	| "detached"
	/** A repository with no remotes at all — a perfectly ordinary way to work. */
	| "none"
	/** Remotes exist, this branch tracks none of them. */
	| "no-upstream"
	/** The ordinary case: a branch with an upstream. */
	| "tracking";

export interface RemoteStanding {
	state: RemoteState;
	/**
	 * The remote a push would go to, or null when nothing sensible could be chosen.
	 *
	 * Null is a real answer and the caller must respect it: several remotes and no `origin` among
	 * them is a repository where guessing is worse than declining.
	 */
	remote: string | null;
}

/** Whether the `## …` line says the repository has no commits — `## No commits yet on main`. */
export function hasNoCommits(header: string): boolean {
	return header.startsWith("No commits yet");
}

/**
 * Which remote an upstream belongs to.
 *
 * Split against the configured remotes rather than at the first `/`. Remote names are allowed to
 * contain slashes, and a branch called `feature/x` on a remote called `origin` produces exactly
 * the same string as a branch called `x` on a remote called `origin/feature`. Only the list of
 * remotes can tell those apart, and the longest match is the one that is actually configured.
 */
export function remoteOfUpstream(upstream: string, remotes: string[]): string | null {
	let best: string | null = null;
	for (const remote of remotes) {
		if (upstream === remote || upstream.startsWith(`${remote}/`)) {
			if (!best || remote.length > best.length) best = remote;
		}
	}
	return best;
}

/**
 * The remote to publish an untracked branch to.
 *
 * One remote is not a choice, so it is used. Several remotes with an `origin` among them follows
 * the convention every other tool follows. Several remotes *without* an `origin` is genuinely
 * ambiguous — pushing to the wrong one is not an error anyone would notice quickly — so it declines
 * and the panel disables the button rather than picking.
 */
export function defaultRemote(remotes: string[]): string | null {
	if (remotes.length === 0) return null;
	if (remotes.length === 1) return remotes[0];
	return remotes.includes("origin") ? "origin" : null;
}

/**
 * Classify, in the one order that works.
 *
 * The sequence is load-bearing rather than stylistic:
 *
 * - **in-progress before detached.** A rebase detaches HEAD for its whole duration, so a checkout
 *   in the middle of one satisfies the detached test too. Asked in the other order, every rebase
 *   reads as "not on a branch" — true, and not the thing to tell someone.
 * - **no-commits before the remote questions.** A fresh repository has a branch name and may well
 *   have a remote configured; what it does not have is anything to push. Classified by its remote
 *   it would be offered a "发布分支" button that fails.
 */
export function classifyRemote({
	header,
	branch,
	upstream,
	operation,
	remotes,
}: {
	/** The `## …` line with its marker stripped, as `gitStatus` already has it. */
	header: string;
	/** `symbolic-ref` — null means not on a branch. Never the string "HEAD"; see `gitBranch`. */
	branch: string | null;
	upstream: string | null;
	operation: GitOperation | null;
	remotes: string[];
}): RemoteStanding {
	if (operation) return { state: "in-progress", remote: null };
	if (!branch) return { state: "detached", remote: null };
	if (hasNoCommits(header)) return { state: "no-commits", remote: null };
	if (upstream) return { state: "tracking", remote: remoteOfUpstream(upstream, remotes) };
	if (remotes.length === 0) return { state: "none", remote: null };
	return { state: "no-upstream", remote: defaultRemote(remotes) };
}
