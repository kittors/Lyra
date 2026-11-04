/**
 * Pictures fitted once, on their way into a conversation.
 *
 * Everything that enters the history is re-sent on every request after it, so this is the place to
 * make a picture the size it will be sent at: a person's prompt (`runtime/session.ts`) and every tool
 * result (`agent/tool-run.ts`) — `read`, MCP tools, the browser's screenshots — pass through here
 * before they are stored. pi does the same at the same place, for the same reason: one oversized
 * picture in the history does not fail one turn, it fails every turn.
 *
 * What is stored is the fitted copy. The model never looks at more than these limits, and the
 * original stays wherever it came from: a dragged-in file keeps its path on the attachment.
 *
 * Without a codec nothing changes here; the request boundary (`request-images.ts`) decides what is
 * sent instead.
 */

import type { ToolResult, UserContent } from "../types.ts";
import { imageCodec, type ImageCodec } from "./codec.ts";
import { imageStyle } from "./fit.ts";
import { ENTRY_LIMITS, scaledNote } from "./shrink.ts";

export async function fitEntryImages(content: UserContent[], options: { codec?: ImageCodec | null; noteScale?: boolean } = {}): Promise<UserContent[]> {
	const codec = options.codec === undefined ? imageCodec() : options.codec;
	if (!codec || !content.some((part) => part.type === "image" && part.data)) return content;
	let changed = false;
	const out: UserContent[] = [];
	for (const part of content) {
		if (part.type !== "image" || !part.data) {
			out.push(part);
			continue;
		}
		const mimeType = part.mimeType === "image/jpg" ? "image/jpeg" : part.mimeType;
		const shrunk = await codec.shrink({ data: new Uint8Array(Buffer.from(part.data, "base64")), mimeType }, { ...ENTRY_LIMITS, style: imageStyle(mimeType) }).catch(() => null);
		// Undecodable here, or already fine: kept as it came. The request boundary has the last word.
		if (!shrunk?.changed) {
			out.push(part);
			continue;
		}
		changed = true;
		// `media` named the old bytes; the store names the new ones when it writes them.
		const { media: _stale, ...rest } = part;
		out.push({ ...rest, data: Buffer.from(shrunk.data).toString("base64"), mimeType: shrunk.mimeType });
		const scaled = shrunk.width !== shrunk.original.width || shrunk.height !== shrunk.original.height;
		if (options.noteScale && scaled) out.push({ type: "text", text: scaledNote(shrunk.original, shrunk) });
	}
	return changed ? out : content;
}

/**
 * A tool's pictures, fitted — with the line that maps coordinates back when one was scaled, because a
 * tool's screenshot is what the model clicks on next.
 */
export async function fitResultImages(result: ToolResult, codec?: ImageCodec | null): Promise<ToolResult> {
	const content = await fitEntryImages(result.content, { codec, noteScale: true });
	return content === result.content ? result : { ...result, content };
}
