/**
 * Keeping system emoji out of text this app renders.
 *
 * Two ways to get this wrong and both are quiet. Too greedy, and the arrows and check marks the
 * interface is built from disappear — `→` between two branch names, `✓` beside a passing check.
 * Too timid, and a zero-width joiner survives on its own: invisible, unsearchable, and it breaks
 * the word it is sitting in.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { stripEmoji } from "../src/lib/markdown/strip-emoji.ts";

test("a plain emoji goes, and the sentence closes up behind it", () => {
	assert.equal(stripEmoji("🤖 Generated with Claude Code"), "Generated with Claude Code");
	assert.equal(stripEmoji("done ✅"), "done");
});

test("typographic symbols stay — they are the interface, not decoration", () => {
	// Arrows, check and cross marks, the return symbol: all drawn by the text font at the app's
	// own weight, all used deliberately.
	for (const kept of ["main → dev", "✓ passed", "✕ close", "press ↵", "⇧⌘P", "a ← b", "100% · 3/4"]) {
		assert.equal(stripEmoji(kept), kept);
	}
});

test("a joined sequence is removed whole, leaving no invisible joiner", () => {
	const out = stripEmoji("family 👨‍👩‍👧‍👦 here");
	assert.equal(out, "family here");
	assert.ok(!out.includes("‍"), "a stray zero-width joiner would be invisible and unsearchable");
});

test("skin tones and variation selectors go with their base", () => {
	const out = stripEmoji("wave 👋🏽 and point ☝️");
	assert.equal(out, "wave and point");
	assert.ok(!/[︀-️]/.test(out), "a leftover variation selector is invisible");
});

test("flags are removed as pairs, not as halves", () => {
	// Regional indicators are two code points that mean one flag; removing one leaves the other
	// rendering as a lone letter in a box.
	assert.equal(stripEmoji("ship it 🇯🇵"), "ship it");
});

test("line structure survives, because this runs before Markdown", () => {
	const md = "# 标题 🎉\n\n- 一项 ✅\n- 两项\n";
	assert.equal(stripEmoji(md), "# 标题\n\n- 一项\n- 两项\n");
});

test("a line that was only an emoji becomes empty, not removed", () => {
	// Deleting the line would join two paragraphs into one.
	assert.equal(stripEmoji("上\n🎉\n下"), "上\n\n下");
});

test("indentation is not eaten — a code block depends on it", () => {
	assert.equal(stripEmoji("text\n    indented\n"), "text\n    indented\n");
});

test("empty and emoji-only inputs are handled", () => {
	assert.equal(stripEmoji(""), "");
	assert.equal(stripEmoji("🎉"), "");
});
