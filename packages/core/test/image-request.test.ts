/**
 * What a request carries in place of the conversation's pictures — with a codec and without one.
 *
 * Without one (the CLI) nothing can be scaled, so the boundary's whole job is to never send what a
 * provider refuses: a refused picture stays in the history and fails every request after it. With one
 * (the desktop), pictures are fitted to the model and the history is budgeted. Either way the
 * conversation itself is untouched — only the request changes.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { streamAssistant, useLlmRegistry } from "../src/ai/index.ts";
import { codecFromEngine } from "../src/images/codec.ts";
import { fitEntryImages, fitResultImages } from "../src/images/fit-entry.ts";
import { claudeStandardTier, clearRequestImageCache, gistNote, omittedNote, prepareRequestImages } from "../src/images/request-images.ts";
import { emptyUsage, type AssistantMessage, type ImageContent, type LlmContext, type Message, type ModelConfig, type Provider } from "../src/types.ts";
import { fakeEngine, jpeg, png } from "./image-helpers.ts";

const KB = 1024;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const picture = (bytes: Uint8Array, mimeType = "image/png", extra: Partial<ImageContent> = {}): ImageContent => ({ type: "image", data: b64(bytes), mimeType, ...extra });

function model(modelId: string, supportsImages = true): ModelConfig {
	return { id: `relay/${modelId}`, providerId: "relay", modelId, name: modelId, contextWindow: 200_000, maxOutputTokens: 8192, supportsImages, supportsTools: true, supportsThinking: false } as ModelConfig;
}

const reply = (toolCall = false): AssistantMessage => ({
	role: "assistant", api: "anthropic-messages", provider: "relay", model: "m", usage: emptyUsage(), stopReason: toolCall ? "toolUse" : "stop", timestamp: 1,
	content: toolCall ? [{ type: "toolCall", id: "t1", name: "read", arguments: {} }] : [{ type: "text", text: "ok" }],
});

const ask = (...content: Message["content"]): Message => ({ role: "user", content, timestamp: 1 }) as Message;
const imagesIn = (messages: Message[]) => messages.flatMap((m) => (m.role === "assistant" ? [] : m.content.filter((p) => p.type === "image"))) as ImageContent[];
const textsIn = (messages: Message[]) => messages.flatMap((m) => (m.role === "assistant" ? [] : m.content.flatMap((p) => (p.type === "text" ? [p.text] : []))));

afterEach(() => clearRequestImageCache());

test("claudeStandardTier: before 4.7 by either naming, and a date is not a version", () => {
	for (const id of ["claude-opus-4-6-thinking", "claude-sonnet-4-5-20250929", "claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307", "claude-haiku-4-5"]) {
		assert.equal(claudeStandardTier(id), true, id);
	}
	for (const id of ["claude-opus-4-7", "claude-opus-5-5", "claude-sonnet-5", "claude-fable-5-1", "gpt-5.5", "gemini-3.1-pro", "claude"]) {
		assert.equal(claudeStandardTier(id), false, id);
	}
});

test("no pictures, or a model that cannot see: the very same context goes out", async () => {
	const plain: LlmContext = { systemPrompt: "", messages: [ask({ type: "text", text: "hi" })], tools: [] };
	assert.equal(await prepareRequestImages(plain, model("claude-opus-5-5"), { codec: null }), plain);
	const withPicture: LlmContext = { systemPrompt: "", messages: [ask(picture(png(9000, 9000, 9 * 1024 * KB)))], tools: [] };
	assert.equal(await prepareRequestImages(withPicture, model("deepseek-chat", false), { codec: null }), withPicture);
});

test("without a codec: what fits goes as it is, what a provider would refuse is said instead", async () => {
	const fine = picture(png(3000, 2000, 900 * KB));
	const heavy = picture(png(1200, 800, 4 * 1024 * KB));
	const huge = picture(png(9000, 6000, 900 * KB));
	const heic = picture(jpeg(4032, 3024, 2 * 1024 * KB), "image/heic");
	const context: LlmContext = { systemPrompt: "", messages: [ask(fine, heavy, huge, heic, { type: "text", text: "看看" })], tools: [] };
	const out = await prepareRequestImages(context, model("claude-opus-5-5"), { codec: null });
	assert.deepEqual(imagesIn(out.messages), [fine], "the one that fits, untouched — the provider scales it");
	const notes = textsIn(out.messages).filter((t) => t.startsWith("[image omitted"));
	assert.equal(notes.length, 3);
	assert.match(notes[0], /too large to send/);
	assert.match(notes[2], /image\/heic is not a format this model accepts/);
	assert.equal(imagesIn(context.messages).length, 4, "the conversation itself still has all four");
});

test("without a codec: past twenty pictures, Anthropic's tighter side limit applies", async () => {
	const pictures = Array.from({ length: 21 }, (_v, i) => picture(png(i === 0 ? 2500 : 1000, 800, 40 * KB)));
	const out = await prepareRequestImages({ systemPrompt: "", messages: [ask(...pictures)], tools: [] }, model("claude-opus-5-5"), { codec: null });
	assert.equal(imagesIn(out.messages).length, 20);
	assert.match(textsIn(out.messages)[0], /too large/);
});

test("with a codec: Claude's standard tier gets 1568 px, a newer model gets what entry fitting left", async () => {
	const { engine, calls } = fakeEngine(() => 200 * KB);
	const codec = codecFromEngine(engine);
	const shot = picture(png(2000, 1125, 300 * KB));
	const context: LlmContext = { systemPrompt: "", messages: [ask(shot)], tools: [] };

	const newer = await prepareRequestImages(context, model("claude-opus-5-5"), { codec });
	assert.equal(newer, context, "already fitted on the way in: nothing to do");
	assert.equal(calls.decode, 0);

	const older = await prepareRequestImages(context, model("claude-opus-4-6-thinking"), { codec });
	const [sent] = imagesIn(older.messages);
	assert.notEqual(sent, shot);
	assert.deepEqual(calls.encode, ["png@1456x819"]);
	await prepareRequestImages(context, model("claude-opus-4-6-thinking"), { codec });
	assert.equal(calls.encode.length, 1, "the fitted copy is reused on the next request");
});

test("with a codec: an old conversation's 4K original is fitted at the boundary", async () => {
	const { engine, calls } = fakeEngine(() => 300 * KB);
	const original = picture(png(3840, 2160, 6 * 1024 * KB), "image/png", { media: "a".repeat(40) + ".png" });
	const out = await prepareRequestImages({ systemPrompt: "", messages: [ask(original)], tools: [] }, model("gpt-5.5"), { codec: codecFromEngine(engine) });
	const [sent] = imagesIn(out.messages);
	assert.equal(sent.media, undefined, "the request copy does not claim the stored file's name");
	assert.deepEqual(calls.encode, ["png@2000x1125"]);
	assert.equal(Buffer.from(sent.data, "base64").length, 300 * KB);
});

test("with a codec: history over the budget goes as gists and then as lines, the turn being asked stays whole", async () => {
	const { engine } = fakeEngine((size) => (size.width <= 768 ? 30 * KB : 200 * KB));
	const codec = codecFromEngine(engine);
	const old = Array.from({ length: 12 }, () => picture(png(1600, 900, 200 * KB)));
	const now = [picture(png(1600, 900, 200 * KB)), picture(png(1600, 900, 200 * KB))];
	const messages: Message[] = [ask(...old.slice(0, 6)), reply(), ask(...old.slice(6)), reply(), ask(...now, { type: "text", text: "这两张呢" })];
	const frozen = JSON.stringify(messages);
	const out = await prepareRequestImages({ systemPrompt: "", messages, tools: [] }, model("claude-opus-5-5"), {
		codec,
		budget: { fullBytes: 4 * 1024 * KB, fullCount: 4, gistCount: 4, lowWater: 0.5 },
	});
	const last = out.messages.at(-1) as Extract<Message, { role: "user" }>;
	assert.deepEqual(last.content.slice(0, 2), now, "this turn's pictures, as they were");
	const texts = textsIn(out.messages);
	assert.ok(texts.includes(gistNote({ width: 1600, height: 900 })), "a gist says what it is");
	assert.ok(texts.includes(omittedNote({ width: 1600, height: 900 })), "a line says what was there and how to get it back");
	assert.ok(imagesIn(out.messages).length < 14);
	assert.equal(JSON.stringify(messages), frozen, "the conversation's own messages are not touched");
});

test("streamAssistant: every request passes the boundary, whichever adapter answers", async () => {
	let seen: LlmContext | null = null;
	const fake = {
		// oxlint-disable-next-line require-yield -- an adapter that only records what it was handed
		async *stream(_provider: unknown, _model: unknown, context: LlmContext) {
			seen = context;
			return reply();
		},
	} as unknown as Provider;
	useLlmRegistry({ get: () => fake });
	try {
		const heic = picture(jpeg(4032, 3024, 2 * 1024 * KB), "image/heic");
		const stream = streamAssistant({ id: "relay", name: "r", api: "anthropic-messages", baseUrl: "http://x", apiKey: "k", enabled: true, models: [] } as never, model("claude-opus-5-5"), { systemPrompt: "", messages: [ask(heic)], tools: [] });
		while (!(await stream.next()).done);
		assert.ok(seen);
		assert.equal(imagesIn((seen as LlmContext).messages).length, 0);
		assert.match(textsIn((seen as LlmContext).messages)[0], /image\/heic/);
	} finally {
		useLlmRegistry(null);
	}
});

test("fitEntryImages: a prompt's picture is replaced by its fitted copy, its lineage kept, its stale file name dropped", async () => {
	const { engine } = fakeEngine(() => 250 * KB);
	const codec = codecFromEngine(engine);
	const big = picture(png(3840, 2160, 6 * 1024 * KB), "image/png", { media: "b".repeat(40) + ".png", from: "c".repeat(40) + ".png" });
	const content = [{ type: "text" as const, text: "看" }, big];
	const out = await fitEntryImages(content, { codec });
	const fitted = out[1] as ImageContent;
	assert.equal(fitted.media, undefined);
	assert.equal(fitted.from, big.from, "the annotation lineage survives fitting");
	assert.equal(out.length, 2, "no coordinate line on a person's own picture");
	assert.equal(await fitEntryImages(content, { codec: null }), content, "no codec: nothing changes");
	const small = [picture(png(800, 600, 50 * KB))];
	assert.equal(await fitEntryImages(small, { codec }), small, "already fine: the same array");
});

test("fitResultImages: a tool's scaled screenshot carries the line that maps coordinates back", async () => {
	const { engine } = fakeEngine(() => 250 * KB);
	const result = { content: [picture(png(3840, 2160, 6 * 1024 * KB))] };
	const out = await fitResultImages(result, codecFromEngine(engine));
	assert.equal(out.content.length, 2);
	assert.equal((out.content[1] as { text: string }).text, "[Image: original 3840x2160, displayed at 2000x1125. Multiply coordinates by 1.92 to map to original image.]");
});

test("an old conversation's hundred originals: only what is sent is decoded, and the next request agrees", async () => {
	const { engine, calls } = fakeEngine((size) => (size.width <= 768 ? 30 * KB : 300 * KB));
	const codec = codecFromEngine(engine);
	// Saved before pictures were fitted on the way in: 4K originals, forty turns of them.
	const messages: Message[] = [];
	for (let turn = 0; turn < 40; turn++) messages.push(ask(picture(png(3840, 2160, 2 * 1024 * KB + turn), "image/png", { media: `${String(turn).padStart(40, "0")}.png` })), reply());
	messages.push(ask({ type: "text", text: "继续" }));
	const first = await prepareRequestImages({ systemPrompt: "", messages, tools: [] }, model("claude-opus-5-5"), { codec });
	const decodedFirst = calls.decode;
	assert.ok(decodedFirst <= 10 + 20, `${decodedFirst} decoded: at most the ten sent whole and the twenty gists`);
	const second = await prepareRequestImages({ systemPrompt: "", messages, tools: [] }, model("claude-opus-5-5"), { codec });
	assert.equal(calls.decode, decodedFirst, "everything sent was cached");
	assert.deepEqual(textsIn(second.messages), textsIn(first.messages), "the same tiers once the cache is full");
	assert.equal(JSON.stringify(imagesIn(second.messages)), JSON.stringify(imagesIn(first.messages)));
});
