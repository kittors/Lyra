/**
 * Is this provider reachable, and how quickly.
 *
 * A real request rather than a models listing: what the settings page is really asking is whether a
 * conversation would work, and only a request shaped like a conversation's answers that.
 */

import type { ProviderTestResult, SyncStatus } from "./ipc-types.ts";
import { streamAssistant, type AssistantMessage, type Settings, type StreamEvent, type ThinkingLevel } from "@lyra/core";
import { getSettings } from "./app-settings.ts";
import { nativeText } from "./i18n.ts";

type Provider = Settings["providers"][number];

/** How long the first token may take before the test gives up. */
const ANSWER_TIMEOUT_MS = 30_000;

/** What sync looks like when it is not running: the port it would use, and nothing else. */
export function idleSyncStatus(): SyncStatus {
	const settings = getSettings();
	return {
		running: false,
		port: settings?.sync.port ?? 4517,
		token: settings?.sync.token ?? null,
		addresses: [],
		clients: 0,
		pairingUrl: null,
		// Configured rather than discovered, so they are known even while the server is stopped —
		// the settings page shows the fields either way.
		publicUrl: settings?.sync.publicUrl?.trim() || null,
		relayUrl: settings?.sync.relayUrl?.trim() || null,
	};
}

/**
 * Where a provider lists its models: `/v1/models`, whether or not the base URL already ends in `/v1`.
 */
function modelsUrl(provider: Provider): string {
	const base = provider.baseUrl.replace(/\/+$/, "");
	return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
}

/**
 * The credentials a listing is asked with, plus the provider's own headers — the same ones every
 * conversation request carries. Without them, a relay that routes or authorises on a header answered
 * the listing differently from the conversation it was supposed to predict.
 */
