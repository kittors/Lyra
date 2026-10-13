/**
 * A refusal that arrives as the answer, through the real Responses adapter: not retried.
 *
 * The shape recorded on 2026-10-13: Gemini behind a relay streams "The prompt could not be submitted …
 * Prohibited Use policy …" as `output_text.delta`, then the relay closes with a generic in-stream
 * `error`. Read from the error alone it was a hiccup, and every retry streamed the same refusal again.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { openaiResponsesProvider } from "../src/ai/openai-responses.ts";
import type { AssistantMessage } from "../src/types.ts";

const REFUSAL =
	"The prompt could not be submitted. The prompt contains sensitive words that violate Google's Generative AI Prohibited Use policy. Try rephrasing the prompt. If you think this was an error, send feedback.";

const frame = (type: string, body: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`;

function refusedThenClosed(text: string): string {
	return [
		frame("response.created", { response: { id: "resp_1" } }),
		frame("response.output_item.added", { output_index: 0, item: { type: "message", role: "assistant", content: [] } }),
		...(text.match(/.{1,24}/gs) ?? []).map((piece) => frame("response.output_text.delta", { output_index: 0, content_index: 0, delta: piece })),
		frame("error", { code: "internal_server_error", message: "response_stream_incomplete: upstream responses stream closed before response.completed", sequence_number: 0 }),
	].join("");
}

const provider = { id: "relay", name: "relay", baseUrl: "https://example.invalid", api: "openai-responses" as const, apiKey: "test", enabled: true, models: [] };
const model = { modelId: "gemini-3.8-flash-high", contextWindow: 128000, maxOutputTokens: 4096 };

async function run(sse: string): Promise<{ message: AssistantMessage; requests: number; retries: number }> {
	let requests = 0;
	let retries = 0;
	const stream = openaiResponsesProvider.stream(
		provider,
		model,
		{ systemPrompt: "", messages: [{ role: "user", content: [{ type: "text", text: "draw it" }], timestamp: 0 }], tools: [] },
		{
			// oxlint-disable-next-line no-explicit-any -- a fake fetch answering every attempt with the same stream
			fetch: (async () => {
				requests++;
				return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
			}) as any,
			// Retries on, with a one-second floor: a retried refusal would show up as a second request.
			retryAttempts: 3,
			retryPolicy: { upstream: { retries: 2, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 } },
			onRetry: () => {
				retries++;
			},
		},
	);
	let last: AssistantMessage | undefined;
	while (true) {
		const next = await stream.next();
		if (next.done) {
			last = next.value;
			break;
		}
	}
	assert.ok(last);
	return { message: last, requests, retries };
}

test("a refusal streamed as the answer and closed by a generic error is final: one request, no retry", async () => {
	const { message, requests, retries } = await run(refusedThenClosed(REFUSAL));
	assert.equal(requests, 1, "the same refusal was asked for again");
	assert.equal(retries, 0);
	assert.equal(message.stopReason, "error");
	assert.equal(message.errorRetryable, false);
	assert.equal(message.failure?.kind, "fatal");
	assert.equal(message.failure?.hint, "blocked");
	const shown = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
	assert.ok(shown.includes("Prohibited Use policy"), "the provider's own words stay in the reply");
});

test("the same close after an ordinary half-answer is still retried", async () => {
	const { requests, retries } = await run(refusedThenClosed("Here is the first half of a perfectly ordinary answer"));
	assert.ok(requests > 1 && retries > 0, `a hiccup after ordinary text was not retried (${requests} requests)`);
});
