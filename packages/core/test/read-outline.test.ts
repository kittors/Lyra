/**
 * The outline view of `read`.
 *
 * The behaviour that matters most is the last group: folding must not widen what the model is
 * allowed to edit. An outline the model treats as the whole file is worse than no outline.
 */

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { editTool } from "../src/tools/edit.ts";
import { snapshotTag } from "../src/tools/hunk.ts";
import { outline } from "../src/tools/outline.ts";
import { readTool } from "../src/tools/read.ts";
import type { ToolContext } from "../src/types.ts";

/** A file with real structure: declarations, doc comments, and bodies worth folding. */
function sourceFile(functions = 12): string {
	const head = `/**\n * Module header.\n * Explains why this exists.\n */\n\nimport { a } from "./a.ts";\nimport { b } from "./b.ts";\n\n`;
	const body = Array.from({ length: functions }, (_, i) => {
		const filler = Array.from({ length: 8 }, (_, j) => `\tconst step${j} = compute(${i}, ${j});`).join("\n");
		return `/** Does thing ${i}. */\nexport function thing${i}(input: string): number {\n${filler}\n\treturn ${i};\n}\n`;
	}).join("\n");
	return head + body;
}

async function fixture(name: string, content: string): Promise<{ file: string; ctx: ToolContext }> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-outline-"));
	const file = join(dir, name);
	await writeFile(file, content, "utf8");
	return { file, ctx: { cwd: dir, sessionId: "t", state: new Map() } };
}

function textOf(res: { content: { type: string; text?: string }[] }): string {
	return res.content[0]?.type === "text" ? (res.content[0].text ?? "") : "";
}

