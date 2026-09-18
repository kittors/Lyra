/**
 * A 1-button row and a 3-button row stop the name at the same place.
 * The leading glyph shares one box with the worktree folder beside it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { BranchRow } from "../../src/features/git/BranchRow.tsx";
import { GIT_CONTROLS } from "../../src/ui/row/HoverRow.tsx";
import { mount } from "../helpers/mount.ts";

const long = "origin/dependabot/npm_and_yarn/packages/desktop/electron-builder";

test("分支名停在同一条让位线上，图标不占另一列", async () => {
	const one = await mount(
		h(BranchRow, { name: long, current: false, busy: false, onSwitch: () => {} }),
	);
	const three = await mount(
		h(BranchRow, {
			name: long,
			current: false,
			busy: false,
			onSwitch: () => {},
			onCompare: () => {},
			onDelete: () => {},
		}),
	);
	try {
		const nameOne = one.find("[data-ly-branch-name]");
		const nameThree = three.find("[data-ly-branch-name]");
		assert.equal(nameOne.style.paddingRight, "var(--ly-row-controls)");
		assert.equal(nameThree.style.paddingRight, "var(--ly-row-controls)");
		assert.equal(nameOne.className, nameThree.className);

		const rowOne = nameOne.closest("[data-ly-hover-row]");
		const rowThree = nameThree.closest("[data-ly-hover-row]");
		assert.match(rowOne?.getAttribute("style") ?? "", new RegExp(`--ly-row-controls:\\s*${GIT_CONTROLS}px`));
		assert.match(rowThree?.getAttribute("style") ?? "", new RegExp(`--ly-row-controls:\\s*${GIT_CONTROLS}px`));

		const markOne = one.find("[data-ly-row-mark]");
		const markThree = three.find("[data-ly-row-mark]");
		assert.equal(markOne.className, markThree.className);

		const strip = three.find("[data-ly-hover-reveal]");
		assert.match(strip.className, /\babsolute\b/);
		assert.equal(strip.style.width, "var(--ly-row-controls)");
	} finally {
		await one.unmount();
		await three.unmount();
	}
});
