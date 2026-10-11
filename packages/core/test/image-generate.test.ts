/**
 * Drawing over the wire, against a fake host that answers the way real ones do.
 *
 * The shapes are the ones measured on a CliRelay relay in front of Gemini and on OpenAI's own API:
 * JSON generations, JSON or multipart edits, `n` run one per request, JPEG under an API that implies
 * PNG, a chat completion with the picture in `message.images`, and a quota that is spent for hours.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { imageDimensions, sniffImageType } from "../src/images/dimensions.ts";
import { generateImages, resetImageRoutes } from "../src/images/generate.ts";
import { viaChatCompletions } from "../src/images/chat-images.ts";
import { viaImagesApi } from "../src/images/openai-images.ts";
import type { ModelConfig, ProviderConfig } from "../src/types/provider.ts";

/** 1×1 PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** A JPEG header carrying a 1408×768 frame — what the relay sends back for a 16:9 Gemini picture. */
const JPEG = Buffer.from([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
	0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x00, 0x05, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
]).toString("base64");

const provider = (baseUrl = "https://relay.example"): ProviderConfig => ({ id: "relay", name: "Relay", baseUrl, api: "openai-responses", apiKey: "sk-test", enabled: true, models: [] });
const model = (modelId: string): ModelConfig => ({
	id: `relay/${modelId}`,
	providerId: "relay",
	modelId,
	name: modelId,
	contextWindow: 0,
	maxOutputTokens: 0,
	supportsThinking: false,
	supportsImages: true,
	supportsTools: false,
});

interface Seen {
	url: string;
	headers: Headers;
	json?: Record<string, unknown>;
	form?: FormData;
}

/** A host whose every answer comes from `reply`, with every request kept for the assertions. */
function host(reply: (seen: Seen, index: number) => Response | Promise<Response>) {
	const seen: Seen[] = [];
	const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		const body = init?.body;
		const entry: Seen = { url: String(input), headers };
		if (typeof body === "string") entry.json = JSON.parse(body) as Record<string, unknown>;
		else if (body instanceof FormData) entry.form = body;
		seen.push(entry);
		return reply(entry, seen.length - 1);
	}) as typeof globalThis.fetch;
	return { seen, fetch };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("a picture's size and type come from its own bytes", () => {
	assert.deepEqual(imageDimensions(Buffer.from(PNG, "base64")), { width: 1, height: 1 });
	assert.deepEqual(imageDimensions(Buffer.from(JPEG, "base64")), { width: 1408, height: 768 });
	assert.equal(sniffImageType(Buffer.from(JPEG, "base64")), "image/jpeg");
	assert.equal(imageDimensions(Buffer.from("not an image")), null);
});

test("a generation is one JSON request, and a JPEG answer is called a JPEG", async () => {
	const relay = host(() => json({ data: [{ b64_json: JPEG }], usage: { input_tokens: 37, output_tokens: 1518, total_tokens: 1555 } }));
	const result = await viaImagesApi(provider(), model("gemini-3.1-flash-image"), { prompt: "a paper boat", aspectRatio: "16:9", quality: "high" }, { fetch: relay.fetch, retryAttempts: 1 });
	assert.equal(relay.seen.length, 1);
	assert.equal(relay.seen[0].url, "https://relay.example/v1/images/generations");
	assert.equal(relay.seen[0].headers.get("authorization"), "Bearer sk-test");
	assert.deepEqual(relay.seen[0].json, { model: "gemini-3.1-flash-image", prompt: "a paper boat", n: 1, response_format: "b64_json", aspect_ratio: "16:9", image_size: "2K" });
	assert.equal(result.images[0].mimeType, "image/jpeg");
	assert.equal(result.route, "images");
	assert.deepEqual(result.usage, { input: 37, output: 1518, total: 1555 });
});

