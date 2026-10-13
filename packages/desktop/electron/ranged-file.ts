/**
 * A file the way `<video>` and `<audio>` need it served: the bytes a Range header asks for, as a 206.
 *
 * `net.fetch(file://)` answers every request with the whole file and a 200, Range header or not.
 * Chromium's media pipeline reads that as a source that cannot seek — `seekable` comes back as
 * [0, 0] — and every seek lands on the first frame: the scrubber, ← →, a click on the track. A clip
 * made in a conversation could only ever be watched from the start.
 *
 * Read from disk a range at a time rather than whole: a 1080p clip runs to tens of megabytes, and a
 * scrub asks for a few hundred kilobytes somewhere in the middle of it.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

/** The one `bytes=` range a media element sends. Anything else — several ranges, a typo — is answered whole. */
export function byteRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
	const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
	if (!match || (!match[1] && !match[2])) return null;
	// `bytes=-500` is the last 500 bytes; `bytes=500-` runs to the end.
	const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
	const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
	return start >= size || start > end ? "unsatisfiable" : { start, end };
}

export async function serveRanged(path: string, request: Request, type: string): Promise<Response> {
	const info = await stat(path).catch(() => null);
	if (!info?.isFile()) return new Response("not found", { status: 404 });
	const size = info.size;
	const headers: Record<string, string> = { "content-type": type, "accept-ranges": "bytes" };
	const range = byteRange(request.headers.get("range"), size);
	if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
	const { start, end } = range ?? { start: 0, end: size - 1 };
	if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
	headers["content-length"] = String(size === 0 ? 0 : end - start + 1);
	const body = request.method === "HEAD" || size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream<Uint8Array>);
	return new Response(body, { status: range ? 206 : 200, headers });
}
