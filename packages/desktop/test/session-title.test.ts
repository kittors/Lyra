/**
 * What a conversation is called before the runtime has named it.
 *
 * The risk here is over-reach: the placeholder is an ordinary string, and a user whose first
 * message happens to be about starting a new session must not have their title replaced by the
 * word the placeholder happens to use.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionTitle } from "../src/lib/session-title.ts";

test("the placeholder becomes the interface's own word for it", () => {
	assert.equal(sessionTitle("New session"), "新对话");
	assert.equal(sessionTitle("New Session"), "新对话");
	assert.equal(sessionTitle("Untitled"), "新对话");
});

test("nothing at all is the same case", () => {
	assert.equal(sessionTitle(""), "新对话");
	assert.equal(sessionTitle("   "), "新对话");
	assert.equal(sessionTitle(null), "新对话");
	assert.equal(sessionTitle(undefined), "新对话");
});

test("a real title is left exactly as it was stored", () => {
	assert.equal(sessionTitle("帮我梳理这个项目的整体架构"), "帮我梳理这个项目的整体架构");
	assert.equal(sessionTitle("fix the flaky test"), "fix the flaky test");
});

test("a title that merely mentions the placeholder is a real title", () => {
	// Somebody's actual first message. Rewriting it would be replacing what they wrote.
	assert.equal(sessionTitle("New session button does nothing"), "New session button does nothing");
	assert.equal(sessionTitle("Untitled documents keep piling up"), "Untitled documents keep piling up");
});
