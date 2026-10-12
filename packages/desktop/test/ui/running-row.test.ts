/**
 * The 「运行中」 row folds away with its content still in it.
 *
 * Its `data-open` and its content used to be one condition, so a turn that ended without an answer
 * (only tools, stopped, failed) or a compaction starting emptied the row in the frame its fold began:
 * nothing was left to animate, and a transcript pinned to the bottom lost the row's height at once.
 * happy-dom runs no transitions, so the tests deliver the `transitionend` the fold would end with.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { RunningRow } from "../../src/features/conversation/RunningRow.tsx";
import { fire, mount } from "../helpers/mount.ts";

/** happy-dom's `TransitionEvent` drops `propertyName` from its init, so it is put on by hand. */
function foldEnds(row: Element, propertyName: string) {
	const event = new Event("transitionend", { bubbles: true });
	Object.defineProperty(event, "propertyName", { value: propertyName });
	return fire(row, event);
}

test("a turn that ends without an answer folds the row with the indicator still in it", async () => {
	const view = await mount(h(RunningRow, { running: true, answering: false, compacting: false }));
	try {
		const row = view.find(".ly-reveal");
		assert.equal(row.dataset.open, "true");
		assert.ok(view.host.querySelector("[data-ly-running]"), "the indicator shows while the turn runs");

		await view.rerender(h(RunningRow, { running: false, answering: false, compacting: false }));
		assert.equal(row.dataset.open, "false", "the fold starts at once");
		assert.ok(view.host.querySelector("[data-ly-running]"), "emptied in the frame the fold began");

		await foldEnds(row, "opacity");
		assert.ok(view.host.querySelector("[data-ly-running]"), "the fade ending is not the fold ending");
		await foldEnds(row, "grid-template-rows");
		assert.ok(!view.host.querySelector("[data-ly-running]"), "kept after the fold had finished");
	} finally {
		await view.unmount();
	}
});

test("a compaction starting folds the row the same way", async () => {
	const view = await mount(h(RunningRow, { running: true, answering: false, compacting: false }));
	try {
		await view.rerender(h(RunningRow, { running: true, answering: false, compacting: true }));
		const row = view.find(".ly-reveal");
		assert.equal(row.dataset.open, "false");
		assert.ok(view.host.querySelector("[data-ly-running]"));
		await foldEnds(row, "grid-template-rows");
		assert.ok(!view.host.querySelector("[data-ly-running]"));
	} finally {
		await view.unmount();
	}
});

test("the answer arriving still folds it at once, and keeps it for when the answer pauses", async () => {
	const view = await mount(h(RunningRow, { running: true, answering: false, compacting: false }));
	try {
		await view.rerender(h(RunningRow, { running: true, answering: true, compacting: false }));
		const row = view.find(".ly-reveal");
		assert.equal(row.dataset.open, "false");
		assert.equal(row.style.transition, "none", "the deliberate instant fold");
		assert.ok(view.host.querySelector("[data-ly-running]"), "still there to unfold when the answer pauses");

		// The turn then ends: nothing to fold, and nothing left behind with no transitionend to release it.
		await view.rerender(h(RunningRow, { running: false, answering: false, compacting: false }));
		assert.ok(!view.host.querySelector("[data-ly-running]"), "an indicator stayed mounted after the turn");
	} finally {
		await view.unmount();
	}
});