function listingHeaders(provider: Provider): Record<string, string> {
	return {
		...(provider.api === "anthropic-messages"
			? { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" }
			: { authorization: `Bearer ${provider.apiKey}` }),
		...provider.headers,
	};
}

/**
 * Probe a provider: list its models when testing the provider as a whole (free, and many relays do
 * not expose a listing, so a failure there is not fatal), then send one real request.
 *
 * `thinking` is the level a new conversation would use, so the request is the one a conversation
 * would send — thinking parameters included, which is where Gemini behind Chat Completions used to fail.
 */
export async function testProvider(
	provider: Provider,
	targetModelId?: string,
	thinking: ThinkingLevel = "off",
): Promise<ProviderTestResult> {
	const started = Date.now();

	let models: string[] | undefined;
	// Only fetch the full model catalogue if testing the provider as a whole (no specific model requested)
	if (!targetModelId) {
		try {
			const listed = await fetch(modelsUrl(provider), {
				headers: listingHeaders(provider),
				signal: AbortSignal.timeout(15_000),
			});
			if (listed.ok) {
				const body = (await listed.json()) as { data?: { id?: string }[] };
				models = body.data?.map((m) => m.id ?? "").filter(Boolean).slice(0, 200);
			}
		} catch {
			models = undefined;
		}
	}

	const model = targetModelId
		? provider.models.find((m) => m.id === targetModelId || m.modelId === targetModelId)
		: provider.models[0];

	if (!model) {
		if (targetModelId) {
			return { ok: false, latencyMs: Date.now() - started, message: nativeText("provider.modelNotFound") };
		}
		return models
			? { ok: true, latencyMs: Date.now() - started, message: nativeText("provider.listed", { n: models.length }), models }
			: { ok: false, latencyMs: Date.now() - started, message: nativeText("provider.needModel") };
	}

	const reply = await firstToken(provider, model, thinking);
	return reply.ok
		? { ok: true, latencyMs: reply.latencyMs, message: nativeText("provider.responded", { model: model.name || model.modelId }), models }
		: { ok: false, latencyMs: reply.latencyMs, message: reply.message, models };
}

/** What counts as the endpoint having started to answer. Reasoning counts: it is a thinking model's first output. */
const ANSWERED: ReadonlySet<StreamEvent["type"]> = new Set(["text_delta", "thinking_delta", "toolcall_start"]);

/**
 * Send one request the way a conversation would send it, and stop at the first token.
 *
 * Through the adapter rather than a hand-built body, because a hand-built body only proves that the
 * hand-built body works. This used to post `/v1/responses` for every provider that was not Anthropic,
 * so a Chat Completions endpoint failed its test while its conversations worked; and it sent none of
 * the provider's own headers. The adapter is also the only thing that knows what an endpoint has
 * already taught it (which tokens field, which parameters it refuses), so the test now fails exactly
 * when a conversation would, and passes when one would.
 *
 * Stopping at the first token keeps the cost to a handful of tokens and makes the latency the number
 * a person feels — how long until the reply starts. One attempt only: the retry policy is for a
 * conversation that should survive a blip, and a test should report the blip.
 */
async function firstToken(
	provider: Provider,
	model: Provider["models"][number],
	thinking: ThinkingLevel,
): Promise<{ ok: true; latencyMs: number } | { ok: false; latencyMs: number; message: string }> {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, ANSWER_TIMEOUT_MS);
	const started = Date.now();
	let answeredAt: number | undefined;
	let final: AssistantMessage | undefined;
	try {
		const stream = streamAssistant(
			provider,
			model,
			{ systemPrompt: "", messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: started }], tools: [] },
			{ signal: controller.signal, thinking, retryAttempts: 1 },
		);
		// Drained to the end rather than abandoned, so the adapter unwinds through its own abort path.
		for (;;) {
			const next = await stream.next();
			if (next.done) {
				final = next.value;
				break;
			}
			if (answeredAt === undefined && ANSWERED.has(next.value.type)) {
				answeredAt = Date.now();
				controller.abort();
			}
		}
	} catch (error) {
		return { ok: false, latencyMs: Date.now() - started, message: error instanceof Error ? error.message : String(error) };
	} finally {
		clearTimeout(timer);
	}
	if (answeredAt !== undefined) return { ok: true, latencyMs: answeredAt - started };
	const latencyMs = Date.now() - started;
	if (timedOut) return { ok: false, latencyMs, message: nativeText("provider.noAnswer", { seconds: ANSWER_TIMEOUT_MS / 1000 }) };
	if (final && final.stopReason !== "error" && final.stopReason !== "aborted") return { ok: true, latencyMs };
	return { ok: false, latencyMs, message: final?.errorMessage ?? final?.failure?.summary ?? nativeText("provider.noAnswer", { seconds: ANSWER_TIMEOUT_MS / 1000 }) };
}

/**
 * Fetch available model list directly from the provider's /models endpoint.
 */
export async function fetchEndpointModels(
	provider: Provider,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
	try {
		const res = await fetch(modelsUrl(provider), {
			headers: listingHeaders(provider),
			signal: AbortSignal.timeout(15_000),
		});

		if (!res.ok) {
			const detail = (await res.text().catch(() => "")).slice(0, 200);
			return { ok: false, models: [], error: `HTTP ${res.status}: ${detail || nativeText("provider.listFailed")}` };
		}

		const body = (await res.json()) as { data?: { id?: string }[] } | { models?: { id?: string; name?: string }[] } | string[];
		let modelList: string[] = [];

		if (Array.isArray(body)) {
			modelList = body.filter((m): m is string => typeof m === "string");
		} else if (body && "data" in body && Array.isArray(body.data)) {
			modelList = body.data.map((m) => m.id ?? "").filter(Boolean);
		} else if (body && "models" in body && Array.isArray(body.models)) {
			modelList = body.models.map((m) => m.id ?? m.name ?? "").filter(Boolean);
		}

		// Sort models naturally
		modelList.sort((a, b) => a.localeCompare(b));

		return { ok: true, models: modelList };
	} catch (error) {
		return {
			ok: false,
			models: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
