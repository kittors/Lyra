/**
 * The one thing core cannot do for itself with a picture: decode it, scale it, encode it again.
 *
 * Core runs in the desktop's main process, in the CLI and in tests, and only the first has an image
 * library (Electron's `nativeImage`). So the work is a binding the host makes once, like the provider
 * registry in `ai/index.ts`: the desktop binds a codec at startup, and everything that has to make a
 * picture smaller asks for it here. A host that binds nothing — the CLI — still never sends a picture
 * that does not fit: `request-images.ts` replaces it with a line instead.
 */

import { shrinkImage, type RasterEngine, type ShrinkTarget, type ShrunkImage } from "./shrink.ts";

export interface ImageCodec {
	/** Null when these bytes cannot be decoded here, or cannot be made to fit. */
	shrink(input: { data: Uint8Array; mimeType: string }, target: ShrinkTarget): Promise<ShrunkImage | null>;
}

let bound: ImageCodec | null = null;

/** Bind the host's codec; `null` unbinds it (a test, a shutdown). */
export function useImageCodec(codec: ImageCodec | null): void {
	bound = codec;
}

export function imageCodec(): ImageCodec | null {
	return bound;
}

/** A codec from an engine that can only scale and encode — the decisions stay in `shrink.ts`. */
export function codecFromEngine<Bitmap>(engine: RasterEngine<Bitmap>): ImageCodec {
	return { shrink: (input, target) => shrinkImage(engine, input, target) };
}
