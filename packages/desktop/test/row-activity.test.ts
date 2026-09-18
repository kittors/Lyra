import assert from "node:assert/strict";
import { test } from "node:test";

import { rowActivity, sideChatRunning } from "../src/lib/row-activity.ts";

test("an idle row breathes when its side chat is running", () => {
	assert.equal(rowActivity(null, true, false), "running");
	assert.equal(rowActivity(null, true, true), "running");
});

test("a side chat does not invent an unread result after it stops", () => {
	assert.equal(rowActivity(null, false, false), null);
	assert.equal(rowActivity("done", false, true), null);
});

test("the main turn still wins while it is running or waiting", () => {
	assert.equal(rowActivity("waiting", true, false), "waiting");
	assert.equal(rowActivity("running", true, true), "running");
});

test("an unread main result yields to a live side chat", () => {
	assert.equal(rowActivity("done", true, false), "running");
	assert.equal(rowActivity("failed", true, false), "running");
});

test("sideChatRunning reads the attached pane, then the cache", () => {
	assert.equal(sideChatRunning({ sessionId: "a", running: true, sessionCache: {} }, "a"), true);
	assert.equal(sideChatRunning({ sessionId: "a", running: false, sessionCache: {} }, "a"), false);
	assert.equal(
		sideChatRunning({ sessionId: "a", running: false, sessionCache: { b: { running: true } } }, "b"),
		true,
	);
	assert.equal(sideChatRunning({ sessionId: "a", running: true, sessionCache: {} }, "b"), false);
});
