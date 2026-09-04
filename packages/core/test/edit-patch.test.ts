/**
 * The patch form of `edit`, end to end through the tool.
 *
 * The applier itself is covered by unit tests below; these go through `editTool.execute` because
 * the parts most likely to break are the seams — the read record, the stale check, and the
 * re-record that lets a second edit in the same turn succeed.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { editTool } from "../src/tools/edit.ts";
import { applyHunks, parsePatch, PatchError, snapshotTag } from "../src/tools/hunk.ts";
import { readTool } from "../src/tools/read.ts";
import type { ToolContext } from "../src/types.ts";

const FIVE = "alpha\nbravo\ncharlie\ndelta\necho\n";

async function fixture(content = FIVE): Promise<{ dir: string; file: string; ctx: ToolContext }> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-edit-"));
	const file = join(dir, "sample.txt");
	await writeFile(file, content, "utf8");
	return { dir, file, ctx: { cwd: dir, sessionId: "t", state: new Map() } };
}

/** Read first, the way the agent must. */
async function read(ctx: ToolContext, file: string, args: Record<string, unknown> = {}) {
	return await readTool.execute({ path: file, ...args } as never, ctx);
}

// ---------------------------------------------------------------------------
// read: the snapshot header
// ---------------------------------------------------------------------------

