/**
 * A list that refreshes itself, and the two things that has to be true of it.
 *
 * It must not redraw what did not change — a row keeping its identity is what stops a minute
 * timer from re-rendering the whole pane forever — and it must be able to say what did. Both are
 * rules over data, and both fail silently: a broken identity check looks like nothing at all, and
 * a broken unread rule looks like a list that is merely quiet.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PullRequestDetail } from "../electron/ipc-shapes.ts";
import {
	acknowledge,
	baseline,
	mergeLists,
	pruneSeen,
	sameDetail,
	sameSeen,
	unseenOf,
} from "../src/features/pull-requests/pr-sync.ts";
import { pr } from "./pr-fixtures.ts";

test("a refresh that changed nothing hands back the very same list", () => {
	const before = [pr({ relation: "authored", number: 1 }), pr({ relation: "reviewing", number: 2 })];
	// A fresh parse of the same answer: equal in every field, identical in none.
	const after = before.map((row) => ({ ...row }));

	const merged = mergeLists(before, after);
	assert.equal(merged.items, before, "the array itself, so the component above it never re-renders");
	assert.equal(merged.touched.size, 0);
});

test("only the row that moved becomes a new object", () => {
	const before = [pr({ relation: "authored", number: 1 }), pr({ relation: "authored", number: 2 })];
	const after = [{ ...before[0] }, { ...before[1], updatedAt: "2026-08-03T00:00:00Z" }];

	const merged = mergeLists(before, after);
	assert.equal(merged.items[0], before[0], "untouched rows keep their identity, so they keep their memo");
	assert.notEqual(merged.items[1], before[1]);
	assert.deepEqual([...merged.touched], ["acct-1:kittors/lyra#2"]);
});

test("CI finishing counts as a change even though the timestamp does not move", () => {
	const before = [pr({ relation: "authored", checkState: "pending" })];
	const after = [pr({ relation: "authored", checkState: "pass" })];

	const merged = mergeLists(before, after);
	assert.deepEqual([...merged.touched], ["acct-1:kittors/lyra#1"], "the dot on the row has to redraw");
});

test("the first list is not news", () => {
	const merged = mergeLists([], [pr({ relation: "authored", number: 1 }), pr({ relation: "authored", number: 2 })]);
	assert.equal(merged.items.length, 2);
	assert.equal(merged.touched.size, 0, "a pane opening for the first time cannot highlight everything on it");
});

test("a row that arrived while you were away is highlighted", () => {
	const before = [pr({ relation: "authored", number: 1 })];
	const after = [pr({ relation: "authored", number: 1 }), pr({ relation: "reviewing", number: 9 })];

	assert.deepEqual([...mergeLists(before, after).touched], ["acct-1:kittors/lyra#9"]);
});

test("nothing is unread until something has been recorded", () => {
	const items = [pr({ relation: "authored", number: 1 })];
	assert.equal(unseenOf(items, null).size, 0, "a first run has nothing to compare against");
	assert.equal(unseenOf(items, baseline(items)).size, 0, "and the baseline it writes agrees");
});

test("a row is unread when it has moved since it was opened, and only until it is opened again", () => {
	const first = pr({ relation: "authored", number: 1, updatedAt: "2026-08-02T00:00:00Z" });
	const seen = acknowledge(baseline([first]), first);
	assert.equal(unseenOf([first], seen).size, 0);

	const commented = { ...first, updatedAt: "2026-08-05T00:00:00Z" };
	assert.deepEqual([...unseenOf([commented], seen)], ["acct-1:kittors/lyra#1"]);
	assert.equal(unseenOf([commented], acknowledge(seen, commented)).size, 0, "opening it settles it");
});

test("a pull request nobody has ever opened is unread", () => {
	const known = pr({ relation: "authored", number: 1 });
	const arrived = pr({ relation: "reviewing", number: 7 });
	assert.deepEqual([...unseenOf([known, arrived], baseline([known]))], ["acct-1:kittors/lyra#7"]);
});

test("rows that left the list are forgotten, and only those", () => {
	const kept = pr({ relation: "authored", number: 1 });
	const merged = pr({ relation: "authored", number: 2 });
	const seen = baseline([kept, merged]);

	assert.deepEqual(pruneSeen(seen, [kept]), { "acct-1:kittors/lyra#1": kept.updatedAt });
});

test("two seen maps that would draw the same marks are the same map", () => {
	const items = [pr({ relation: "authored", number: 1 })];
	assert.equal(sameSeen(baseline(items), baseline(items)), true);
	assert.equal(sameSeen(null, baseline(items)), false, "a first run is never equal to a recorded one");
	assert.equal(sameSeen(baseline(items), acknowledge(baseline(items), { ...items[0], updatedAt: "2026-09-01T00:00:00Z" })), false);
});

function detail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
	return {
		...pr({ relation: "authored" }),
		body: "why this change",
		additions: 12,
		deletions: 3,
		changedFiles: 2,
		headRefName: "fix/something",
		baseRefName: "main",
		threads: [],
		reviews: [],
		reviewers: [],
		checks: { total: 3, passed: 2, failed: 0, pending: 1, items: [] },
		mergeable: "MERGEABLE",
		labels: ["bug"],
		commits: [],
		...over,
	};
}

test("an unchanged detail is not swapped in under the reader", () => {
	assert.equal(sameDetail(detail(), detail()), true);
});

test("a check finishing changes the detail, even with the same timestamp", () => {
	const before = detail();
	const after = detail({ checks: { total: 3, passed: 3, failed: 0, pending: 0, items: [] } });
	assert.equal(sameDetail(before, after), false);
});

test("a repository that runs no checks is not the same as one whose checks all passed", () => {
	assert.equal(sameDetail(detail({ checks: null }), detail()), false);
	assert.equal(sameDetail(detail({ checks: null }), detail({ checks: null })), true);
});

test("a new comment changes the detail", () => {
	const after = detail({ comments: 1, threads: [{ author: "someone", body: "看起来不错", createdAt: "2026-08-06T00:00:00Z" }] });
	assert.equal(sameDetail(detail(), after), false);
});
