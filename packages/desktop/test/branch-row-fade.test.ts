/**
 * Session, project, and git rows share HoverRow: fill, overlay, fade on hover.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("session and project rows use the shared HoverRow shell", async () => {
	for (const file of ["src/features/sidebar/SessionRow.tsx", "src/features/sidebar/ProjectHead.tsx"]) {
		const source = await readFile(new URL(file, root), "utf8");
		assert.match(source, /ui\/row\/HoverRow/, file);
		assert.match(source, /HoverRowReveal/, file);
	}
	const session = await readFile(new URL("src/features/sidebar/SessionRow.tsx", root), "utf8");
	assert.match(session, /pr-1\.5/);
	assert.doesNotMatch(session, /actionsCount === 2 \? "pr-14" : "pr-8"/);
});

test("the fade keys off the shared hover-row attribute", async () => {
	const css = await readFile(new URL("src/styles/thinking-ticker.css", root), "utf8");
	assert.match(css, /\[data-ly-hover-row\]:hover \.ly-fade-tail/);
	assert.match(css, /--ly-fade-clear:\s*var\(--ly-row-controls/);
	assert.doesNotMatch(css, /--ly-fade-right:\s*var\(--ly-row-controls/);
	assert.doesNotMatch(css, /group\\\/session:hover/);
});

test("the shared mask keeps a solid clear zone under the icons", async () => {
	const css = await readFile(new URL("src/styles/marquee.css", root), "utf8");
	assert.match(css, /@property --ly-fade-clear/);
	assert.match(css, /transparent calc\(100% - var\(--ly-fade-clear\) \* var\(--ly-fade-reveal\)\)/);
	assert.match(css, /#000 calc\(100% - var\(--ly-fade-right\) - var\(--ly-fade-clear\) \* var\(--ly-fade-reveal\)\)/);
	// The transition is on whether the run shows, not on its width. The width lands with the
	// layout: folding a project under the pointer moves the count in and out, the covered run
	// changes with it, and easing that change drew the title's tail under the buttons and back.
	assert.match(css, /@property --ly-fade-reveal/);
	assert.match(css, /--ly-fade-reveal var\(--ly-t-quick\)/);
	assert.doesNotMatch(css, /--ly-fade-clear var\(--ly-t/);
	const ticker = await readFile(new URL("src/styles/thinking-ticker.css", root), "utf8");
	assert.match(ticker, /--ly-fade-reveal:\s*1/);
});

test("the reveal is a shrink-wrap overlay on group/row", async () => {
	const row = await readFile(new URL("src/ui/row/HoverRow.tsx", root), "utf8");
	assert.match(row, /data-ly-hover-row/);
	assert.match(row, /group\/row/);
	assert.match(row, /absolute inset-y-0 right-0/);
	assert.match(row, /px-1\.5/);
	assert.match(row, /group-hover\/row:opacity-100/);
	assert.match(row, /titleRight - overlay\.left/);
	assert.doesNotMatch(row, /width:\s*"var\(--ly-row-controls\)"/);
	assert.doesNotMatch(row, /group\/branch/);
});

test("the marquee duplicate stays off-screen until hover", async () => {
	const scroll = await readFile(new URL("src/ui/scroll/ScrollText.tsx", root), "utf8");
	assert.match(scroll, /data-ly-scroll-dup/);
	assert.match(scroll, /left:\s*width \+ GAP/);
	assert.match(scroll, /invisible/);
	const css = await readFile(new URL("src/styles/marquee.css", root), "utf8");
	assert.match(css, /\[data-ly-scroll-dup\]/);
});

test("worktrees do not indent the icon past the repo icon", async () => {
	const checkout = await readFile(new URL("src/features/git/CheckoutRow.tsx", root), "utf8");
	assert.doesNotMatch(checkout, /pl-5/);
	assert.match(checkout, /HoverRowMark/);
});
