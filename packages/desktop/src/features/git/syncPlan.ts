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

import type { GitOperation, GitStatus, RemoteState } from "../../../electron/ipc-types.ts";

/** What to call each unfinished operation in a sentence. */
const OPERATION: Record<GitOperation, string> = {
	rebase: "变基",
	merge: "合并",
	"cherry-pick": "拣选",
	revert: "回滚",
	bisect: "二分查找",
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
	const clean = "没有未提交的改动。";

	if (!status) {
		return { branch, detail: null, ...blocked("没有仓库"), empty: { body: clean, action: null } };
	}

	if (state === "in-progress") {
		const what = OPERATION[status.operation ?? "merge"];
		return {
			branch,
			detail: `正在${what}`,
			...blocked("先完成或中止当前操作"),
			empty: { body: `${what}进行中，先完成或中止。`, action: null },
		};
	}

	if (state === "detached") {
		return {
			branch: "游离 HEAD",
			// The commit it is sitting on: 「游离 HEAD」 on its own says you are lost without saying
			// where, and the sha is what you would need to get back.
			detail: status.head,
			...blocked("当前不在任何分支上"),
			empty: { body: "当前不在任何分支上。", action: null },
		};
	}

	if (state === "no-commits") {
		return {
			branch,
			detail: null,
			...blocked("还没有任何提交"),
			empty: { body: "还没有任何提交。", action: null },
		};
	}

	if (state === "none") {
		// A local-only repository is a normal way to work, so this says nothing about publishing.
		return {
			branch,
			detail: "无远端",
			...blocked("仓库没有配置远端"),
			empty: { body: clean, action: null },
		};
	}

	if (state === "no-upstream") {
		// Pull needs an upstream to pull *from*; without one git refuses with "no tracking
		// information", which is a worse way to learn it than a disabled button that says so.
		const noUpstream: SyncButton = { disabled: true, tip: "当前分支没有上游", emphasis: false, count: null };
		if (!status.remote) {
			return {
				branch,
				detail: "未跟踪远端",
				pull: noUpstream,
				push: { disabled: true, tip: "有多个远端，请先设置上游分支", emphasis: false, count: null },
				empty: { body: "有多个远端，请先设置上游分支。", action: null },
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
			detail: "未跟踪远端",
			pull: noUpstream,
			push: {
				disabled: false,
				tip: never ? `发布到 ${status.remote}` : `推送到 ${status.remote}/${branch}`,
				emphasis: true,
				count: never ? null : count,
			},
			empty: {
				body: never
					? `这个分支还没有发布到 ${status.remote}`
					: `${count} 个提交尚未推送到 ${status.remote}/${branch}`,
				action: running ? null : { label: never ? "发布分支" : "推送", kind: "push" },
			},
		};
	}

	// Tracking: the four ways a branch can differ from its upstream.
	const upstream = status.upstream ?? "";
	const ahead = status.unpushed ?? status.ahead;
	const behind = status.behind;

	const pull: SyncButton = {
		disabled: false,
		tip: behind > 0 ? `拉取 ${behind} 个提交（--ff-only）` : `已与 ${upstream} 同步`,
		emphasis: behind > 0,
		count: behind > 0 ? behind : null,
	};
	const push: SyncButton = {
		disabled: false,
		tip: ahead > 0 ? `推送到 ${upstream}` : `已与 ${upstream} 同步`,
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
			? `本地超前 ${ahead}，远端领先 ${behind}`
			: ahead > 0
				? `${ahead} 个提交尚未推送到 ${upstream}`
				: behind > 0
					? `远端领先 ${behind} 个提交`
					: clean;
	const action =
		running || (ahead > 0 && behind > 0)
			? null
			: ahead > 0
				? ({ label: "推送", kind: "push" } as const)
				: behind > 0
					? ({ label: "拉取", kind: "pull" } as const)
					: null;

	return { branch, detail: upstream || null, pull, push, empty: { body, action } };
}
