/**
 * Drawing and editing pictures with the user's image model, in the conversation.
 *
 * A tool rather than a model you chat with, for the same reason a person asks for a picture in the
 * middle of a conversation rather than opening another app: the request comes with context — the
 * screenshot they just pasted, the logo drawn three turns ago, "make it warmer" — and the model that
 * holds that context is the one writing the prompt. The image model only ever sees a finished prompt
 * and the pictures it is about.
 *
 * Only offered when an image model is configured (`session-turn.ts`); the drawing is billed to the
 * user's provider, and a tool that can only fail is a turn spent finding that out.
 */

import { errorResult } from "../agent/tool-run.ts";
import { canBeTransparent, imageDimensions, sniffImageType } from "../images/dimensions.ts";
import { RECENT_IMAGES_KEY } from "../images/recent.ts";
import { ASPECT_RATIOS, QUALITIES } from "../images/shape.ts";
import { type ImageGenerationDetails, type ImageInput, type ImagePointer, type ImageRequest } from "../images/types.ts";
import { persistSessionImage, sessionMediaPath } from "../session/payload.ts";
import type { Tool, ToolResult } from "../types.ts";
import { failureText, offRatio, picturesFor, seconds } from "./media-inputs.ts";
import { displayPath } from "./paths.ts";

interface ImageArgs {
	prompt: string;
	images?: string[];
	aspect_ratio?: string;
	quality?: string;
	count?: number;
	background?: string;
	model?: string;
}

