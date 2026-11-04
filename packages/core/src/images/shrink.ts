/**
 * Making one picture small enough to send — the same steps whoever does the pixel work.
 *
 * Two hosts can decode and encode: the composer's canvas (any format Chromium reads, before the
 * picture leaves the window or the phone) and the desktop's main process (`nativeImage`, for what
 * tools return and what the window could not decode). Each brings a `RasterEngine` that only scales
 * and encodes; every decision — the size, the format, the quality, when to give up — is made here,
 * once, so a screenshot pasted into the composer and the same screenshot returned by `read` come out
 * the same.
 *
 * Browser-safe: this file is on the renderer's import list, so it may import nothing that is not.
 *
 * The numbers, and where they come from (checked 2026-11, see docs/architecture/prompt-images.md):
 *
 *   - 2000 px on the long side is what Claude Code, opencode and pi send, and the cap Anthropic once
 *     documented for requests carrying more than 20 pictures. It is above what Claude's standard tier
 *     (1568) and OpenAI's `high` detail (2048 side, 2,500 patches) look at.
 *   - 3.75 MP is Claude's high-resolution budget (4,784 visual tokens of 28×28): no provider looks at
 *     more, so more is upload time for nothing.
 *   - 512 KB is where Claude Code and oh-my-pi stop compressing; 3.75 MiB is 5 MiB once encoded as
 *     base64 — Bedrock's per-picture limit, and the API's until recently. Relays often sit on Bedrock.
 */

import type { Dimensions } from "./dimensions.ts";
import { imageDimensions } from "./dimensions.ts";
import { fitDimensions, SAFE_IMAGE_TYPES, withinLimits, type FitLimits } from "./fit.ts";

// The renderer's door (`@lyra/core/image-shrink`): what the composer's canvas needs beside the algorithm.
export { imageDimensions } from "./dimensions.ts";
export { imageStyle } from "./fit.ts";

export interface ShrinkTarget extends FitLimits {
	/** The first encoding that lands at or under this is taken. */
	softBytes: number;
	/** Never more than this: past it the picture is scaled down further. */
	maxBytes: number;
	/**
	 * Which encodings to try, in order. `sharp` tries lossless first and then a JPEG good enough for
	 * small text (judged on an 11 px devtools capture: q90 and q80 read like the PNG). `photo` starts
	 * where a camera's own JPEG does. `gist` is the stand-in an old picture becomes: what it was, not
	 * every word on it.
	 */
	style: "sharp" | "photo" | "gist";
}

/** What a picture is fitted to when it enters a conversation. */
export const ENTRY_LIMITS = { maxEdge: 2000, maxPixels: 3_750_000, softBytes: 512 * 1024, maxBytes: 3_932_160 } as const;

/** The small copy an old picture is replaced by once the request has too many. */
export const GIST_LIMITS = { maxEdge: 768, maxPixels: 768 * 768, softBytes: 48 * 1024, maxBytes: 160 * 1024 } as const;

export type Encoding = { type: "image/png" } | { type: "image/jpeg"; quality: number };

export interface RasterEngine<Bitmap> {
	/** Null when these bytes cannot be decoded here. The size is the decoded one, after any EXIF turn. */
	decode(data: Uint8Array, mimeType: string): Promise<{ bitmap: Bitmap; width: number; height: number } | null>;
	/** Scale and encode. A JPEG is flattened onto white: transparency would otherwise turn black. */
	encode(bitmap: Bitmap, size: Dimensions, encoding: Encoding): Promise<Uint8Array>;
	release?(bitmap: Bitmap): void;
}

export interface ShrunkImage {
	data: Uint8Array;
	mimeType: string;
	width: number;
	height: number;
	/** The size it came in at; equal to `width`/`height` when nothing was scaled. */
	original: Dimensions;
	/** False when the bytes went through untouched. */
	changed: boolean;
}

export function encodingLadder(style: ShrinkTarget["style"]): Encoding[] {
	if (style === "photo") return [{ type: "image/jpeg", quality: 0.85 }, { type: "image/jpeg", quality: 0.75 }, { type: "image/jpeg", quality: 0.65 }];
	if (style === "gist") return [{ type: "image/jpeg", quality: 0.6 }, { type: "image/jpeg", quality: 0.45 }];
	return [{ type: "image/png" }, { type: "image/jpeg", quality: 0.9 }, { type: "image/jpeg", quality: 0.8 }, { type: "image/jpeg", quality: 0.7 }];
}

/** How many times a picture that will not fit is scaled down by a quarter before giving up. */
const SCALE_STEPS = 4;

/**
 * Fit one picture to `target`. Null when the engine cannot decode it, or nothing it produces fits.
 *
 * A picture already inside every limit, in a format every provider takes, goes through untouched.
 */
export async function shrinkImage<Bitmap>(engine: RasterEngine<Bitmap>, input: { data: Uint8Array; mimeType: string }, target: ShrinkTarget): Promise<ShrunkImage | null> {
	const header = imageDimensions(input.data);
	if (header && SAFE_IMAGE_TYPES.has(input.mimeType) && withinLimits(header, target) && input.data.length <= target.softBytes) {
		return { data: input.data, mimeType: input.mimeType, ...header, original: header, changed: false };
	}

	const decoded = await engine.decode(input.data, input.mimeType).catch(() => null);
	if (!decoded || decoded.width <= 0 || decoded.height <= 0) return null;
	try {
		const original = { width: decoded.width, height: decoded.height };
		/*
		 * Already inside every hard limit, only heavier than the soft target: kept unless an encoding is
		 * clearly smaller. This is what stops a picture shrunk once — in the composer, say — from being
		 * JPEG-compressed a second time when the main process sees it again.
		 */
		const fitsHard = SAFE_IMAGE_TYPES.has(input.mimeType) && withinLimits(original, target) && input.data.length <= target.maxBytes;
		let size = fitDimensions(original, target);
		for (let step = 0; step <= SCALE_STEPS; step++) {
			let smallest: { data: Uint8Array; encoding: Encoding } | null = null;
			for (const encoding of encodingLadder(target.style)) {
				// The source itself, when it already is this encoding at this size: a second PNG pass only loses time.
				const reuse = step === 0 && size.width === original.width && size.height === original.height && encoding.type === input.mimeType && encoding.type === "image/png";
				const data = reuse ? input.data : await engine.encode(decoded.bitmap, size, encoding);
				if (data.length <= target.softBytes) return { data, mimeType: encoding.type, ...size, original, changed: !reuse };
				if (data.length <= target.maxBytes && (!smallest || data.length < smallest.data.length)) smallest = { data, encoding };
			}
			if (fitsHard && (!smallest || smallest.data.length > input.data.length * 0.9)) {
				return { data: input.data, mimeType: input.mimeType, ...original, original, changed: false };
			}
			if (smallest) return { data: smallest.data, mimeType: smallest.encoding.type, ...size, original, changed: true };
			size = { width: Math.max(1, Math.floor(size.width * 0.75)), height: Math.max(1, Math.floor(size.height * 0.75)) };
		}
		return null;
	} finally {
		engine.release?.(decoded.bitmap);
	}
}

/**
 * The line a scaled tool picture carries, so coordinates read off it can be mapped back.
 *
 * Worded exactly as Claude Code, pi and oh-my-pi word it: models have seen this sentence.
 */
export function scaledNote(original: Dimensions, shown: Dimensions): string {
	const factor = Math.round((original.width / shown.width) * 100) / 100;
	return `[Image: original ${original.width}x${original.height}, displayed at ${shown.width}x${shown.height}. Multiply coordinates by ${factor} to map to original image.]`;
}
