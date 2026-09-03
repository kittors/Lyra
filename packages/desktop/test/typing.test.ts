/**
 * The rewrite between two titles, as a sequence rather than as motion on a screen.
 *
 * What is easy to get wrong here is the shape of the sequence, not its speed: a frame list that
 * skips its own last entry leaves the row showing a truncated title forever, and one that walks
 * back past the shared prefix retypes text that never changed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { typingFrames } from "../src/lib/typing.ts";

test("nothing to animate when the text has not changed", () => {
	assert.deepEqual(typingFrames("新对话", "新对话"), []);
	assert.deepEqual(typingFrames("", ""), []);
});

test("deletes back to the shared prefix, then types the rest", () => {
	assert.deepEqual(typingFrames("新对话", "新对策"), ["新对", "新对策"]);
});

test("always ends on the target, exactly", () => {
	for (const [from, to] of [
		["新对话", "帮我梳理这个项目的整体架构"],
		["", "abc"],
		["abcdef", ""],
		["a".repeat(60), "b".repeat(60)],
	]) {
		const frames = typingFrames(from, to);
		assert.equal(frames.at(-1), to, `${from} → ${to}`);
	}
});

test("passes through the shared prefix on the way", () => {
	// 「新对话」 and the real title share nothing, so the row empties before it fills.
	const frames = typingFrames("新对话", "查依赖");
	assert.ok(frames.includes(""), frames.join("|"));
	assert.deepEqual(frames, ["新对", "新", "", "查", "查依", "查依赖"]);
});

test("a long rewrite is capped in steps, not in characters", () => {
	const frames = typingFrames("新对话", "帮".repeat(60));
	assert.ok(frames.length <= 26, `${frames.length} frames`);
	assert.equal(frames.at(-1), "帮".repeat(60));
	// Every frame is a real prefix of one side or the other — never a mix of both.
	for (const frame of frames) assert.ok("新对话".startsWith(frame) || "帮".repeat(60).startsWith(frame), frame);
});

test("frames only ever grow or shrink by one step", () => {
	const frames = typingFrames("abcdef", "abcxyz");
	assert.deepEqual(frames, ["abcde", "abcd", "abc", "abcx", "abcxy", "abcxyz"]);
});

test("astral characters are moved whole", () => {
	const frames = typingFrames("🚀🚀", "🚀");
	// One code point removed, not one UTF-16 unit — half a surrogate pair renders as a tofu box.
	assert.deepEqual(frames, ["🚀"]);
	for (const frame of typingFrames("", "🚀🎯🌊")) assert.ok(!frame.includes("�"), frame);
});
