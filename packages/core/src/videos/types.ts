/**
 * A request to film, and what comes back — independent of which task API does the filming.
 */

import type { ImageCallOptions, ImageInput, ImagePointer } from "../images/types.ts";
import type { ModelConfig, ProviderConfig, VideoApi } from "../types/provider.ts";

/** The tool's name, in one place: the transcript is searched for its results by it. */
export const VIDEO_TOOL_NAME = "video_generate";

/** A task API a call actually goes through; `auto` is only ever a setting. */
export type VideoWireApi = Exclude<VideoApi, "auto">;

export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export interface VideoRequest {
	prompt: string;
	/** The first frame: the video starts from this picture (image-to-video). */
	image?: ImageInput;
	/** The last frame, where the model supports ending on a picture. */
	lastImage?: ImageInput;
	/** Pictures to take subjects and style from, without fixing any frame. */
	references?: ImageInput[];
	/** Seconds. Each API has its own range; the nearest it takes is sent, and the change reported. */
	duration?: number;
	/** `"16:9"` and friends; absent leaves it to the model (and a first frame decides it on most). */
	aspectRatio?: string;
	resolution?: VideoResolution;
	/** `false` for a silent clip. Absent is the model's default, which on most is with sound. */
	audio?: boolean;
	negativePrompt?: string;
}

/** Where a finished video is, and whether fetching it takes the provider's key. */
export interface VideoOutput {
	url: string;
	/** `bearer` / `goog`: the content endpoint wants the key; a signed CDN link wants nothing. */
	auth?: "bearer" | "goog";
	seconds?: number;
}

export type VideoStage = "submitting" | "queued" | "running" | "downloading";

export interface VideoCallOptions {
	signal?: AbortSignal;
	fetch?: typeof globalThis.fetch;
	retryAttempts?: number;
	onRetry?: ImageCallOptions["onRetry"];
	/** Where the task is, and how far along when the provider says. */
	onStage?: (stage: VideoStage, progress?: number) => void;
	/** Between polls. Tests shorten it. */
	pollIntervalMs?: number;
	/** How long a task may take before it is reported rather than waited on. */
	timeoutMs?: number;
}

export interface SavedVideo {
	/** The `session-media` file. */
	media: string;
	mimeType: string;
	bytes: number;
	width?: number;
	height?: number;
	seconds?: number;
}

export interface VideoResult {
	videos: SavedVideo[];
	api: VideoWireApi;
	/** The provider's id for the task, for anyone tracing it upstream. */
	taskId: string;
	/** What was asked for and could not be sent the way it was asked, one sentence each. */
	adjusted: string[];
}

/** One video model and the provider it is reached through. */
export interface VideoTarget {
	provider: ProviderConfig;
	model: ModelConfig;
}

/**
 * What the host gives `video_generate`: the models, the filming, and the conversation's pictures
 * (a first frame is usually one of them). The video counterpart of `ImageHost`.
 */
export interface VideoHost {
	resolve(asked?: string): VideoTarget | { problem: string };
	generate(target: VideoTarget, request: VideoRequest, options?: Pick<VideoCallOptions, "signal" | "onRetry" | "onStage">): Promise<VideoResult>;
	pictures(): ImagePointer[];
	names?(filter?: { pictures?: boolean }): string[];
	adopt?(target: VideoTarget): void;
}

/**
 * What `video_generate` hands the window, as the call runs and when it ends — stored with the result,
 * so the card is redrawn when the conversation is reopened. The videos are files under
 * `session-media`, named here.
 */
export interface VideoGenerationDetails {
	kind: "video_generation";
	status: "running" | "done" | "error";
	model: { id: string; name: string; provider: string };
	prompt: string;
	aspectRatio?: string;
	resolution?: string;
	duration?: number;
	audio?: boolean;
	count: number;
	stage?: VideoStage;
	/** 0–100 when the provider reports progress; absent and the window estimates. */
	progress?: number;
	/** The pictures that went in, by `session-media` name: first frame, last frame, references. */
	sources?: string[];
	/** Width over height to hold the place with while it films, when a first frame decides the shape. */
	shapeHint?: number;
	startedAt: number;
	durationMs?: number;
	videos?: { media: string; mimeType: string; width?: number; height?: number; seconds?: number }[];
	api?: VideoWireApi;
	adjusted?: string[];
	retry?: { attempt: number; delayMs: number; reason: string };
	/** `reason` names the two failures that are about the task rather than the request: gone, or past its time. */
	error?: { summary: string; detail?: string; hint?: string; retryAfterMs?: number; reason?: "lost" | "timeout" };
	failures?: string[];
}
