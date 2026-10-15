/**
 * Code blocks, display formulas and diagrams carry their own sideways thumb.
 *
 * Native scrollbars are hidden everywhere, so a long line in a fenced block, a wide equation or a wide
 * diagram ran off the right edge with nothing to say so: a trackpad could swipe to it, a Windows mouse
 * could only Shift+wheel. Tables already drew `OverlayScrollbar`; these hold the other three to it,
 * and to the same rule that shows the thumb only while the pointer is over that block.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (path: string) => readFileSync(join(import.meta.dirname, "../../src", path), "utf8");

test("each block that scrolls sideways draws the overlay thumb over its own scroller", () => {
	for (const file of ["features/conversation/CodeBlock.tsx", "features/conversation/Markdown.tsx", "features/conversation/MermaidBlock.tsx"]) {
		const source = read(file);
		assert.match(source, /<OverlayScrollbar viewport=\{viewport\} orientation="horizontal" \/>/, file);
		assert.match(source, /ly-hscroll-own/, file);
	}
});

test("the thumb shows for the block under the pointer, not for every block in the transcript", () => {
	const css = read("styles/scroll.css");
	assert.match(css, /\.ly-hscroll-own:not\(:hover\) \.ly-hthumb/);
	assert.match(css, /\.ly-hscroll-own:hover \.ly-hthumb/);
	assert.match(css, /\.ly-hscroll-own:has\(\.ly-hthumb-active\)/, "dragging the thumb must not select the code under it");
});
