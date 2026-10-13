/**
 * Video models beside image models, and the four levels a request's model is picked from.
 *
 * The rules a conversation leans on every time it draws or films: a name misread as a video model
 * disappears from the chat picker, and a pick that resolves to the wrong row is billed to the person.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { isImageModel, isMediaModel, isVideoModel, isVideoModelId, mediaKind, mediaModelLabel, mediaModelRows, resolveMediaModel } from "../src/images/models.ts";
import type { ModelConfig, ProviderConfig } from "../src/types/provider.ts";

const model = (providerId: string, modelId: string, extra: Partial<ModelConfig> = {}): ModelConfig => ({
	id: `${providerId}/${modelId}`,
	providerId,
	modelId,
	name: modelId,
	contextWindow: 0,
	maxOutputTokens: 0,
	supportsThinking: false,
	supportsImages: true,
	supportsTools: true,
	...extra,
});

const provider = (id: string, models: ModelConfig[], name = id, enabled = true): ProviderConfig => ({
	id,
	name,
	baseUrl: "https://relay.example",
	api: "openai-responses",
	apiKey: "k",
	enabled,
	models,
});

test("video models are recognised by name, across the houses that make them", () => {
	for (const id of [
		"grok-imagine-video-1.5",
		"grok-imagine-video",
		"doubao-seedance-2-5-260628",
		"seedance-1-0-pro",
		"seedance2.5",
		"veo-3.1-generate-preview",
		"veo3",
		"sora-2-pro",
		"kling-v2-master",
		"MiniMax-Hailuo-02",
		"viduq1",
		"wan2.5-t2v-preview",
		"wanx2.1-i2v-plus",
		"wan2.2-kf2v-flash",
		"jimeng_vgfm_t2v_l20",
		"hunyuan-video",
		"ltx-video-0.9.7",
		"cogvideox-5b",
	]) {
		assert.equal(isVideoModelId(id), true, id);
	}
});

test("chat, vision and image models are not mistaken for video models", () => {
	for (const id of [
		"grok-4.7",
		"grok-imagine-image",
		"grok-imagine-image-quality",
		"gemini-3.1-flash-image",
		"doubao-seed-1-6-250615",
		"doubao-seedream-4-0-250828",
		"wanx2.1-t2i-turbo",
		"qwen-vl-max",
		"video-llava-7b",
		"gpt-5",
		"imagine-chat",
	]) {
		assert.equal(isVideoModelId(id), false, id);
	}
});

test("a video house that also draws keeps its two lines apart", () => {
	assert.equal(mediaKind(model("x", "grok-imagine-video-1.5")), "video");
	assert.equal(mediaKind(model("x", "grok-imagine-image")), "image");
	assert.equal(mediaKind(model("x", "grok-4.7")), null);
});

test("stored switches outrank the name, each only for its own kind", () => {
	assert.equal(mediaKind(model("p", "house-director", { videoOutput: true })), "video");
	assert.equal(mediaKind(model("p", "grok-imagine-video-1.5", { videoOutput: false })), null, "not a video model is a chat model, not an image model");
	assert.equal(mediaKind(model("p", "grok-imagine-video-1.5", { videoOutput: false, imageOutput: true })), "image");
	assert.equal(mediaKind(model("p", "grok-imagine-video-1.5", { imageOutput: false })), "video", "the image switch says nothing about video");
	assert.equal(mediaKind(model("p", "house", { imageOutput: true, videoOutput: true })), "video", "both stored: video wins, as the names are read");
	assert.equal(isImageModel(model("p", "gemini-3.1-flash-image", { videoOutput: true })), false);
	assert.equal(isVideoModel(model("p", "gemini-3.1-flash-image", { videoOutput: true })), true);
	assert.equal(isMediaModel(model("p", "gpt-5")), false);
});

test("rows are per kind, on enabled providers, in configured order", () => {
	const providers = [
		provider("off", [model("off", "veo-3.1-generate-preview")], "off", false),
		provider("grok", [model("grok", "grok-4.7"), model("grok", "grok-imagine-image"), model("grok", "grok-imagine-video-1.5")]),
		provider("ark", [model("ark", "doubao-seedance-2-5-260628")]),
	];
	assert.deepEqual(mediaModelRows(providers, "image").map((row) => row.model.id), ["grok/grok-imagine-image"]);
	assert.deepEqual(mediaModelRows(providers, "video").map((row) => row.model.id), ["grok/grok-imagine-video-1.5", "ark/doubao-seedance-2-5-260628"]);
});

test("the four levels: named, this conversation, the default, the first", () => {
	const providers = [provider("relay", [model("relay", "gemini-3.1-flash-image"), model("relay", "grok-imagine-image"), model("relay", "grok-imagine-image-quality")])];
	const first = "relay/gemini-3.1-flash-image";
	const grok = "relay/grok-imagine-image";
	const quality = "relay/grok-imagine-image-quality";

	assert.deepEqual(pickOf(resolveMediaModel(providers, "image", {})), [first, "auto"]);
	assert.deepEqual(pickOf(resolveMediaModel(providers, "image", { preferred: grok })), [grok, "default"]);
	assert.deepEqual(pickOf(resolveMediaModel(providers, "image", { session: quality, preferred: grok })), [quality, "session"]);
	assert.deepEqual(pickOf(resolveMediaModel(providers, "image", { session: quality, preferred: grok }, "gemini")), [first, "asked"]);
});

test("a stored pick that no longer resolves is stepped over and reported, not obeyed or fatal", () => {
	const providers = [provider("relay", [model("relay", "gemini-3.1-flash-image"), model("relay", "grok-imagine-image")])];
	const gone = resolveMediaModel(providers, "image", { session: "relay/deleted", preferred: "relay/grok-imagine-image" });
	assert.equal(gone.row?.model.id, "relay/grok-imagine-image");
	assert.equal(gone.row && gone.source, "default");
	assert.deepEqual(gone.row && gone.stale, ["session"]);

	const both = resolveMediaModel(providers, "image", { session: "relay/deleted", preferred: "other/gone" });
	assert.equal(both.row?.model.id, "relay/gemini-3.1-flash-image");
	assert.deepEqual(both.row && both.stale, ["session", "default"]);

	const wrongKind = resolveMediaModel(providers, "video", { session: "relay/grok-imagine-image" });
	assert.equal(wrongKind.row, undefined, "no video models at all is `none`, whatever was stored");
	assert.equal("reason" in wrongKind && wrongKind.reason, "none");
});

test("two providers with the same model can each be named, in the spelling the error offers", () => {
	const rows = [
		provider("a", [model("a", "gpt-image-1")], "Relay A"),
		provider("b", [model("b", "gpt-image-1"), model("b", "dall-e-3")], "Relay B"),
	];
	const all = mediaModelRows(rows, "image");
	assert.deepEqual(all.map((row) => mediaModelLabel(row, all)), ["gpt-image-1 (Relay A)", "gpt-image-1 (Relay B)", "dall-e-3"]);

	const bare = resolveMediaModel(rows, "image", {}, "gpt-image-1");
	assert.equal("reason" in bare && bare.reason, "ambiguous");
	for (const row of all) {
		const label = mediaModelLabel(row, all);
		assert.equal(resolveMediaModel(rows, "image", {}, label).row?.model.id, row.model.id, label);
	}
	assert.equal(resolveMediaModel(rows, "image", {}, "Relay B/gpt-image-1").row?.model.id, "b/gpt-image-1");
	assert.equal(resolveMediaModel(rows, "image", {}, "b/gpt-image-1").row?.model.id, "b/gpt-image-1", "the local id always works");
});

test("twins under providers that also share a name fall back to the local id", () => {
	const rows = [provider("a", [model("a", "veo-3")], "Google"), provider("b", [model("b", "veo-3")], "Google")];
	const all = mediaModelRows(rows, "video");
	assert.deepEqual(all.map((row) => mediaModelLabel(row, all)), ["a/veo-3", "b/veo-3"]);
	assert.equal(resolveMediaModel(rows, "video", {}, "b/veo-3").row?.model.id, "b/veo-3");
});

function pickOf(pick: ReturnType<typeof resolveMediaModel>): [string | undefined, string | undefined] {
	return pick.row ? [pick.row.model.id, pick.source] : [undefined, undefined];
}
