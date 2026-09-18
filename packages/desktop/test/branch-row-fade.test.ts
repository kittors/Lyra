/**
 * Git rows use the same reserved slot as a session row.
 *
 * A full-width name with icons on top is the overlap SessionRow's comment forbids.
 * A per-row reservation (one button, three, 「当前」) is the empty boxes of different widths.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("session, project, and git rows share HoverRow", async () => {
	const files = [
		"src/features/sidebar/SessionRow.tsx",
		"src/features/sidebar/ProjectHead.tsx",
		"src/features/git/BranchRow.tsx",
		"src/features/git/CheckoutRow.tsx",
	];
	for (const file of files) {
		const source = await readFile(new URL(file, root), "utf8");
		assert.match(source, /from "\.\.\/.*ui\/row\/HoverRow\.tsx"/, file);
	}
});

test("the fade yields on the shared row, not a per-list group name", async () => {
	const css = await readFile(new URL("src/styles/thinking-ticker.css", root), "utf8");
	assert.match(css, /\[data-ly-hover-row\]:hover \.ly-fade-tail/);
	assert.match(css, /--ly-fade-right:\s*var\(--ly-row-controls/);
	assert.doesNotMatch(css, /group\\\/branch/);
	assert.doesNotMatch(css, /group\\\/session:hover/);
});

test("worktrees do not indent the icon past the repo icon", async () => {
	const view = await readFile(new URL("src/features/git/BranchesView.tsx", root), "utf8");
	const checkout = await readFile(new URL("src/features/git/CheckoutRow.tsx", root), "utf8");
	assert.doesNotMatch(view, /pl-5/);
	assert.doesNotMatch(checkout, /pl-5/);
	assert.match(checkout, /HoverRowMark/);
	assert.match(checkout, /GIT_CONTROLS/);
});

test("every branch row reserves the same trailing slot", async () => {
	const row = await readFile(new URL("src/features/git/BranchRow.tsx", root), "utf8");
	assert.match(row, /GIT_CONTROLS/);
	assert.doesNotMatch(row, /pr-\[76px\]|pr-\[52px\]|pr-7/);
	assert.match(row, /HoverRowMark/);
});
