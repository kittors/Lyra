/**
 * The narrowed change, which is what keeps the cursor still.
 *
 * Replacing the whole document also works, and is the reason formatting used to be unusable
 * halfway down a file: every position maps through a change that spans everything.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { changedRange } from "../src/features/editor/apply-format.ts";

/** Apply a range the way CodeMirror would, so the assertions are about the real outcome. */
function apply(before: string, change: { from: number; to: number; insert: string } | null): string {
	if (!change) return before;
	return before.slice(0, change.from) + change.insert + before.slice(change.to);
}

test("identical text is not a change at all", () => {
	assert.equal(changedRange("a\nb\n", "a\nb\n"), null);
});

test("the range covers only what differs", () => {
	const before = "const a = 1\nconst b   =   2\nconst c = 3\n";
	const after = "const a = 1\nconst b = 2\nconst c = 3\n";
	const change = changedRange(before, after)!;
	// Both untouched lines lie outside the range, which is the entire point: a cursor on line 1
	// or line 3 maps through unmoved.
	assert.ok(change.from > before.indexOf("const b"), "范围起点侵入了未改动的第一行");
	assert.ok(change.to <= before.lastIndexOf("const c"), "范围终点侵入了未改动的第三行");
	assert.equal(apply(before, change), after);
});

test("insertion at the end does not rewrite the start", () => {
	const before = "a\nb";
	const after = "a\nb\n";
	const change = changedRange(before, after)!;
	assert.equal(change.from, 3);
	assert.equal(apply(before, change), after);
});

test("insertion at the start does not rewrite the end", () => {
	const change = changedRange("b\n", "a\nb\n")!;
	assert.equal(change.from, 0);
	assert.equal(apply("b\n", change), "a\nb\n");
});

test("a repetitive document cannot produce a backwards range", () => {
	// The prefix and suffix scans meet in the middle here; unguarded they cross, and `to < from`
	// is a range CodeMirror throws on.
	const before = "x\nx\nx\n";
	const after = "x\nx\nx\nx\n";
	const change = changedRange(before, after)!;
	assert.ok(change.to >= change.from, `范围倒了：${change.from} → ${change.to}`);
	assert.equal(apply(before, change), after);
});

test("deleting every line still round-trips", () => {
	const change = changedRange("a\nb\nc\n", "");
	assert.equal(apply("a\nb\nc\n", change), "");
});

test("whole-document rewrites are still handled", () => {
	const change = changedRange("完全不同", "毫无关系");
	assert.equal(apply("完全不同", change), "毫无关系");
});