export const imageTool: Tool<ImageArgs> = {
	// A literal, not `IMAGE_TOOL_NAME`: `test/tool-registry.test.ts` finds tools by reading their names.
	name: "image_generate",
	snippet: "Draw or edit images with the user's image model",
	guidelines: [
		"When the user asks for a picture — an illustration, icon, poster, photo, logo, sticker — or asks to change one, use `image_generate`. A chart, diagram or UI that code can draw exactly is better done with code or `preview`.",
		"The picture is shown to the user as it arrives. Afterwards say at most a sentence; don't describe what was drawn unless asked.",
	],
	description:
		"Generate images, or edit existing ones, with the image model the user configured, and show them in the conversation.\n\n" +
		"Write `prompt` as a complete brief: subject, composition, setting, style or medium, lighting, colour, and any text that must appear (quoted, verbatim). " +
		"Keep the user's language for text inside the picture. For an edit, say what to change and what must stay the same.\n\n" +
		"To edit or use pictures as reference, list them in `images`: \"#1\" is the newest image in this conversation — something the user attached, or an earlier result — \"#2\" the one before it, and so on. " +
		"A file can be given by path, including the path an earlier result reported.\n\n" +
		"Pass `model` when the user names an image model, in words or with @. A picture drawn with a named model switches this conversation to it, " +
		"so later drawings and edits use it without naming it again; naming two models in one reply, to compare them, leaves the conversation's model as it was.",
	parameters: {
		type: "object",
		properties: {
			prompt: { type: "string", description: "The full brief for the image model." },
			images: {
				type: "array",
				items: { type: "string" },
				description: "Pictures to edit or draw from: \"#1\" for the newest image in the conversation, \"#2\" for the one before, or a file path.",
			},
			aspect_ratio: {
				type: "string",
				enum: ["auto", ...ASPECT_RATIOS],
				description: "Shape of the picture. auto lets the model decide (an edit keeps the input's shape).",
			},
			quality: {
				type: "string",
				enum: ["auto", ...QUALITIES],
				description: "Detail. high and max are slower and cost more; max is the largest the model offers (4K where supported). Default auto.",
			},
			count: { type: "integer", minimum: 1, maximum: 4, description: "How many variations. Default 1." },
			background: {
				type: "string",
				enum: ["auto", "transparent", "opaque"],
				description: "transparent for stickers, icons and logos, where the model supports it.",
			},
			model: { type: "string", description: "When the user names an image model, e.g. \"gpt-image-2.5\". Where two providers share a model, write it exactly as listed." },
		},
		required: ["prompt"],
		additionalProperties: false,
	},
	mutating: false,
	// "Edit image …" when pictures go in: the window says 编辑图片 rather than 生成图片 (`lib/tool-kinds.ts`).
	summarize: (args) => `${args.images?.length ? "Edit image" : "Image"} ${(args.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}`,

	async execute(args, ctx): Promise<ToolResult> {
		const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
		if (!prompt) return errorResult("`prompt` is required: describe the picture to draw.");
		if (!ctx.images) return errorResult("No image model is configured. Tell the user to add one in Settings → Models (for example gpt-image-1 or gemini-3.1-flash-image).");

		const target = ctx.images.resolve(args.model);
		if ("problem" in target) return errorResult(target.problem);

		const given = await picturesFor(Array.isArray(args.images) ? args.images.filter((ref) => typeof ref === "string") : [], ctx, () => ctx.images?.pictures() ?? []);
		if (typeof given === "string") return errorResult(given);
		const { inputs, sources } = given;
		/*
		 * A model set up without picture input is not sent pictures. It used to be, and the provider's
		 * answer to an edit it cannot do is either a refusal billed as a call or — worse — a fresh
		 * picture drawn from the words alone, presented as the edit.
		 */
		if (inputs.length > 0 && target.model.supportsImages === false) {
			const able = ctx.images.names?.({ pictures: true }) ?? [];
			return errorResult(
				`${target.model.name} is set up without picture input, so it cannot edit or draw from a picture.` +
					(able.length ? ` Image models that take pictures: ${able.join(", ")} — pass one as \`model\`.` : "") +
					` If ${target.model.name} does take pictures, the user can turn picture input on for it in Settings → Models.`,
			);
		}

		const ratio = args.aspect_ratio && args.aspect_ratio !== "auto" ? args.aspect_ratio : undefined;
		const quality = (QUALITIES as readonly string[]).includes(args.quality ?? "") ? (args.quality as ImageRequest["quality"]) : undefined;
		const background = args.background === "transparent" || args.background === "opaque" ? args.background : undefined;
		const count = Math.max(1, Math.min(4, Math.round(Number(args.count) || 1)));
		const startedAt = Date.now();
		const base: ImageGenerationDetails = {
			kind: "image_generation",
			status: "running",
			model: { id: target.model.id, name: target.model.name, provider: target.provider.name },
			prompt,
			aspectRatio: ratio,
			quality,
			count,
			edit: inputs.length > 0,
			...(sources.length ? { sources } : {}),
			...(ratio ? {} : { shapeHint: shapeOf(inputs[0]) }),
			startedAt,
		};
		ctx.onProgress?.({ content: [], details: base });

		const request: ImageRequest = { prompt, images: inputs, aspectRatio: ratio, quality, count, background };
		let result;
		try {
			result = await ctx.images.generate(target, request, {
				signal: ctx.signal,
				onRetry: (info) => ctx.onProgress?.({ content: [], details: { ...base, retry: { attempt: info.attempt, delayMs: info.delayMs, reason: info.reason } } }),
			});
		} catch (error) {
			if (ctx.signal?.aborted) throw error;
			const failed = failureText("Image generation", target.model.name, error);
			return {
				content: [{ type: "text", text: failed.text }],
				isError: true,
				details: { ...base, status: "error", durationMs: Date.now() - startedAt, error: failed.error } satisfies ImageGenerationDetails,
			};
		}

		let opaque = false;
		const saved = result.images.map((image) => {
			const bytes = Buffer.from(image.data, "base64");
			const mimeType = sniffImageType(bytes) ?? image.mimeType;
			const media = persistSessionImage(image.data, mimeType);
			const size = imageDimensions(bytes);
			if (background === "transparent" && !canBeTransparent(bytes)) opaque = true;
			return { media, mimeType, ...size };
		});
		// Named for this drawing and it arrived: the conversation draws with it from now on (`NamedPicks`).
		if (typeof args.model === "string" && args.model.trim() && saved.length > 0) ctx.images.adopt?.(target);
		// Newest first, ahead of what was there: `#1` is now this turn's last picture.
		const drawn = (ctx.state.get(RECENT_IMAGES_KEY) as ImagePointer[] | undefined) ?? [];
		ctx.state.set(RECENT_IMAGES_KEY, [...[...saved].reverse().map(({ media, mimeType }) => ({ media, mimeType })), ...drawn]);

		const durationMs = Date.now() - startedAt;
		const paths = saved.map((image) => displayPath(ctx.cwd, sessionMediaPath(image.media)));
		const dims = saved[0]?.width ? ` (${saved[0].width}×${saved[0].height})` : "";
		const lines = [
			`Drew ${saved.length} image${saved.length === 1 ? "" : "s"} with ${target.model.name}${dims} in ${seconds(durationMs)}; shown to the user in the conversation.`,
			`Saved: ${paths.join(", ")}. To edit one, pass its path — or #1 for the newest image in the conversation — in \`images\`.`,
		];
		if (result.failures?.length) lines.push(`${result.failures.length} of ${count} did not arrive: ${result.failures[0]}.`);
		if (result.revisedPrompt) lines.push(`The provider rewrote the prompt as: ${result.revisedPrompt}`);
		/*
		 * What arrived, measured, against what was asked. Some models — and some relays in front of
		 * them — drop the ratio or the transparent background without a word, and the person should
		 * hear that from the model rather than find it in the picture.
		 */
		const first = saved[0];
		if (ratio && first?.width && first.height && offRatio(ratio, first.width, first.height)) {
			lines.push(`${target.model.name} did not keep to ${ratio}: the picture is ${first.width}×${first.height}. Tell the user if the shape matters — this model may not take a ratio.`);
		}
		if (opaque) lines.push(`${target.model.name} drew an opaque background, not a transparent one. Tell the user if they need transparency — gpt-image models support it.`);
		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details: {
				...base,
				status: "done",
				durationMs,
				images: saved,
				revisedPrompt: result.revisedPrompt,
				route: result.route,
				failures: result.failures,
			} satisfies ImageGenerationDetails,
		};
	},
};

/** Width over height of a picture going in, read from its header; undefined when there is none or it cannot be read. */
function shapeOf(input: ImageInput | undefined): number | undefined {
	if (!input) return undefined;
	const size = imageDimensions(Buffer.from(input.data, "base64"));
	return size && size.width > 0 && size.height > 0 ? size.width / size.height : undefined;
}
