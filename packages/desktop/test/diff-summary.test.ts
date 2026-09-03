/**
 * The two pieces of the split diff load: reading `--numstat`, and joining the halves back together.
 *
 * Both are pure, and both are places where being subtly wrong would show up as the panel jumping —
 * the defect the split exists to fix — rather than as an error anyone would see.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNumstat } from "../electron/git-history.ts";
import { withContents } from "../src/features/git/diff-merge.ts";
import type { WorkspaceDiffFile } from "../electron/ipc-types.ts";

/** `--numstat -z` terminates every field with a NUL, including the last. */
const z = (...fields: string[]) => fields.map((field) => `${field}\0`).join("");

function file(path: string, extra: Partial<WorkspaceDiffFile> = {}): WorkspaceDiffFile {
	return { path, status: "modified", added: 0, removed: 0, hunks: [], ...extra };
}

test("an ordinary record is counts and a path", () => {
	const counts = parseNumstat(z("12\t3\tsrc/app.ts"));
	assert.deepEqual(counts.get("src/app.ts"), { added: 12, removed: 3, binary: false });
});

test("a binary file reports no count rather than a count of zero", () => {
	const counts = parseNumstat(z("-\t-\tassets/icon.png"));
	assert.equal(counts.get("assets/icon.png")?.binary, true);
	// Zero is what a collapsed row would show; `binary` is what stops it claiming that.
	assert.equal(counts.get("assets/icon.png")?.added, 0);
});

test("a rename spends three fields, and is keyed by where the file ended up", () => {
	/*
	 * The record is the counts with an empty path, then the two paths. Getting this wrong does not
	 * throw — it silently keys the entry under the wrong name, and every file after it in the walk
	 * shifts by two, so the whole list gets the wrong numbers.
	 */
	const counts = parseNumstat(z("4\t2\t", "src/old.ts", "src/new.ts", "1\t1\tsrc/after.ts"));
	assert.deepEqual(counts.get("src/new.ts"), { added: 4, removed: 2, binary: false });
	assert.equal(counts.has("src/old.ts"), false);
	// The record that follows a rename still lands where it should.
	assert.deepEqual(counts.get("src/after.ts"), { added: 1, removed: 1, binary: false });
});

test("an empty diff parses to nothing", () => {
	assert.equal(parseNumstat("").size, 0);
});

test("contents fill into the listed rows, keeping the list's order", () => {
	const listed = [file("a.ts"), file("b.ts"), file("c.ts")];
	const loaded = [file("c.ts", { added: 9 }), file("a.ts", { added: 1 })];
	const merged = withContents(listed, loaded);
	assert.deepEqual(
		merged.map((f) => f.path),
		["a.ts", "b.ts", "c.ts"],
	);
	assert.equal(merged[0].added, 1);
	assert.equal(merged[2].added, 9);
});

test("a file the diff could not read stays listed", () => {
	/*
	 * `diffRefs` drops a file whose blob is too large. If the merge took its result as the roster,
	 * the row would disappear once the contents arrived — the list would get shorter under the
	 * reader, which is the jump this whole arrangement is meant to prevent, arriving late instead
	 * of early.
	 */
	const listed = [file("app.ts"), file("pnpm-lock.yaml", { added: 200 })];
	const merged = withContents(listed, [file("app.ts", { added: 3 })]);
	assert.equal(merged.length, 2);
	assert.equal(merged[1].path, "pnpm-lock.yaml");
	assert.equal(merged[1].added, 200);
});

test("diffs arriving before the list are used as they are", () => {
	const loaded = [file("only.ts", { added: 5 })];
	assert.deepEqual(withContents([], loaded), loaded);
});
