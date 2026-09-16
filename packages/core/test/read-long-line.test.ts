/**
 * A line longer than the cap stays addressable. The catalog that blew a session
 * up is one 1.7 MB line; truncating it to the head made the rest unreachable.
 */

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { editTool } from "../src/tools/edit.ts";
import { snapshotTag } from "../src/tools/hunk.ts";
import { readTool } from "../src/tools/read.ts";
import type { ToolContext } from "../src/types.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const CATALOG = join(ROOT, "packages/core/src/catalog/model-catalog.json");
const NAME = "Qwen3-LiveTranslate Flash Realtime";

function textOf(res: { content: { type: string; text?: string }[] }): string {
	return res.content[0]?.type === "text" ? (res.content[0].text ?? "") : "";
}

async function workspace(content: string, name = "catalog.json"): Promise<{ file: string; ctx: ToolContext }> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-read-long-"));
	const file = join(dir, name);
	await writeFile(file, content, "utf8");
	return { file, ctx: { cwd: dir, sessionId: "t", state: new Map() } };
}

test("a default read of a long line does not pretend the rest is gone", async () => {
	const needle = "MID-LINE-NEEDLE-7K2M";
	const content = `${"a".repeat(80_000)}"id":"${needle}"${"b".repeat(80_000)}`;
	const { file, ctx } = await workspace(content);
	const first = textOf(await readTool.execute({ path: file } as never, ctx));
	assert.doesNotMatch(first, new RegExp(needle));
	assert.match(first, /char_offset=2001/);
	assert.match(first, /is 160027 characters/);

	const at = content.indexOf(needle);
	const second = textOf(await readTool.execute({ path: file, char_offset: at + 1 } as never, ctx));
	assert.match(second, new RegExp(needle));
	assert.ok(second.length < 8_000, `window was ${second.length} characters`);
});

test("the live model-catalog.json mid-line name is reachable via char_offset", async () => {
	const ctx: ToolContext = { cwd: ROOT, sessionId: "live-read", state: new Map() };
	const head = textOf(await readTool.execute({ path: CATALOG } as never, ctx));
	assert.doesNotMatch(head, new RegExp(NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.match(head, /char_offset=/);

	const { readFile } = await import("node:fs/promises");
	const at = (await readFile(CATALOG, "utf8")).indexOf(NAME);
	assert.ok(at > 2000, `name was at ${at}`);
	const window = textOf(await readTool.execute({ path: CATALOG, char_offset: Math.max(1, at - 80) } as never, ctx));
	assert.ok(window.includes(NAME), "the named window must include the name");
	assert.ok(window.includes("qwen3-livetranslate-flash-realtime"));
	assert.ok(window.length < 8_000);
});

test("a patch of a long line is refused until the whole line has been seen", async () => {
	const content = `${"a".repeat(80_000)}KEEP${"b".repeat(80_000)}`;
	const { file, ctx } = await workspace(content, "blob.txt");
	await readTool.execute({ path: file } as never, ctx);
	const patch = await editTool.execute({ path: file, tag: snapshotTag(content), patch: "REPLACE 1-1\n+changed" }, ctx);
	assert.equal(patch.isError, true);
	assert.match(textOf(patch), /char_offset|old_string/);
});

test("a string replace of a span that was on screen is allowed", async () => {
	const needle = "SWAP-ME";
	const content = `HEAD-UNIQUE${"a".repeat(80_000)}${needle}${"b".repeat(80_000)}`;
	const { file, ctx } = await workspace(content, "blob.txt");
	const at = content.indexOf(needle);
	await readTool.execute({ path: file, char_offset: at + 1 } as never, ctx);
	const unseen = await editTool.execute({ path: file, old_string: "HEAD-UNIQUE", new_string: "xxx" }, ctx);
	assert.equal(unseen.isError, true);
	assert.match(textOf(unseen), /have not read|char_offset/);

	const seen = await editTool.execute({ path: file, old_string: needle, new_string: "SWAPPED" }, ctx);
	assert.equal(seen.isError, undefined, textOf(seen));
});
