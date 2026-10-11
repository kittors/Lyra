/**
 * The host side of `image_generate`, built once per turn from that turn's settings and transcript.
 */

import type { Message } from "../types/message.ts";
import type { ProviderConfig } from "../types/provider.ts";
import { generateImages } from "./generate.ts";
import { imageModelRows, resolveImageModel } from "./models.ts";
import { conversationPictures, RECENT_IMAGES_KEY } from "./recent.ts";
import type { ImageHost, ImagePointer } from "./types.ts";

/**
 * Attempts per drawing, the first included — fixed, not the user's retry policy.
 *
 * That policy is written for a conversation: "keep trying until the network is back" is the right
 * answer for a reply you are waiting on. A drawing is a single paid call inside a turn, and the
 * failure an image model actually gives — quota spent until the pool resets, hours away — is one an
 * unlimited policy would wait out with the card spinning and the turn held open. Two retries ride
 * out a hiccup; anything longer is better reported than waited for.
 */
const ATTEMPTS = 3;

export function imageHost(input: {
	providers: readonly ProviderConfig[];
	preferred: string | null | undefined;
	messages: readonly Message[];
	state: Map<string, unknown>;
}): ImageHost | undefined {
	if (imageModelRows(input.providers).length === 0) return undefined;
	return {
		resolve(asked) {
			const found = resolveImageModel(input.providers, input.preferred, asked);
			if (found.row) return found.row;
			const names = found.candidates.map((row) => `${row.model.modelId} (${row.provider.name})`).join(", ");
			return {
				problem:
					found.reason === "ambiguous"
						? `"${asked}" matches more than one image model: ${names}. Pass one of these exactly.`
						: `No image model called "${asked}" is configured. Available: ${names}. Use one of these, or tell the user to add the model in Settings → Models.`,
			};
		},
		generate: (target, request, options = {}) =>
			generateImages(target.provider, target.model, request, { signal: options.signal, onRetry: options.onRetry, retryAttempts: ATTEMPTS }),
		pictures: () => conversationPictures(input.messages, (input.state.get(RECENT_IMAGES_KEY) as ImagePointer[] | undefined) ?? []),
	};
}
