/**
 * A request to draw, and what comes back — independent of which endpoint does the drawing.
 */

import type { RetryPolicySource } from "../config/retry-policy.ts";
import type { ModelConfig, ProviderConfig, RequestOptions } from "../types/provider.ts";

/** The tool's name, in one place: the transcript is searched for its results by it. */
export const IMAGE_TOOL_NAME = "image_generate";

/** An image going in: something to edit, or to draw after. */
export interface ImageInput {
	/** base64, no `data:` prefix. */
	data: string;
	mimeType: string;
	/** A file name for the multipart upload; some endpoints reject a part without one. */
	name?: string;
}

export interface ImageRequest {
	prompt: string;
	/** Present means an edit: these are the pictures the prompt is about. */
	images?: ImageInput[];
	/** `"16:9"` and friends; absent or `auto` leaves the shape to the model. */
	aspectRatio?: string;
	/** `max` is the largest the model offers — 4K on Gemini — and is slow to arrive over a relay. */
	quality?: "low" | "medium" | "high" | "max";
	count?: number;
	background?: "transparent" | "opaque";
}

export interface GeneratedImage {
	data: string;
	mimeType: string;
}

/** Which endpoint drew it: the Images API, or a chat completion asked for image output. */
export type ImageRoute = "images" | "chat";

export interface ImageResult {
	images: GeneratedImage[];
	/** What the provider says it actually drew from, when it rewrote the prompt. */
	revisedPrompt?: string;
	route: ImageRoute;
	usage?: { input?: number; output?: number; total?: number };
	/** Why the pictures that did not arrive did not, when only some of several did. */
	failures?: string[];
}

export interface ImageCallOptions {
	signal?: AbortSignal;
	fetch?: typeof globalThis.fetch;
	retryAttempts?: number;
	retryPolicy?: RetryPolicySource;
	onRetry?: RequestOptions["onRetry"];
}

/** A picture already in the conversation, not yet read: inline pixels or a file under `session-media`. */
export interface ImagePointer {
	data?: string;
	media?: string;
	mimeType: string;
}

/** One image model and the provider it is reached through. */
export interface ImageTarget {
	provider: ProviderConfig;
	model: ModelConfig;
}

/**
 * What the host gives `image_generate`: the models, the drawing, and the conversation's pictures.
 *
 * On the tool context rather than imported by the tool, because which providers exist and which model
 * is the default are settings — a tool sees none — and the conversation's pictures are the session's.
 */
export interface ImageHost {
	/**
	 * The model a call means, read at the call: the one named, else the conversation's pick, else the
	 * default, else the first (`picks.ts`); a sentence for the model when a name finds none or several.
	 */
	resolve(asked?: string): ImageTarget | { problem: string };
	generate(target: ImageTarget, request: ImageRequest, options?: { signal?: AbortSignal; onRetry?: ImageCallOptions["onRetry"] }): Promise<ImageResult>;
	/** The conversation's pictures, newest first, including what was drawn earlier this turn. */
	pictures(): ImagePointer[];
	/** Every image model by the name `resolve` takes back; `pictures` keeps those that take pictures in. */
	names?(filter?: { pictures?: boolean }): string[];
	/** A drawing asked for by name went through on `target`: the conversation's pick follows (`NamedPicks`). */
	adopt?(target: ImageTarget): void;
}

/**
 * What `image_generate` hands the window, as the call runs and when it ends.
 *
 * In `details`, so it is stored with the result and redrawn when the conversation is reopened — the
 * pictures themselves are files under `session-media`, named here.
 */
export interface ImageGenerationDetails {
	kind: "image_generation";
	status: "running" | "done" | "error";
	model: { id: string; name: string; provider: string };
	prompt: string;
	aspectRatio?: string;
	quality?: string;
	count: number;
	/** Pictures went in: this was an edit. */
	edit: boolean;
	/**
	 * The pictures that went in, by `session-media` name, in the order they were given.
	 *
	 * What makes a picture's history drawable in the gallery: the dog, the dog in a hat, the girl
	 * holding it. Absent on results written before it existed; those are traced back from the call's
	 * own `#1`/path arguments instead (`lineage.ts`).
	 */
	sources?: string[];
	/**
	 * The shape the picture will most likely come back in, when none was asked for: an edit keeps
	 * the shape of the picture it starts from. Width over height.
	 *
	 * For the window, which holds the place while it draws. Without it the place was a square, and an
	 * edit of a wide picture landed as a 420px square snapping to 420×236 — the card, and everything
	 * under it in the conversation, jumping on the very frame the picture arrived.
	 */
	shapeHint?: number;
	startedAt: number;
	durationMs?: number;
	images?: { media: string; mimeType: string; width?: number; height?: number }[];
	revisedPrompt?: string;
	route?: ImageRoute;
	/** The wait the call is in, while it is in one. */
	retry?: { attempt: number; delayMs: number; reason: string };
	error?: { summary: string; detail?: string; hint?: string; retryAfterMs?: number };
	/** Why some of several pictures did not arrive. */
	failures?: string[];
}
