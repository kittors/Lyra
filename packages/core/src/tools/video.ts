/**
 * Making videos with the user's video model, in the conversation — `image_generate`'s counterpart.
 *
 * A tool for the reason pictures are one (ADR-0033): the request comes with context — the poster drawn
 * a minute ago that should now move, "make it slower" — and the model holding that context writes the
 * brief and points at the frame. Only offered when a video model is configured (`session-turn.ts`).
 *
 * A video is a task, not a call: submitted, polled for anything from half a minute to several, then
 * fetched (`videos/generate.ts`). The card follows the stages as they come.
 */

import { errorResult } from "../agent/tool-run.ts";
import { failureOf } from "../ai/failure.ts";
import { imageDimensions } from "../images/dimensions.ts";
import { parseRatio } from "../images/shape.ts";
import type { ImageInput } from "../images/types.ts";
import { sessionMediaPath } from "../session/payload.ts";
import type { Tool, ToolResult } from "../types.ts";
import { VIDEO_RESOLUTIONS, type VideoGenerationDetails, type VideoRequest, type VideoResolution, type VideoResult } from "../videos/types.ts";
import { failureText, MAX_INPUTS, offRatio, picturesFor, seconds } from "./media-inputs.ts";
import { displayPath } from "./paths.ts";

interface VideoArgs {
	prompt: string;
	image?: string;
	last_image?: string;
	references?: string[];
	duration?: number;
	aspect_ratio?: string;
	resolution?: string;
	audio?: boolean;
	negative_prompt?: string;
	count?: number;
	model?: string;
}

const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "3:2", "2:3"] as const;

