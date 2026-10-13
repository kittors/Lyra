/**
 * Width, height and length out of an MP4's own `moov` box, read without loading the file.
 *
 * For the same reason `images/dimensions.ts` reads a picture's header: the card holds the video's
 * place at its real shape before a frame has decoded, and the model is told what it got. A host says
 * what it was asked for, not what it made — image-to-video takes the picture's shape, whatever ratio
 * was requested. Only the top level is walked to find `moov`, which is a few kilobytes even when it
 * sits after twenty megabytes of frames.
 */

import { open } from "node:fs/promises";

export interface VideoFacts {
	width?: number;
	height?: number;
	seconds?: number;
}

/** A `moov` larger than this is not a video's index but a broken file; not worth reading into memory. */
const MOOV_LIMIT = 32 * 1024 * 1024;

export async function mp4Facts(path: string): Promise<VideoFacts | null> {
	const file = await open(path, "r").catch(() => null);
	if (!file) return null;
	try {
		const { size } = await file.stat();
		const header = Buffer.alloc(16);
		let at = 0;
		while (at + 8 <= size) {
			const { bytesRead } = await file.read(header, 0, 16, at);
			if (bytesRead < 8) return null;
			let boxSize = header.readUInt32BE(0);
			const type = header.toString("latin1", 4, 8);
			let headerSize = 8;
			if (boxSize === 1) {
				if (bytesRead < 16) return null;
				boxSize = Number(header.readBigUInt64BE(8));
				headerSize = 16;
			} else if (boxSize === 0) boxSize = size - at;
			if (boxSize < headerSize) return null;
			if (type === "moov") {
				if (boxSize - headerSize > MOOV_LIMIT) return null;
				const moov = Buffer.alloc(boxSize - headerSize);
				await file.read(moov, 0, moov.length, at + headerSize);
				return factsIn(moov);
			}
			at += boxSize;
		}
		return null;
	} finally {
		await file.close();
	}
}

/** `mvhd` for the length, the first track header with a picture size for the shape. */
export function factsIn(moov: Buffer): VideoFacts {
	const facts: VideoFacts = {};
	walk(moov, (type, body) => {
		if (type === "mvhd" && body.length >= 24) {
			const v1 = body[0] === 1;
			const timescale = v1 ? body.readUInt32BE(20) : body.readUInt32BE(12);
			const duration = v1 && body.length >= 32 ? Number(body.readBigUInt64BE(24)) : body.readUInt32BE(16);
			if (timescale > 0) facts.seconds = Math.round((duration / timescale) * 10) / 10;
		}
		// An audio track's header says 0×0; the first track with a size is the picture.
		if (type === "tkhd" && facts.width === undefined && body.length >= 8) {
			const width = Math.round(body.readUInt32BE(body.length - 8) / 65536);
			const height = Math.round(body.readUInt32BE(body.length - 4) / 65536);
			if (width > 0 && height > 0) Object.assign(facts, { width, height });
		}
		return type === "trak";
	});
	return facts;
}

/** Each box in `buffer`; `visit` returning true descends into it. */
function walk(buffer: Buffer, visit: (type: string, body: Buffer) => boolean): void {
	let at = 0;
	while (at + 8 <= buffer.length) {
		let size = buffer.readUInt32BE(at);
		const type = buffer.toString("latin1", at + 4, at + 8);
		let header = 8;
		if (size === 1 && at + 16 <= buffer.length) {
			size = Number(buffer.readBigUInt64BE(at + 8));
			header = 16;
		} else if (size === 0) size = buffer.length - at;
		if (size < header || at + size > buffer.length) return;
		const body = buffer.subarray(at + header, at + size);
		if (visit(type, body)) walk(body, visit);
		at += size;
	}
}
