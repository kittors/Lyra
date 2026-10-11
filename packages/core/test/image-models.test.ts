/**
 * Which models draw, which one a call means, and how each family is asked for a shape.
 *
 * Rules rather than plumbing, so they are pinned here one case at a time: a name misread as an image
 * model disappears from the chat picker, and a size a family does not accept is a refused request.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { imageModelRows, isImageModel, isImageModelId, resolveImageModel } from "../src/images/models.ts";
import { resetAfterMs } from "../src/images/quota.ts";
import { editsAsJson, imageFields, parseRatio, perRequestLimit } from "../src/images/shape.ts";
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

const provider = (id: string, models: ModelConfig[], enabled = true): ProviderConfig => ({
	id,
	name: id,
	baseUrl: "https://relay.example",
	api: "openai-responses",
	apiKey: "k",
	enabled,
	models,
});

test("image models are recognised by name, across the houses that make them", () => {
	for (const id of [
		"gpt-image-1",
		"gpt-image-2.5",
		"chatgpt-image-latest",
		"dall-e-3",
		"gemini-3.1-flash-image",
		"gemini-2.5-flash-image-preview",
		"gemini-3-pro-image-preview",
		"google/gemini-2.5-flash-image",
		"imagen-4.0-generate-001",
		"black-forest-labs/flux-1.1-pro",
		"flux.1-dev",
		"doubao-seedream-4-0-250828",
		"grok-2-image",
		"qwen-image",
		"nano-banana-pro",
	]) {
		assert.equal(isImageModelId(id), true, id);
	}
});

test("chat and vision models are not mistaken for image models", () => {
	for (const id of ["gpt-4o", "gpt-5", "o3", "gemini-3.8-flash-high", "gemini-2.5-flash", "claude-opus-4-5", "qwen3.8", "qwen-vl-max", "llama-3.2-11b-vision", "deepseek-v3", "glm-4v", "imagine-chat"]) {
		assert.equal(isImageModelId(id), false, id);
	}
});

test("a stored choice outranks the name, in both directions", () => {
	assert.equal(isImageModel(model("p", "gemini-3.1-flash-image", { imageOutput: false })), false);
	assert.equal(isImageModel(model("p", "house-artist", { imageOutput: true })), true);
	assert.equal(isImageModel(model("p", "house-artist")), false);
});

test("only enabled providers offer image models, in configured order", () => {
	const rows = imageModelRows([
		provider("off", [model("off", "gpt-image-1")], false),
		provider("relay", [model("relay", "gemini-3.8-flash-high"), model("relay", "gemini-3.1-flash-image")]),
		provider("openai", [model("openai", "gpt-image-1")]),
	]);
	assert.deepEqual(rows.map((row) => row.model.id), ["relay/gemini-3.1-flash-image", "openai/gpt-image-1"]);
});

test("the model a call means: named exactly, then uniquely in part, else the default", () => {
	const providers = [
		provider("relay", [model("relay", "gemini-3.1-flash-image"), model("relay", "gpt-image-2.5")]),
		provider("openai", [model("openai", "gpt-image-1"), model("openai", "dall-e-3")]),
	];
	assert.equal(resolveImageModel(providers, null).row?.model.id, "relay/gemini-3.1-flash-image");
	assert.equal(resolveImageModel(providers, "openai/dall-e-3").row?.model.id, "openai/dall-e-3");
	assert.equal(resolveImageModel(providers, "gone/model").row?.model.id, "relay/gemini-3.1-flash-image", "a default that no longer resolves falls back");
	assert.equal(resolveImageModel(providers, null, "GPT-Image-2.5").row?.model.id, "relay/gpt-image-2.5");
	assert.equal(resolveImageModel(providers, null, "dall").row?.model.id, "openai/dall-e-3");

	const ambiguous = resolveImageModel(providers, null, "gpt-image");
	assert.equal(ambiguous.row, undefined);
	assert.equal("reason" in ambiguous && ambiguous.reason, "ambiguous");

	const unknown = resolveImageModel(providers, null, "midjourney-v7");
	assert.equal("reason" in unknown && unknown.reason, "unknown", "an unknown name is not quietly replaced by the default");
	assert.equal(resolveImageModel([], null).row, undefined);
});

test("each family is asked for a shape the way it accepts one", () => {
	assert.deepEqual(imageFields("gpt-image-1", { aspectRatio: "16:9", quality: "max", background: "transparent" }), {
		size: "1536x1024",
		quality: "high",
		background: "transparent",
	});
	assert.deepEqual(imageFields("gpt-image-1", {}), { size: "auto" }, "gpt-image takes no response_format");
	assert.deepEqual(imageFields("dall-e-3", { aspectRatio: "9:16", quality: "high" }), { response_format: "b64_json", size: "1024x1792", quality: "hd" });
	// The relay refuses "16:9" as a size and ignores quality: shape and detail travel in its own fields.
	assert.deepEqual(imageFields("gemini-3.1-flash-image", { aspectRatio: "16:9", quality: "high" }), {
		response_format: "b64_json",
		aspect_ratio: "16:9",
		image_size: "2K",
	});
	assert.deepEqual(imageFields("gemini-3.1-flash-image", { quality: "medium" }), { response_format: "b64_json" }, "1K is the default and not worth saying");
	assert.deepEqual(imageFields("flux-1.1-pro", { aspectRatio: "16:9" }), { response_format: "b64_json", size: "1024x576" });
	assert.deepEqual(imageFields("flux-1.1-pro", { aspectRatio: "2:3" }), { response_format: "b64_json", size: "704x1024" });
});

test("one picture per request where the host would queue or refuse several", () => {
	assert.equal(perRequestLimit("dall-e-3"), 1);
	assert.equal(perRequestLimit("gemini-3.1-flash-image"), 1);
	assert.equal(perRequestLimit("gpt-image-1"), 4);
	assert.equal(editsAsJson("gemini-3-pro-image-preview"), true);
	assert.equal(editsAsJson("gpt-image-1"), false);
});

test("ratios read the way people write them", () => {
	assert.deepEqual(parseRatio("16:9"), { width: 16, height: 9 });
	assert.deepEqual(parseRatio(" 3 x 2 "), { width: 3, height: 2 });
	assert.equal(parseRatio("auto"), null);
	assert.equal(parseRatio("0:1"), null);
});

test("how long a spent quota says to wait, in each spelling it comes in", () => {
	assert.equal(resetAfterMs("Your quota will reset after 1h52m45s."), 6_765_000);
	assert.equal(resetAfterMs(String.raw`\"quotaResetDelay\": \"45.5s\"`), 45_500);
	assert.equal(resetAfterMs('{"error":{"code":"model_cooldown","reset_seconds":125}}'), 125_000);
	assert.equal(resetAfterMs("rate limited"), undefined);
});
