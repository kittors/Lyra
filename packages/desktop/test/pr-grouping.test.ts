/**
 * Which pull requests appear, and under which heading.
 *
 * The list answers "what is waiting on me", and that answer is built from three overlapping
 * searches. The rules for turning them into one list are the sort that look obvious until they
 * are wrong: a filter that a search can undo, a group that keeps a row it no longer matches.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { groupFor } from "../src/features/pull-requests/pr-groups.ts";
import { pr } from "./pr-fixtures.ts";

test("groups come in the order they need attention", () => {
	const groups = groupFor(
		[pr({ relation: "reviewed", number: 3 }), pr({ relation: "authored", number: 2 }), pr({ relation: "reviewing", number: 1 })],
		"all",
		"",
	);
	assert.deepEqual(
		groups.map((g) => g.key),
		["reviewing", "authored", "reviewed"],
		"what is asked of you comes before what you are waiting on",
	);
});

test("an empty group is not a heading with nothing under it", () => {
	const groups = groupFor([pr({ relation: "authored" })], "all", "");
	assert.deepEqual(
		groups.map((g) => g.key),
		["authored"],
	);
});

test("the filter narrows to one relation", () => {
	const items = [pr({ relation: "authored", number: 1 }), pr({ relation: "reviewing", number: 2 })];
	assert.deepEqual(
		groupFor(items, "authored", "").flatMap((g) => g.items.map((i) => i.number)),
		[1],
	);
	assert.deepEqual(
		groupFor(items, "reviewing", "").flatMap((g) => g.items.map((i) => i.number)),
		[2],
	);
});

test("search matches the title, the repository, the author, the branch and the number", () => {
	const items = [
		pr({ relation: "authored", number: 11, title: "fix: guard against empty name" }),
		pr({ relation: "authored", number: 12, repo: "farion1231/cc-switch", title: "feat: catalog" }),
		pr({ relation: "authored", number: 13, author: "spock-wen", title: "chore: bump" }),
		pr({ relation: "authored", number: 14, headRefName: "dependabot/github_actions/actions", title: "bump" }),
	];
	const numbers = (query: string) => groupFor(items, "all", query).flatMap((g) => g.items.map((i) => i.number));

	assert.deepEqual(numbers("guard"), [11], "by title");
	assert.deepEqual(numbers("cc-switch"), [12], "by repository");
	assert.deepEqual(numbers("spock"), [13], "by author");
	assert.deepEqual(numbers("github_actions"), [14], "by branch, which is what you have in hand from a terminal");
	assert.deepEqual(numbers("#12"), [12], "by number");
});

test("a row with no branch is still searchable by everything else", () => {
	// Rows restored from a cache written before the search carried branches have none.
	const items = [pr({ relation: "authored", number: 21, headRefName: null, title: "unique-token" })];
	assert.equal(groupFor(items, "all", "unique-token").length, 1);
});

test("search cannot resurrect a row the filter excluded", () => {
	/*
	 * The order matters: filter first, then search. Searching the whole list and then filtering
	 * would show a pull request under "由我创建" that someone else wrote.
	 */
	const items = [pr({ relation: "reviewing", number: 1, title: "unique-token" }), pr({ relation: "authored", number: 2 })];
	assert.deepEqual(groupFor(items, "authored", "unique-token"), []);
});

test("search is case-insensitive and ignores surrounding space", () => {
	const items = [pr({ relation: "authored", title: "Fix: Guard" })];
	assert.equal(groupFor(items, "all", "  guard ").length, 1);
});
