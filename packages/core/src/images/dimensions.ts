/**
 * Width and height out of an image's own header.
 *
 * The card holds the picture's place at its real shape before the bytes have loaded, and the model is
 * told what it got. Asking the provider is not enough: the Images API reports a requested size, not
 * the delivered one, and a relay in front of Gemini reports nothing at all. PNG, JPEG and WebP — what
 * image models return — and `null` for anything else rather than a guess.
 */

export interface Dimensions {
	width: number;
	height: number;
}

function png(bytes: Uint8Array): Dimensions | null {
	// Signature, then the IHDR chunk: width and height are its first eight bytes, big-endian.
	if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpeg(bytes: Uint8Array): Dimensions | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let at = 2;
	while (at + 9 < bytes.length) {
		if (bytes[at] !== 0xff) return null;
		const marker = bytes[at + 1];
		// Standalone markers carry no length.
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			at += 2;
			continue;
		}
		const length = view.getUint16(at + 2);
		// Any start-of-frame except the DHT/JPG/DAC markers that share the range.
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
		}
		at += 2 + length;
	}
	return null;
}

function webp(bytes: Uint8Array): Dimensions | null {
	const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
	if (bytes.length < 30 || text(0, 4) !== "RIFF" || text(8, 12) !== "WEBP") return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunk = text(12, 16);
	if (chunk === "VP8X") {
		const uint24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
		return { width: uint24(24) + 1, height: uint24(27) + 1 };
	}
	if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
	if (chunk === "VP8L") {
		const bits = view.getUint32(21, true);
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
	}
	return null;
}

export function imageDimensions(bytes: Uint8Array): Dimensions | null {
	return png(bytes) ?? jpeg(bytes) ?? webp(bytes);
}

/** The MIME type the bytes actually are, which is not always what the response claimed. */
export function sniffImageType(bytes: Uint8Array): string | null {
	if (png(bytes)) return "image/png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
	if (webp(bytes)) return "image/webp";
	return null;
}
