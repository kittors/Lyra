/**
 * What each drawing in a conversation was drawn from: recorded `sources`, or `#1`/paths traced back.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { drawingsIn, type TranscriptEntry } from "../src/images/lineage.ts";
import { IMAGE_TOOL_NAME } from "../src/images/types.ts";
import type { Message } from "../src/types/message.ts";

const DOG = `${"a".repeat(40)}.jpg`;
const HAT = `${"b".repeat(40)}.jpg`;
const GIRL = `${"c".repeat(40)}.jpg`;
const SKETCH = `${"d".repeat(40)}.png`;
const CAT = `${"e".repeat(40)}.jpg`;

let clock = 1000;
const tick = () => (clock += 10);

const said = (text: string, extra: Partial<Extract<Message, { role: "user" }>> = {}): Message => ({
	role: "user",
	content: [{ type: "text", text }],
	timestamp: tick(),
	...extra,
});

const attached = (media: string, text: string): Message => ({
	role: "user",
	content: [{ type: "text", text }, { type: "image", data: "", media, mimeType: "image/png" }],
	attachments: [{ name: "sketch.png", kind: "image" } as never],
	timestamp: tick(),
});

const calls = (...items: { id: string; images?: string[] }[]): Message =>
	({
		role: "assistant",
		content: items.map((item) => ({ type: "toolCall", id: item.id, name: IMAGE_TOOL_NAME, arguments: { prompt: "p", ...(item.images ? { images: item.images } : {}) } })),
		timestamp: tick(),
	}) as unknown as Message;

const drew = (id: string, media: string[], extra: Record<string, unknown> = {}): Message => ({
	role: "toolResult",
	toolCallId: id,
	toolName: IMAGE_TOOL_NAME,
	content: [{ type: "text", text: "Drew." }],
	details: {
		kind: "image_generation",
		status: "done",
		model: { id: "m", name: "gemini-3.1-flash-image", provider: "relay" },
		prompt: `brief for ${id}`,
		count: media.length,
		edit: false,
		startedAt: clock,
		images: media.map((name) => ({ media: name, mimeType: "image/jpeg", width: 1024, height: 1024 })),
		...extra,
	},
	isError: false,
	timestamp: tick(),
});

const numbered = (messages: Message[]): TranscriptEntry[] => messages.map((message, index) => ({ seq: index + 1, message }));

const lineage = (entries: TranscriptEntry[]) => drawingsIn(entries).drawn.map((picture) => [picture.media, picture.sources]);

test("an old chain of #1 edits is traced back link by link", () => {
	// The shape of the real conversation this was built for: every edit said #1, nothing recorded.
	const entries = numbered([
		said("给我用生图，画一个可爱的小狗。"),
		calls({ id: "c1" }),
		drew("c1", [DOG]),
		said("在这个小狗的头上加一个帽子吧"),
		calls({ id: "c2", images: ["#1"] }),
		drew("c2", [HAT], { edit: true }),
		said("给我画一个可爱亚洲女孩带着这个小狗一起拍照。"),
		calls({ id: "c3", images: ["#1"] }),
		drew("c3", [GIRL], { edit: true }),
	]);
	assert.deepEqual(lineage(entries), [
		[DOG, []],
		[HAT, [DOG]],
		[GIRL, [HAT]],
	]);
	const asks = drawingsIn(entries).drawn.map((picture) => picture.ask?.text);
	assert.deepEqual(asks, ["给我用生图，画一个可爱的小狗。", "在这个小狗的头上加一个帽子吧", "给我画一个可爱亚洲女孩带着这个小狗一起拍照。"]);
});

test("#2 reaches past the newest picture, and a picture attached since is #1", () => {
	const entries = numbered([
		said("draw a dog"),
		calls({ id: "c1" }),
		drew("c1", [DOG]),
		said("now a cat"),
		calls({ id: "c2" }),
		drew("c2", [CAT]),
		attached(SKETCH, "put the dog into my sketch"),
		calls({ id: "c3", images: ["#1", "#3"] }),
		drew("c3", [GIRL], { edit: true }),
	]);
	const { drawn, given } = drawingsIn(entries);
	assert.deepEqual(drawn.at(-1)?.sources, [SKETCH, DOG]);
	// The sketch is not a drawing: it is where this one started, and the person's message carried it.
	assert.equal(given.length, 1);
	assert.equal(given[0].media, SKETCH);
	assert.equal(given[0].seq, 7);
	assert.equal(given[0].ask?.text, "put the dog into my sketch");
	assert.deepEqual(given[0].ask?.attachments, [{ name: "sketch.png" }]);
});

test("recorded sources win over the arguments, which may say anything", () => {
	const entries = numbered([said("draw"), calls({ id: "c1" }), drew("c1", [DOG]), said("edit"), calls({ id: "c2", images: ["#9"] }), drew("c2", [HAT], { edit: true, sources: [DOG] })]);
	assert.deepEqual(lineage(entries), [
		[DOG, []],
		[HAT, [DOG]],
	]);
});

test("a path into session-media is that picture; a workspace path cannot be traced", () => {
	const entries = numbered([
		said("draw"),
		calls({ id: "c1" }),
		drew("c1", [DOG]),
		said("edit both"),
		calls({ id: "c2", images: [`/Users/me/.lyra/session-media/${DOG}`, "./design/logo.png"] }),
		drew("c2", [HAT], { edit: true }),
	]);
	const last = drawingsIn(entries).drawn.at(-1);
	assert.deepEqual(last?.sources, [DOG]);
	assert.equal(last?.untraced, 1);
});

test("calls side by side in one message do not see each other's pictures", () => {
	const entries = numbered([
		said("draw"),
		calls({ id: "c1" }),
		drew("c1", [DOG]),
		said("two variations of it"),
		calls({ id: "c2", images: ["#1"] }, { id: "c3", images: ["#1"] }),
		drew("c2", [HAT], { edit: true }),
		drew("c3", [CAT], { edit: true }),
	]);
	assert.deepEqual(lineage(entries).slice(1), [
		[HAT, [DOG]],
		[CAT, [DOG]],
	]);
});

test("several pictures from one call share their sources and the person's words", () => {
	const entries = numbered([said("draw two"), calls({ id: "c1" }), drew("c1", [DOG, CAT])]);
	const { drawn } = drawingsIn(entries);
	assert.deepEqual(
		drawn.map((picture) => [picture.media, picture.index, picture.count, picture.ask?.text]),
		[
			[DOG, 0, 2, "draw two"],
			[CAT, 1, 2, "draw two"],
		],
	);
});

test("what the runtime says in the person's place is not what they asked", () => {
	const entries = numbered([
		said("draw a dog"),
		calls({ id: "c1" }),
		said("Continue where you left off.", { synthetic: true }),
		drew("c1", [DOG]),
		said("[rule] stop", { ruleMatch: { rules: [], interrupted: false } }),
		calls({ id: "c2", images: ["#1"] }),
		drew("c2", [HAT], { edit: true }),
	]);
	assert.deepEqual(
		drawingsIn(entries).drawn.map((picture) => picture.ask?.text),
		["draw a dog", "draw a dog"],
	);
});

test("displayText is what they typed; a failed or running call draws nothing", () => {
	const entries = numbered([
		said("<skill>…</skill> draw a dog", { displayText: "draw a dog" }),
		calls({ id: "c1" }, { id: "c2" }),
		drew("c1", [], { status: "error" }),
		drew("c2", [DOG], { status: "running" }),
	]);
	assert.deepEqual(drawingsIn(entries).drawn, []);
	const ok = numbered([said("<skill>…</skill> draw a dog", { displayText: "draw a dog" }), calls({ id: "c1" }), drew("c1", [DOG])]);
	assert.equal(drawingsIn(ok).drawn[0].ask?.text, "draw a dog");
});

test("an edit whose call is gone is marked untraced rather than dropped", () => {
	const entries = numbered([said("edit it"), drew("c9", [HAT], { edit: true })]);
	const [picture] = drawingsIn(entries).drawn;
	assert.deepEqual(picture.sources, []);
	assert.equal(picture.untraced, 1);
});

test("a picture is never its own source, and a damaged record is skipped", () => {
	const entries = numbered([said("draw"), calls({ id: "c1" }), drew("c1", [DOG], { sources: [DOG] }), { role: undefined } as unknown as Message]);
	assert.deepEqual(lineage(entries), [[DOG, []]]);
});

test("a marked-up copy hangs off the picture it was marked up on", () => {
	const marked: Message = {
		role: "user",
		content: [
			{ type: "text", text: "照圈出来的地方改" },
			{ type: "image", data: "", media: SKETCH, mimeType: "image/png", from: DOG },
		],
		timestamp: tick(),
	};
	const entries = numbered([said("draw"), calls({ id: "c1" }), drew("c1", [DOG]), marked, calls({ id: "c2", images: ["#1"] }), drew("c2", [HAT], { edit: true })]);
	const { drawn, given } = drawingsIn(entries);
	assert.deepEqual(drawn.at(-1)?.sources, [SKETCH]);
	assert.deepEqual(
		given.map((picture) => [picture.media, picture.from, picture.ask?.text]),
		[[SKETCH, DOG, "照圈出来的地方改"]],
	);
});
