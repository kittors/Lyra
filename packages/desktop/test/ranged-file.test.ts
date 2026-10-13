/**
 * Video served the way `<video>` can seek in: a Range request gets those bytes and a 206, every answer
 * says ranges are taken. `net.fetch(file://)` answered all of it with the whole file and a 200, and a
 * source like that has `seekable` [0, 0] — every drag of the scrubber went back to the first frame.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { byteRange, serveRanged } from "../electron/ranged-file.ts";

const BYTES = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);

async function clip(): Promise<{ path: string; done: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-ranged-"));
	const path = join(dir, "clip.mp4");
	await writeFile(path, BYTES);
	return { path, done: () => rm(dir, { recursive: true, force: true }) };
}

const ask = (range?: string, method = "GET") => new Request("ly-media://m/clip.mp4", { method, headers: range ? { range } : {} });

test("a range is those bytes, as a 206 that says which part of how much", async () => {
	const { path, done } = await clip();
	try {
		const answer = await serveRanged(path, ask("bytes=100-199"), "video/mp4");
		assert.equal(answer.status, 206);
		assert.equal(answer.headers.get("content-range"), "bytes 100-199/1000");
		assert.equal(answer.headers.get("content-length"), "100");
		assert.equal(answer.headers.get("accept-ranges"), "bytes");
		assert.equal(answer.headers.get("content-type"), "video/mp4");
		assert.deepEqual(new Uint8Array(await answer.arrayBuffer()), BYTES.slice(100, 200));
	} finally {
		await done();
	}
});

test("the first request, with no range, is the whole file — and already says ranges are taken", async () => {
	const { path, done } = await clip();
	try {
		const answer = await serveRanged(path, ask(), "video/mp4");
		assert.equal(answer.status, 200);
		assert.equal(answer.headers.get("accept-ranges"), "bytes");
		assert.equal(answer.headers.get("content-length"), "1000");
		assert.equal((await answer.arrayBuffer()).byteLength, 1000);
	} finally {
		await done();
	}
});

test("open-ended and suffix ranges, a range past the end, and a file that is not there", async () => {
	const { path, done } = await clip();
	try {
		const tail = await serveRanged(path, ask("bytes=900-"), "video/mp4");
		assert.equal(tail.headers.get("content-range"), "bytes 900-999/1000");
		assert.deepEqual(new Uint8Array(await tail.arrayBuffer()), BYTES.slice(900));
		const last = await serveRanged(path, ask("bytes=-10"), "video/mp4");
		assert.equal(last.headers.get("content-range"), "bytes 990-999/1000");
		const beyond = await serveRanged(path, ask("bytes=5000-"), "video/mp4");
		assert.equal(beyond.status, 416);
		assert.equal(beyond.headers.get("content-range"), "bytes */1000");
		assert.equal((await serveRanged(`${path}.gone`, ask("bytes=0-1"), "video/mp4")).status, 404);
	} finally {
		await done();
	}
});

test("only the one-range form a media element sends is read as a range", () => {
	assert.deepEqual(byteRange("bytes=0-0", 10), { start: 0, end: 0 });
	assert.deepEqual(byteRange("bytes=5-999", 10), { start: 5, end: 9 }, "an end past the file stops at its last byte");
	assert.equal(byteRange("bytes=0-1,4-5", 10), null, "several ranges: the whole file");
	assert.equal(byteRange("items=0-1", 10), null);
	assert.equal(byteRange("bytes=-", 10), null);
	assert.equal(byteRange(null, 10), null);
	assert.equal(byteRange("bytes=7-3", 10), "unsatisfiable");
});
