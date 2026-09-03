import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGraph } from "../src/features/git/graph.ts";
import type { GitCommit } from "../electron/ipc-types.ts";

const commit = (sha: string, parents: string[]): GitCommit => ({
	sha,
	shortSha: sha,
	subject: sha,
	parents,
	author: "t",
	date: "2026-01-01T00:00:00Z",
	refs: [],
});

test("linear history stays in one lane", () => {
	const rows = buildGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);
	assert.deepEqual(
		rows.map((row) => row.lane),
		[0, 0, 0],
	);
	// Nothing runs alongside a straight line.
	assert.equal(rows.every((row) => row.through.length === 0), true);
	// The root has no parent, so no line leaves it.
	assert.deepEqual(rows[2].out, []);
});

test("a merge draws both parents and marks the merge point", () => {
	/*
	 *   m        merge of `feature` into `main`
	 *   |\
	 *   | f      the feature commit
	 *   b |      a commit on main
	 *   |/
	 *   a        their common base
	 */
	const rows = buildGraph([
		commit("m", ["b", "f"]),
		commit("b", ["a"]),
		commit("f", ["a"]),
		commit("a", []),
	]);

	const merge = rows[0];
	assert.equal(merge.lane, 0);
	// Two parents: one continues the lane, one opens a second.
	assert.equal(merge.out.length, 2);
	assert.equal(merge.out[0].to, 0);
	assert.notEqual(merge.out[1].to, 0);
	// The two lanes carry different colours, which is what makes them followable.
	assert.notEqual(merge.out[0].colour, merge.out[1].colour);

	// `b` keeps lane 0; `f` sits in the lane the merge opened.
	assert.equal(rows[1].lane, 0);
	assert.equal(rows[2].lane, merge.out[1].to);
	// While `f` is drawn, main's line passes it by.
	assert.equal(rows[2].through.some((line) => line.lane === 0), true);

	// `a` is where the second lane rejoins, so it records the incoming merge.
	assert.equal(rows[3].lane, 0);
	assert.equal(rows[3].merges.length, 1);
});

test("lanes are reused once a branch has been merged away", () => {
	const rows = buildGraph([
		commit("m", ["b", "f"]),
		commit("b", ["a"]),
		commit("f", ["a"]),
		commit("a", ["z"]),
		commit("z", []),
	]);
	// By the time the branch is behind us the graph is one column wide again.
	assert.equal(rows[4].through.length, 0);
	assert.equal(rows[4].lane, 0);
});
