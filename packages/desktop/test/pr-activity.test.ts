/**
 * Weaving reviews and comments into one timeline.
 *
 * GitHub returns them as two lists because they are two API objects. They are not two things to
 * read: a review that answers the comment above it belongs under that comment, and split apart
 * the reader has to interleave two timestamped lists by hand. Worth a test because the failure is
 * quiet — every entry is present and correct, in an order that just happens to be wrong.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { activityOf } from "../src/features/pull-requests/activity.ts";

const at = (iso: string) => new Date(iso).toISOString();

test("reviews and comments interleave by time, not by kind", () => {
	const entries = activityOf({
		reviews: [
			{ author: "ana", state: "APPROVED", body: "看起来不错", submittedAt: at("2026-03-02T10:00:00Z") },
			{ author: "ana", state: "COMMENTED", body: "再看一眼", submittedAt: at("2026-03-04T10:00:00Z") },
		],
		threads: [
			{ author: "bo", body: "这里为什么要 guard", createdAt: at("2026-03-01T10:00:00Z") },
			{ author: "bo", body: "改好了", createdAt: at("2026-03-03T10:00:00Z") },
		],
	} as never);

	assert.deepEqual(
		entries.map((e) => e.body),
		["这里为什么要 guard", "看起来不错", "改好了", "再看一眼"],
	);
});

test("oldest first, because a conversation is read downwards", () => {
	const entries = activityOf({
		reviews: [],
		threads: [
			{ author: "a", body: "第二", createdAt: at("2026-03-05T00:00:00Z") },
			{ author: "a", body: "第一", createdAt: at("2026-03-01T00:00:00Z") },
		],
	} as never);

	assert.deepEqual(
		entries.map((e) => e.body),
		["第一", "第二"],
	);
});

test("a review carries its verdict; a comment has none", () => {
	const [review, comment] = activityOf({
		reviews: [{ author: "ana", state: "APPROVED", body: "ok", submittedAt: at("2026-03-01T00:00:00Z") }],
		threads: [{ author: "bo", body: "hm", createdAt: at("2026-03-02T00:00:00Z") }],
	} as never);

	assert.equal(review.verdict, "已批准");
	assert.equal(comment.verdict, undefined);
});

test("entries keep distinct keys across the two sources", () => {
	// Both lists are indexed from zero, so keying on the index alone collides on the first of each
	// — and React would then reuse one row's open state for the other.
	const entries = activityOf({
		reviews: [{ author: "a", state: "COMMENTED", body: "r", submittedAt: at("2026-03-01T00:00:00Z") }],
		threads: [{ author: "b", body: "c", createdAt: at("2026-03-02T00:00:00Z") }],
	} as never);

	assert.equal(new Set(entries.map((e) => e.key)).size, entries.length);
});

test("nothing at all is an empty timeline, not a crash", () => {
	assert.deepEqual(activityOf({ reviews: [], threads: [] } as never), []);
});

test("commits and the opening join the same timeline, in time order", () => {
	/*
	 * What was pushed and what was said about it are the two halves of a review. Before commits
	 * were included, the timeline showed opinions about a change it never showed.
	 */
	const entries = activityOf({
		author: "kittors",
		createdAt: at("2026-03-01T00:00:00Z"),
		commits: [
			{ sha: "c1adc75", headline: "fix(tun): prevent DNS loop", author: "kittors", at: at("2026-03-02T00:00:00Z") },
		],
		reviews: [],
		threads: [{ author: "bot", body: "分析", createdAt: at("2026-03-03T00:00:00Z") }],
	} as never);

	assert.deepEqual(
		entries.map((e) => e.kind),
		["opened", "commit", "comment"],
	);
	assert.equal(entries[1].sha, "c1adc75");
});

test("a commit with no date is dropped rather than sorted to 1970", () => {
	// `new Date("")` is NaN; sorting on it puts the row in an arbitrary place, which reads as the
	// timeline being wrong rather than as one commit being odd.
	const entries = activityOf({
		commits: [{ sha: "aaa", headline: "no date", author: "x", at: "" }],
		reviews: [],
		threads: [{ author: "b", body: "c", createdAt: at("2026-03-02T00:00:00Z") }],
	} as never);

	assert.deepEqual(
		entries.map((e) => e.kind),
		["comment"],
	);
});

test("without an author or a date there is no opening row", () => {
	// The summary caches an older shape; a row saying "undefined 打开了此 Pull Request" is worse
	// than no row.
	const entries = activityOf({ reviews: [], threads: [] } as never);
	assert.deepEqual(entries, []);
});
