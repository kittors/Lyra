/**
 * How a long tooltip wraps.
 *
 * The claim: a label never ends with a single character on its own line, a path or filename breaks
 * after its separators rather than in the middle of a word, and the lines come out as even as those
 * breaks allow — while a short label is left exactly as it was.
 *
 * The bubble is laid out by the browser, which is not here, so `linesAt` stands in for its line
 * breaker. It is deliberately small, but it follows the browser's rule where it matters: a line may
 * end after a space, around a CJK character, and at a `<wbr>`; only a run that fits nowhere is cut
 * inside (`overflow-wrap: anywhere`). The first test shows it reproduces the bug as it was.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { balancedWidth, softBreaks } from "../src/ui/overlay/tooltip.ts";

/** Every character is this wide. Real glyphs vary; the arithmetic does not care. */
const ADVANCE = 7;
const CJK = /[\u3000-\u9fff\uff00-\uffef]/u;

/** The label cut into the pieces a line may not split, in order; `\n` stands alone. */
function units(pieces: string[]): string[] {
	const found: string[] = [];
	for (const piece of pieces) {
		let current = "";
		for (const char of piece) {
			if (char === "\n" || CJK.test(char)) {
				if (current) found.push(current);
				found.push(char);
				current = "";
				continue;
			}
			current += char;
			if (char === " ") {
				found.push(current);
				current = "";
			}
		}
		if (current) found.push(current);
	}
	return found;
}

/** The lines a greedy line breaker makes of these pieces at this width. */
function linesAt(pieces: string[], width: number): string[] {
	const wide = (text: string) => [...text].length * ADVANCE;
	const lines: string[] = [];
	let line = "";
	for (const unit of units(pieces)) {
		if (unit === "\n") {
			lines.push(line);
			line = "";
			continue;
		}
		if (wide(line + unit) <= width) {
			line += unit;
			continue;
		}
		if (line) lines.push(line);
		// `overflow-wrap: anywhere`, and only for a unit too long for a line of its own.
		let rest = [...unit];
		const perLine = Math.max(1, Math.floor(width / ADVANCE));
		while (rest.length * ADVANCE > width) {
			lines.push(rest.slice(0, perLine).join(""));
			rest = rest.slice(perLine);
		}
		line = rest.join("");
	}
	lines.push(line);
	return lines;
}

/** What the tooltip does now: break opportunities, then the narrowest width that costs no line. */
function laidOut(text: string, cap: number): string[] {
	const pieces = softBreaks(text);
	return linesAt(pieces, balancedWidth(cap, (width) => linesAt(pieces, width).length));
}

const FILENAME = "REQUIREMENTS_POLICY_PORTAL_v2_final_review_notes.md";
const PATH = "docs/issue/2026-09-16-2220-01-tasklist-false-paused-on-unfinished-plan.md";
/** 50 characters to a line: one fewer than the filename, which is how 「d」 ended up alone. */
const CAP = 50 * ADVANCE;

const spread = (lines: string[]) => {
	const lengths = lines.map((line) => [...line].length);
	return Math.max(...lengths) - Math.min(...lengths);
};

test("the stand-in reproduces the bug: one word, cut at the cap, one letter left over", () => {
	assert.deepEqual(linesAt([FILENAME], CAP), ["REQUIREMENTS_POLICY_PORTAL_v2_final_review_notes.m", "d"]);
});

test("a long filename breaks after a separator, into lines of about the same length", () => {
	const lines = laidOut(FILENAME, CAP);
	assert.deepEqual(lines, ["REQUIREMENTS_POLICY_PORTAL_", "v2_final_review_notes.md"]);
	assert.equal(lines.join(""), FILENAME, "nothing added or lost");
});

test("no line is ever a single character, at any width the cap can be", () => {
	for (const text of [FILENAME, PATH, "a".repeat(51), `${"x".repeat(49)}_yz`]) {
		for (let chars = 8; chars <= 60; chars++) {
			const lines = laidOut(text, chars * ADVANCE);
			if (lines.length < 2) continue;
			assert.ok(
				lines.every((line) => [...line].length > 1),
				`${JSON.stringify(text)} at ${chars} characters a line: ${JSON.stringify(lines)}`,
			);
		}
	}
});

test("a long path breaks only right after / _ - . and stays even", () => {
	const lines = laidOut(PATH, CAP);
	assert.equal(lines.length, 2);
	assert.match(lines[0]!, /[/_.-]$/u, `the first line should end at a separator: ${JSON.stringify(lines)}`);
	assert.ok(spread(lines) <= 8, `lines as even as the separators allow: ${JSON.stringify(lines)}`);
});

test("a run with no separators is still evened out rather than left with a stub", () => {
	const lines = laidOut("a".repeat(51), CAP);
	assert.deepEqual(lines.map((line) => line.length), [26, 25]);
});

test("a long Chinese sentence is evened out over its lines", () => {
	const sentence = "移动文件：拖动或按方向键；垂直于排列方向的按键预览分屏，Enter 确认，Escape 取消";
	const before = linesAt([sentence], 40 * ADVANCE);
	const after = laidOut(sentence, 40 * ADVANCE);
	assert.equal(after.length, before.length, "no extra line");
	assert.ok(spread(after) < spread(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
	assert.ok(spread(after) <= 2, JSON.stringify(after));
});

test("a short label is left as it is", () => {
	for (const label of ["用默认应用打开", "复制", "新建会话 ⌘N", "Copy path"]) {
		assert.deepEqual(softBreaks(label), [label], `no break opportunities added to ${label}`);
		assert.deepEqual(laidOut(label, CAP), [label], `and it is not narrowed into more lines: ${label}`);
	}
});

test("break opportunities go only into long runs, never into ordinary words or numbers", () => {
	assert.deepEqual(softBreaks("上下文用了 85.3%，还剩 14.7%"), ["上下文用了 85.3%，还剩 14.7%"]);
	assert.deepEqual(softBreaks("升级到 v0.9.19 之后"), ["升级到 v0.9.19 之后"]);
	assert.deepEqual(softBreaks(FILENAME), ["REQUIREMENTS_", "POLICY_", "PORTAL_", "v2_", "final_", "review_", "notes.", "md"]);
	assert.deepEqual(softBreaks("见 https://example.com/a/b?c=1"), ["见 https:", "/", "/", "example.", "com/", "a/", "b?", "c=", "1"]);
});

test("lines the caller broke on purpose stay broken, and each is evened on its own", () => {
	const label = "#12 read · 读取 packages/desktop/src/features/conversation/Markdown.tsx 的前 200 行\n1.2s";
	const lines = laidOut(label, CAP);
	assert.equal(lines.at(-1), "1.2s", `the caller's second line is kept: ${JSON.stringify(lines)}`);
	assert.ok(
		lines.every((line) => !/^[a-z]$/iu.test(line)),
		`no path cut down to a stray letter: ${JSON.stringify(lines)}`,
	);
	assert.ok(!lines.some((line) => line.endsWith("Markdown.ts")), `not cut inside a filename: ${JSON.stringify(lines)}`);
});
