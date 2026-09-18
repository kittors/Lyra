/**
 * Every branch name uses the same small pad. The fade token follows the button
 * count. A reserved `pr-14` / `pr-20` was the empty gutter.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { BranchRow } from "../../src/features/git/BranchRow.tsx";
import { hoverSlot } from "../../src/ui/row/HoverRow.tsx";
import { mount } from "../helpers/mount.ts";

const long = "origin/dependabot/npm_and_yarn/packages/desktop/electron-builder";

test("一颗按钮按会话行一颗的让位，三颗按三颗，条本身不拉宽", async () => {
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
		assert.match(nameOne.className, /\bpr-1\.5\b/);
		assert.equal(nameOne.className, nameThree.className);
		assert.doesNotMatch(nameOne.className, /pr-14|pr-20|pr-8\b/);
		assert.equal(hoverSlot(1), "28px");
		assert.equal(hoverSlot(2), "48px");
		assert.equal(hoverSlot(3), "68px");
		assert.equal(nameOne.parentElement?.style.getPropertyValue("--ly-row-controls"), "28px");
		assert.equal(nameThree.parentElement?.style.getPropertyValue("--ly-row-controls"), "68px");

		const strip = three.find("[data-ly-hover-reveal]");
		assert.match(strip.className, /\babsolute\b/);
		assert.equal(strip.style.width, "");

		const markOne = one.find("[data-ly-row-mark]");
		const markThree = three.find("[data-ly-row-mark]");
		assert.equal(markOne.className, markThree.className);
	} finally {
		await one.unmount();
		await three.unmount();
	}
});
