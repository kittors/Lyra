/**
 * Files from the phone: written as they arrive, resumable after a cut, and only ever turned into a
 * path by the desktop itself.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, test, type TestContext } from "node:test";
import { MAX_UPLOAD_BYTES, safeFileName, UploadLink, UploadStore } from "../electron/sync-uploads.ts";
import { initialPrompt, promptOptions } from "../electron/prompt-input.ts";

async function store(t: TestContext): Promise<UploadStore> {
	const root = await mkdtemp(join(tmpdir(), "lyra-uploads-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	return new UploadStore(root);
}

/** Links a test opened, released after it as a closed connection would be — no file handle left open. */
const opened: UploadLink[] = [];
afterEach(async () => {
	for (const endpoint of opened.splice(0)) endpoint.release();
	await new Promise((resolve) => setTimeout(resolve, 20));
});

/** A link and the replies it has sent, as the channel would carry them to the phone. */
function link(uploads: UploadStore) {
	const replies: Record<string, unknown>[] = [];
	const reply = (message: Record<string, unknown>) => replies.push(message);
	const endpoint = new UploadLink(uploads);
	opened.push(endpoint);
	return {
		endpoint,
		replies,
		reply,
		async until(check: () => boolean, what: string) {
			for (let i = 0; i < 400; i++) {
				if (check()) return;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			assert.fail(`timed out waiting for ${what}: ${JSON.stringify(replies.slice(-3))}`);
		},
		last(type: string) {
			return replies.findLast((r) => r.type === type);
		},
	};
}

const PART = 49_152;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function send(conn: ReturnType<typeof link>, sid: number, file: Buffer, from: number, to = file.length): Promise<void> {
	for (let at = from; at < to; at += PART) conn.endpoint.part(sid, at, file.subarray(at, Math.min(at + PART, to)), conn.reply);
	await conn.until(() => conn.replies.some((r) => (r.type === "upload_ack" && r.n === to) || r.type === "upload_error"), `ack of ${to}`);
}

test("a file arrives part by part and ends up whole, under a name that is only a name", async (t) => {
	const uploads = await store(t);
	const conn = link(uploads);
	const file = randomBytes(5 * PART + 1234);
	conn.endpoint.control({ type: "upload_begin", id: "u1", name: "../../etc/report.log", size: file.length, mimeType: "text/plain" }, conn.reply);
	await conn.until(() => Boolean(conn.last("upload_state")), "upload_state");
	const state = conn.last("upload_state")!;
	assert.equal(state.id, "u1");
	assert.equal(state.offset, 0);
	assert.match(String(state.upload), /^[a-f0-9]{32}$/);

	await send(conn, Number(state.sid), file, 0);
	await conn.until(() => Boolean(conn.last("upload_done")), "upload_done");
	const done = conn.last("upload_done")!;
	assert.equal(done.upload, state.upload);
	assert.equal(basename(String(done.path)), "report.log");
	assert.equal(dirname(dirname(String(done.path))), uploads.root, "inside the upload store, nowhere a phone chose");
	assert.equal(sha(await readFile(String(done.path))), sha(file));
	assert.equal(uploads.pathFor(state.upload), done.path);
	// Acknowledged only as far as it is written, and every part was.
	const acks = conn.replies.filter((r) => r.type === "upload_ack").map((r) => r.n);
	assert.deepEqual(acks, Array.from({ length: 6 }, (_, i) => Math.min((i + 1) * PART, file.length)));
});

test("a cut in the middle resumes from what is on disk instead of starting over", async (t) => {
	const uploads = await store(t);
	const file = randomBytes(8 * PART);
	const first = link(uploads);
	first.endpoint.control({ type: "upload_begin", id: "u1", name: "video.mp4", size: file.length, mimeType: "video/mp4" }, first.reply);
	await first.until(() => Boolean(first.last("upload_state")), "upload_state");
	const { upload, sid } = first.last("upload_state")!;
	await send(first, Number(sid), file, 0, 3 * PART);
	// The link goes: the relay dropped, the phone locked. What was written stays.
	first.endpoint.release();

	const second = link(uploads);
	second.endpoint.control({ type: "upload_begin", id: "u1", name: "video.mp4", size: file.length, mimeType: "video/mp4", resume: upload }, second.reply);
	await second.until(() => Boolean(second.last("upload_state")), "resumed upload_state");
	const resumed = second.last("upload_state")!;
	assert.equal(resumed.upload, upload, "the same upload, not a new one");
	assert.equal(resumed.offset, 3 * PART, "continues from the length on disk");
	await send(second, Number(resumed.sid), file, 3 * PART);
	await second.until(() => Boolean(second.last("upload_done")), "upload_done");
	assert.equal(sha(await readFile(String(second.last("upload_done")!.path))), sha(file));
});

test("a part for a stream this link never opened asks the phone to begin again", async (t) => {
	const uploads = await store(t);
	const conn = link(uploads);
	conn.endpoint.part(42, 0, Buffer.from("orphan"), conn.reply);
	assert.deepEqual(conn.replies, [{ type: "upload_error", sid: 42, error: "unknown-stream", message: "upload is not open on this link" }]);
});

test("a file over the limit is refused before a byte is written", async (t) => {
	const uploads = await store(t);
	const conn = link(uploads);
	conn.endpoint.control({ type: "upload_begin", id: "u1", name: "huge.bin", size: MAX_UPLOAD_BYTES + 1, mimeType: "" }, conn.reply);
	await conn.until(() => Boolean(conn.last("upload_error")), "upload_error");
	assert.equal(conn.last("upload_error")!.error, "too-large");
	assert.deepEqual(await readdir(uploads.root).catch(() => []), []);
});

test("an abort removes what was written", async (t) => {
	const uploads = await store(t);
	const conn = link(uploads);
	conn.endpoint.control({ type: "upload_begin", id: "u1", name: "a.txt", size: 3 * PART, mimeType: "text/plain" }, conn.reply);
	await conn.until(() => Boolean(conn.last("upload_state")), "upload_state");
	const { upload, sid } = conn.last("upload_state")!;
	await send(conn, Number(sid), randomBytes(3 * PART), 0, PART);
	conn.endpoint.control({ type: "upload_abort", upload }, conn.reply);
	await conn.until(() => uploads.pathFor(upload) === null, "the abort");
	for (let i = 0; i < 100 && (await readdir(uploads.root)).length > 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
	assert.deepEqual(await readdir(uploads.root), []);
});

test("a file named like the store's own bookkeeping cannot overwrite it", async (t) => {
	const uploads = await store(t);
	const conn = link(uploads);
	const file = Buffer.from("not metadata");
	conn.endpoint.control({ type: "upload_begin", id: "u1", name: "meta.json", size: file.length, mimeType: "application/json" }, conn.reply);
	await conn.until(() => Boolean(conn.last("upload_state")), "upload_state");
	const { upload, sid } = conn.last("upload_state")!;
	await send(conn, Number(sid), file, 0);
	await conn.until(() => Boolean(conn.last("upload_done")), "upload_done");
	assert.equal(String(await readFile(String(conn.last("upload_done")!.path))), "not metadata");
	assert.equal(uploads.pathFor(upload), conn.last("upload_done")!.path);
});

test("only finished uploads resolve to a path, and nothing that is not an upload id does", async (t) => {
	const uploads = await store(t);
	const conn = link(uploads);
	conn.endpoint.control({ type: "upload_begin", id: "u1", name: "half.bin", size: 2 * PART, mimeType: "" }, conn.reply);
	await conn.until(() => Boolean(conn.last("upload_state")), "upload_state");
	const { upload } = conn.last("upload_state")!;
	assert.equal(uploads.pathFor(upload), null, "half-written is not readable");
	for (const bad of ["../../etc", "x".repeat(32), null, 42, `${upload}/../..`]) assert.equal(uploads.pathFor(bad), null);
});

test("a path this store gave out is recognised, and nothing else under it is", async (t) => {
	/*
	 * An edited message comes back from the phone carrying the path the desktop recorded when it was
	 * first sent. That path may stand — but only if it is exactly a finished upload's file.
	 */
	const uploads = await store(t);
	const conn = link(uploads);
	const file = Buffer.from("contents");
	conn.endpoint.control({ type: "upload_begin", id: "u1", name: "a.txt", size: file.length, mimeType: "text/plain" }, conn.reply);
	await conn.until(() => Boolean(conn.last("upload_state")), "upload_state");
	const { upload, sid } = conn.last("upload_state")!;
	await send(conn, Number(sid), file, 0);
	await conn.until(() => Boolean(conn.last("upload_done")), "upload_done");
	const path = String(conn.last("upload_done")!.path);
	assert.equal(uploads.pathFor(path), path);
	for (const other of [join(uploads.root, `${upload}.json`), join(uploads.root, String(upload)), join(uploads.root, String(upload), "b.txt"), join(uploads.root, String(upload), "..", "..", "etc"), "/etc/passwd", "relative/a.txt"]) {
		assert.equal(uploads.pathFor(other), null, other);
	}
	const options = promptOptions({ attachments: [{ name: "a.txt", path }, { name: "b", path: "/etc/passwd" }] }, "remote", (reference) => uploads.pathFor(reference));
	assert.deepEqual(options.attachments, [{ name: "a.txt", path }, { name: "b" }]);
});

test("stale partial uploads are swept, recent ones are kept", async (t) => {
	const uploads = await store(t);
	const conn = link(uploads);
	conn.endpoint.control({ type: "upload_begin", id: "u1", name: "old.bin", size: 10, mimeType: "" }, conn.reply);
	await conn.until(() => Boolean(conn.last("upload_state")), "upload_state");
	const { upload } = conn.last("upload_state")!;
	conn.endpoint.control({ type: "upload_begin", id: "u2", name: "new.bin", size: 10, mimeType: "" }, conn.reply);
	await conn.until(() => conn.replies.filter((r) => r.type === "upload_state").length === 2, "second upload_state");
	const recent = conn.last("upload_state")!.upload;
	conn.endpoint.release();
	// Two days old by its own record.
	const meta = join(uploads.root, `${upload}.json`);
	const record = JSON.parse(await readFile(meta, "utf8")) as { created: number };
	await writeFile(meta, JSON.stringify({ ...record, created: Date.now() - 2 * 24 * 60 * 60 * 1000 }));
	await utimes(meta, new Date(), new Date());
	await uploads.sweep(Date.now() + 2 * 60 * 60 * 1000);
	assert.equal((await stat(join(uploads.root, `${upload}.part`)).catch(() => null)), null);
	assert.ok(await stat(join(uploads.root, `${recent}.part`)), "an upload from two hours ago is still resumable");
});

test("names are reduced to a file name, never empty and never a directory", () => {
	assert.equal(safeFileName("../../.ssh/id_rsa"), "id_rsa");
	assert.equal(safeFileName("C:\\Users\\me\\report.pdf"), "report.pdf");
	assert.equal(safeFileName(".env"), "env");
	assert.equal(safeFileName("a\u0000b|c?.txt"), "a_b_c_.txt");
	assert.equal(safeFileName(""), "upload");
	assert.equal(safeFileName(undefined), "upload");
});

// ---------------------------------------------------------------------------
// The prompt: an upload id is the only way a phone's attachment gets a path
// ---------------------------------------------------------------------------

test("a phone's attachment naming a finished upload gets that upload's path", () => {
	const options = promptOptions({ attachments: [{ name: "log.txt", kind: "text", upload: "a".repeat(32) }] }, "remote", (id) => `/uploads/${id}/log.txt`);
	assert.deepEqual(options.attachments, [{ name: "log.txt", kind: "text", path: `/uploads/${"a".repeat(32)}/log.txt` }]);
});

test("an attachment naming an upload that is not finished is refused, not sent without its file", () => {
	assert.throws(() => promptOptions({ attachments: [{ name: "log.txt", upload: "b".repeat(32) }] }, "remote", () => null), /upload-missing/);
	assert.throws(() => initialPrompt({ content: "hi", attachments: [{ name: "log.txt", upload: "b".repeat(32) }] }, "remote"), /upload-missing/);
});

test("a path a phone writes itself is still dropped, whatever its type", () => {
	/*
	 * The phone's bridge used to answer `pathForDrop` with a promise, which the composer took for a
	 * path and sent — and the whole message was refused as an invalid attachment. A remote path is
	 * discarded anyway, so its shape is no reason to refuse the message.
	 */
	const options = promptOptions({ attachments: [{ name: "a.png", path: {} }, { name: "b.png", path: "/etc/passwd" }] }, "remote", () => null);
	assert.deepEqual(options.attachments, [{ name: "a.png" }, { name: "b.png" }]);
	assert.throws(() => promptOptions({ attachments: [{ name: "a.png", path: {} }] }, "local"), /Invalid attachment path/);
});

test("an upload id means nothing from the desktop's own window", () => {
	const options = promptOptions({ attachments: [{ name: "x", upload: "c".repeat(32) }] }, "local", () => "/should/not/be/used");
	assert.deepEqual(options.attachments, [{ name: "x" }]);
});
