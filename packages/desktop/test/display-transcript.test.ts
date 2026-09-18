import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DISPLAY_TEXT_CHARS, slimMessagesForDisplay, slimSnapshot } from "../electron/display-transcript.ts";
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

test("oversized inline images are stripped from the display copy", () => {
	const photo: Message = {
		role: "user",
		content: [{ type: "image", mimeType: "image/png", data: "a".repeat(12_000) }],
		timestamp: 1,
	};
	const icon: Message = {
		role: "user",
		content: [{ type: "image", mimeType: "image/png", data: "icon" }],
		timestamp: 2,
	};
	const slimmed = slimMessagesForDisplay([photo, icon]);
	assert.notEqual(slimmed[0], photo);
	assert.equal(slimmed[1], icon);
	assert.ok(slimmed[0].role === "user" && slimmed[0].content[0].type === "image");
	assert.equal(slimmed[0].role === "user" && slimmed[0].content[0].type === "image" ? slimmed[0].content[0].data : "x", "");
	assert.ok(slimmed[0].role === "user" && slimmed[0].content[0].type === "image" && slimmed[0].content[0].media);
	assert.equal(slimmed[1].role === "user" && slimmed[1].content[0].type === "image" ? slimmed[1].content[0].data : "", "icon");
});

test("slimSnapshot parks oversized images so the window has a file pointer", () => {
	const home = mkdtempSync(join(tmpdir(), "lyra-slim-"));
	const previous = process.env.LYRA_HOME;
	process.env.LYRA_HOME = home;
	try {
		const slimmed = slimSnapshot({
			messages: [
				{
					role: "user" as const,
					content: [{ type: "image" as const, mimeType: "image/png", data: "a".repeat(12_000) }],
					timestamp: 1,
				},
			],
		});
		const image = slimmed.messages[0]?.role === "user" ? slimmed.messages[0].content[0] : undefined;
		assert.ok(image?.type === "image" && image.media);
		assert.equal(existsSync(join(home, "session-media", image.media)), true);
	} finally {
		if (previous === undefined) delete process.env.LYRA_HOME;
		else process.env.LYRA_HOME = previous;
	}
});

test("a multi-megabyte block slims without walking every code point", () => {
	const huge = {
		role: "toolResult" as const,
		toolCallId: "t3",
		toolName: "grep",
		isError: false,
		content: [{ type: "text" as const, text: "x".repeat(2_000_000) }],
		timestamp: 1,
	};
	const started = performance.now();
	const slimmed = slimMessagesForDisplay([huge]);
	const elapsed = performance.now() - started;
	assert.ok(slimmed[0] !== huge);
	assert.ok(elapsed < 50, `slimmed a 2 MB block in ${elapsed.toFixed(1)}ms`);
});
