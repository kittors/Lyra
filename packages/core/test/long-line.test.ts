import assert from "node:assert/strict";
import { test } from "node:test";
import { charWindow, clipOutput, coversChars, formatCharWindow, indexToLineCol, matchWindow, mergeCharRanges, utf8ByteOffsetToIndex } from "../src/tools/long-line.ts";

test("a window starting past the first 2000 characters still contains the needle", () => {
	const needle = "NEEDLE";
	const text = `${"a".repeat(80_000)}${needle}${"b".repeat(80_000)}`;
	const window = charWindow(text, 79_900);
	assert.ok(window.text.includes(needle));
	assert.ok(window.start >= 79_000);
	assert.ok(window.end - window.start <= 2000);
});

test("a match window prefers the hit over the line head", () => {
	const needle = "MID-LINE-NEEDLE";
	const text = `${"a".repeat(80_000)}${needle}${"b".repeat(80_000)}`;
	const window = matchWindow(text, needle);
	assert.ok(window.text.includes(needle));
	assert.ok(window.start > 0, "must not be the line head");
	assert.match(formatCharWindow(text, window.start), /char_offset=/);
});

test("indexToLineCol maps a mid-line offset to line 1", () => {
	assert.deepEqual(indexToLineCol("abc", 2), { line: 1, col: 3 });
	assert.deepEqual(indexToLineCol("ab\ncd", 4), { line: 2, col: 2 });
});

test("utf8 byte offsets land on the same character as JS indexOf for ASCII and CJK", () => {
	const text = "ab中c";
	assert.equal(utf8ByteOffsetToIndex(text, 0), 0);
	assert.equal(utf8ByteOffsetToIndex(text, 2), 2);
	assert.equal(utf8ByteOffsetToIndex(text, 5), 3);
});

test("clipOutput windows a single huge line instead of keeping 60k of head and tail", () => {
	const needle = "HIDDEN-MIDDLE";
	const text = `${"a".repeat(80_000)}${needle}${"b".repeat(80_000)}`;
	const clipped = clipOutput(text, 60_000);
	assert.ok(clipped.length < 8_000, `clipped to ${clipped.length}`);
	assert.match(clipped, /char_offset=/);
	assert.doesNotMatch(clipped, new RegExp(needle));
});

test("clipOutput keeps a failing assertion that sat in the omitted middle", () => {
	const fail = "✖ failing tests:\ntest at test/lsp-idle.test.ts:76:1\n  AssertionError [ERR_ASSERTION]: idle never reached";
	const text = `${"ok\n".repeat(8_000)}\n${fail}\n${"ok\n".repeat(8_000)}`;
	const clipped = clipOutput(text, 60_000);
	assert.match(clipped, /AssertionError/);
	assert.match(clipped, /lsp-idle/);
	assert.ok(clipped.length <= 60_000, `clipped to ${clipped.length}`);
});

test("coversChars and mergeCharRanges join adjacent spans", () => {
	const merged = mergeCharRanges([[1, 10], [11, 20], [40, 50]]);
	assert.deepEqual(merged, [[1, 20], [40, 50]]);
	assert.equal(coversChars(merged, 5, 15), true);
	assert.equal(coversChars(merged, 15, 25), false);
});