export const videoTool: Tool<VideoArgs> = {
	// A literal, not `VIDEO_TOOL_NAME`: `test/tool-registry.test.ts` finds tools by reading their names.
	name: "video_generate",
	snippet: "Make videos with the user's video model",
	guidelines: [
		"When the user asks for a video, a clip or an animation — or to make a picture move — use `video_generate`. For a still picture use `image_generate`.",
		"A video takes from half a minute to several minutes and is billed per video: make one unless the user asks for more, and don't remake one unasked. It is shown to the user as it arrives; afterwards say at most a sentence.",
	],
	description:
		"Make a video with the video model the user configured, and show it in the conversation.\n\n" +
		"Write `prompt` as a complete brief: subject and action, camera movement, setting, style, lighting, and sound or speech when it matters. Keep the user's language for anything spoken.\n\n" +
		"To start from a picture, give it as `image`: \"#1\" is the newest image in this conversation — something the user attached or an earlier drawing — \"#2\" the one before, or a file path. " +
		"`last_image` ends on a picture where the model supports it; `references` lends subjects and style without fixing a frame. On most models a first frame decides the shape.\n\n" +
		"Pass `model` when the user names a video model, in words or with @. A video made with a named model switches this conversation to it, " +
		"so later videos use it without naming it again; naming two models in one reply, to compare them, leaves the conversation's model as it was.",
	parameters: {
		type: "object",
		properties: {
			prompt: { type: "string", description: "The full brief for the video model." },
			image: { type: "string", description: "The first frame: \"#1\" for the newest image in the conversation, \"#2\" for the one before, or a file path." },
			last_image: { type: "string", description: "The last frame, the same way. Only where the model supports ending on a picture." },
			references: { type: "array", items: { type: "string" }, description: "Pictures to take subjects or style from, without fixing a frame." },
			duration: { type: "integer", minimum: 1, maximum: 30, description: "Seconds. Each model has its own range; the nearest it offers is used. Default: the model's own." },
			aspect_ratio: { type: "string", enum: ["auto", ...RATIOS], description: "Shape of the video. auto lets the model decide; a first frame usually decides it." },
			resolution: { type: "string", enum: [...VIDEO_RESOLUTIONS], description: "Higher is slower and costs more. Default: the model's own." },
			audio: { type: "boolean", description: "false for a silent clip. Default: the model's own, usually with sound." },
			negative_prompt: { type: "string", description: "What to keep out, where the model takes it." },
			count: { type: "integer", minimum: 1, maximum: 4, description: "How many videos. Default 1." },
			model: { type: "string", description: "When the user names a video model. Where two providers share a model, write it exactly as listed." },
		},
		required: ["prompt"],
		additionalProperties: false,
	},
	mutating: false,
	summarize: (args) => `Video ${(args.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}`,

	async execute(args, ctx): Promise<ToolResult> {
		const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
		if (!prompt) return errorResult("`prompt` is required: describe the video to make.");
		const host = ctx.videos;
		if (!host) return errorResult("No video model is configured. Tell the user to add one in Settings → Models (for example grok-imagine-video-1.5 or doubao-seedance-2-5-260628).");

		const target = host.resolve(args.model);
		if ("problem" in target) return errorResult(target.problem);

		// One read for every picture the call points at, kept in order so each lands in its role.
		const first = typeof args.image === "string" && args.image.trim() ? [args.image] : [];
		const last = typeof args.last_image === "string" && args.last_image.trim() ? [args.last_image] : [];
		const references = Array.isArray(args.references) ? args.references.filter((ref): ref is string => typeof ref === "string" && Boolean(ref.trim())).slice(0, MAX_INPUTS) : [];
		const given = await picturesFor([...first, ...last, ...references], ctx, () => host.pictures());
		if (typeof given === "string") return errorResult(given);
		const { inputs, sources } = given;
		const image = first.length ? inputs[0] : undefined;
		const lastImage = last.length ? inputs[first.length] : undefined;
		const refs = inputs.slice(first.length + last.length);

		if (inputs.length > 0 && target.model.supportsImages === false) {
			const able = host.names?.({ pictures: true }) ?? [];
			return errorResult(
				`${target.model.name} is set up without picture input, so it cannot start from or follow a picture.` +
					(able.length ? ` Video models that take pictures: ${able.join(", ")} — pass one as \`model\`.` : "") +
					` If ${target.model.name} does take pictures, the user can turn picture input on for it in Settings → Models.`,
			);
		}

		const ratio = args.aspect_ratio && args.aspect_ratio !== "auto" && parseRatio(args.aspect_ratio) ? args.aspect_ratio : undefined;
		const resolution = (VIDEO_RESOLUTIONS as readonly string[]).includes(args.resolution ?? "") ? (args.resolution as VideoResolution) : undefined;
		const duration = Number.isFinite(Number(args.duration)) && Number(args.duration) > 0 ? Math.min(60, Math.round(Number(args.duration))) : undefined;
		const audio = typeof args.audio === "boolean" ? args.audio : undefined;
		const negativePrompt = typeof args.negative_prompt === "string" && args.negative_prompt.trim() ? args.negative_prompt.trim() : undefined;
		const count = Math.max(1, Math.min(4, Math.round(Number(args.count) || 1)));
		const startedAt = Date.now();
		const base: VideoGenerationDetails = {
			kind: "video_generation",
			status: "running",
			model: { id: target.model.id, name: target.model.name, provider: target.provider.name },
			prompt,
			aspectRatio: ratio,
			resolution,
			duration,
			audio,
			count,
			stage: "submitting",
			...(sources.length ? { sources } : {}),
			...(image ? { shapeHint: shapeOf(image) } : {}),
			startedAt,
		};
		ctx.onProgress?.({ content: [], details: base });

		const request: VideoRequest = { prompt, image, lastImage, references: refs.length ? refs : undefined, duration, aspectRatio: ratio, resolution, audio, negativePrompt };
		const runs = await Promise.allSettled(
			Array.from({ length: count }, () =>
				host.generate(target, request, {
					signal: ctx.signal,
					onStage: (stage, progress) => ctx.onProgress?.({ content: [], details: { ...base, stage, ...(progress !== undefined ? { progress } : {}) } }),
					onRetry: (info) => ctx.onProgress?.({ content: [], details: { ...base, retry: { attempt: info.attempt, delayMs: info.delayMs, reason: info.reason } } }),
				}),
			),
		);
		if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error("Aborted");
		const made = runs.filter((run): run is PromiseFulfilledResult<VideoResult> => run.status === "fulfilled").map((run) => run.value);
		const refused = runs.filter((run): run is PromiseRejectedResult => run.status === "rejected").map((run) => run.reason as unknown);
		const durationMs = Date.now() - startedAt;

		if (made.length === 0) {
			const failed = failureText("Video generation", target.model.name, refused[0]);
			// The fingerprints `videos/wire.ts` and `videos/generate.ts` give the two task failures, for the card's words.
			const print = failureOf(refused[0]).fingerprint;
			const reason = print.startsWith("lost:") ? "lost" : print.startsWith("video-timeout:") ? "timeout" : undefined;
			return {
				content: [{ type: "text", text: failed.text }],
				isError: true,
				details: { ...base, status: "error", stage: undefined, durationMs, error: { ...failed.error, ...(reason ? { reason } : {}) } } satisfies VideoGenerationDetails,
			};
		}
		// Named for this video and it arrived: the conversation films with it from now on (`NamedPicks`).
		if (typeof args.model === "string" && args.model.trim()) host.adopt?.(target);

		const videos = made.flatMap((result) => result.videos);
		const adjusted = [...new Set(made.flatMap((result) => result.adjusted))];
		const failures = refused.map((reason) => failureText("Video generation", target.model.name, reason).error.summary);
		const firstVideo = videos[0];
		const facts = [firstVideo?.width && firstVideo.height ? `${firstVideo.width}×${firstVideo.height}` : "", firstVideo?.seconds ? `${firstVideo.seconds}s` : ""].filter(Boolean).join(", ");
		const lines = [
			`Made ${videos.length} video${videos.length === 1 ? "" : "s"} with ${target.model.name}${facts ? ` (${facts})` : ""} in ${seconds(durationMs)}; shown to the user in the conversation.`,
			`Saved: ${videos.map((video) => displayPath(ctx.cwd, sessionMediaPath(video.media))).join(", ")}.`,
		];
		if (adjusted.length) lines.push(`Not exactly as asked: ${adjusted.join(" ")}`);
		if (ratio && !image && firstVideo?.width && firstVideo.height && offRatio(ratio, firstVideo.width, firstVideo.height)) {
			lines.push(`${target.model.name} did not keep to ${ratio}: the video is ${firstVideo.width}×${firstVideo.height}. Tell the user if the shape matters.`);
		}
		if (failures.length) lines.push(`${failures.length} of ${count} did not arrive: ${failures[0]}.`);
		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details: {
				...base,
				status: "done",
				stage: undefined,
				durationMs,
				videos: videos.map(({ media, mimeType, width, height, seconds: length }) => ({ media, mimeType, width, height, seconds: length })),
				api: made[0].api,
				...(adjusted.length ? { adjusted } : {}),
				...(failures.length ? { failures } : {}),
			} satisfies VideoGenerationDetails,
		};
	},
};

/** Width over height of the first frame, which decides the video's shape on most models. */
function shapeOf(input: ImageInput): number | undefined {
	const size = imageDimensions(Buffer.from(input.data, "base64"));
	return size && size.width > 0 && size.height > 0 ? size.width / size.height : undefined;
}
