/**
 * The main process's half of fitting pictures: decode, scale, encode, with Electron's `nativeImage`.
 *
 * Bound into core at startup (`useImageCodec`), so a tool's screenshot, a picture `read` opened, a
 * phone's HEIC and the history of a conversation saved before any of this existed are fitted here.
 * What to do — the size, the format, the quality — is decided in core (`images/shrink.ts`); this file
 * only does the pixel work. The composer does the same work on a canvas before a picture leaves the
 * window, so most pictures arrive here already fitted and are only looked at.
 *
 * Measured on this machine (Electron 43, a 3840×2160 PNG): decode 15–40 ms, resize 11 ms, PNG
 * 13–160 ms, JPEG 3–7 ms. All of it is synchronous, so each step first yields to the event loop:
 * IPC waiting behind a batch of pictures gets a turn between them.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { nativeImage, type NativeImage } from "electron";
import { codecFromEngine, type Encoding, type ImageCodec, type RasterEngine } from "@lyra/core";

const yieldTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The extension `sips` reads the format from. */
const EXTENSION: Record<string, string> = {
	"image/heic": "heic",
	"image/heif": "heif",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/tiff": "tiff",
	"image/bmp": "bmp",
	"image/avif": "avif",
};

/**
 * What `nativeImage` cannot read — it decodes PNG and JPEG only; HEIC, WebP, GIF, TIFF come back empty
 * (checked: `createFromBuffer` and `createFromPath` alike).
 *
 * On macOS `sips` reads them all and keeps the size. `createThumbnailFromPath` would read them too, but
 * hands back the requested box (4096×4096 for a 4032×3024 photo), not the picture. Elsewhere there is
 * nothing to ask, and the picture stays as it came: the request boundary says what it was instead of
 * sending a format the model refuses.
 */
async function convertElsewhere(data: Uint8Array, mimeType: string): Promise<NativeImage | null> {
	const extension = EXTENSION[mimeType];
	if (process.platform !== "darwin" || !extension) return null;
	const dir = await mkdtemp(join(tmpdir(), "lyra-image-"));
	try {
		const source = join(dir, `${randomUUID()}.${extension}`);
		const target = join(dir, "converted.png");
		await writeFile(source, data);
		await promisify(execFile)("/usr/bin/sips", ["-s", "format", "png", source, "--out", target], { timeout: 20_000 });
		const image = nativeImage.createFromBuffer(await readFile(target));
		return image.isEmpty() ? null : image;
	} catch {
		return null;
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

/**
 * Onto white, for JPEG: `toJPEG` drops alpha, and what was see-through comes out black (measured: a
 * transparent pixel encodes as 0,0,0). The bitmap is premultiplied BGRA, so white shows through as
 * `colour + (255 − alpha)`. Most screenshots are opaque, and those are returned untouched.
 */
function flattened(image: NativeImage): NativeImage {
	const pixels = image.toBitmap();
	let opaque = true;
	for (let at = 3; at < pixels.length; at += 4) {
		if (pixels[at] !== 255) {
			opaque = false;
			break;
		}
	}
	if (opaque) return image;
	for (let at = 0; at < pixels.length; at += 4) {
		const clear = 255 - pixels[at + 3];
		pixels[at] += clear;
		pixels[at + 1] += clear;
		pixels[at + 2] += clear;
		pixels[at + 3] = 255;
	}
	return nativeImage.createFromBitmap(pixels, image.getSize());
}

const engine: RasterEngine<NativeImage> = {
	async decode(data, mimeType) {
		await yieldTurn();
		let image: NativeImage | null = nativeImage.createFromBuffer(Buffer.from(data));
		if (image.isEmpty()) image = await convertElsewhere(data, mimeType);
		if (!image) return null;
		const { width, height } = image.getSize();
		return { bitmap: image, width, height };
	},
	async encode(image, size, encoding: Encoding) {
		await yieldTurn();
		const now = image.getSize();
		const scaled = now.width === size.width && now.height === size.height ? image : image.resize({ ...size, quality: "best" });
		if (encoding.type === "image/png") return new Uint8Array(scaled.toPNG());
		return new Uint8Array(flattened(scaled).toJPEG(Math.round(encoding.quality * 100)));
	},
};

export const electronImageCodec: ImageCodec = codecFromEngine(engine);
