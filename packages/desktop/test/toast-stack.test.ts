/**
 * How a stack of toasts behaves when there is more than one.
 *
 * One toast is easy and needs no test. The claims worth pinning down are all about several: that
 * the same message twice is one card and not two, that a repeat does not make the column reshuffle
 * under the pointer, and that a burst is capped on screen without silently queueing behind what is
 * visible.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	groupNotices,
	TOAST_LIFETIME,
	TOAST_LIMIT,
	TOAST_Z,
	visibleToasts,
	type Notice,
} from "../src/features/toast/stack.ts";

const notice = (id: string, message: string, level: Notice["level"] = "error"): Notice => ({ id, level, message });

test("distinct messages are distinct cards, in the order they arrived", () => {
	const groups = groupNotices([notice("1", "甲"), notice("2", "乙"), notice("3", "丙")]);
	assert.deepEqual(
		groups.map((g) => g.message),
		["甲", "乙", "丙"],
	);
	assert.ok(
		groups.every((g) => g.ids.length === 1),
		"nothing was merged that should not be",
	);
});

test("the same message twice is one card that counts", () => {
	// Deleting five files that all fail the same way should say it once, not five times.
	const groups = groupNotices([notice("1", "删除失败"), notice("2", "删除失败"), notice("3", "删除失败")]);
	assert.equal(groups.length, 1);
	assert.deepEqual(groups[0].ids, ["1", "2", "3"], "every notice is kept, so dismissing clears them all");
});

test("the same words at different levels are different cards", () => {
	const groups = groupNotices([notice("1", "同一句话", "warn"), notice("2", "同一句话", "error")]);
	assert.equal(groups.length, 2, "a warning and a failure are not the same event");
});

test("a repeat keeps the card where it was", () => {
	/*
	 * The reason: promoting a repeated message to the end slides the whole column up at the exact
	 * moment somebody is reaching for the close button of the card below it.
	 */
	const groups = groupNotices([notice("1", "甲"), notice("2", "乙"), notice("3", "甲")]);
	assert.deepEqual(
		groups.map((g) => g.message),
		["甲", "乙"],
	);
	assert.deepEqual(groups[0].ids, ["1", "3"]);
});

test("only the newest few are drawn, and the rest are not lost", () => {
	const many = Array.from({ length: 7 }, (_, i) => notice(String(i), `第 ${i} 条`));
	const groups = groupNotices(many);
	assert.equal(groups.length, 7, "grouping keeps them all — their clocks are still running");

	const shown = visibleToasts(groups);
	assert.equal(shown.length, TOAST_LIMIT);
	assert.deepEqual(
		shown.map((g) => g.message),
		["第 4 条", "第 5 条", "第 6 条"],
		"the newest, since those are the ones still worth reading",
	);
});

test("a stack shorter than the limit is shown whole", () => {
	const groups = groupNotices([notice("1", "甲"), notice("2", "乙")]);
	assert.deepEqual(visibleToasts(groups), groups);
});

test("nothing in, nothing out", () => {
	assert.deepEqual(groupNotices([]), []);
	assert.deepEqual(visibleToasts([]), []);
});

test("every level has a lifetime, and errors are given longer than chatter", () => {
	for (const level of ["info", "warn", "error"] as const) {
		assert.ok(TOAST_LIFETIME[level] > 0, `${level} has no lifetime`);
	}
	assert.ok(TOAST_LIFETIME.error > TOAST_LIFETIME.info, "a failure should outlast progress chatter");
});

test("toasts sit above every other layer on screen, ours and not ours", () => {
	// 120 is the image annotator's toolbar — the highest the app itself draws at. 200 is
	// CodeMirror's gutters, which is the reminder that the app does not number every layer here.
	assert.ok(TOAST_Z > 120, `toasts are at ${TOAST_Z}, which the app's own layers can cover`);
	assert.ok(TOAST_Z > 200, `toasts are at ${TOAST_Z}, which CodeMirror's own layers can cover`);
});
