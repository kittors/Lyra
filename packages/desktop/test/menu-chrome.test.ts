/**
 * Menu cards share one radius and one even inset.
 *
 * An 8px card and 6px rows (`rounded-lg` /
 * `rounded-md`). Both have to stay in the tokens, not as a number at a
 * call site.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("menu cards share one radius and one even inset", async () => {
	const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
	const scroll = await readFile(new URL("../src/styles/scroll.css", import.meta.url), "utf8");
	const misc = await readFile(new URL("../src/styles/misc.css", import.meta.url), "utf8");
	assert.match(tokens, /--radius-menu:\s*8px/);
	assert.match(tokens, /--ly-menu-inset:\s*4px/);
	assert.match(tokens, /--radius-item:\s*6px/);
	assert.match(tokens, /--ly-menu-row:\s*32px/);
	assert.match(scroll, /margin:\s*var\(--ly-menu-inset\)/);
	assert.doesNotMatch(scroll, /margin-right:\s*4px/);
	assert.match(misc, /\.ly-menu-card \.ly-item \{[\s\S]*?border-radius:\s*var\(--radius-item\)/);
	// The rows under a menu's divider (`MenuFooter`) take the same gutter as the list above them.
	assert.match(scroll, /\.ly-menu-foot \{\s*padding:\s*var\(--ly-menu-inset\)/);
});
