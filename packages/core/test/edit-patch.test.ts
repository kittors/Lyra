/**
 * The patch form of `edit`, end to end through the tool.
 *
 * The applier itself is covered by unit tests below; these go through `editTool.execute` because
 * the parts most likely to break are the seams — the read record, the stale check, and the
 * re-record that lets a second edit in the same turn succeed.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { editTool } from "../src/tools/edit.ts";
import { applyHunks, parsePatch, PatchError, snapshotTag } from "../src/tools/hunk.ts";
import { readTool } from "../src/tools/read.ts";
import { writeTool } from "../src/tools/write.ts";
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

test("the string form writes `$` sequences in new_string literally", async () => {
	// `String.replace` reads `$$`, `$&`, `` $` `` and `$'` in a string replacement as patterns, so
	// shell and template code came out rewritten: `$$` lost a dollar, `$&` became the matched text.
	const { file, ctx } = await fixture("alpha\nPLACEHOLDER\ncharlie\n");
	await read(ctx, file);
	const literal = "echo $$ and $& and $` and $' and $1";
	const res = await editTool.execute({ path: file, old_string: "PLACEHOLDER", new_string: literal }, ctx);
	assert.equal(res.isError, undefined);
	assert.equal(await readFile(file, "utf8"), `alpha\n${literal}\ncharlie\n`);
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

// ---------------------------------------------------------------------------
// the unified-diff guard
//
// Models write `-old` / `+new` by habit. Every unprefixed line used to be taken literally, so the
// `-` lines were written into the file on top of the replacement and `edit` reported success — a
// wrong file written successfully, which is the one failure mode this format exists to remove.
// ---------------------------------------------------------------------------

test("a payload that mixes + lines with - lines is rejected as a unified diff", () => {
	assert.throws(
		() => parsePatch("REPLACE 2-3\n-bravo\n-charlie\n+B\n+C"),
		(error: Error) => error instanceof PatchError && /not a unified diff/.test(error.message),
	);
});

test("an @@ hunk header among prefixed lines is rejected too", () => {
	assert.throws(
		() => parsePatch("REPLACE 2-2\n@@ -2,1 +2,1 @@\n+B"),
		(error: Error) => error instanceof PatchError && /not a unified diff/.test(error.message),
	);
});

test("mixed prefixes with no diff punctuation say which half is wrong", () => {
	assert.throws(
		() => parsePatch("REPLACE 2-3\n+B\ncharlie two"),
		(error: Error) => error instanceof PatchError && /Prefix every replacement line/.test(error.message),
	);
});

test("a payload of only - lines is caught against the file it would be applied to", () => {
	// No mixture to spot, so the parser lets it through; the content is what proves it is a diff.
	const { hunks } = parsePatch("REPLACE 2-3\n-bravo\n-charlie");
	assert.throws(
		() => applyHunks(hunks, FIVE),
		(error: Error) => error instanceof PatchError && /not a unified diff/.test(error.message),
	);
});

test("a line that merely starts with - is source, and still applies", () => {
	// `- item` is ordinary YAML and Markdown. Only `-` plus the exact line being replaced is a marker.
	const yaml = "steps:\n  - build\n  - test\n";
	const bare = parsePatch("REPLACE 2-2\n  - lint");
	assert.equal(applyHunks(bare.hunks, yaml), "steps:\n  - lint\n  - test\n");
	const prefixed = parsePatch("REPLACE 2-2\n+  - lint");
	assert.equal(applyHunks(prefixed.hunks, yaml), "steps:\n  - lint\n  - test\n");
});

test("blank payload lines do not count as unprefixed, so + blocks with gaps still parse", () => {
	const { hunks } = parsePatch("REPLACE 1-1\n+function foo() {\n+\n+}");
	assert.equal(applyHunks(hunks, FIVE), "function foo() {\n\n}\nbravo\ncharlie\ndelta\necho\n");
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

test("read and edit work cleanly on explicitly allowed paths outside workspace", async (t) => {
	/*
	 * Under the home directory rather than in a temp one, because the temp areas are readable.
	 *
	 * `assessRead` allows `/tmp` and `os.tmpdir()` for the same reason `writableRoots` grants them:
	 * that is where work that should not touch the repository goes. A test that used a temp
	 * directory to stand for "outside the workspace" was testing a path that is no longer outside
	 * anything, and it passed for that reason rather than because the boundary held.
	 */
	const externalDir = await mkdtemp(join(homedir(), ".lyra-external-"));
	const externalFile = join(externalDir, "external.txt");
	await writeFile(externalFile, FIVE, "utf8");
	t.after(() => rm(externalDir, { recursive: true, force: true }));

	const workspaceDir = await mkdtemp(join(tmpdir(), "lyra-ws-"));
	const ctxWithoutAllowed: ToolContext = {
		cwd: workspaceDir,
		sessionId: "t2",
		state: new Map(),
	};
	const ctxWithAllowed: ToolContext = {
		...ctxWithoutAllowed,
		allowedPaths: new Set([externalFile]),
	};

	// Without allowedPaths — and with nobody to ask — the read is refused.
	const deniedRead = await readTool.execute({ path: externalFile } as never, ctxWithoutAllowed);
	assert.equal(deniedRead.isError, true);
	assert.match(deniedRead.content[0].type === "text" ? deniedRead.content[0].text : "", /没有可以询问的人/);

	// With allowedPaths, read succeeds
	const readRes = await readTool.execute({ path: externalFile } as never, ctxWithAllowed);
	assert.equal(readRes.isError, undefined);

	/*
	 * 但改不了——这条原来断言的是相反的事。
	 *
	 * 那份集合是用户拖进输入框的附件（`runtime/session-turn.ts` 的 `collectAllowedPaths`），拖进来
	 * 的意思是让模型看它。原来 `write`/`edit` 也吃同一份许可，于是一次「你看看我的 ~/.zshrc」就换来
	 * 了对它的写权限，在完全访问模式下全程不再问第二次；而 `MessageAttachment.path` 自己的类型注释
	 * 写着它只是展示用元数据，从没按权限凭证设计过。
	 */
	const editRes = await editTool.execute(
		{ path: externalFile, tag: snapshotTag(FIVE), patch: "REPLACE 2-2\n+BRAVO_EXTERNAL" },
		ctxWithAllowed,
	);
	assert.equal(editRes.isError, true, "附件给的是读的许可，不该连写一起给");
	assert.match(editRes.content[0].type === "text" ? editRes.content[0].text : "", /escapes the workspace root/);
	assert.equal(await readFile(externalFile, "utf8"), FIVE, "文件一个字都不该被动过");
});

