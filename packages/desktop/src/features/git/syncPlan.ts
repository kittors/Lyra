/**
 * What the sync row and the empty state say, given where the checkout stands.
 *
 * Written as data rather than as JSX because the interesting part is the table, not the markup:
 * eight situations, each with a different answer for two buttons and a sentence, and several of
 * them (a stopped rebase, a repository whose remote is called something other than `origin`, a
 * branch the remote has never seen) are tedious to reach in a running app and trivial to write
 * down here. The component below renders whatever this returns and decides nothing.
 *
 * The rule the whole thing serves: a button is emphasised only when pressing it is the next thing
 * to do. Everything else is either muted — available, not urgent — or disabled with a reason.
 * Four identically grey icons is what the panel had before, and it is why nobody could tell that a
 * commit was sitting unpushed.
 */

import { translate } from "../../i18n/translate.ts";
import type { GitOperation, GitStatus, RemoteState } from "../../../electron/ipc-types.ts";

/** What to call each unfinished operation in a sentence. */
const OPERATION: Record<GitOperation, string> = {
	rebase: translate("sync.rebase"),
	merge: translate("sync.merge"),
	"cherry-pick": translate("sync.cherryPick"),
	revert: translate("sync.revert"),
	bisect: translate("sync.bisect"),
};

export interface SyncButton {
	disabled: boolean;
	/** Tooltip, and the accessible name. Says why when disabled — that is the whole point of it. */
	tip: string;
	/** The one action worth taking right now, drawn in full-strength ink. */
	emphasis: boolean;
	/** The badge on the corner. Null when there is no meaningful number, which is not the same as 0. */
	count: number | null;
}

export interface SyncPlan {
	/** The branch name, or a stand-in when there is no branch. */
	branch: string;
	/** What follows it: the upstream, or why there is none. Null when there is nothing to add. */
	detail: string | null;
	pull: SyncButton;
	push: SyncButton;
	/** The sentence under 「工作区干净」, and the button under that. */
	empty: {
		body: string;
		action: { label: string; kind: "push" | "pull" } | null;
	};
}

/** Both buttons off, for the states where git would refuse anything they could do. */
function blocked(reason: string): { pull: SyncButton; push: SyncButton } {
	return {
		pull: { disabled: true, tip: reason, emphasis: false, count: null },
		push: { disabled: true, tip: reason, emphasis: false, count: null },
	};
}

/**
 * The whole table.
 *
 * `running` only affects the empty state's button, and only by removing it. The agent commits on
 * its own, so the moment it does the tree is clean and a 「推送」 button would appear — until its
 * next edit takes it away again. A button that flickers in and out during a turn is worse than no
 * button, and pushing is a decision worth waiting for the turn to end. The badge on the sync row
 * stays either way: that is a fact about the repository, not a prompt.
 */
export function syncPlan(status: GitStatus | null, { running = false }: { running?: boolean } = {}): SyncPlan {
	const branch = status?.branch ?? "—";
	const state: RemoteState = status?.remoteState ?? "none";
	const clean = translate("sync.clean");

	if (!status) {
		return { branch, detail: null, ...blocked(translate("sync.noRepo")), empty: { body: clean, action: null } };
	}

	if (state === "in-progress") {
		const what = OPERATION[status.operation ?? "merge"];
		return {
			branch,
			detail: translate("sync.inProgress", { what }),
			...blocked(translate("sync.finishFirst")),
			empty: { body: translate("sync.finishFirstOf", { what }), action: null },
		};
	}

	if (state === "detached") {
		return {
			branch: translate("sync.detached"),
			// The commit it is sitting on: 「游离 HEAD」 on its own says you are lost without saying
			// where, and the sha is what you would need to get back.
			detail: status.head,
			...blocked(translate("sync.notOnBranch")),
			empty: { body: translate("sync.notOnBranchDot"), action: null },
		};
	}

	if (state === "no-commits") {
		return {
			branch,
			detail: null,
			...blocked(translate("sync.noCommits")),
			empty: { body: translate("sync.noCommitsDot"), action: null },
		};
	}

	if (state === "none") {
		// A local-only repository is a normal way to work, so this says nothing about publishing.
		return {
			branch,
			detail: translate("sync.noRemote"),
			...blocked(translate("sync.noRemoteDetail")),
			empty: { body: clean, action: null },
		};
	}

	if (state === "no-upstream") {
		// Pull needs an upstream to pull *from*; without one git refuses with "no tracking
		// information", which is a worse way to learn it than a disabled button that says so.
		const noUpstream: SyncButton = { disabled: true, tip: translate("sync.noUpstream"), emphasis: false, count: null };
		if (!status.remote) {
			return {
				branch,
				detail: translate("sync.untracked"),
				pull: noUpstream,
				push: { disabled: true, tip: translate("sync.manyRemotes"), emphasis: false, count: null },
				empty: { body: translate("sync.manyRemotesDot"), action: null },
			};
		}
		/*
		 * Two readings of "no upstream", and they deserve different sentences.
		 *
		 * A number means the remote already has a branch of this name to count against. Null means
		 * it has never seen this branch at all — and 「发布过没有」 is a yes-or-no question, so it
		 * is answered as one. `rev-list --count HEAD` would put the length of the entire branch
		 * there: correct, and no use to anybody.
		 */
		const never = status.unpushed === null;
		const count = status.unpushed ?? 0;
		return {
			branch,
			detail: translate("sync.untracked"),
			pull: noUpstream,
			push: {
				disabled: false,
				tip: never ? translate("sync.publishTo", { remote: status.remote }) : translate("sync.pushTo", { remote: status.remote, branch }),
				emphasis: true,
				count: never ? null : count,
			},
			empty: {
				body: never
					? translate("sync.notPublished", { remote: status.remote })
					: translate("sync.unpushedTo", { count, remote: status.remote, branch }),
				action: running ? null : { label: never ? translate("sync.publishBranch") : translate("common.push"), kind: "push" },
			},
		};
	}

	// Tracking: the four ways a branch can differ from its upstream.
	const upstream = status.upstream ?? "";
	const ahead = status.unpushed ?? status.ahead;
	const behind = status.behind;

	const pull: SyncButton = {
		disabled: false,
		tip: behind > 0 ? translate("sync.pullFf", { behind }) : translate("sync.upToDate", { upstream }),
		emphasis: behind > 0,
		count: behind > 0 ? behind : null,
	};
	const push: SyncButton = {
		disabled: false,
		tip: ahead > 0 ? translate("sync.pushToUpstream", { upstream }) : translate("sync.upToDate", { upstream }),
		emphasis: ahead > 0,
		count: ahead > 0 ? ahead : null,
	};

	/*
	 * Diverged offers no button of its own on purpose.
	 *
	 * Pull then push is two decisions with a failure in between — `--ff-only` can refuse, and what
	 * to do about that is a judgement call. One 「同步」 button would hide both.
	 */
	const body =
		ahead > 0 && behind > 0
			? translate("sync.diverged", { ahead, behind })
			: ahead > 0
				? translate("sync.unpushed", { ahead, upstream })
				: behind > 0
					? translate("sync.behindBy", { behind })
					: clean;
	const action =
		running || (ahead > 0 && behind > 0)
			? null
			: ahead > 0
				? ({ label: translate("common.push"), kind: "push" } as const)
				: behind > 0
					? ({ label: translate("common.pull"), kind: "pull" } as const)
					: null;

	return { branch, detail: upstream || null, pull, push, empty: { body, action } };
}
