/**
 * The default UI face is the machine's Chinese UI family, so Han and Latin share one face.
 *
 * Settings store a CSS stack, not a menu id. Inter and IBM Plex stay bundled for anyone
 * who types those stacks; they must not be the first-frame sans any more.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("default sans is PingFang-first, with Inter and Plex still declared", async () => {
	const fonts = await readFile(new URL("../src/styles/fonts.css", import.meta.url), "utf8");
	const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
	assert.match(fonts, /font-family:\s*"IBM Plex Sans Variable"/);
	assert.match(fonts, /font-family:\s*"Inter Variable"/);
	assert.match(tokens, /--font-sans:[^;]*"Lyra Punct"/);
	assert.match(tokens, /--font-sans:[^;]*"PingFang SC"/);
	assert.doesNotMatch(tokens, /--font-sans:[^;]*"IBM Plex Sans Variable"/);
	assert.doesNotMatch(tokens, /--font-sans:[^;]*"Inter Variable"/);
	assert.match(fonts, /font-weight:\s*400/);
	assert.match(fonts, /PingFangSC-Regular/);
	assert.match(fonts, /PingFangSC-Medium/);
	assert.match(fonts, /PingFangSC-Semibold/);
	assert.match(fonts, /font-family:\s*"Lyra Punct"/);
	assert.match(fonts, /font-family:\s*"Lyra Punct TW"/);
	assert.match(fonts, /STSongti-SC-Regular/);
	assert.doesNotMatch(fonts, /font-family:\s*"Lyra CJK"[\s\S]*?font-weight:\s*100 900/);
	const cjkFace = fonts.match(/font-family:\s*"Lyra CJK";[\s\S]*?unicode-range:\s*([^;]+);/);
	assert.ok(cjkFace, "Lyra CJK declares a unicode-range");
	assert.doesNotMatch(cjkFace[1], /U\+3000-303F/, "Han face must not claim CJK punctuation");
	assert.match(fonts, /font-family:\s*"Lyra Punct";[\s\S]*?U\+3000-303F/);
});
