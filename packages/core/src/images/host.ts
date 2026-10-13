/**
 * The host side of `image_generate`: built once per turn, reading its model at every call.
 *
 * The transcript it numbers pictures from is the turn's; which model draws is read from the live
 * settings and the conversation's pick each time (`picks.ts`), so a switch made while the agent is
 * drawing applies to its next picture.
 */

import type { Message } from "../types/message.ts";
import { generateImages } from "./generate.ts";
import { mediaModelRows } from "./models.ts";
import { mediaNames, type MediaSource, type NamedPicks, pickMedia, pickProblem } from "./picks.ts";
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
	source: MediaSource;
	/** This turn's tally of models asked for by name; absent where a name must not move the conversation's pick. */
	named?: NamedPicks;
	messages: readonly Message[];
	state: Map<string, unknown>;
}): ImageHost | undefined {
	if (mediaModelRows(input.source.settings().providers, "image").length === 0) return undefined;
	return {
		resolve(asked) {
			const pick = pickMedia(input.source, "image", asked);
			return pick.row ? pick.row : { problem: pickProblem("image", asked, pick) };
		},
		names: (filter) => mediaNames(input.source, "image", filter),
		adopt: (target) => input.named?.adopt("image", target.model.id),
		generate: (target, request, options = {}) =>
			generateImages(target.provider, target.model, request, { signal: options.signal, onRetry: options.onRetry, retryAttempts: ATTEMPTS }),
		pictures: () => conversationPictures(input.messages, (input.state.get(RECENT_IMAGES_KEY) as ImagePointer[] | undefined) ?? []),
	};
}
