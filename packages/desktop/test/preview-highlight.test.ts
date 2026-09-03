/**
 * Colouring a sample by token name rather than by stylesheet.
 *
 * The reason this exists at all is that the settings page shows two palettes at once, and
 * `highlightStyle` cannot: its colours are `light-dark()` pairs resolved from `color-scheme`,
 * of which a document has one. So both specimens came out in the same scheme.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightPieces, grammarFor } from "../src/features/settings/preview-highlight.ts";

test("a TypeScript sample is split into the kinds a theme has colours for", async () => {
	const pieces = await highlightPieces('const x: string = "hi"; // 说明', "ts");
	const kinds = new Set(pieces.map((p) => p.token).filter(Boolean));
	// The four that carry the most of a theme's character, and the ones a flat render loses.
	for (const wanted of ["keyword", "type", "string", "comment"]) {
		assert.ok(kinds.has(wanted as never), `没有识别出 ${wanted}，只有 ${[...kinds].join("、")}`);
	}
});

test("the pieces reassemble into exactly the original source", async () => {
	// The gaps `highlightTree` skips are the easy thing to drop, and dropping them silently
	// deletes whitespace from the sample.
	const code = 'function f(a: number) {\n\treturn a + 1;\n}\n';
	const pieces = await highlightPieces(code, "ts");
	assert.equal(pieces.map((p) => p.text).join(""), code);
});

test("an unknown language renders as one plain run rather than throwing", async () => {
	const pieces = await highlightPieces("whatever this is", null);
	assert.deepEqual(pieces, [{ text: "whatever this is", token: null }]);
	const missing = await highlightPieces("x", "no-such-grammar");
	assert.equal(missing.length, 1);
	assert.equal(missing[0].token, null);
});

test("the stream-mode grammars unwrap — the bug that made half of them flat", async () => {
	// `StreamLanguage.define` returns a Language directly rather than a LanguageSupport, and the
	// unwrapping that misses it produces a grammar that loads and colours nothing.
	for (const key of ["yaml", "sh", "dockerfile", "nginx", "toml"]) {
		const language = await grammarFor(key);
		assert.ok(language, `${key} 没有解出语言`);
	}
});

test("a config file gets its comments told apart from its values", async () => {
	const pieces = await highlightPieces("# 注释\nserver {\n  listen 80;\n}\n", "nginx");
	const kinds = new Set(pieces.map((p) => p.token).filter(Boolean));
	assert.ok(kinds.size >= 2, `nginx 只分出了 ${kinds.size} 种：${[...kinds].join("、")}`);
	assert.ok(pieces.some((p) => p.token === "comment" && p.text.includes("注释")), "注释没有被识别");
});
