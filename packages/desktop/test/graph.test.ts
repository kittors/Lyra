import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGraph, graphWidths } from "../src/features/git/graph.ts";
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

/*
 * 图占多宽，是逐行长出来的，不是全表一口价。
 *
 * 从前是全表最宽的那一行说了算：仓库里但凡有过一处八条分支并行，最上面那几条笔直的提交也要陪着让
 * 出八条车道的位置，右边的标题被挤到截断。而决定这个宽度的那次合并可能在三周以前。
 */

test("a straight run of commits does not pay for a merge further down", () => {
	const rows = buildGraph([
		commit("d", ["c"]),
		commit("c", ["m"]),
		commit("m", ["b", "f"]),
		commit("b", ["a"]),
		commit("f", ["a"]),
		commit("a", []),
	]);
	const widths = graphWidths(rows, 10);
	// 上面那两条是直的，只要一条车道的宽度——它们不必为下面那次合并留位置。
	assert.deepEqual(widths.slice(0, 2), [10, 10]);
	// 合并那一行真的需要第二条车道，图就在这里长宽。
	assert.equal(widths[2], 20);
});

test("the column only ever grows going down, never narrows again", () => {
	/*
	 * 分支合并完了，图确实又变回一条线（见上一条测试）——但宽度不跟着缩回去。缩回去会让下面的标题
	 * 整体左移，滚动时来回走，读起来是列表在自己重排。长出来一次就留着。
	 */
	const rows = buildGraph([
		commit("m", ["b", "f"]),
		commit("b", ["a"]),
		commit("f", ["a"]),
		commit("a", ["z"]),
		commit("z", []),
	]);
	const widths = graphWidths(rows, 10);
	assert.equal(widths[0], 20, "合并那一行是两条车道");
	assert.equal(widths[4], 20, "分支早已合并干净，宽度仍旧留在两条");
	for (let i = 1; i < widths.length; i++) {
		assert.ok(widths[i] >= widths[i - 1], `第 ${i} 行比上一行窄了，标题会往左跳`);
	}
});

test("every row is wide enough for what is actually drawn on it", () => {
	const rows = buildGraph([
		commit("m", ["b", "f"]),
		commit("b", ["a"]),
		commit("f", ["a"]),
		commit("a", []),
	]);
	const widths = graphWidths(rows, 10);
	rows.forEach((row, index) => {
		const lanes = [row.lane, ...row.through.map((l) => l.lane), ...row.out.map((l) => l.to)];
		const needed = (Math.max(...lanes) + 1) * 10;
		assert.ok(widths[index] >= needed, `第 ${index} 行画到了 ${needed}px，画布只有 ${widths[index]}px`);
	});
});

test("an empty history still has a column", () => {
	assert.deepEqual(graphWidths([], 10), []);
});
