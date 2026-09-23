/**
 * The line diff behind edit previews, approval prompts and the review panes.
 *
 * Its table grows as (changed old lines) × (changed new lines). Unbounded, a 6000-line file whose
 * every line differed — a CRLF checkout diffed against its LF blob — took most of a second and a few
 * hundred megabytes to report that every line changed. Past a ceiling the middle is now shown as one
 * block replaced: still a correct diff, only not the smallest.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDiff } from "../src/tools/diff.ts";

const lines = (n: number, line: (i: number) => string) => `${Array.from({ length: n }, (_, i) => line(i)).join("\n")}\n`;

test("上限以内仍是最小改动：两边共有的行对齐成上下文", () => {
	const before = `${lines(100, (i) => `old ${i}`)}common\n`;
	const after = `common\n${lines(100, (i) => `new ${i}`)}`;
	const diff = computeDiff(before, after);
	assert.deepEqual([diff.removed, diff.added], [100, 100]);
	assert.ok(diff.hunks.some((hunk) => hunk.lines.some((line) => line.type === "context" && line.text === "common")));
});

test("改动区超过上限：整块替换，不再为对齐一行去建几百万格的表", () => {
	// 2002 × 2002 lines of middle, just past the ceiling: the one shared line is no longer aligned.
	const before = `${lines(2001, (i) => `old ${i}`)}common\n`;
	const after = `common\n${lines(2001, (i) => `new ${i}`)}`;
	const diff = computeDiff(before, after);
	assert.deepEqual([diff.removed, diff.added], [2002, 2002]);
});

test("6000 行每行都不同：很快给出答案", () => {
	const before = lines(6000, (i) => `line ${i}`);
	const after = lines(6000, (i) => `line ${i}\r`);
	const started = performance.now();
	const diff = computeDiff(before, after);
	const elapsed = performance.now() - started;
	assert.deepEqual([diff.removed, diff.added], [6000, 6000]);
	// Unbounded this took 934ms on the machine it was measured on; bounded, a few milliseconds.
	assert.ok(elapsed < 400, `用了 ${elapsed.toFixed(0)}ms`);
});

test("整块替换时，前后公共部分的行号照旧连续", () => {
	const before = `head\n${lines(2001, (i) => `old ${i}`)}tail\n`;
	const after = `head\n${lines(2001, (i) => `new ${i}`)}tail\n`;
	const { hunks } = computeDiff(before, after, 1);
	const first = hunks[0]?.lines ?? [];
	const last = hunks[hunks.length - 1]?.lines ?? [];
	assert.deepEqual(first[0], { type: "context", text: "head", oldLine: 1, newLine: 1 });
	assert.deepEqual(last[last.length - 1], { type: "context", text: "tail", oldLine: 2003, newLine: 2003 });
});
