/**
 * What the sync row and the empty state say, in every state a checkout can be in.
 *
 * The reported bug was a sentence: 「工作区干净 · 没有未提交的改动」 under a repository with a
 * commit that had never left the machine. It was true about the working tree and wrong about the
 * question being asked, and it survived because nothing checked what the panel *said* — only what
 * git returned.
 *
 * So this is the table, asserted as a table. Each case names the state it covers, and the ones that
 * exist because of a specific wrong answer say which.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { GitStatus } from "../electron/ipc-types.ts";
import { syncPlan } from "../src/features/git/syncPlan.ts";

function status(over: Partial<GitStatus> = {}): GitStatus {
	return {
		branch: "main",
		upstream: "origin/main",
		ahead: 0,
		behind: 0,
		staged: [],
		unstaged: [],
		remoteState: "tracking",
		remote: "origin",
		operation: null,
		unpushed: 0,
		head: null,
		...over,
	};
}

/** The shape a failure should read as: which button is lit, and what the empty state offers. */
function shape(plan: ReturnType<typeof syncPlan>) {
	return {
		branch: `${plan.branch}${plan.detail ? ` · ${plan.detail}` : ""}`,
		pull: plan.pull.disabled ? "disabled" : plan.pull.emphasis ? `lit${plan.pull.count ?? ""}` : "muted",
		push: plan.push.disabled ? "disabled" : plan.push.emphasis ? `lit${plan.push.count ?? ""}` : "muted",
		body: plan.empty.body,
		action: plan.empty.action?.label ?? null,
	};
}

// ---------------------------------------------------------------------------
// The reported case
// ---------------------------------------------------------------------------

test("a branch that has never been published does not claim to be in sync", () => {
	/*
	 * The bug, exactly. `git status` reports no ahead count without an upstream, so every number
	 * here is zero — and the old panel drew the same 「没有未提交的改动」 it draws for a branch that
	 * really is up to date.
	 */
	const plan = syncPlan(status({ remoteState: "no-upstream", upstream: null, unpushed: null }));
	assert.deepEqual(shape(plan), {
		branch: "main · 未跟踪远端",
		pull: "disabled",
		push: "lit",
		body: "这个分支还没有发布到 origin",
		action: "发布分支",
	});
});

test("never published shows no number, because the number would be the whole branch", () => {
	const plan = syncPlan(status({ remoteState: "no-upstream", upstream: null, unpushed: null }));
	assert.equal(plan.push.count, null, "「1274 个提交尚未发布」 is accurate and useless");
	assert.equal(plan.push.tip, "发布到 origin");
});

test("published before but untracked counts against the remote's copy", () => {
	// The other reading of "no upstream": the remote has this branch, the tracking config is gone.
	const plan = syncPlan(status({ remoteState: "no-upstream", upstream: null, unpushed: 2 }));
	assert.deepEqual(shape(plan), {
		branch: "main · 未跟踪远端",
		pull: "disabled",
		push: "lit2",
		body: "2 个提交尚未推送到 origin/main",
		action: "推送",
	});
});

// ---------------------------------------------------------------------------
// Tracking: the four ways to differ
// ---------------------------------------------------------------------------

test("in sync: both muted, and neither pretends to be the next step", () => {
	const plan = syncPlan(status());
	assert.deepEqual(shape(plan), {
		branch: "main · origin/main",
		pull: "muted",
		push: "muted",
		body: "没有未提交的改动。",
		action: null,
	});
	// Muted, not hidden — someone looking for 拉取 has to be able to find it.
	assert.equal(plan.pull.disabled, false);
	assert.equal(plan.pull.tip, "已与 origin/main 同步");
});

test("ahead: push is the one thing to do", () => {
	assert.deepEqual(shape(syncPlan(status({ ahead: 1, unpushed: 1 }))), {
		branch: "main · origin/main",
		pull: "muted",
		push: "lit1",
		body: "1 个提交尚未推送到 origin/main",
		action: "推送",
	});
});

test("behind: pull is", () => {
	assert.deepEqual(shape(syncPlan(status({ behind: 3 }))), {
		branch: "main · origin/main",
		pull: "lit3",
		push: "muted",
		body: "远端领先 3 个提交",
		action: "拉取",
	});
});

test("diverged: both lit, and the empty state offers neither", () => {
	/*
	 * Deliberate. Pull-then-push is two decisions with a failure in between — `--ff-only` can
	 * refuse — and a single 「同步」 button would hide both. The two icons are there; the order is
	 * the person's to choose.
	 */
	assert.deepEqual(shape(syncPlan(status({ ahead: 2, unpushed: 2, behind: 1 }))), {
		branch: "main · origin/main",
		pull: "lit1",
		push: "lit2",
		body: "本地超前 2，远端领先 1",
		action: null,
	});
});

// ---------------------------------------------------------------------------
// The states where both buttons would fail
// ---------------------------------------------------------------------------

test("a fresh repository is not nagged about publishing", () => {
	assert.deepEqual(shape(syncPlan(status({ remoteState: "no-commits", upstream: null, unpushed: null }))), {
		branch: "main",
		pull: "disabled",
		push: "disabled",
		body: "还没有任何提交。",
		action: null,
	});
});

test("a repository with no remote is left alone", () => {
	const plan = syncPlan(status({ remoteState: "none", upstream: null, remote: null, unpushed: null }));
	assert.deepEqual(shape(plan), {
		branch: "main · 无远端",
		pull: "disabled",
		push: "disabled",
		// Not 「尚未发布」: working without a remote is a choice, not an oversight.
		body: "没有未提交的改动。",
		action: null,
	});
	assert.equal(plan.push.tip, "仓库没有配置远端");
});

