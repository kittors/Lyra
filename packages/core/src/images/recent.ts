/**
 * The pictures already in a conversation, newest first — what `#1` and `#2` mean to `image_generate`.
 *
 * A number rather than an id because the model never sees an id for an attachment: it sees the
 * picture. "The newest one" is how a person refers to what they just pasted, and how they refer to
 * what was just drawn, and both resolve the same way here.
 *
 * Sources, in the order they are looked at: pictures drawn this turn (not in the transcript the turn
 * started from yet), then every message from the newest back — attachments, earlier drawings, and
 * images other tools returned (a screenshot, a read of a PNG). Only the one asked for is read from
 * disk; a long conversation can hold hundreds.
 */

import { readFile } from "node:fs/promises";
import { safeMediaName, sessionMediaPath } from "../session/payload.ts";
import type { Message } from "../types/message.ts";
import { IMAGE_TOOL_NAME, type ImageInput, type ImagePointer } from "./types.ts";

/** Where the tool notes what it drew, for the rest of this turn. Newest first. */
export const RECENT_IMAGES_KEY = "image_generate:recent";

function picturesOf(message: Message): ImagePointer[] {
	if (message.role === "assistant") return [];
	const found: ImagePointer[] = [];
	if (message.role === "toolResult" && message.toolName === IMAGE_TOOL_NAME) {
		const details = message.details as { images?: { media?: string; mimeType?: string }[] } | undefined;
		for (const image of details?.images ?? []) if (image.media) found.push({ media: image.media, mimeType: image.mimeType ?? "image/png" });
	}
	for (const part of message.content) {
		if (part.type === "image" && (part.data || part.media)) found.push({ data: part.data || undefined, media: part.media, mimeType: part.mimeType });
	}
	return found;
}

/** Every picture, newest first, without loading any of them. Duplicates of one file count once. */
export function conversationPictures(messages: readonly Message[], drawnThisTurn: readonly ImagePointer[] = []): ImagePointer[] {
	const all = [...drawnThisTurn];
	for (let index = messages.length - 1; index >= 0; index--) all.push(...picturesOf(messages[index]));
	const seen = new Set<string>();
	return all.filter((picture) => {
		if (!picture.media) return true;
		if (seen.has(picture.media)) return false;
		seen.add(picture.media);
		return true;
	});
}

export async function loadPicture(picture: ImagePointer): Promise<ImageInput | null> {
	if (picture.data) return { data: picture.data, mimeType: picture.mimeType };
	const name = picture.media ? safeMediaName(picture.media) : "";
	if (!name) return null;
	const bytes = await readFile(sessionMediaPath(name)).catch(() => null);
	return bytes ? { data: bytes.toString("base64"), mimeType: picture.mimeType, name } : null;
}
