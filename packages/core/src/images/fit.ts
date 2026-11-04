/**
 * Whether a picture already fits, and the size it should be scaled to when it does not.
 *
 * Pure rules, shared by every place that makes a picture smaller — the composer's canvas, the main
 * process's codec, the request boundary — so that all three agree on what "fits" means. A picture
 * that fits is never touched: re-encoding costs quality and time and buys nothing.
 */

import { imageDimensions, type Dimensions } from "./dimensions.ts";

export interface FitLimits {
	/** Longest side, in pixels. */
	maxEdge: number;
	/** Total pixels: providers budget pictures by area as well as by side. */
	maxPixels: number;
}

/**
 * What every provider takes. Anything else is converted, or not sent: a type one provider refuses is a
 * 400 on that request and on every request after it, because the picture stays in the history.
 * GIF is missing on purpose — Gemini does not take it.
 */
export const SAFE_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * The size to scale to: the largest that respects both the side and the area limit, never larger
 * than the picture itself. Rounded down, so the result is inside the limits rather than a pixel over.
 */
export function fitDimensions(size: Dimensions, limits: FitLimits): Dimensions {
	const { width, height } = size;
	if (width <= 0 || height <= 0) return { width: 0, height: 0 };
	const byEdge = limits.maxEdge / Math.max(width, height);
	const byArea = Math.sqrt(limits.maxPixels / (width * height));
	const scale = Math.min(1, byEdge, byArea);
	if (scale >= 1) return { width, height };
	return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function withinLimits(size: Dimensions, limits: FitLimits): boolean {
	return Math.max(size.width, size.height) <= limits.maxEdge && size.width * size.height <= limits.maxPixels;
}

/**
 * Whether these bytes can go as they are. A picture whose size cannot be read from its header does not
 * fit: nothing can vouch for it, and the provider's own limit is the one that would find out.
 */
export function fitsAsIs(bytes: Uint8Array, mimeType: string, limits: FitLimits & { maxBytes: number }, accepted: ReadonlySet<string> = SAFE_IMAGE_TYPES): boolean {
	if (!accepted.has(mimeType) || bytes.length > limits.maxBytes) return false;
	const size = imageDimensions(bytes);
	return size !== null && withinLimits(size, limits);
}

/**
 * Screenshot or photo, judged by the format it came in.
 *
 * A screen is captured losslessly — PNG from every screenshot tool, the annotator, the clipboard — and
 * a camera writes JPEG or HEIC. The format is the one signal every entry point has, and it is right
 * where it matters: text in a PNG gets the encoder ladder that keeps text sharp.
 */
export function imageStyle(mimeType: string): "sharp" | "photo" {
	return /jpe?g|heic|heif|avif/i.test(mimeType) ? "photo" : "sharp";
}

/** Bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(data: string): number {
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}
