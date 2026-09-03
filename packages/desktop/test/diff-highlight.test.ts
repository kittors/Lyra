/**
 * Dealing syntax colours back out to diff rows.
 *
 * A hunk is parsed as two passages — the file before the change and the file after — because a
 * block comment or a template literal has to keep its colour across the lines it spans, and only
 * whole-passage parsing can see that. Which leaves one thing to get right: putting the coloured
 * lines back against the rows they came from.
 *
 * That is worth testing precisely because getting it wrong is invisible. A row still renders,
 * still has colours, and they are simply the colours of a different line. Nothing throws and
 * nothing looks broken — it just quietly stops meaning anything.
 *
 * The tokenizer is stubbed here: what is under test is the alignment, not the grammar.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiffHunk } from "@lyra/core";
import { highlightHunks } from "../src/features/git/diff-highlight.ts";

/** Stands in for the real tokenizer: one token per line, carrying that line's own text. */
const oneTokenPerLine = (code: string) => code.split("\n").map((text) => [{ text, className: "" }]);

/** What each row was coloured as, which is the whole question. */
const colouredAs = (hunks: DiffHunk[]) => highlightHunks(hunks, oneTokenPerLine).map((row) => row[0]?.text ?? "");

function hunk(lines: [DiffHunk["lines"][number]["type"], string][]): DiffHunk {
	return {
		oldStart: 1,
		newStart: 1,
		lines: lines.map(([type, text], index) => ({ type, text, oldLine: index + 1, newLine: index + 1 })),
	} as DiffHunk;
}

test("every row is coloured as its own text", () => {
	const rows = colouredAs([
		hunk([
			["context", "const a = 1;"],
			["remove", "const b = 2;"],
			["add", "const b = 3;"],
			["context", "return a + b;"],
		]),
	]);

	assert.deepEqual(rows, ["const a = 1;", "const b = 2;", "const b = 3;", "return a + b;"]);
});

test("a context line advances both sides, so nothing after it slips a row", () => {
	// The case that breaks if only one cursor moves: several context lines between two changes.
	const rows = colouredAs([
		hunk([
			["remove", "first"],
			["add", "FIRST"],
			["context", "one"],
			["context", "two"],
			["context", "three"],
			["remove", "last"],
			["add", "LAST"],
		]),
	]);

	assert.deepEqual(rows, ["first", "FIRST", "one", "two", "three", "last", "LAST"]);
});

test("a run of removals does not consume the additions' colours", () => {
	const rows = colouredAs([
		hunk([
			["remove", "old one"],
			["remove", "old two"],
			["remove", "old three"],
			["add", "new one"],
			["add", "new two"],
		]),
	]);

	assert.deepEqual(rows, ["old one", "old two", "old three", "new one", "new two"]);
});

test("each hunk starts its own passages rather than continuing the last", () => {
	const rows = colouredAs([
		hunk([
			["context", "a1"],
			["add", "a2"],
		]),
		hunk([
			["context", "b1"],
			["remove", "b2"],
		]),
	]);

	assert.deepEqual(rows, ["a1", "a2", "b1", "b2"], "the second hunk is not offset by the first's length");
});

test("a hunk of only additions leaves the removed side empty without misaligning", () => {
	const rows = colouredAs([
		hunk([
			["add", "one"],
			["add", "two"],
		]),
	]);

	assert.deepEqual(rows, ["one", "two"]);
});

test("rows come back one per line, so the caller can index them by render order", () => {
	const hunks = [
		hunk([
			["context", "x"],
			["add", "y"],
		]),
		hunk([["remove", "z"]]),
	];
	const total = hunks.reduce((sum, h) => sum + h.lines.length, 0);

	assert.equal(highlightHunks(hunks, oneTokenPerLine).length, total);
});
