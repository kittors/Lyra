import assert from "node:assert/strict";
import { test } from "node:test";

import { litSessionIds, rowLit, rowLitFromFocus } from "../src/lib/lit-sessions.ts";

test("the focused conversation is lit", () => {
	assert.deepEqual([...litSessionIds("a", [], [])], ["a"]);
});

test("every tiled pane is lit, including ones that are not focused", () => {
	const ids = litSessionIds("a", ["a", "b"], []);
	assert.equal(ids.has("a"), true);
	assert.equal(ids.has("b"), true);
	assert.equal(ids.size, 2);
});

test("a conversation open in another window stays lit here", () => {
	const ids = litSessionIds("a", ["a"], ["c"]);
	assert.equal(ids.has("a"), true);
	assert.equal(ids.has("c"), true);
	assert.equal(ids.size, 2);
});

test("blank leaves do not invent a row", () => {
	assert.equal(litSessionIds(null, [null], []).size, 0);
});

test("a pending click lights that row and not the conversation being left", () => {
	const ids = litSessionIds("a", ["a"], [], "b");
	assert.equal(ids.has("b"), true);
	assert.equal(ids.has("a"), false);
	assert.equal(ids.size, 1);
});

test("a pending click keeps the other tiled panes lit", () => {
	const ids = litSessionIds("a", ["a", "c"], [], "b");
	assert.equal(ids.has("b"), true);
	assert.equal(ids.has("c"), true);
	assert.equal(ids.has("a"), false);
	assert.equal(ids.size, 2);
});

test("a single row agrees with the set", () => {
	assert.equal(rowLit("a", "a", false, false), true);
	assert.equal(rowLit("b", "a", false, false), false);
	assert.equal(rowLit("b", "a", true, false), true);
	assert.equal(rowLit("a", "a", true, false, "b"), false);
	assert.equal(rowLit("b", "a", false, false, "b"), true);
	assert.equal(rowLit("c", "a", true, false, "b"), true);
	assert.equal(rowLit("a", "a", false, true, "b"), true);
	assert.equal(rowLitFromFocus("on", false, false), true);
	assert.equal(rowLitFromFocus("leaving", true, false), false);
	assert.equal(rowLitFromFocus("leaving", false, true), true);
	assert.equal(rowLitFromFocus("off", true, false), true);
	assert.equal(rowLitFromFocus("off", false, false), false);
	assert.equal(rowLitFromFocus("off", true, false, true), false);
	assert.equal(rowLitFromFocus("off", false, true, true), true);
});

test("a stale focused leaf does not relight after pending clears", () => {
	const ids = litSessionIds("b", ["a"], [], null, "a");
	assert.equal(ids.has("b"), true);
	assert.equal(ids.has("a"), false);
	assert.equal(rowLit("a", "b", true, false, null, "a"), false);
	assert.equal(rowLit("b", "b", false, false, null, "a"), true);
	assert.equal(rowLit("c", "b", true, false, null, "a"), true);
});
