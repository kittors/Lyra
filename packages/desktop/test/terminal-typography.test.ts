/**
 * The terminal takes the code font and leaves the reading settings alone.
 *
 * A line height of 2.3 and 0.09em of tracking — a real settings file — had made every terminal
 * cell 28px tall with a block cursor to match. The grid is the terminal's own.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { TERMINAL_LINE_HEIGHT, terminalTypography } from "../src/features/terminal/typography.ts";

const FALLBACK = { font: "Menlo", size: 12, weight: 400 };

test("font, size and weight follow 代码外观; line height and tracking do not", () => {
	const options = terminalTypography(
		{ codeFont: "JetBrains Mono", codeFontSize: 14, codeFontWeight: 500, codeLineHeight: 2.3, codeLetterSpacing: 0.09 },
		FALLBACK,
	);
	assert.deepEqual(options, { fontFamily: "JetBrains Mono", fontSize: 14, fontWeight: 500, lineHeight: TERMINAL_LINE_HEIGHT, letterSpacing: 0 });
});

test("the grid is tighter than any code block and has no tracking", () => {
	assert.ok(TERMINAL_LINE_HEIGHT >= 1.1 && TERMINAL_LINE_HEIGHT <= 1.3, `a terminal, not prose: ${TERMINAL_LINE_HEIGHT}`);
	assert.equal(terminalTypography({ codeLetterSpacing: 0.2 }, FALLBACK).letterSpacing, 0);
});

test("without settings, the live CSS values stand in", () => {
	assert.deepEqual(terminalTypography(undefined, FALLBACK), {
		fontFamily: "Menlo", fontSize: 12, fontWeight: 400, lineHeight: TERMINAL_LINE_HEIGHT, letterSpacing: 0,
	});
	// An empty font string is "not set", not a font called nothing.
	assert.equal(terminalTypography({ codeFont: "" }, FALLBACK).fontFamily, "Menlo");
});
