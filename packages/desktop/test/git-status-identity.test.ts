/**
 * When two readings of `git status` count as the same reading.
 *
 * The claim: `sameStatus` is true exactly when nothing a reader of the status could act on has
 * moved. It exists so the git panel's 1.5s poll can hand back the object it already had, which is
 * what stops every tick from re-running the effect that fetches the whole working-tree diff — a
 * read slower than the interval, so the panel could never catch up with itself.
 *
 * The interesting cases are the ones that must come back *false*: a file whose line counts moved
 * looks identical by path alone, and that is precisely the change the panel exists to show.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitStatus, GitStatusFile } from "../electron/git-status.ts";
import { sameStatus } from "../src/features/git/sameStatus.ts";

function file(path: string, over: Partial<GitStatusFile> = {}): GitStatusFile {
	return { path, status: "modified", staged: false, unstaged: true, added: 3, removed: 1, ...over };
}

function status(over: Partial<GitStatus> = {}): GitStatus {
	return {
		branch: "main",
		upstream: "origin/main",
		ahead: 0,
		behind: 0,
		staged: [],
		unstaged: [file("src/a.ts")],
		remoteState: "tracking",
		remote: "origin",
		operation: null,
		unpushed: 0,
		...over,
	};
}

test("two separately built readings of the same state are the same", () => {
	assert.equal(sameStatus(status(), status()), true);
});

test("the same object is the same reading", () => {
	const one = status();
	assert.equal(sameStatus(one, one), true);
});

test("null is only the same as null", () => {
	assert.equal(sameStatus(null, null), true);
	assert.equal(sameStatus(null, status()), false);
	assert.equal(sameStatus(status(), null), false);
});

test("a file whose line counts moved is a change", () => {
	// The path list is identical; only the numbers differ. Comparing paths alone would miss this,
	// and it is the ordinary case — the agent edited a file that was already dirty.
	assert.equal(sameStatus(status(), status({ unstaged: [file("src/a.ts", { added: 9 })] })), false);
	assert.equal(sameStatus(status(), status({ unstaged: [file("src/a.ts", { removed: 9 })] })), false);
});

test("a file that changed kind is a change", () => {
	assert.equal(sameStatus(status(), status({ unstaged: [file("src/a.ts", { status: "untracked" })] })), false);
});

test("moving a file between the index and the tree is a change", () => {
	const staged = status({ staged: [file("src/a.ts", { staged: true, unstaged: false })], unstaged: [] });
	assert.equal(sameStatus(status(), staged), false);
});

test("a file appearing or disappearing is a change", () => {
	assert.equal(sameStatus(status(), status({ unstaged: [file("src/a.ts"), file("src/b.ts")] })), false);
	assert.equal(sameStatus(status(), status({ unstaged: [] })), false);
});

test("a different file at the same position is a change", () => {
	assert.equal(sameStatus(status(), status({ unstaged: [file("src/b.ts")] })), false);
});

test("the branch, its upstream and the distance to it are all part of the reading", () => {
	assert.equal(sameStatus(status(), status({ branch: "feat/x" })), false);
	assert.equal(sameStatus(status(), status({ upstream: null })), false);
	assert.equal(sameStatus(status(), status({ ahead: 1 })), false);
	assert.equal(sameStatus(status(), status({ behind: 1 })), false);
});

test("so is where the branch stands with its remote, which moves with no file moving", () => {
	/*
	 * The case that makes this necessary: publishing a branch. Before and after, the tree is clean,
	 * every count is zero and both file lists are empty — the only thing that changed is that the
	 * branch now has an upstream. Compared on files and counts alone this reads as "nothing
	 * happened", and the panel would go on offering 「发布分支」 for a branch already published.
	 */
	const untracked = status({ remoteState: "no-upstream", upstream: null, unpushed: null, unstaged: [] });
	const published = status({ remoteState: "tracking", upstream: "origin/main", unpushed: 0, unstaged: [] });
	assert.equal(sameStatus(untracked, published), false, "publishing has to register");

	assert.equal(sameStatus(status(), status({ remoteState: "detached" })), false);
	assert.equal(sameStatus(status(), status({ remote: "fork" })), false);
	assert.equal(sameStatus(status(), status({ operation: "rebase" })), false);
	assert.equal(sameStatus(status(), status({ unpushed: 3 })), false);
	// And a genuinely unchanged reading is still the same one; the poll depends on it.
	assert.equal(sameStatus(status(), status()), true);
});
