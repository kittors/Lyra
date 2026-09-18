/**
 * A 1-button row and a 3-button row must stop the name at the same place at rest.
 * Reserving padding for icons is what left those empty boxes on the right.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { BranchRow } from "../../src/features/git/BranchRow.tsx";
import { mount } from "../helpers/mount.ts";

const long = "origin/dependabot/npm_and_yarn/packages/desktop/electron-builder";

test("分支名铺满一行，图标不占位", async () => {
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
		assert.doesNotMatch(nameOne.className, /\bpr-/);
		assert.doesNotMatch(nameThree.className, /\bpr-/);
		assert.equal(nameOne.className, nameThree.className);

		const strip = three.find("[data-ly-hover-reveal]");
		assert.match(strip.className, /\babsolute\b/);
		assert.match(nameThree.parentElement?.getAttribute("style") ?? "", /--ly-row-controls:\s*76px/);
		assert.match(nameOne.parentElement?.getAttribute("style") ?? "", /--ly-row-controls:\s*28px/);
	} finally {
		await one.unmount();
		await three.unmount();
	}
});