test("a detached HEAD says where it is sitting", () => {
	const plan = syncPlan(status({ remoteState: "detached", branch: null, upstream: null, unpushed: null, head: "48ec31a" }));
	assert.deepEqual(shape(plan), {
		branch: "游离 HEAD · 48ec31a",
		pull: "disabled",
		push: "disabled",
		body: "当前不在任何分支上。",
		action: null,
	});
	assert.equal(plan.push.tip, "当前不在任何分支上");
});

test("an unfinished operation names itself", () => {
	/*
	 * A stopped rebase detaches HEAD, so without this it would be drawn as an ordinary detached
	 * checkout — true, and not the thing to tell someone who is halfway through a rebase.
	 */
	const rebasing = syncPlan(status({ remoteState: "in-progress", operation: "rebase", branch: "side" }));
	assert.deepEqual(shape(rebasing), {
		branch: "side · 正在变基",
		pull: "disabled",
		push: "disabled",
		body: "变基进行中，先完成或中止。",
		action: null,
	});

	const merging = syncPlan(status({ remoteState: "in-progress", operation: "merge" }));
	assert.equal(merging.empty.body, "合并进行中，先完成或中止。");
	assert.equal(syncPlan(status({ remoteState: "in-progress", operation: "cherry-pick" })).empty.body, "拣选进行中，先完成或中止。");
	assert.equal(syncPlan(status({ remoteState: "in-progress", operation: "bisect" })).empty.body, "二分查找进行中，先完成或中止。");
});

test("several remotes and no origin: nothing to press, and it says why", () => {
	const plan = syncPlan(status({ remoteState: "no-upstream", upstream: null, remote: null, unpushed: null }));
	assert.equal(plan.push.disabled, true);
	assert.equal(plan.push.tip, "有多个远端，请先设置上游分支");
	assert.equal(plan.empty.action, null);
});

// ---------------------------------------------------------------------------
// Two things that are about the panel rather than about git
// ---------------------------------------------------------------------------

test("no repository at all disables everything without inventing a branch", () => {
	assert.deepEqual(shape(syncPlan(null)), {
		branch: "—",
		pull: "disabled",
		push: "disabled",
		body: "没有未提交的改动。",
		action: null,
	});
});

test("while the agent is working, the sync row still reports but the empty state stops offering", () => {
	/*
	 * The agent commits on its own. The instant it does, the tree is clean and a 「推送」 button
	 * would appear — then vanish on its next edit. A button that flickers through a turn is worse
	 * than none, and pushing is a decision that can wait for the turn to end.
	 */
	const idle = syncPlan(status({ ahead: 1, unpushed: 1 }), { running: false });
	const busy = syncPlan(status({ ahead: 1, unpushed: 1 }), { running: true });

	assert.equal(idle.empty.action?.label, "推送");
	assert.equal(busy.empty.action, null, "no button mid-turn");
	// The badge is a fact about the repository, not a prompt, so it stays.
	assert.deepEqual([busy.push.emphasis, busy.push.count], [true, 1]);
	assert.equal(busy.empty.body, idle.empty.body, "and it still says what is true");
});

test("the remote's real name is used everywhere, never assumed to be origin", () => {
	const plan = syncPlan(status({ upstream: "fork/main", remote: "fork", ahead: 1, unpushed: 1 }));
	assert.equal(plan.detail, "fork/main");
	assert.equal(plan.push.tip, "推送到 fork/main");
	assert.equal(plan.empty.body, "1 个提交尚未推送到 fork/main");

	const publishing = syncPlan(status({ remoteState: "no-upstream", upstream: null, remote: "fork", unpushed: null }));
	assert.equal(publishing.empty.body, "这个分支还没有发布到 fork");
});

test("exactly one button is ever emphasised, except when both sides really moved", () => {
	// The rule the row exists for: emphasis means "this is the next step", so two of them is a
	// claim that two different things are.
	const cases: Partial<GitStatus>[] = [
		{},
		{ ahead: 1, unpushed: 1 },
		{ behind: 1 },
		{ remoteState: "no-upstream", upstream: null, unpushed: null },
		{ remoteState: "no-commits" },
		{ remoteState: "none", remote: null },
		{ remoteState: "detached", branch: null },
		{ remoteState: "in-progress", operation: "rebase" },
	];
	for (const over of cases) {
		const plan = syncPlan(status(over));
		const lit = [plan.pull, plan.push].filter((button) => button.emphasis).length;
		assert.ok(lit <= 1, `${JSON.stringify(over)} lit ${lit} buttons`);
	}
	const diverged = syncPlan(status({ ahead: 1, unpushed: 1, behind: 1 }));
	assert.equal([diverged.pull, diverged.push].filter((b) => b.emphasis).length, 2, "both sides moved");
});

test("a disabled button always says why", () => {
	const cases: Partial<GitStatus>[] = [
		{ remoteState: "no-commits" },
		{ remoteState: "none", remote: null },
		{ remoteState: "detached", branch: null },
		{ remoteState: "in-progress", operation: "merge" },
		{ remoteState: "no-upstream", upstream: null, remote: null },
		{ remoteState: "no-upstream", upstream: null, unpushed: null },
	];
	for (const over of cases) {
		const plan = syncPlan(status(over));
		for (const [name, button] of [["pull", plan.pull], ["push", plan.push]] as const) {
			if (!button.disabled) continue;
			assert.ok(button.tip.length > 0, `${name} disabled with no reason in ${JSON.stringify(over)}`);
		}
	}
});
