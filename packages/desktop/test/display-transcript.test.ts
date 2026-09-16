import assert from "node:assert/strict";
import { test } from "node:test";
import { DISPLAY_TEXT_CHARS, slimMessagesForDisplay } from "../electron/display-transcript.ts";
import type { Message } from "@lyra/core";

test("oversized tool results are cut for display and small ones keep their identity", () => {
	const small: Message = {
		role: "toolResult",
		toolCallId: "t1",
		toolName: "grep",
		isError: false,
		content: [{ type: "text", text: "few lines" }],
		timestamp: 1,
	};
	const huge: Message = {
		role: "toolResult",
		toolCallId: "t2",
		toolName: "grep",
		isError: false,
		content: [{ type: "text", text: "x".repeat(DISPLAY_TEXT_CHARS + 8_000) }],
		timestamp: 1,
	};
	const slimmed = slimMessagesForDisplay([small, huge]);
	assert.equal(slimmed[0], small);
	assert.notEqual(slimmed[1], huge);
	assert.ok(slimmed[1].role === "toolResult" && slimmed[1].content[0].type === "text");
	const text = slimmed[1].role === "toolResult" && slimmed[1].content[0].type === "text" ? slimmed[1].content[0].text : "";
	const original = huge.role === "toolResult" && huge.content[0].type === "text" ? huge.content[0].text.length : 0;
	assert.ok(text.length < original);
	assert.match(text, /omitted for display/);
});
