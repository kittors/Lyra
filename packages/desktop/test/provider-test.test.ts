/**
 * The connection test on the settings page: one request, shaped like a conversation's.
 *
 * It used to post `/v1/responses` for every provider that was not Anthropic, so a Chat Completions
 * endpoint failed its test while its conversations worked, and it sent none of the provider's own
 * headers. These hold the request to the adapter's: the same URL, the same headers, the same model.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiFormat, ModelConfig, ProviderConfig } from "@lyra/core";
import { fetchEndpointModels, testProvider } from "../electron/providers.ts";

const frame = (type: string, rest: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`;
const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
	`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

/** A short reply, in each wire's own stream format. */
const REPLY: Record<ApiFormat, string> = {
	"openai-responses":
		frame("response.output_item.added", { output_index: 0, item: { type: "message", id: "m1" } }) +
		frame("response.output_text.delta", { output_index: 0, delta: "ok" }) +
		frame("response.completed", { response: { usage: { input_tokens: 3, output_tokens: 1 } } }),
	"openai-chat-completions": chunk({ content: "ok" }) + chunk({}, "stop") + "data: [DONE]\n\n",
	"anthropic-messages":
		frame("message_start", { message: { id: "msg_1", usage: { input_tokens: 3, output_tokens: 1 } } }) +
		frame("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
		frame("content_block_delta", { index: 0, delta: { type: "text_delta", text: "ok" } }) +
		frame("content_block_stop", { index: 0 }) +
		frame("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }) +
		frame("message_stop"),
};

const ENDPOINT: Record<ApiFormat, string> = {
	"openai-responses": "https://api.example.com/v1/responses",
	"openai-chat-completions": "https://api.example.com/v1/chat/completions",
	"anthropic-messages": "https://api.example.com/v1/messages",
};

interface Seen {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown> | null;
}

/** Swap the global fetch for one that records every request and answers with `answer`. */
async function withFetch(answer: (url: string, init: RequestInit | undefined) => Response, run: (seen: Seen[]) => Promise<void>): Promise<void> {
	const seen: Seen[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = input.toString();
		const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
		seen.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
		return answer(url, init);
	}) as typeof fetch;
	try {
		await run(seen);
	} finally {
		globalThis.fetch = original;
	}
}

const sse = (text: string) => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });

const model = (id: string, name: string, modelId: string): ModelConfig => ({
	id,
	providerId: "prov-1",
	name,
	modelId,
	contextWindow: 200000,
	maxOutputTokens: 8192,
	supportsThinking: false,
	supportsImages: false,
	supportsTools: true,
});

function relay(api: ApiFormat): ProviderConfig {
	return {
		id: "prov-1",
		name: "Test Relay",
		baseUrl: "https://api.example.com/v1",
		apiKey: "sk-test",
		api,
		enabled: true,
		headers: { "x-relay-route": "team-a" },
		models: [model("m-1", "GPT 4o", "gpt-4o"), model("m-2", "Claude Sonnet", "claude-3-5-sonnet")],
	};
}

test("each protocol is tested at the endpoint its conversations use, with the provider's own headers", async () => {
	for (const api of Object.keys(ENDPOINT) as ApiFormat[]) {
		await withFetch(
			() => sse(REPLY[api]),
			async (seen) => {
				const result = await testProvider(relay(api), "m-2");
				assert.equal(result.ok, true, `${api}: ${result.message}`);
				assert.deepEqual(seen.map((request) => request.url), [ENDPOINT[api]], `${api}: one request, and no listing for a single model`);
				assert.equal(seen[0].headers["x-relay-route"], "team-a", api);
				assert.equal(seen[0].body?.model, "claude-3-5-sonnet", api);
				assert.equal(seen[0].body?.stream, true, `${api}: streamed, like a conversation`);
				assert.equal(result.models, undefined);
			},
		);
	}
});

test("testing the provider as a whole lists its models with the same headers a conversation sends", async () => {
	await withFetch(
		(url) => (url.endsWith("/models") ? Response.json({ data: [{ id: "gpt-4o" }, { id: "claude-3-5-sonnet" }] }) : sse(REPLY["openai-chat-completions"])),
		async (seen) => {
			const result = await testProvider(relay("openai-chat-completions"));
			assert.equal(result.ok, true, result.message);
			assert.deepEqual(result.models, ["gpt-4o", "claude-3-5-sonnet"]);
			assert.equal(seen[0].url, "https://api.example.com/v1/models");
			assert.equal(seen[0].headers.authorization, "Bearer sk-test");
			assert.equal(seen[0].headers["x-relay-route"], "team-a");
			assert.equal(seen[1].url, ENDPOINT["openai-chat-completions"]);
		},
	);
	await withFetch(
		() => Response.json({ data: [{ id: "b" }, { id: "a" }] }),
		async (seen) => {
			assert.deepEqual(await fetchEndpointModels(relay("anthropic-messages")), { ok: true, models: ["a", "b"] });
			assert.equal(seen[0].headers["x-api-key"], "sk-test");
			assert.equal(seen[0].headers["x-relay-route"], "team-a");
		},
	);
});

test("a refused request is reported with what the endpoint said, after one attempt", async () => {
	await withFetch(
		() => Response.json({ error: { message: "Incorrect API key provided" } }, { status: 401 }),
		async (seen) => {
			const result = await testProvider(relay("openai-chat-completions"), "m-1");
			assert.equal(result.ok, false);
			assert.match(result.message, /Incorrect API key provided/);
			assert.equal(seen.length, 1, "a test reports the failure instead of retrying it");
		},
	);
});

test("the test stops at the first token — reasoning included — instead of waiting for the reply to end", async () => {
	let cutOff = false;
	await withFetch(
		(_url, init) => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(chunk({ reasoning_content: "Let me think" })));
					// Never closes, like an endpoint still generating: only the test's abort ends it.
					init?.signal?.addEventListener("abort", () => {
						cutOff = true;
						controller.error(new DOMException("The operation was aborted.", "AbortError"));
					});
				},
			});
			return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		},
		async () => {
			const result = await testProvider(relay("openai-chat-completions"), "m-1");
			assert.equal(result.ok, true, result.message);
			assert.ok(cutOff, "the request was cut off once the first token arrived");
		},
	);
});

test("a model that is not configured fails without sending anything", async () => {
	await withFetch(
		() => sse(""),
		async (seen) => {
			const result = await testProvider({ ...relay("openai-responses"), models: [] }, "non-existent-id");
			assert.equal(result.ok, false);
			assert.match(result.message, /未找到指定的模型/);
			assert.equal(seen.length, 0);
		},
	);
});
