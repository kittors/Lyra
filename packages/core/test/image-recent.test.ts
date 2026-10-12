/**
 * What `#1`, `#2` mean to `image_generate`: the order of the pictures in a conversation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationPictures } from "../src/images/recent.ts";
import { IMAGE_TOOL_NAME, type ImagePointer } from "../src/images/types.ts";
import type { Message } from "../src/types/message.ts";

const asked = (text: string): Message => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });

const drew = (media: string): Message => ({
	role: "toolResult",
	toolCallId: `call_${media}`,
	toolName: IMAGE_TOOL_NAME,
	content: [{ type: "text", text: "Saved." }],
	details: { images: [{ media, mimeType: "image/jpeg" }] },
	isError: false,
	timestamp: 2,
});

const attached = (media: string, text: string): Message => ({
	role: "user",
	content: [{ type: "text", text }, { type: "image", data: "", media, mimeType: "image/png" }],
	timestamp: 3,
});

const order = (pictures: ImagePointer[]) => pictures.map((picture) => picture.media);

test("a drawing from an earlier turn does not stay ahead of a picture attached since", () => {
	// The session's scratch list still names the dog drawn turns ago; the transcript has it too.
	const transcript = [asked("draw a puppy"), drew("dog.jpg"), attached("marked.png", "redraw what I circled")];
	assert.deepEqual(order(conversationPictures(transcript, [{ media: "dog.jpg", mimeType: "image/jpeg" }])), ["marked.png", "dog.jpg"]);
});

test("a picture drawn this turn, not in the transcript yet, is #1", () => {
	const transcript = [asked("draw a puppy"), drew("dog.jpg"), attached("marked.png", "redraw what I circled")];
	const drawn = [{ media: "flower.jpg", mimeType: "image/jpeg" }, { media: "dog.jpg", mimeType: "image/jpeg" }];
	assert.deepEqual(order(conversationPictures(transcript, drawn)), ["flower.jpg", "marked.png", "dog.jpg"]);
});