function linesOf(content: string): string[] {
	const lines = content.split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

// ---------------------------------------------------------------------------
// When it folds, and when it does not
// ---------------------------------------------------------------------------

test("a long source file comes back as an outline", async () => {
	const content = sourceFile();
	const { file, ctx } = await fixture("mod.ts", content);
	const res = await readTool.execute({ path: file } as never, ctx);
	const text = textOf(res);
	assert.match(text, /⋯ \d+ lines/, "bodies should be folded");
	assert.match(text, /export function thing0/, "declarations should survive");
	assert.match(text, /Does thing 0/, "the doc comment should stay with its declaration");
	assert.doesNotMatch(text, /const step3 =/, "body lines should be gone");
	assert.equal((res.details as { outlined?: boolean }).outlined, true);
});

test("the footer says how to get the folded lines back, and not to guess", async () => {
	const { file, ctx } = await fixture("mod.ts", sourceFile());
	const text = textOf(await readTool.execute({ path: file } as never, ctx));
	assert.match(text, /offset/, "must name the way to fetch a range");
	assert.match(text, /绝不要猜测/, "must forbid guessing at folded content");
});

test("a short file is returned verbatim", async () => {
	const { file, ctx } = await fixture("small.ts", "export const a = 1;\nexport const b = 2;\n");
	const text = textOf(await readTool.execute({ path: file } as never, ctx));
	assert.doesNotMatch(text, /⋯/);
	assert.match(text, /1→export const a = 1;/);
});

test("an explicit window is never folded", async () => {
	const { file, ctx } = await fixture("mod.ts", sourceFile());
	const text = textOf(await readTool.execute({ path: file, offset: 10, limit: 20 } as never, ctx));
	assert.doesNotMatch(text, /⋯ \d+ lines/, "the caller said where to look");
	assert.match(text, /const step0/, "body lines must be present in a windowed read");
});

test("a file we cannot parse is returned verbatim", async () => {
	// Long, but not a language whose declarations the patterns know.
	const prose = Array.from({ length: 200 }, (_, i) => `line ${i} of ordinary prose`).join("\n") + "\n";
	const { file, ctx } = await fixture("notes.md", prose);
	const text = textOf(await readTool.execute({ path: file } as never, ctx));
	assert.doesNotMatch(text, /⋯ \d+ lines/);
});

test("a file that is nearly all declarations is not folded — there is nothing to save", () => {
	const decls = Array.from({ length: 120 }, (_, i) => `export const value${i} = ${i};`).join("\n") + "\n";
	assert.equal(outline("types.ts", decls, linesOf(decls)), null);
});

test("a short run between declarations stays verbatim rather than becoming a marker", () => {
	const content = sourceFile(2) + Array.from({ length: 70 }, (_, i) => `export const tail${i} = ${i};`).join("\n") + "\n";
	const result = outline("mod.ts", content, linesOf(content));
	// Whatever it decides, it must never emit a marker for fewer lines than the marker costs.
	if (result) {
		for (const match of result.text.matchAll(/⋯ (\d+) lines/g)) {
			assert.ok(Number(match[1]) >= 4, `a ${match[1]}-line fold is not worth a marker`);
		}
	}
});

// ---------------------------------------------------------------------------
// Folding must not widen what may be edited
// ---------------------------------------------------------------------------

test("after an outline, editing a folded body is refused", async () => {
	const content = sourceFile();
	const { file, ctx } = await fixture("mod.ts", content);
	const res = await readTool.execute({ path: file } as never, ctx);
	const text = textOf(res);

	// Find a line number inside the first fold.
	const fold = /⋯ \d+ lines \((\d+)-(\d+)\)/.exec(text);
	assert.ok(fold, "the fixture must produce at least one fold");
	const insideFold = Number(fold[1]);

	const edit = await editTool.execute({ path: file, tag: snapshotTag(content), patch: `REPLACE ${insideFold}-${insideFold}\n+\tconst tampered = 1;` }, ctx);
	assert.equal(edit.isError, true);
	assert.match(textOf(edit), /were not in what you read/);
});

test("after an outline, editing a line that was shown works", async () => {
	const content = sourceFile();
	const { file, ctx } = await fixture("mod.ts", content);
	const text = textOf(await readTool.execute({ path: file } as never, ctx));

	// Pick a displayed declaration line straight out of the rendered outline.
	const shown = /^\s*(\d+)→export function thing0/m.exec(text);
	assert.ok(shown, "the outline must show the declaration");
	const line = Number(shown[1]);

	const edit = await editTool.execute(
		{ path: file, tag: snapshotTag(content), patch: `REPLACE ${line}-${line}\n+export function thing0(input: string, extra = 0): number {` },
		ctx,
	);
	assert.equal(edit.isError, undefined, textOf(edit));
});

test("reading a range after an outline widens what may be edited", async () => {
	const content = sourceFile();
	const { file, ctx } = await fixture("mod.ts", content);
	const text = textOf(await readTool.execute({ path: file } as never, ctx));
	const fold = /⋯ \d+ lines \((\d+)-(\d+)\)/.exec(text);
	const from = Number(fold![1]);
	const to = Number(fold![2]);

	// Refused before the range is read...
	const before = await editTool.execute({ path: file, tag: snapshotTag(content), patch: `REPLACE ${from}-${from}\n+\tconst ok = 1;` }, ctx);
	assert.equal(before.isError, true);

	// ...and allowed after.
	await readTool.execute({ path: file, offset: from, limit: to - from + 1 } as never, ctx);
	const after = await editTool.execute({ path: file, tag: snapshotTag(content), patch: `REPLACE ${from}-${from}\n+\tconst ok = 1;` }, ctx);
	assert.equal(after.isError, undefined, textOf(after));
});

// ---------------------------------------------------------------------------
// The outline itself
// ---------------------------------------------------------------------------

test("outline reports ranges that cover exactly the displayed lines", () => {
	const content = sourceFile();
	const lines = linesOf(content);
	const result = outline("mod.ts", content, lines);
	assert.ok(result);
	const covered = result.shownRanges.reduce((sum, [a, b]) => sum + (b - a + 1), 0);
	assert.equal(covered, result.shownLines);
	assert.equal(result.shownLines + result.foldedLines, lines.length);
});

test("outline never claims a line the file does not have", () => {
	const content = sourceFile();
	const lines = linesOf(content);
	const result = outline("mod.ts", content, lines)!;
	for (const [a, b] of result.shownRanges) {
		assert.ok(a >= 1 && b <= lines.length, `range ${a}-${b} escapes a ${lines.length}-line file`);
	}
});