test("several Gemini pictures go side by side, and one refusal costs one picture, not all", async () => {
	const relay = host((_, index) => (index === 1 ? json({ error: { message: "upstream returned no image", type: "server_error" } }, 400) : json({ data: [{ b64_json: PNG }] })));
	const result = await viaImagesApi(provider(), model("gemini-3.1-flash-image"), { prompt: "three boats", count: 3 }, { fetch: relay.fetch, retryAttempts: 1 });
	assert.equal(relay.seen.length, 3);
	assert.ok(relay.seen.every((entry) => entry.json?.n === 1), "each request asks for one");
	assert.equal(result.images.length, 2);
	assert.equal(result.failures?.length, 1);
});

test("gpt-image asks for its pictures in one request", async () => {
	const relay = host(() => json({ data: [{ b64_json: PNG, revised_prompt: "a small boat" }, { b64_json: PNG }] }));
	const result = await viaImagesApi(provider("https://api.openai.com"), model("gpt-image-1"), { prompt: "a boat", count: 2 }, { fetch: relay.fetch, retryAttempts: 1 });
	assert.equal(relay.seen.length, 1);
	assert.equal(relay.seen[0].json?.n, 2);
	assert.equal(relay.seen[0].json?.response_format, undefined, "gpt-image refuses response_format");
	assert.equal(result.revisedPrompt, "a small boat");
});

test("a Gemini edit sends its pictures as data URLs in JSON", async () => {
	const relay = host(() => json({ data: [{ b64_json: PNG }] }));
	await viaImagesApi(provider(), model("gemini-3.1-flash-image"), { prompt: "make it blue", images: [{ data: PNG, mimeType: "image/png" }] }, { fetch: relay.fetch, retryAttempts: 1 });
	assert.equal(relay.seen[0].url, "https://relay.example/v1/images/edits");
	assert.deepEqual(relay.seen[0].json?.image, [`data:image/png;base64,${PNG}`]);
});

test("an OpenAI edit is multipart, with the picture as a file", async () => {
	const relay = host(() => json({ data: [{ b64_json: PNG }] }));
	await viaImagesApi(provider("https://api.openai.com/v1"), model("gpt-image-1"), { prompt: "make it blue", images: [{ data: PNG, mimeType: "image/png" }] }, { fetch: relay.fetch, retryAttempts: 1 });
	assert.equal(relay.seen[0].url, "https://api.openai.com/v1/images/edits", "a base URL ending in /v1 is not doubled");
	const form = relay.seen[0].form;
	assert.ok(form, "sent as a form");
	assert.equal(form.get("model"), "gpt-image-1");
	const file = form.get("image");
	assert.ok(file instanceof Blob && file.size > 0, "the picture is a file part");
});

test("a picture handed back as a link is fetched, without the key", async () => {
	const relay = host((seen) => (seen.url.endsWith("/images/generations") ? json({ data: [{ url: "https://cdn.example/p.png" }] }) : new Response(Buffer.from(PNG, "base64"), { headers: { "content-type": "image/png" } })));
	const result = await viaImagesApi(provider(), model("flux-1.1-pro"), { prompt: "a boat" }, { fetch: relay.fetch, retryAttempts: 1 });
	assert.equal(relay.seen[1].url, "https://cdn.example/p.png");
	assert.equal(relay.seen[1].headers.get("authorization"), null);
	assert.equal(result.images[0].data, Buffer.from(PNG, "base64").toString("base64"));
});

test("a spent quota is final at once, and says how long it lasts", async () => {
	const body = { error: { message: JSON.stringify({ error: { code: 429, message: "You have exhausted your capacity on this model. Your quota will reset after 1h52m45s.", status: "RESOURCE_EXHAUSTED" } }), type: "invalid_request_error" } };
	const relay = host(() => json(body, 429));
	await assert.rejects(
		viaImagesApi(provider(), model("gemini-3.1-flash-image"), { prompt: "a boat" }, { fetch: relay.fetch, retryAttempts: 3 }),
		(error: { failure?: { hint?: string; retryAfterMs?: number; kind?: string } }) => {
			assert.equal(error.failure?.hint, "check-billing");
			assert.equal(error.failure?.kind, "fatal");
			assert.equal(error.failure?.retryAfterMs, 6_765_000);
			return true;
		},
	);
	assert.equal(relay.seen.length, 1, "not retried: the answer was not going to change");
});

