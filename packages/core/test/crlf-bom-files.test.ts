/**
 * read / edit / write on the files a Windows checkout is full of: CRLF line breaks, and a UTF-8 BOM.
 *
 * Git for Windows defaults to `core.autocrlf=true`, so the working tree is CRLF almost everywhere, and
 * Windows editors like to lead with a BOM. The tools split on `\n` and joined with `\n`, which showed
 * the model a `\r` on every line, wrote a patched line back as LF in a CRLF file, never found a
 * multi-line `old_string`, flattened a whole file to LF on `write`, and dropped the BOM with line 1.
 *
 * These go through the tools themselves, because the failure that matters is a seam: the fingerprint,
 * the line count and the shown-characters record all have to be taken from the same text, or the
 * next edit is refused by the tool's own bookkeeping.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { editTool } from "../src/tools/edit.ts";
import { readFileChange, undoFileChanges } from "../src/tools/file-changes.ts";
import { readTool } from "../src/tools/read.ts";
import { writeTool } from "../src/tools/write.ts";
import type { ToolContext, ToolResult } from "../src/types.ts";

const BOM = "\uFEFF";
const CRLF = "alpha\r\nbravo\r\ncharlie\r\n";

async function fixture(t: TestContext, content: string): Promise<{ file: string; ctx: ToolContext }> {
	const home = await mkdtemp(join(tmpdir(), "lyra-crlf-"));
	const cwd = join(home, "project");
	await mkdir(cwd);
	const file = join(cwd, "sample.txt");
	await writeFile(file, content, "utf8");
	// A scratch dir makes the tools record each change, which is what undo replays.
	const prior = process.env.LYRA_HOME;
	process.env.LYRA_HOME = home;
	t.after(async () => {
		if (prior === undefined) delete process.env.LYRA_HOME;
		else process.env.LYRA_HOME = prior;
		await rm(home, { recursive: true, force: true });
	});
	return { file, ctx: { cwd, sessionId: "crlf", state: new Map(), scratchDir: join(home, "scratch") } };
}

const textOf = (res: ToolResult) => res.content.map((part) => (part.type === "text" ? part.text : "")).join("");

async function read(ctx: ToolContext, file: string): Promise<{ text: string; tag: string }> {
	const res = await readTool.execute({ path: file }, ctx);
	return { text: textOf(res), tag: (res.details as { tag: string }).tag };
}

const newTag = (res: ToolResult) => /New tag: ([0-9A-F]{4})/.exec(textOf(res))?.[1] ?? "";

test("read 交给模型的行不带 \\r，BOM 也不算第一行的字", async (t) => {
	const { file, ctx } = await fixture(t, BOM + CRLF);
	const { text } = await read(ctx, file);
	assert.ok(!text.includes("\r"), `输出里不能有 \\r：${JSON.stringify(text)}`);
	assert.ok(!text.includes(BOM), "输出里不能有 BOM");
	assert.match(text, /1→alpha\n/);
	assert.match(text, /3→charlie$/);
});

test("patch 改 CRLF 文件的一行，其余每一行的字节原样不动", async (t) => {
	const { file, ctx } = await fixture(t, CRLF);
	const { tag } = await read(ctx, file);
	const res = await editTool.execute({ path: file, tag, patch: "REPLACE 2-2\n+BRAVO" }, ctx);
	assert.equal(res.isError, undefined, textOf(res));
	assert.equal(await readFile(file, "utf8"), "alpha\r\nBRAVO\r\ncharlie\r\n", "改出来的那一行也得是 CRLF，文件里不能混进 LF");
});

test("patch 在 CRLF 文件上照样认得出「-原行」这种 diff 写法", async (t) => {
	const { file, ctx } = await fixture(t, CRLF);
	const { tag } = await read(ctx, file);
	const res = await editTool.execute({ path: file, tag, patch: "REPLACE 2-2\n+-bravo\n+BRAVO" }, ctx);
	assert.equal(res.isError, true, "带 - 的原行是 diff 的删除标记，写进去就是一行源码");
	assert.match(textOf(res), /not a unified diff/);
	assert.equal(await readFile(file, "utf8"), CRLF);
});

test("BOM 文件：patch 改第 1 行，BOM 还在", async (t) => {
	const { file, ctx } = await fixture(t, BOM + CRLF);
	const { tag } = await read(ctx, file);
	const res = await editTool.execute({ path: file, tag, patch: "REPLACE 1-1\n+ALPHA" }, ctx);
	assert.equal(res.isError, undefined, textOf(res));
	assert.equal(await readFile(file, "utf8"), `${BOM}ALPHA\r\nbravo\r\ncharlie\r\n`);
});

test("字符串形式：跨行的 old_string 用 LF 写，也能在 CRLF 文件里找到，写回仍是 CRLF", async (t) => {
	const { file, ctx } = await fixture(t, BOM + CRLF);
	await read(ctx, file);
	const res = await editTool.execute({ path: file, old_string: "alpha\nbravo", new_string: "ALPHA\nBRAVO" }, ctx);
	assert.equal(res.isError, undefined, textOf(res));
	assert.equal(await readFile(file, "utf8"), `${BOM}ALPHA\r\nBRAVO\r\ncharlie\r\n`);
});

test("字符串形式：old_string 写成 CRLF 也认，new_string 的换行跟随文件", async (t) => {
	const { file, ctx } = await fixture(t, CRLF);
	await read(ctx, file);
	const res = await editTool.execute({ path: file, old_string: "alpha\r\nbravo", new_string: "A\nB" }, ctx);
	assert.equal(res.isError, undefined, textOf(res));
	assert.equal(await readFile(file, "utf8"), "A\r\nB\r\ncharlie\r\n");
});

test("write 覆盖 CRLF + BOM 文件：给的是 LF，写回去仍是 CRLF，BOM 也留着", async (t) => {
	const { file, ctx } = await fixture(t, BOM + CRLF);
	await read(ctx, file);
	const res = await writeTool.execute({ path: file, content: "one\ntwo\n" }, ctx);
	assert.equal(res.isError, undefined, textOf(res));
	assert.equal(await readFile(file, "utf8"), `${BOM}one\r\ntwo\r\n`);
});

test("write 新建文件：给什么写什么", async (t) => {
	const { file, ctx } = await fixture(t, "");
	const crlf = join(file, "..", "new-crlf.txt");
	const lf = join(file, "..", "new-lf.txt");
	await writeTool.execute({ path: crlf, content: "a\r\nb\r\n" }, ctx);
	await writeTool.execute({ path: lf, content: "a\nb\n" }, ctx);
	assert.equal(await readFile(crlf, "utf8"), "a\r\nb\r\n");
	assert.equal(await readFile(lf, "utf8"), "a\nb\n");
});

test("换行混用的文件不做规范化：没编辑的行一个字节都不动", async (t) => {
	// Normalizing a mixed file would rewrite every line of the minority kind — lines nobody edited.
	const mixed = "alpha\r\nbravo\ncharlie\r\ndelta\n";
	const { file, ctx } = await fixture(t, mixed);
	const { tag } = await read(ctx, file);
	const res = await editTool.execute({ path: file, tag, patch: "REPLACE 4-4\n+DELTA" }, ctx);
	assert.equal(res.isError, undefined, textOf(res));
	assert.equal(await readFile(file, "utf8"), "alpha\r\nbravo\ncharlie\r\nDELTA\n");

	await read(ctx, file);
	await writeTool.execute({ path: file, content: "x\r\ny\nz\n" }, ctx);
	assert.equal(await readFile(file, "utf8"), "x\r\ny\nz\n", "混用的文件整篇重写时原样写入，不去猜该用哪种");
});

test("换行混用的文件上，「-原行」这种 diff 写法同样被认出来", async (t) => {
	// Patched as stored, so line 1 is still `alpha\r` when the guard compares it with `-alpha`.
	const mixed = "alpha\r\nbravo\ncharlie\r\n";
	const { file, ctx } = await fixture(t, mixed);
	const { tag } = await read(ctx, file);
	const res = await editTool.execute({ path: file, tag, patch: "REPLACE 1-1\n+-alpha\n+ALPHA" }, ctx);
	assert.equal(res.isError, true);
	assert.match(textOf(res), /not a unified diff/);
	assert.equal(await readFile(file, "utf8"), mixed);
});

test("同一轮里连着改、改完再读：指纹、行数、已读范围处处对得上，不会被自己误拒", async (t) => {
	const { file, ctx } = await fixture(t, BOM + CRLF);
	const first = await read(ctx, file);
	const a = await editTool.execute({ path: file, tag: first.tag, patch: "REPLACE 1-1\n+ALPHA" }, ctx);
	assert.equal(a.isError, undefined, textOf(a));
	const b = await editTool.execute({ path: file, tag: newTag(a), patch: "INSERT AFTER 3\n+delta" }, ctx);
	assert.equal(b.isError, undefined, textOf(b));

	const again = await read(ctx, file);
	assert.equal(again.tag, newTag(b), "编辑结果里报的新指纹，要和重新 read 看到的一致");
	const c = await editTool.execute({ path: file, old_string: "bravo\ncharlie", new_string: "BRAVO\nCHARLIE" }, ctx);
	assert.equal(c.isError, undefined, textOf(c));

	const d = await writeTool.execute({ path: file, content: "one\ntwo\n" }, ctx);
	assert.equal(d.isError, undefined, textOf(d));
	const e = await editTool.execute({ path: file, old_string: "two", new_string: "TWO" }, ctx);
	assert.equal(e.isError, undefined, `write 之后直接改，不该要求重读：${textOf(e)}`);
	const f = await editTool.execute({ path: file, tag: (await read(ctx, file)).tag, patch: "REPLACE 1-1\n+ONE" }, ctx);
	assert.equal(f.isError, undefined, textOf(f));
	assert.equal(await readFile(file, "utf8"), `${BOM}ONE\r\nTWO\r\n`);
});

test("撤销按字节还原：CRLF + BOM 文件改完再撤销，一个字节不差", async (t) => {
	const original = BOM + CRLF;
	const { file, ctx } = await fixture(t, original);
	const { tag } = await read(ctx, file);
	const res = await editTool.execute({ path: file, tag, patch: "REPLACE 2-2\n+BRAVO" }, ctx);
	const id = (res.details as { changeId?: string }).changeId;
	assert.ok(id, "有 scratchDir 时要记下这次改动");
	await undoFileChanges(ctx.cwd, [await readFileChange(ctx.sessionId, id)]);
	assert.equal(await readFile(file, "utf8"), original);
});
