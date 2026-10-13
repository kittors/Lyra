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

import { readFile } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { errorResult } from "../agent/tool-run.ts";
import { failureOf } from "../ai/failure.ts";
import { imageDimensions, sniffImageType } from "../images/dimensions.ts";
import { loadPicture, RECENT_IMAGES_KEY } from "../images/recent.ts";
import { ASPECT_RATIOS, QUALITIES } from "../images/shape.ts";
import { type ImageGenerationDetails, type ImageInput, type ImagePointer, type ImageRequest } from "../images/types.ts";
import { persistSessionImage, safeMediaName, sessionMediaHome, sessionMediaPath } from "../session/payload.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";
import { displayPath } from "./paths.ts";
import { authorizeRead, toAbsolute } from "./read-access.ts";

interface ImageArgs {
	prompt: string;
	images?: string[];
	aspect_ratio?: string;
	quality?: string;
	count?: number;
	background?: string;
	model?: string;
}

/** Bigger than any reference picture needs to be, and small enough not to time out an upload. */
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_INPUTS = 8;

/** A file the tool drew earlier is in the app's own directory, not the workspace, and needs no asking. */
function ownMedia(path: string): string | null {
	const rel = relative(sessionMediaHome(), path);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
	return safeMediaName(rel) || null;
}

/**
 * `#1`, `#2` from the conversation, or paths; a sentence for the model on the first one that fails.
 *
 * Each input also comes back as a `session-media` name — what the result records as its sources. A
 * picture that is not in `session-media` yet (a workspace file, a small inline attachment) is stored
 * there under its hash, so the gallery can still show where an edit started after the file changed.
 */
async function inputsFor(refs: string[], ctx: ToolContext): Promise<{ inputs: ImageInput[]; sources: string[] } | string> {
	if (refs.length > MAX_INPUTS) return `At most ${MAX_INPUTS} images can go into one call; ${refs.length} were given.`;
	const host = ctx.images;
	let pictures: ImagePointer[] | null = null;
	const inputs: ImageInput[] = [];
	const sources: string[] = [];
	for (const raw of refs) {
		const ref = raw.trim();
		const numbered = /^#\s*(\d+)$/.exec(ref);
		if (numbered) {
			pictures ??= host?.pictures() ?? [];
			const index = Number(numbered[1]);
			const picture = index >= 1 ? pictures[index - 1] : undefined;
			const loaded = picture ? await loadPicture(picture) : null;
			if (!loaded) {
				return pictures.length === 0
					? `There are no images in this conversation, so "${ref}" refers to nothing. Ask the user to attach the picture.`
					: `"${ref}" is out of range: this conversation has ${pictures.length} image${pictures.length === 1 ? "" : "s"} (#1 is the newest).`;
			}
			inputs.push(loaded);
			sources.push(safeMediaName(picture?.media ?? "") || persistSessionImage(loaded.data, loaded.mimeType));
			continue;
		}
		const absolute = toAbsolute(ctx.cwd, ref);
		const media = ownMedia(absolute);
		if (!media) {
			const access = await authorizeRead(ctx, ref);
			if (!access.ok) return access.message;
		}
		const bytes = await readFile(media ? sessionMediaPath(media) : absolute).catch(() => null);
		if (!bytes) return `Could not read ${ref}.`;
		if (bytes.length > MAX_INPUT_BYTES) return `${ref} is ${Math.round(bytes.length / 1048576)}MB; images over 20MB cannot be sent.`;
		const mimeType = sniffImageType(bytes);
		if (!mimeType) return `${ref} is not a PNG, JPEG or WebP image.`;
		const data = bytes.toString("base64");
		inputs.push({ data, mimeType, name: absolute.split(/[/\\]/).pop() });
		sources.push(media ?? persistSessionImage(data, mimeType));
	}
	return { inputs, sources };
}

function seconds(ms: number): string {
	return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

function wait(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return `${Math.ceil(ms / 1000)} seconds`;
	if (minutes < 60) return `${minutes} minutes`;
	return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

/** What the model is told when it did not work, so it can tell the person something true. */
function failureText(model: string, error: unknown): { text: string; error: NonNullable<ImageGenerationDetails["error"]> } {
	const failure = failureOf(error);
	const detail = failure.detail ?? (error instanceof Error ? error.message : String(error));
	const recorded = { summary: failure.summary, detail: detail.slice(0, 2000), hint: failure.hint, retryAfterMs: failure.retryAfterMs };
	if (failure.hint === "check-billing") {
		const when = failure.retryAfterMs ? ` It resets in about ${wait(failure.retryAfterMs)}.` : "";
		return { error: recorded, text: `${model} has no quota left.${when} Tell the user; trying again now will fail the same way.` };
	}
	if (failure.hint === "check-key") {
		return {
			error: recorded,
			text: `The provider refused ${model} for this key (${detail.slice(0, 300)}). The user may need to allow the model for the key, or use a provider address whose group includes it. Don't retry.`,
		};
	}
	return { error: recorded, text: `Image generation with ${model} failed: ${failure.summary}. ${detail.slice(0, 600)}` };
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
		"Pass `model` only when the user names an image model.",
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
			model: { type: "string", description: "Only when the user names an image model, e.g. \"gpt-image-2.5\"." },
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

		const given = await inputsFor(Array.isArray(args.images) ? args.images.filter((ref) => typeof ref === "string") : [], ctx);
		if (typeof given === "string") return errorResult(given);
		const { inputs, sources } = given;

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
			const failed = failureText(target.model.name, error);
			return {
				content: [{ type: "text", text: failed.text }],
				isError: true,
				details: { ...base, status: "error", durationMs: Date.now() - startedAt, error: failed.error } satisfies ImageGenerationDetails,
			};
		}

		const saved = result.images.map((image) => {
			const bytes = Buffer.from(image.data, "base64");
			const mimeType = sniffImageType(bytes) ?? image.mimeType;
			const media = persistSessionImage(image.data, mimeType);
			const size = imageDimensions(bytes);
			return { media, mimeType, ...size };
		});
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
