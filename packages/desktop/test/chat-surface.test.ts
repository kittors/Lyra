import assert from "node:assert/strict";
import { test } from "node:test";
import { chatSurface } from "../src/lib/chat-surface.ts";

test("a cold historical session with no messages yet is the skeleton, not the transcript", () => {
	assert.equal(chatSurface({ messages: 0, loading: true }), "skeleton");
});

test("messages already in memory paint the conversation even while a refresh is in flight", () => {
	assert.equal(chatSurface({ messages: 12, loading: true }), "conversation");
});

test("a blank new session is empty, not a loading stand-in", () => {
	assert.equal(chatSurface({ messages: 0, loading: false }), "empty");
});
