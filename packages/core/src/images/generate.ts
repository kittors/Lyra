/**
 * Draw with an image model, through whichever endpoint its provider actually has.
 *
 * There is no field that says. An OpenAI-compatible base URL may serve the Images API, chat
 * completions with image output, or both, and which one is a property of the host and the model
 * together: the same Gemini model is reachable through `/v1/images` on one relay and only through chat
 * on OpenRouter. So the first call tries the likelier route, a "this endpoint is not here" answer
 * switches to the other, and the route that worked is remembered for the rest of the run — one wasted
 * request per model per launch, not per picture.
 */

import { failureOf } from "../ai/failure.ts";
import type { ModelConfig, ProviderConfig } from "../types/provider.ts";
import { viaChatCompletions } from "./chat-images.ts";
import { viaImagesApi } from "./openai-images.ts";
import type { ImageCallOptions, ImageRequest, ImageResult, ImageRoute } from "./types.ts";

const learned = new Map<string, ImageRoute>();

/** Forget the routes learned so far. For tests. */
export function resetImageRoutes(): void {
	learned.clear();
}

function firstRoute(provider: ProviderConfig): ImageRoute {
	// OpenRouter has no Images API at all; every other host is likelier to have it than not.
	return /(?:^|\.)openrouter\.ai(?:[:/]|$)/i.test(provider.baseUrl.replace(/^https?:\/\//, "")) ? "chat" : "images";
}

/**
 * Whether a failure says the endpoint is missing, rather than that the request was wrong.
 *
 * 404 is the clear case (`check-model`). A 400 or 405 that says the route or model is unsupported is
 * the same answer from a host that words it differently. A refusal on content or quota is not, and
 * trying the other endpoint would only spend a second request on the same refusal.
 */
function endpointMissing(error: unknown): boolean {
	const failure = failureOf(error);
	if (failure.hint === "check-model") return true;
	if (failure.hint === "check-key" || failure.hint === "check-billing" || failure.hint === "blocked") return false;
	return /not\s+(?:supported|found|implemented|allowed)|unsupported|no\s+such|unknown\s+(?:url|endpoint|route|path)|invalid\s+(?:url|endpoint)|method\s+not\s+allowed/i.test(
		`${failure.summary} ${failure.detail ?? ""}`,
	);
}

export async function generateImages(
	provider: ProviderConfig,
	model: ModelConfig,
	request: ImageRequest,
	options: ImageCallOptions = {},
): Promise<ImageResult> {
	const key = `${provider.baseUrl}\n${model.modelId}`;
	const route = learned.get(key) ?? firstRoute(provider);
	const run = (via: ImageRoute) => (via === "images" ? viaImagesApi : viaChatCompletions)(provider, model, request, options);
	try {
		const result = await run(route);
		learned.set(key, route);
		return result;
	} catch (error) {
		if (options.signal?.aborted || !endpointMissing(error)) throw error;
		const other: ImageRoute = route === "images" ? "chat" : "images";
		try {
			const result = await run(other);
			learned.set(key, other);
			return result;
		} catch {
			// The first refusal is the informative one: it is the endpoint this model was expected on.
			throw error;
		}
	}
}