test("an attachment does not become a licence to overwrite the file either", async () => {
	// `write` 和 `edit` 是同一条边界上的两个入口，堵一个不堵另一个等于没堵。
	const externalDir = await mkdtemp(join(tmpdir(), "lyra-external-"));
	const externalFile = join(externalDir, "external.txt");
	await writeFile(externalFile, FIVE, "utf8");
	const workspaceDir = await mkdtemp(join(tmpdir(), "lyra-ws-"));
	const ctx: ToolContext = { cwd: workspaceDir, sessionId: "t3", state: new Map(), allowedPaths: new Set([externalFile]) };

	// 先读一遍：`write` 对已存在的文件要求先读过，绕开这一步会撞上另一条规则而不是边界本身。
	await readTool.execute({ path: externalFile } as never, ctx);
	const written = await writeTool.execute({ path: externalFile, content: "OVERWRITTEN" } as never, ctx);

	assert.equal(written.isError, true, "附件给的是读的许可，不该连覆写一起给");
	assert.equal(await readFile(externalFile, "utf8"), FIVE, "文件一个字都不该被动过");
});

test("a file just written can be edited in the same turn without a dummy read", async () => {
	const dir = await mkdtemp(join(tmpdir(), "lyra-write-edit-"));
	const ctx: ToolContext = { cwd: dir, sessionId: "write-edit", state: new Map() };
	const created = await writeTool.execute({ path: "Sample.ts", content: "export const answer = 1;\n" } as never, ctx);
	assert.equal(created.isError, undefined, created.content[0].type === "text" ? created.content[0].text : "");
	const edited = await editTool.execute({ path: "Sample.ts", old_string: "answer = 1", new_string: "answer = 2" }, ctx);
	assert.equal(edited.isError, undefined, edited.content[0].type === "text" ? edited.content[0].text : "");
	assert.equal(await readFile(join(dir, "Sample.ts"), "utf8"), "export const answer = 2;\n");
});
