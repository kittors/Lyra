import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, SessionStorage } from "@lyra/core";
import { findUserImagesAt, loadUserImagesAt, readUserImagesAt } from "../electron/display-image.ts";

const photo = (data: string, timestamp: number): Message => ({
	role: "user",
	content: [{ type: "image", mimeType: "image/png", data }],
	timestamp,
});

test("findUserImagesAt keeps the last user message at that timestamp", () => {
	const images = findUserImagesAt([photo("first", 1), photo("second", 1), photo("other", 2)], 1);
	assert.equal(images.length, 1);
	assert.equal(images[0]?.data, "second");
});

test("readUserImagesAt drops a truncated message", async () => {
	const read: SessionStorage["read"] = async function* () {
		yield { seq: 1, ts: 1, type: "message", message: photo("keep", 10) };
		yield { seq: 2, ts: 2, type: "message", message: photo("gone", 11) };
		yield { seq: 3, ts: 3, type: "truncate", afterSeq: 1 };
	};
	assert.equal((await readUserImagesAt(read, "p", "s", 11)).length, 0);
	assert.equal((await readUserImagesAt(read, "p", "s", 10))[0]?.data, "keep");
});

test("loadUserImagesAt prefers the live session and does not read the log", async () => {
	let reads = 0;
	const read: SessionStorage["read"] = async function* () {
		reads += 1;
		yield { seq: 1, ts: 1, type: "message", message: photo("disk", 1) };
	};
	const images = await loadUserImagesAt(
		{ liveMessages: () => [photo("live", 1)], read },
		"p",
		"s",
		1,
	);
	assert.equal(images[0]?.data, "live");
	assert.equal(reads, 0);
});
