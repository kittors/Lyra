/**
 * Ctrl+Tab and Ctrl+Shift+Tab walk the conversations by recency, the sidebar's recent order.
 * Opening one does not change it, so pressing again keeps walking rather than bouncing between two.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionMeta } from "@lyra/core";
import { stepInRecency } from "../src/features/split/recency.ts";

const meta = (id: string, updatedAt: number, archived = false) => ({ id, updatedAt, archived }) as SessionMeta;
const sessions = [meta("old", 1), meta("newest", 30), meta("middle", 20), meta("filed", 25, true)];

test("Ctrl+Tab goes to the next older conversation and wraps", () => {
	assert.equal(stepInRecency(sessions, "newest", 1)?.id, "middle");
	assert.equal(stepInRecency(sessions, "middle", 1)?.id, "old");
	assert.equal(stepInRecency(sessions, "old", 1)?.id, "newest");
});

test("Ctrl+Shift+Tab goes the other way", () => {
	assert.equal(stepInRecency(sessions, "newest", -1)?.id, "old");
	assert.equal(stepInRecency(sessions, "old", -1)?.id, "middle");
});

test("archived conversations are not walked into", () => {
	for (const from of ["newest", "middle", "old"]) assert.notEqual(stepInRecency(sessions, from, 1)?.id, "filed");
});

test("from no conversation, the most recent; with only one, nowhere to go", () => {
	assert.equal(stepInRecency(sessions, null, 1)?.id, "newest");
	assert.equal(stepInRecency([meta("only", 1)], "only", 1), null);
	assert.equal(stepInRecency([], null, 1), null);
});
