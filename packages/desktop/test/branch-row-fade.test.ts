/**
 * Branch names yield to hover icons the same way session titles do.
 *
 * An in-flow transparent strip still occupies width, so every row faded in a
 * different place (one button, three, or 「当前」) and a long name drew two
 * fades — the 22px overflow mask, then the empty gutter. The overlay plus
 * `--ly-row-controls` is what keeps one fade, in one place.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("branch rows overlay icons and tell the fade how wide they are", async () => {
	const row = await readFile(new URL("src/features/git/BranchRow.tsx", root), "utf8");
	assert.match(row, /--ly-row-controls/);
	assert.match(row, /ly-fade-tail/);
	assert.match(row, /absolute inset-y-0 right-0/);
	assert.match(row, /group-hover\/branch:opacity-100/);
	assert.match(row, /pointer-events-none absolute/);
	assert.doesNotMatch(row, /pr-\[76px\]|pr-\[52px\]|pr-7/);
});

test("the fade yields for branch icons, not only session and project rows", async () => {
	const css = await readFile(new URL("src/styles/thinking-ticker.css", root), "utf8");
	assert.match(css, /group\\\/branch:hover \.ly-fade-tail/);
	assert.match(css, /--ly-fade-right:\s*var\(--ly-row-controls/);
});

test("a workspace checkout keeps one fade — the branch name truncates", async () => {
	const view = await readFile(new URL("src/features/git/BranchesView.tsx", root), "utf8");
	const checkout = view.slice(view.indexOf("checkouts.map"), view.indexOf("common.local"));
	assert.equal((checkout.match(/<ScrollText/g) ?? []).length, 1);
	assert.match(checkout, /truncate/);
});
