/**
 * Pictures for tests that only look at headers and sizes.
 *
 * `png` and `jpeg` write a real header for the size asked for and pad to a chosen length — every
 * decision in `images/` reads exactly those two things. `fakeEngine` is a `RasterEngine` that encodes
 * by writing such a header, at a length the test decides per size and encoding.
 */

import { imageDimensions } from "../src/images/dimensions.ts";
import type { Encoding, RasterEngine } from "../src/images/shrink.ts";

export function png(width: number, height: number, total = 64): Uint8Array {
	const bytes = new Uint8Array(Math.max(33, total));
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	bytes[24] = 8;
	bytes[25] = 6;
	return bytes;
}

export function jpeg(width: number, height: number, total = 64): Uint8Array {
	const bytes = new Uint8Array(Math.max(32, total));
	bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]);
	return bytes;
}

/** Bytes an encoding produces at a size, as the test decides. */
type Sizer = (size: { width: number; height: number }, encoding: Encoding) => number;

export function fakeEngine(sizer: Sizer, decodable = true) {
	const calls = { decode: 0, encode: [] as string[], released: 0 };
	const engine: RasterEngine<{ width: number; height: number }> = {
		async decode(data) {
			calls.decode++;
			const size = imageDimensions(data);
			return decodable && size ? { bitmap: size, ...size } : null;
		},
		async encode(_bitmap, size, encoding) {
			calls.encode.push(`${encoding.type === "image/png" ? "png" : `jpeg${Math.round(encoding.quality * 100)}`}@${size.width}x${size.height}`);
			const total = sizer(size, encoding);
			return encoding.type === "image/png" ? png(size.width, size.height, total) : jpeg(size.width, size.height, total);
		},
		release() {
			calls.released++;
		},
	};
	return { engine, calls };
}