test("read emits a [path#TAG] header matching the file", async () => {
	const { file, ctx } = await fixture();
	const res = await read(ctx, file);
	const text = res.content[0].type === "text" ? res.content[0].text : "";
	assert.match(text, /^\[sample\.txt#[0-9A-F]{4}\]\n/);
	assert.ok(text.includes(`#${snapshotTag(FIVE)}`), "header tag must match the file's fingerprint");
	assert.equal((res.details as { tag: string }).tag, snapshotTag(FIVE));
});

test("read still numbers lines the way it always did", async () => {
	const { file, ctx } = await fixture();
	const res = await read(ctx, file);
	const text = res.content[0].type === "text" ? res.content[0].text : "";
	assert.match(text, /1→alpha/);
	assert.match(text, /5→echo/);
});

// ---------------------------------------------------------------------------
// edit: the patch form
// ---------------------------------------------------------------------------

test("patch replaces a line", async () => {
	const { file, ctx } = await fixture();
	await read(ctx, file);
	const res = await editTool.execute({ path: file, tag: snapshotTag(FIVE), patch: "REPLACE 2-2\n+BRAVO" }, ctx);
	assert.equal(res.isError, undefined);
	assert.equal(await readFile(file, "utf8"), "alpha\nBRAVO\ncharlie\ndelta\necho\n");
});

test("patch makes several changes in one call, against original line numbers", async () => {
	const { file, ctx } = await fixture();
	await read(ctx, file);
	const res = await editTool.execute(
		{ path: file, tag: snapshotTag(FIVE), patch: "REPLACE 1-1\n+A1\n+A2\nDELETE 3-3\nINSERT AFTER 5\n+omega" },
		ctx,
	);
	assert.equal(res.isError, undefined);
	assert.equal(await readFile(file, "utf8"), "A1\nA2\nbravo\ndelta\necho\nomega\n");
});

test("patch preserves tabs and blank lines verbatim", async () => {
	const { file, ctx } = await fixture();
	await read(ctx, file);
	await editTool.execute({ path: file, tag: snapshotTag(FIVE), patch: "REPLACE 2-2\n+\t\tindented\n+\n+after" }, ctx);
	assert.equal(await readFile(file, "utf8"), "alpha\n\t\tindented\n\nafter\ncharlie\ndelta\necho\n");
});

test("a stale tag is rejected and the error names the current one", async () => {
	const { file, ctx } = await fixture();
	await read(ctx, file);
	// Someone else touches the file between the read and the edit.
	await writeFile(file, "alpha\nbravo\ncharlie\ndelta\nECHO\n", "utf8");
	const res = await editTool.execute({ path: file, tag: snapshotTag(FIVE), patch: "REPLACE 2-2\n+BRAVO" }, ctx);
	assert.equal(res.isError, true);
	const text = res.content[0].type === "text" ? res.content[0].text : "";
	assert.match(text, /changed since you read it/);
	assert.match(text, new RegExp(snapshotTag("alpha\nbravo\ncharlie\ndelta\nECHO\n")));
	assert.equal(await readFile(file, "utf8"), "alpha\nbravo\ncharlie\ndelta\nECHO\n", "the file must be untouched");
});

test("a missing tag is rejected rather than assumed", async () => {
	const { file, ctx } = await fixture();
	await read(ctx, file);
	const res = await editTool.execute({ path: file, patch: "REPLACE 2-2\n+BRAVO" }, ctx);
	assert.equal(res.isError, true);
	assert.match(res.content[0].type === "text" ? res.content[0].text : "", /`tag` is required/);
});

test("editing again in the same turn works: the result hands back the new tag", async () => {
	const { file, ctx } = await fixture();
	await read(ctx, file);
	const first = await editTool.execute({ path: file, tag: snapshotTag(FIVE), patch: "REPLACE 1-1\n+ALPHA" }, ctx);
	const text = first.content[0].type === "text" ? first.content[0].text : "";
	const match = /New tag: ([0-9A-F]{4})/.exec(text);
	assert.ok(match, "the result must state the new tag");

	const second = await editTool.execute({ path: file, tag: match[1], patch: "REPLACE 5-5\n+ECHO" }, ctx);
	assert.equal(second.isError, undefined);
	assert.equal(await readFile(file, "utf8"), "ALPHA\nbravo\ncharlie\ndelta\nECHO\n");
});

test("lines that were never displayed cannot be edited", async () => {
	const long = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
	const { file, ctx } = await fixture(long);
	await read(ctx, file, { offset: 1, limit: 10 });
	const res = await editTool.execute({ path: file, tag: snapshotTag(long), patch: "REPLACE 30-30\n+changed" }, ctx);
	assert.equal(res.isError, true);
	assert.match(res.content[0].type === "text" ? res.content[0].text : "", /were not in what you read/);
});

test("an out-of-range range is rejected with the file length", async () => {
	const { file, ctx } = await fixture();
	await read(ctx, file);
	const res = await editTool.execute({ path: file, tag: snapshotTag(FIVE), patch: "REPLACE 9-9\n+nope" }, ctx);
	assert.equal(res.isError, true);
	assert.match(res.content[0].type === "text" ? res.content[0].text : "", /past the end of .*: the file has 5 lines/);
});

test("REPLACE with no payload points at DELETE instead of silently deleting", async () => {
	const { file, ctx } = await fixture();
	await read(ctx, file);
	const res = await editTool.execute({ path: file, tag: snapshotTag(FIVE), patch: "REPLACE 2-2" }, ctx);
	assert.equal(res.isError, true);
	assert.match(res.content[0].type === "text" ? res.content[0].text : "", /use DELETE 2-2/);
});

test("mixing the two forms in one call is refused", async () => {
	const { file, ctx } = await fixture();
	await read(ctx, file);
	const res = await editTool.execute({ path: file, tag: snapshotTag(FIVE), patch: "REPLACE 2-2\n+x", old_string: "bravo", new_string: "x" }, ctx);
	assert.equal(res.isError, true);
	assert.match(res.content[0].type === "text" ? res.content[0].text : "", /not both/);
});

test("editing without reading first is still refused", async () => {
	const { file, ctx } = await fixture();
	const res = await editTool.execute({ path: file, tag: snapshotTag(FIVE), patch: "REPLACE 2-2\n+x" }, ctx);
	assert.equal(res.isError, true);
	assert.match(res.content[0].type === "text" ? res.content[0].text : "", /Read .* before editing/);
});

// ---------------------------------------------------------------------------
// edit: the legacy string form still works
// ---------------------------------------------------------------------------

test("the string form still applies a unique replacement", async () => {
	const { file, ctx } = await fixture();
	await read(ctx, file);
	const res = await editTool.execute({ path: file, old_string: "bravo", new_string: "BRAVO" }, ctx);
	assert.equal(res.isError, undefined);
	assert.equal(await readFile(file, "utf8"), "alpha\nBRAVO\ncharlie\ndelta\necho\n");
});

test("an ambiguous string points at the patch form", async () => {
	const { file, ctx } = await fixture("dup\ndup\n");
	await read(ctx, file);
	const res = await editTool.execute({ path: file, old_string: "dup", new_string: "x" }, ctx);
	assert.equal(res.isError, true);
	assert.match(res.content[0].type === "text" ? res.content[0].text : "", /use the `patch` form/);
});

// ---------------------------------------------------------------------------
// applier units
// ---------------------------------------------------------------------------

test("hunks apply bottom-up so ranges never shift", () => {
	const { hunks } = parsePatch("REPLACE 1-1\n+A1\n+A2\nREPLACE 4-4\n+D");
	assert.equal(applyHunks(hunks, FIVE), "A1\nA2\nbravo\ncharlie\nD\necho\n");
});

test("overlapping ranges are rejected", () => {
	const { hunks } = parsePatch("REPLACE 2-3\n+X\nREPLACE 3-4\n+Y");
	assert.throws(() => applyHunks(hunks, FIVE), PatchError);
});

test("payload without the + prefix is tolerated and counted", () => {
	// Measured: the most common weak-model failure was a correct edit with the prefix omitted.
	const parsed = parsePatch("INSERT AFTER 1\n\t\tconst x = 1;");
	assert.equal(parsed.looseLines, 1);
	assert.equal(applyHunks(parsed.hunks, FIVE), "alpha\n\t\tconst x = 1;\nbravo\ncharlie\ndelta\necho\n");
});

test("a following header still ends the payload", () => {
	const { hunks } = parsePatch("REPLACE 1-1\nA\nDELETE 3-3");
	assert.equal(applyHunks(hunks, FIVE), "A\nbravo\ndelta\necho\n");
});

test("a file with no trailing newline keeps its shape", () => {
	const { hunks } = parsePatch("REPLACE 2-2\n+B");
	assert.equal(applyHunks(hunks, "a\nb"), "a\nB");
});

test("INSERT AFTER 0 puts lines at the top", () => {
	const { hunks } = parsePatch("INSERT AFTER 0\n+first");
	assert.equal(applyHunks(hunks, FIVE), "first\nalpha\nbravo\ncharlie\ndelta\necho\n");
});

test("snapshotTag is four hex characters and content-sensitive", () => {
	assert.match(snapshotTag(FIVE), /^[0-9A-F]{4}$/);
	assert.notEqual(snapshotTag(FIVE), snapshotTag(FIVE.replace("alpha", "ALPHA")));
});
