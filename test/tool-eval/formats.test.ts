/**
 * The appliers decide whether an edit passed, so they are tested before any model runs.
 * A bug here would show up as a format being "worse", which is the one conclusion this
 * whole exercise must not reach by accident.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { FORMATS, parseHunkText, snapshotTag } from "./formats.ts";

const FILE = "a\nb\nc\nd\ne\n";
const TAG = snapshotTag(FILE);

const hunkText = FORMATS["hunk-text"];
const hunkJson = FORMATS["hunk-json"];
const strReplace = FORMATS["str-replace"];

test("snapshotTag is stable and content-sensitive", () => {
	assert.equal(snapshotTag(FILE), snapshotTag(FILE));
	assert.notEqual(snapshotTag(FILE), snapshotTag("a\nb\nc\nd\nE\n"));
	assert.match(snapshotTag(FILE), /^[0-9A-F]{4}$/);
});

test("hunk-text: replace one line", () => {
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 2-2\n+B" }, FILE, TAG);
	assert.equal(r.ok, true);
	assert.equal(r.content, "a\nB\nc\nd\ne\n");
});

test("hunk-text: replace a range with a different number of lines", () => {
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 2-3\n+X\n+Y\n+Z" }, FILE, TAG);
	assert.equal(r.ok, true);
	assert.equal(r.content, "a\nX\nY\nZ\nd\ne\n");
});

test("hunk-text: insert after, and after 0 means top of file", () => {
	assert.equal(hunkText.apply({ path: "x", tag: TAG, patch: "INSERT AFTER 2\n+new" }, FILE, TAG).content, "a\nb\nnew\nc\nd\ne\n");
	assert.equal(hunkText.apply({ path: "x", tag: TAG, patch: "INSERT AFTER 0\n+top" }, FILE, TAG).content, "top\na\nb\nc\nd\ne\n");
});

test("hunk-text: delete", () => {
	assert.equal(hunkText.apply({ path: "x", tag: TAG, patch: "DELETE 2-3" }, FILE, TAG).content, "a\nd\ne\n");
});

test("hunk-text: line numbers are original — multiple hunks do not shift each other", () => {
	// Both ranges name original lines. Applied top-down naively, the second would land wrong.
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 1-1\n+A1\n+A2\nREPLACE 4-4\n+D" }, FILE, TAG);
	assert.equal(r.ok, true);
	assert.equal(r.content, "A1\nA2\nb\nc\nD\ne\n");
});

test("hunk-text: payload preserves leading whitespace verbatim", () => {
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 2-2\n+\t\tindented" }, FILE, TAG);
	assert.equal(r.content, "a\n\t\tindented\nc\nd\ne\n");
});

test("hunk-text: a bare + is a blank line", () => {
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 2-2\n+\n+after blank" }, FILE, TAG);
	assert.equal(r.content, "a\n\nafter blank\nc\nd\ne\n");
});

test("hunk-text: stale tag is rejected", () => {
	const r = hunkText.apply({ path: "x", tag: "0000", patch: "REPLACE 2-2\n+B" }, FILE, TAG);
	assert.equal(r.ok, false);
	assert.match(r.error!, /stale tag/);
});

test("hunk-text: overlapping ranges are rejected", () => {
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 2-3\n+X\nREPLACE 3-4\n+Y" }, FILE, TAG);
	assert.equal(r.ok, false);
	assert.match(r.error!, /more than one hunk/);
});

test("hunk-text: out-of-range is rejected", () => {
	assert.equal(hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 9-9\n+X" }, FILE, TAG).ok, false);
	assert.equal(hunkText.apply({ path: "x", tag: TAG, patch: "INSERT AFTER 99\n+X" }, FILE, TAG).ok, false);
});

test("hunk-text: REPLACE with an empty payload is rejected, not treated as delete", () => {
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 2-2\n" }, FILE, TAG);
	assert.equal(r.ok, false);
	assert.match(r.error!, /use DELETE/);
});

test("hunk-text: a payload line with no header is rejected", () => {
	const r = parseHunkText("+orphan");
	assert.equal(r.ok, false);
});

test("hunk-text: trailing-newline shape is preserved both ways", () => {
	assert.equal(hunkText.apply({ path: "x", tag: snapshotTag("a\nb"), patch: "REPLACE 2-2\n+B" }, "a\nb", snapshotTag("a\nb")).content, "a\nB");
	assert.equal(hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 5-5\n+E" }, FILE, TAG).content, "a\nb\nc\nd\nE\n");
});

test("hunk-json: same semantics as hunk-text", () => {
	const r = hunkJson.apply(
		{ path: "x", tag: TAG, hunks: [{ op: "replace", start: 1, end: 1, lines: ["A1", "A2"] }, { op: "delete", start: 4, end: 4 }] },
		FILE,
		TAG,
	);
	assert.equal(r.ok, true);
	assert.equal(r.content, "A1\nA2\nb\nc\ne\n");
});

test("hunk-json: replace with no lines is rejected", () => {
	const r = hunkJson.apply({ path: "x", tag: TAG, hunks: [{ op: "replace", start: 1, end: 1, lines: [] }] }, FILE, TAG);
	assert.equal(r.ok, false);
});

test("str-replace: unique match applies", () => {
	assert.equal(strReplace.apply({ path: "x", old_string: "b", new_string: "B" }, FILE).content, "a\nB\nc\nd\ne\n");
});

test("str-replace: ambiguous match is rejected without replace_all", () => {
	const dup = "x\nx\n";
	const r = strReplace.apply({ path: "x", old_string: "x", new_string: "y" }, dup);
	assert.equal(r.ok, false);
	assert.match(r.error!, /not unique/);
	assert.equal(strReplace.apply({ path: "x", old_string: "x", new_string: "y", replace_all: true }, dup).content, "y\ny\n");
});

test("str-replace: missing anchor is rejected", () => {
	assert.equal(strReplace.apply({ path: "x", old_string: "nope", new_string: "y" }, FILE).ok, false);
});

// ---------------------------------------------------------------------------
// Regression: payload without the leading `+`
//
// Measured on gemini-2.5-flash-lite, 2026-09-04: the single most common hunk-text failure was a
// correct edit with the prefix omitted. Tolerating it costs nothing real — a payload line is only
// ambiguous when it exactly matches the header grammar, which source lines do not.
// ---------------------------------------------------------------------------

test("hunk-text: payload without + still parses", () => {
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "INSERT AFTER 1\n\t\tconst startedAt = Date.now();" }, FILE, TAG);
	assert.equal(r.ok, true);
	assert.equal(r.content, "a\n\t\tconst startedAt = Date.now();\nb\nc\nd\ne\n");
});

test("hunk-text: mixed + and bare payload lines", () => {
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 2-2\n+first\nsecond" }, FILE, TAG);
	assert.equal(r.content, "a\nfirst\nsecond\nc\nd\ne\n");
});

test("hunk-text: a following header still ends the payload", () => {
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 1-1\nA\nDELETE 3-3" }, FILE, TAG);
	assert.equal(r.ok, true);
	assert.equal(r.content, "A\nb\nd\ne\n");
});

test("hunk-text: trailing blank lines are not payload", () => {
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 2-2\n+B\n\n" }, FILE, TAG);
	assert.equal(r.content, "a\nB\nc\nd\ne\n");
});

test("hunk-text: a bare + is still a blank line, not dropped", () => {
	const r = hunkText.apply({ path: "x", tag: TAG, patch: "REPLACE 2-2\n+\n+x" }, FILE, TAG);
	assert.equal(r.content, "a\n\nx\nc\nd\ne\n");
});
