/**
 * The shape and detail a picture is asked for in, said the way each model family understands it.
 *
 * The tool speaks in aspect ratios because that is what a person asks for ("a 16:9 banner") and what
 * the card needs to hold the picture's place. Providers each want their own spelling, and a wrong one
 * is refused outright rather than approximated:
 *
 * - OpenAI's lines take a short list of pixel sizes each.
 * - A relay in front of Gemini (CliRelay) takes `aspect_ratio` and `image_size` (`512`, `1K`, `2K`,
 *   `4K`), refuses `"16:9"` as a `size`, and ignores `quality` — so detail has to travel as
 *   `image_size` or it is lost.
 * - Anything else gets a pixel size in the ratio's proportions, which hosts with fixed sizes snap to.
 */

import type { ImageRequest } from "./types.ts";

export const ASPECT_RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "5:4", "4:5"] as const;
export const QUALITIES = ["low", "medium", "high", "max"] as const;

/** `"16:9"` as numbers, or `null` for `auto`, empty, or anything that is not a ratio. */
export function parseRatio(value: string | undefined): { width: number; height: number } | null {
	const match = /^\s*(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)\s*$/i.exec(value ?? "");
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	return width > 0 && height > 0 ? { width, height } : null;
}

type Family = "gpt-image" | "dall-e-3" | "dall-e-2" | "gemini-image" | "other";

/** The relay's own test for a Gemini image model: `gemini-…` with one dash-separated part exactly `image`. */
function family(modelId: string): Family {
	const id = modelId.toLowerCase().split("/").at(-1) ?? "";
	if (/^(?:gpt-image|chatgpt-image)/.test(id)) return "gpt-image";
	if (id.startsWith("dall-e-3")) return "dall-e-3";
	if (id.startsWith("dall-e-2")) return "dall-e-2";
	if (id.startsWith("gemini-") && id.split("-").includes("image")) return "gemini-image";
	return "other";
}

/** Snapped to 64, which every host that takes free sizes accepts. */
const snap = (value: number) => Math.max(256, Math.round(value / 64) * 64);

function orientation(ratio: { width: number; height: number }): "square" | "landscape" | "portrait" {
	const wide = ratio.width / ratio.height;
	return wide > 1.05 ? "landscape" : wide < 0.95 ? "portrait" : "square";
}

/** Gemini's detail levels: the default is 1K, so only asking for more is worth saying. */
const GEMINI_SIZE: Record<string, string> = { low: "1K", medium: "1K", high: "2K", max: "4K" };

/**
 * The fields of an Images API request that depend on the model, beyond `model`, `prompt` and `n`.
 *
 * Unknown fields are not sent to a family that might refuse them: OpenAI answers an unrecognised
 * parameter with a 400.
 */
export function imageFields(modelId: string, request: Pick<ImageRequest, "aspectRatio" | "quality" | "background">): Record<string, string> {
	const kind = family(modelId);
	const ratio = parseRatio(request.aspectRatio);
	const quality = request.quality;
	const fields: Record<string, string> = {};
	if (kind === "gpt-image") {
		fields.size = ratio ? { square: "1024x1024", landscape: "1536x1024", portrait: "1024x1536" }[orientation(ratio)] : "auto";
		if (quality) fields.quality = quality === "max" ? "high" : quality;
		if (request.background) fields.background = request.background;
		return fields;
	}
	// The rest answer with a link unless told otherwise; base64 saves a second download.
	fields.response_format = "b64_json";
	if (kind === "dall-e-3") {
		fields.size = ratio ? { square: "1024x1024", landscape: "1792x1024", portrait: "1024x1792" }[orientation(ratio)] : "1024x1024";
		if (quality) fields.quality = quality === "high" || quality === "max" ? "hd" : "standard";
		return fields;
	}
	if (kind === "dall-e-2") {
		fields.size = "1024x1024";
		return fields;
	}
	if (kind === "gemini-image") {
		if (ratio) fields.aspect_ratio = `${ratio.width}:${ratio.height}`;
		if (quality && GEMINI_SIZE[quality] !== "1K") fields.image_size = GEMINI_SIZE[quality];
		return fields;
	}
	if (ratio) {
		const wide = ratio.width / ratio.height;
		fields.size = wide >= 1 ? `1024x${snap(1024 / wide)}` : `${snap(1024 * wide)}x1024`;
	}
	if (quality) fields.quality = quality === "max" ? "high" : quality;
	return fields;
}

/**
 * How many pictures one request may ask for.
 *
 * DALL·E 3 draws one per request. A relay in front of Gemini runs `n` one after another and fails the
 * lot if any one fails, so pictures there are asked for one per request — side by side, which is also
 * faster than its own queue.
 */
export function perRequestLimit(modelId: string): number {
	const kind = family(modelId);
	return kind === "dall-e-3" || kind === "gemini-image" ? 1 : 4;
}

/**
 * Whether an edit goes as JSON with data URLs rather than multipart.
 *
 * The relay takes both for Gemini, and refuses a disallowed model on JSON with a clear 403 where the
 * multipart form gets past its model check and fails later as a bare 502. OpenAI's own edits endpoint
 * is multipart only.
 */
export function editsAsJson(modelId: string): boolean {
	return family(modelId) === "gemini-image";
}
