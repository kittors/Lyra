/**
 * The host side of `video_generate`: built once per turn, reading its model at every call — the video
 * counterpart of `images/host.ts`, sharing its picks (`images/picks.ts`) and its numbered pictures,
 * since a first frame is usually one of them.
 */

import { mediaModelRows } from "../images/models.ts";
import { mediaNames, type MediaSource, type NamedPicks, pickMedia, pickProblem } from "../images/picks.ts";
import { conversationPictures, RECENT_IMAGES_KEY } from "../images/recent.ts";
import type { ImagePointer } from "../images/types.ts";
import type { Message } from "../types/message.ts";
import { generateVideo } from "./generate.ts";
import type { VideoHost } from "./types.ts";

/** Attempts per request inside a task, the first included — submit and polls each; see `images/host.ts`. */
const ATTEMPTS = 3;

export function videoHost(input: { source: MediaSource; named?: NamedPicks; messages: readonly Message[]; state: Map<string, unknown> }): VideoHost | undefined {
	if (mediaModelRows(input.source.settings().providers, "video").length === 0) return undefined;
	return {
		resolve(asked) {
			const pick = pickMedia(input.source, "video", asked);
			return pick.row ? pick.row : { problem: pickProblem("video", asked, pick) };
		},
		names: (filter) => mediaNames(input.source, "video", filter),
		adopt: (target) => input.named?.adopt("video", target.model.id),
		generate: (target, request, options = {}) => generateVideo(target.provider, target.model, request, { ...options, retryAttempts: ATTEMPTS }),
		pictures: () => conversationPictures(input.messages, (input.state.get(RECENT_IMAGES_KEY) as ImagePointer[] | undefined) ?? []),
	};
}
