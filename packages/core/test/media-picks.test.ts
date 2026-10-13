/**
 * How a conversation's image and video model is chosen and kept: named, `@`-named, switched while
 * drawing, and what a drawing reports back when the model did not do as asked.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { imageHost } from "../src/images/host.ts";
import { mediaModelRows } from "../src/images/models.ts";
import { type ConversationPicks, mentionedMedia, NamedPicks, pickMedia, pickProblem } from "../src/images/picks.ts";
import type { ImageGenerationDetails, ImageHost, ImageRequest, ImageResult, ImageTarget } from "../src/images/types.ts";
import { adoptMentionedMedia, describeMediaTools } from "../src/runtime/media-turn.ts";
import { imageTool } from "../src/tools/image.ts";
import type { Message, ModelConfig, ProviderConfig, Tool, ToolContext } from "../src/types.ts";

let home = "";
const previousHome = process.env.LYRA_HOME;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-media-picks-"));
	process.env.LYRA_HOME = join(home, ".lyra");
});

after(async () => {
	if (previousHome === undefined) delete process.env.LYRA_HOME;
	else process.env.LYRA_HOME = previousHome;
	await rm(home, { recursive: true, force: true });
});

const model = (providerId: string, modelId: string, extra: Partial<ModelConfig> = {}): ModelConfig => ({
	id: `${providerId}/${modelId}`,
	providerId,
	modelId,
	name: modelId,
	contextWindow: 0,
	maxOutputTokens: 0,
	supportsThinking: false,
	supportsImages: true,
	supportsTools: false,
	...extra,
});

const provider = (id: string, name: string, models: ModelConfig[]): ProviderConfig => ({ id, name, baseUrl: "https://relay.example", api: "openai-responses", apiKey: "k", enabled: true, models });

const providers = [
	provider("relay", "Relay", [model("relay", "gemini-3.1-flash-image"), model("relay", "grok-imagine-image"), model("relay", "grok-imagine-video-1.5")]),
	provider("a", "Relay A", [model("a", "gpt-image-1")]),
	provider("b", "Relay B", [model("b", "gpt-image-1")]),
];

function memory(initial: Partial<Record<"image" | "video", string>> = {}): ConversationPicks & { store: Map<string, string | null> } {
	const store = new Map<string, string | null>(Object.entries(initial));
	return { store, get: (kind) => store.get(kind) ?? null, set: (kind, id) => void store.set(kind, id) };
}

test("a model named for a drawing becomes the conversation's; two named in one turn is a comparison", () => {
	const picks = memory({ image: "relay/gemini-3.1-flash-image" });
	const named = new NamedPicks(picks);
	named.adopt("image", "relay/grok-imagine-image");
	assert.equal(picks.store.get("image"), "relay/grok-imagine-image");
	named.adopt("image", "relay/grok-imagine-image");
	assert.equal(picks.store.get("image"), "relay/grok-imagine-image", "the same name again is still one choice");
	named.adopt("image", "a/gpt-image-1");
	assert.equal(picks.store.get("image"), "relay/gemini-3.1-flash-image", "a second model makes it a comparison: back to before");
	named.adopt("video", "relay/grok-imagine-video-1.5");
	assert.equal(picks.store.get("video"), "relay/grok-imagine-video-1.5", "kinds are tallied apart");

	const next = new NamedPicks(picks);
	next.adopt("image", "b/gpt-image-1");
	assert.equal(picks.store.get("image"), "b/gpt-image-1", "a new turn starts a new tally");

	assert.doesNotThrow(() => new NamedPicks({ get: () => null }).adopt("image", "x"), "a sub-agent's read-only picks are left alone");
});

test("@ names a model in each spelling the composer writes, and only one per kind", () => {
	const rows = { image: mediaModelRows(providers, "image"), video: mediaModelRows(providers, "video") };
	const none = new Set<string>();
	const pick = (text: string, reserved = none) => {
		const found = mentionedMedia(text, rows, reserved);
		return { image: found.image?.model.id, video: found.video?.model.id };
	};
	assert.deepEqual(pick("@grok-imagine-image，画一只猫"), { image: "relay/grok-imagine-image", video: undefined });
	assert.deepEqual(pick("画一只猫 @grok-imagine-image."), { image: "relay/grok-imagine-image", video: undefined }, "the full stop is the sentence's");
	assert.deepEqual(pick('试试 @"gpt-image-1 (Relay B)" 画'), { image: "b/gpt-image-1", video: undefined });
	assert.deepEqual(pick("@gpt-image-1 画"), { image: undefined, video: undefined }, "a name two providers share chooses neither");
	assert.deepEqual(pick("@grok-imagine-image 和 @gemini-3.1-flash-image 比一比"), { image: undefined, video: undefined });
	assert.deepEqual(pick("@grok-imagine-image 画，再用 @grok-imagine-video-1.5 动起来"), { image: "relay/grok-imagine-image", video: "relay/grok-imagine-video-1.5" });
	assert.deepEqual(pick("mail a@grok-imagine-image"), { image: undefined, video: undefined }, "@ inside a word is not a mention");
	assert.deepEqual(pick("@grok 画"), { image: undefined, video: undefined }, "a part of a name is a guess, not a choice");
	assert.deepEqual(pick("@grok-imagine-image", new Set(["grok-imagine-image"])), { image: undefined, video: undefined }, "an agent keeps its name");
});

test("a turn adopts what the person @-named since the last reply, nothing older or injected", () => {
	const text = (content: string) => [{ type: "text" as const, text: content }];
	const messages = [
		{ role: "user", content: text("@gpt-image-1 (Relay A) 画"), timestamp: 1 },
		{ role: "assistant", content: text("好"), timestamp: 2 },
		{ role: "user", content: text("换 @grok-imagine-image 再来"), timestamp: 3 },
		{ role: "user", content: text("@gemini-3.1-flash-image"), timestamp: 4, synthetic: true },
	] as unknown as Message[];
	const picks = memory();
	const adopted = adoptMentionedMedia({ messages, providers, picks, agents: [] });
	assert.deepEqual(adopted, { image: "relay/grok-imagine-image" });
	assert.equal(picks.store.get("image"), "relay/grok-imagine-image");
	assert.deepEqual(adoptMentionedMedia({ messages, providers, picks: { get: () => null }, agents: [] }), {}, "nothing to write to, nothing adopted");
});

test("the drawing tool lists the models only when there is a choice to make", () => {
	const tool = { name: "image_generate", description: "Draw." } as Tool;
	const listed = describeMediaTools([tool], providers, { image: "image_generate" })[0];
	assert.equal(listed.description, "Draw.\n\nImage models configured: gemini-3.1-flash-image, grok-imagine-image, gpt-image-1 (Relay A), gpt-image-1 (Relay B).");
	const single = describeMediaTools([tool], [provider("x", "X", [model("x", "gpt-image-1")])], { image: "image_generate" })[0];
	assert.equal(single, tool, "one model: nothing to choose between, the description stays as cached");
});

test("the host reads its model at each call, so a switch mid-turn reaches the next drawing", () => {
	let settings: { providers: ProviderConfig[]; imageModelId?: string | null; videoModelId?: string | null } = { providers, imageModelId: null };
	const picks = memory();
	const host = imageHost({ source: { settings: () => settings, picks }, named: new NamedPicks(picks), messages: [], state: new Map() });
	assert.ok(host);
	const id = () => {
		const found = host.resolve();
		return "problem" in found ? found.problem : found.model.id;
	};
	assert.equal(id(), "relay/gemini-3.1-flash-image");
	picks.store.set("image", "relay/grok-imagine-image");
	assert.equal(id(), "relay/grok-imagine-image", "the composer's button, mid-turn");
	settings = { ...settings, imageModelId: "a/gpt-image-1" };
	picks.store.delete("image");
	assert.equal(id(), "a/gpt-image-1", "the default, changed in settings mid-turn");
	assert.deepEqual(host.names?.(), ["gemini-3.1-flash-image", "grok-imagine-image", "gpt-image-1 (Relay A)", "gpt-image-1 (Relay B)"]);

	const ambiguous = pickMedia({ settings: () => settings }, "image", "gpt-image-1");
	assert.ok(!ambiguous.row);
	assert.match(pickProblem("image", "gpt-image-1", ambiguous), /gpt-image-1 \(Relay A\), gpt-image-1 \(Relay B\)\. Pass one of these exactly as written/);
});

// A 16×9 JPEG header, as far as the size reader looks: SOI, then a baseline SOF0 giving height 9 and width 16.
const JPEG_16x9 = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x09, 0x00, 0x10, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]).toString("base64");

function hostFor(target: ImageTarget, draw: () => ImageResult | Promise<ImageResult>, pictures: ImageHost["pictures"] = () => []): ImageHost & { adopted: string[]; requests: ImageRequest[] } {
	const adopted: string[] = [];
	const requests: ImageRequest[] = [];
	return {
		adopted,
		requests,
		resolve: () => target,
		generate: async (_, request) => {
			requests.push(request);
			return draw();
		},
		pictures,
		names: (filter) => (filter?.pictures ? ["gpt-image-1 (Relay A)"] : ["grok-imagine-image", "gpt-image-1 (Relay A)"]),
		adopt: (chosen) => void adopted.push(chosen.model.id),
	};
}

const grok: ImageTarget = { provider: providers[0], model: model("relay", "grok-imagine-image") };
const context = (images: ImageHost): ToolContext => ({ cwd: home, sessionId: "s1", state: new Map(), images });
const textOf = (result: { content: { type: string; text?: string }[] }) => result.content.map((part) => part.text ?? "").join("\n");

test("a named drawing moves the conversation's pick only once it has arrived", async () => {
	const ok = hostFor(grok, () => ({ images: [{ data: JPEG_16x9, mimeType: "image/jpeg" }], route: "images" }));
	await imageTool.execute({ prompt: "a fox", model: "grok-imagine-image" }, context(ok));
	assert.deepEqual(ok.adopted, ["relay/grok-imagine-image"]);

	const unnamed = hostFor(grok, () => ({ images: [{ data: JPEG_16x9, mimeType: "image/jpeg" }], route: "images" }));
	await imageTool.execute({ prompt: "a fox" }, context(unnamed));
	assert.deepEqual(unnamed.adopted, [], "drawing with the current pick changes nothing");

	const failed = hostFor(grok, () => {
		throw new Error("upstream 500");
	});
	const result = await imageTool.execute({ prompt: "a fox", model: "grok-imagine-image" }, context(failed));
	assert.equal(result.isError, true);
	assert.deepEqual(failed.adopted, [], "a model that did not deliver is not adopted");
});

test("a model set up without picture input is not sent pictures, and the model is told which ones take them", async () => {
	const blind: ImageTarget = { provider: providers[0], model: model("relay", "grok-imagine-image", { supportsImages: false }) };
	const host = hostFor(blind, () => ({ images: [], route: "images" }), () => [{ data: JPEG_16x9, mimeType: "image/jpeg" }]);
	const result = await imageTool.execute({ prompt: "make it warmer", images: ["#1"] }, context(host));
	assert.equal(result.isError, true);
	assert.equal(host.requests.length, 0, "no request, no bill");
	assert.match(textOf(result), /set up without picture input.*gpt-image-1 \(Relay A\)/s);
});

test("what arrived is measured against what was asked: a ratio ignored, a background left opaque", async () => {
	const square = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]).toString("base64");
	const ignored = await imageTool.execute({ prompt: "a banner", aspect_ratio: "16:9", background: "transparent" }, context(hostFor(grok, () => ({ images: [{ data: square, mimeType: "image/jpeg" }], route: "images" }))));
	const said = textOf(ignored);
	assert.match(said, /did not keep to 16:9: the picture is 16×16/);
	assert.match(said, /opaque background, not a transparent one/);
	assert.equal((ignored.details as ImageGenerationDetails).status, "done", "still a drawing, with the truth told beside it");

	const kept = await imageTool.execute({ prompt: "a banner", aspect_ratio: "16:9" }, context(hostFor(grok, () => ({ images: [{ data: JPEG_16x9, mimeType: "image/jpeg" }], route: "images" }))));
	assert.doesNotMatch(textOf(kept), /did not keep/);
});