test("a chat completion's picture is read from message.images", async () => {
	const relay = host(() =>
		json({ choices: [{ message: { content: null, images: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${JPEG}` }, index: 0 }] } }], usage: { prompt_tokens: 9, completion_tokens: 1290, total_tokens: 1299 } }),
	);
	const result = await viaChatCompletions(provider(), model("gemini-3.1-flash-image"), { prompt: "a boat", aspectRatio: "21:9", quality: "max" }, { fetch: relay.fetch, retryAttempts: 1 });
	assert.equal(relay.seen[0].url, "https://relay.example/v1/chat/completions");
	assert.deepEqual(relay.seen[0].json?.modalities, ["image", "text"]);
	assert.deepEqual(relay.seen[0].json?.image_config, { aspect_ratio: "21:9", image_size: "4K" });
	assert.equal(result.images[0].mimeType, "image/jpeg");
	assert.equal(result.route, "chat");
});

test("a chat answer with the picture inline in markdown, or in a content array, is read too", async () => {
	const markdown = host(() => json({ choices: [{ message: { content: `Here it is:\n![boat](data:image/png;base64,${PNG})` } }] }));
	assert.equal((await viaChatCompletions(provider(), model("gemini-2.5-flash-image"), { prompt: "a boat" }, { fetch: markdown.fetch, retryAttempts: 1 })).images.length, 1);
	const parts = host(() => json({ choices: [{ message: { content: [{ type: "text", text: "ok" }, { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }] } }] }));
	assert.equal((await viaChatCompletions(provider(), model("gemini-2.5-flash-image"), { prompt: "a boat" }, { fetch: parts.fetch, retryAttempts: 1 })).images.length, 1);
	const words = host(() => json({ choices: [{ message: { content: "I can't draw that." } }] }));
	await assert.rejects(viaChatCompletions(provider(), model("gemini-2.5-flash-image"), { prompt: "a boat" }, { fetch: words.fetch, retryAttempts: 1 }), /answered in words instead of drawing: I can't draw that/);
});

test("a host without the Images API is tried over chat once, and remembered", async () => {
	resetImageRoutes();
	const openrouterLike = host((seen) =>
		seen.url.endsWith("/images/generations")
			? json({ error: { message: "Not Found" } }, 404)
			: json({ choices: [{ message: { images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }] } }] }),
	);
	const options = { fetch: openrouterLike.fetch, retryAttempts: 1 };
	const first = await generateImages(provider("https://chat-only.example"), model("gemini-2.5-flash-image"), { prompt: "a boat" }, options);
	assert.equal(first.route, "chat");
	assert.deepEqual(openrouterLike.seen.map((entry) => new URL(entry.url).pathname), ["/v1/images/generations", "/v1/chat/completions"]);
	await generateImages(provider("https://chat-only.example"), model("gemini-2.5-flash-image"), { prompt: "another" }, options);
	assert.equal(openrouterLike.seen.length, 3, "the second picture goes straight to chat");
});

test("a refusal that is about the request, not the endpoint, is not tried elsewhere", async () => {
	resetImageRoutes();
	const forbidden = host(() => json({ error: { code: "model_not_allowed", message: "model 'gemini-3.1-flash-image' is not allowed for this API key", type: "forbidden" } }, 403));
	await assert.rejects(generateImages(provider(), model("gemini-3.1-flash-image"), { prompt: "a boat" }, { fetch: forbidden.fetch, retryAttempts: 1 }), /没有访问权限|not allowed/);
	assert.equal(forbidden.seen.length, 1);
});
