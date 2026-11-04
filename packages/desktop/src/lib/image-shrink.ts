/**
 * Fitting a picture before it leaves the window — or the phone.
 *
 * The decisions (size, format, quality) are core's (`@lyra/core/image-shrink`); this file brings the
 * canvas that does the pixel work. Doing it here rather than only in the main process is about the
 * trip: a 12 MP photo picked on a phone crosses the sync link as a few hundred KB instead of 5 MB, and
 * a draft holding thirteen 4K screenshots holds a few MB of base64 instead of 25. The main process
 * fits again on arrival (`images/fit-entry.ts`), which for a picture fitted here is a header read.
 *
 * Chromium decodes PNG, JPEG, GIF, WebP, BMP, ICO, AVIF and SVG; not HEIC or TIFF. Those come back null
 * and go on as they are, for the main process to convert.
 */

import { ENTRY_LIMITS, imageDimensions, imageStyle, shrinkImage, type Encoding, type RasterEngine, type ShrunkImage } from "@lyra/core/image-shrink";

type Source = ImageBitmap | HTMLImageElement;

/** Decoding allocates width × height × 4 bytes; past this a crafted or panoramic file could take the page down. */
const MAX_DECODE_PIXELS = 50_000_000;

const MIME_BY_EXTENSION: Record<string, string> = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
	avif: "image/avif", heic: "image/heic", heif: "image/heif", svg: "image/svg+xml", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff",
};

/** What a picked file is, when the picker did not say (HEIC on most desktops, anything dragged from some apps). */
export function pictureMimeType(name: string, given: string): string {
	if (given) return given === "image/jpg" ? "image/jpeg" : given;
	return MIME_BY_EXTENSION[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
}

function canvasOf(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
	// An older iOS WebView has no 2D OffscreenCanvas; the element does the same work.
	if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

async function blobOf(canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
	if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
	return new Promise((done, fail) => canvas.toBlob((blob) => (blob ? done(blob) : fail(new Error("encode failed"))), type, quality));
}

/** SVG — and anything else `createImageBitmap` turns down — still decodes through an element. */
async function viaElement(blob: Blob): Promise<{ bitmap: Source; width: number; height: number } | null> {
	const url = URL.createObjectURL(blob);
	try {
		const element = new Image();
		element.src = url;
		await element.decode();
		return element.naturalWidth > 0 ? { bitmap: element, width: element.naturalWidth, height: element.naturalHeight } : null;
	} catch {
		return null;
	} finally {
		URL.revokeObjectURL(url);
	}
}

const engine: RasterEngine<Source> = {
	async decode(data, mimeType) {
		const header = imageDimensions(data);
		if (header && header.width * header.height > MAX_DECODE_PIXELS) return null;
		const blob = new Blob([data as BlobPart], { type: mimeType });
		try {
			// A phone photo is stored sideways with an EXIF turn; `from-image` applies it, so the pixels are upright.
			const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
			return { bitmap, width: bitmap.width, height: bitmap.height };
		} catch {
			return viaElement(blob);
		}
	},
	async encode(source, size, encoding: Encoding) {
		let from: CanvasImageSource = source;
		let width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
		let height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
		// Halve in steps past 2×: one big jump aliases where the browser's "high" smoothing is not a real filter (WebKit).
		while (width / 2 >= size.width && height / 2 >= size.height) {
			const step = canvasOf(Math.round(width / 2), Math.round(height / 2));
			const context = step.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
			context.imageSmoothingQuality = "high";
			context.drawImage(from, 0, 0, step.width, step.height);
			from = step;
			width = step.width;
			height = step.height;
		}
		const canvas = canvasOf(size.width, size.height);
		const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
		if (encoding.type === "image/jpeg") {
			// JPEG has no alpha: what was see-through would come out black.
			context.fillStyle = "#ffffff";
			context.fillRect(0, 0, size.width, size.height);
		}
		context.imageSmoothingQuality = "high";
		context.drawImage(from, 0, 0, size.width, size.height);
		const blob = await blobOf(canvas, encoding.type, encoding.type === "image/jpeg" ? encoding.quality : undefined);
		return new Uint8Array(await blob.arrayBuffer());
	},
	release(source) {
		if (!(source instanceof HTMLImageElement)) source.close();
	},
};

/** A picture fitted for the prompt; null when this page cannot decode it. */
export function fitPicture(data: Uint8Array, mimeType: string): Promise<ShrunkImage | null> {
	return shrinkImage(engine, { data, mimeType }, { ...ENTRY_LIMITS, style: imageStyle(mimeType) }).catch(() => null);
}

/** btoa cannot take a raw byte array; chunked so large pictures do not blow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	return btoa(binary);
}

function base64ToBytes(data: string): Uint8Array {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * A `data:` URL — the annotator's output, a picture from the gallery — split into an attachment's
 * fields, fitted on the way. The annotator hands back a PNG the size of the picture it was given.
 */
export async function fitDataUrl(dataUrl: string, fallbackMime = "image/png"): Promise<{ data: string; mimeType: string } | null> {
	const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(dataUrl);
	if (!match) return null;
	const mimeType = match[1] || fallbackMime;
	const fitted = await fitPicture(base64ToBytes(match[2]), mimeType);
	if (!fitted?.changed) return { data: match[2], mimeType };
	return { data: bytesToBase64(fitted.data), mimeType: fitted.mimeType };
}
