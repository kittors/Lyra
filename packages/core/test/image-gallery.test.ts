/**
 * The gallery across a real store: which conversations are read, forks, undo, and the cache.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { GalleryReader } from "../src/images/gallery.ts";
import { IMAGE_TOOL_NAME } from "../src/images/types.ts";
import { SessionStore } from "../src/session/store.ts";
import type { SessionMeta } from "../src/session/types.ts";
import type { Message } from "../src/types/message.ts";

const DOG = `${"a".repeat(40)}.jpg`;
const HAT = `${"b".repeat(40)}.jpg`;
const CAT = `${"c".repeat(40)}.jpg`;
const PHOTO = `${"d".repeat(40)}.png`;

let clock = 1_000;
const said = (text: string, media?: string): Message => ({
	role: "user",
	content: [{ type: "text", text }, ...(media ? [{ type: "image" as const, data: "", media, mimeType: "image/png" }] : [])],
	timestamp: (clock += 10),
});
const call = (id: string, images?: string[]): Message =>
	({
		role: "assistant",
		content: [{ type: "toolCall", id, name: IMAGE_TOOL_NAME, arguments: { prompt: "p", ...(images ? { images } : {}) } }],
		api: "openai-chat-completions",
		provider: "relay",
		model: "m",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "toolUse",
		timestamp: (clock += 10),
	}) as Message;
const drew = (id: string, media: string, sources?: string[]): Message => ({
	role: "toolResult",
	toolCallId: id,
	toolName: IMAGE_TOOL_NAME,
	content: [{ type: "text", text: "Drew." }],
	details: { kind: "image_generation", status: "done", model: { id: "m", name: "img", provider: "relay" }, prompt: `brief ${id}`, count: 1, edit: Boolean(sources), startedAt: clock, images: [{ media, mimeType: "image/jpeg" }], ...(sources ? { sources } : {}) },
	isError: false,
	timestamp: (clock += 10),
});

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "lyra-gallery-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const store = new SessionStore(join(root, "sessions"));
	const write = async (meta: SessionMeta, messages: Message[]) => {
		for (const message of messages) await store.append(meta, { type: "message", message });
	};
	return { root, store, write };
}

test("only conversations with drawings are read, and a picture lists where it came from", async (t) => {
	const { root, store, write } = await fixture(t);
	const plain = await store.create(root, "m", "just talk");
	await write(plain, [said("hello")]);
	const art = await store.create(root, "m", "生成可爱小狗图片");
	await write(art, [said("画一只小狗"), call("c1"), drew("c1", DOG), said("加个帽子"), call("c2", ["#1"]), drew("c2", HAT)]);

	const gallery = await new GalleryReader(store).list();
	assert.deepEqual(
		gallery.pictures.map((picture) => [picture.media, picture.sources, picture.sessionId, picture.ask?.text]),
		[
			[DOG, [], art.id, "画一只小狗"],
			[HAT, [DOG], art.id, "加个帽子"],
		],
	);
	assert.deepEqual(
		gallery.sessions.map((session) => [session.id, session.title]),
		[[art.id, "生成可爱小狗图片"]],
	);
	// The seq points at the result record, which is what the conversation is scrolled to.
	assert.ok(gallery.pictures[1].seq > gallery.pictures[0].seq);
});

test("a fork's copy of a picture is credited to the conversation it was drawn in", async (t) => {
	const { root, store, write } = await fixture(t);
	const original = await store.create(root, "m", "dog");
	const history = [said("画一只小狗"), call("c1"), drew("c1", DOG)];
	await write(original, history);
	await sleep(5);
	const fork = await store.create(root, "m", "dog（分叉）");
	for (const message of history) await store.append(fork, { type: "message", message }, { copy: true });
	await write(fork, [said("换成猫"), call("c2", ["#1"]), drew("c2", CAT)]);

	const gallery = await new GalleryReader(store).list();
	assert.deepEqual(
		gallery.pictures.map((picture) => [picture.media, picture.sessionId, picture.sources]),
		[
			[DOG, original.id, []],
			[CAT, fork.id, [DOG]],
		],
	);
});

test("an attachment that went into a drawing is an input; the same bytes as a drawing are that drawing", async (t) => {
	const { root, store, write } = await fixture(t);
	const first = await store.create(root, "m", "a");
	await write(first, [said("画一只小狗"), call("c1"), drew("c1", DOG)]);
	await sleep(5);
	const second = await store.create(root, "m", "b");
	await write(second, [said("把这只狗放进照片里", PHOTO), call("c2", ["#1"]), drew("c2", HAT)]);
	await write(second, [said("再用原来那只狗", DOG), call("c3", ["#1"]), drew("c3", CAT)]);

	const gallery = await new GalleryReader(store).list();
	assert.deepEqual(gallery.inputs.map((input) => [input.media, input.sessionId, input.ask?.text]), [[PHOTO, second.id, "把这只狗放进照片里"]]);
	assert.deepEqual(gallery.pictures.find((picture) => picture.media === CAT)?.sources, [DOG]);
});

test("an undone drawing leaves the gallery, and a deleted conversation takes its pictures with it", async (t) => {
	const { root, store, write } = await fixture(t);
	const meta = await store.create(root, "m", "dog");
	await write(meta, [said("画一只小狗"), call("c1"), drew("c1", DOG), said("加个帽子"), call("c2", ["#1"]), drew("c2", HAT)]);
	const reader = new GalleryReader(store);
	assert.equal((await reader.list()).pictures.length, 2);

	await store.truncateFrom(meta.projectId, meta.id, 3);
	assert.deepEqual((await reader.list()).pictures.map((picture) => picture.media), [DOG]);

	await store.delete(meta.projectId, meta.id);
	assert.deepEqual(await reader.list(), { pictures: [], inputs: [], sessions: [] });
});

test("a conversation not written to since is not read again", async (t) => {
	const { root, store, write } = await fixture(t);
	const meta = await store.create(root, "m", "dog");
	await write(meta, [said("画一只小狗"), call("c1"), drew("c1", DOG)]);
	let loads = 0;
	const counted = { listSessions: () => store.listSessions(), sessionsWithResultOf: (name: string) => store.sessionsWithResultOf(name), load: (...args: Parameters<SessionStore["load"]>) => (loads++, store.load(...args)) };
	const reader = new GalleryReader(counted);
	await reader.list();
	await reader.list();
	assert.equal(loads, 1);
	await write(meta, [said("加个帽子"), call("c2", ["#1"]), drew("c2", HAT)]);
	assert.equal((await reader.list()).pictures.length, 2);
	assert.equal(loads, 2);
});

test("the prefilter matches the tool's name as text, not as a pattern", async (t) => {
	const { root, store, write } = await fixture(t);
	const lookalike = await store.create(root, "m", "x");
	// `_` is a wildcard to LIKE: unescaped, "imageXgenerate" would match "image_generate".
	await write(lookalike, [{ role: "toolResult", toolCallId: "r", toolName: "imageXgenerate", content: [{ type: "text", text: "" }], isError: false, timestamp: 1 }]);
	assert.deepEqual(await store.sessionsWithResultOf(IMAGE_TOOL_NAME), []);
});
