/**
 * Asking for a drawing or a video again, with another model, as a message in its own conversation.
 *
 * A message rather than a call made behind the conversation's back, for the reason drawing is a tool
 * at all (ADR-0033): the model holding the conversation writes the brief and points at the pictures,
 * and the result lands where every other one does — in the transcript, in the history of the picture
 * it came from. The message names the model with `@`, so the conversation switches to it as it would
 * for one typed by hand (`runtime/media-turn.ts`), and it is sent only when the composer was empty —
 * the rule the gallery's 「再改」 keeps (ADR-0034): half a sentence someone was writing is not sent with it.
 */

import { type MediaKind, mediaModelLabel, mediaModelRows } from "@lyra/core/image-models";
import { sessionMediaUrl } from "../../../shared/session-image.ts";
import { translate } from "../../i18n/translate.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";

/** `@name` the way the composer writes it, quoted when the name has a space. */
function mentionOf(label: string): string {
	return /\s/.test(label) ? `@"${label.replaceAll('"', '\\"')}"` : `@${label}`;
}

/** The name a model goes by among its kind — what `@` and the tools take back. */
function labelFor(kind: MediaKind, modelId: string): string | null {
	const rows = mediaModelRows(useApp.getState().settings?.providers, kind);
	const row = rows.find((candidate) => candidate.model.id === modelId);
	return row ? mediaModelLabel(row, rows) : null;
}

/** The brief, short enough to sit in a message and still say which drawing is meant. */
const brief = (prompt: string) => {
	const flat = prompt.replace(/\s+/g, " ").trim();
	return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
};

/** The same brief and pictures, another model of the same kind. */
export function remakeWith(sessionId: string | null, kind: MediaKind, modelId: string, prompt: string): void {
	const label = labelFor(kind, modelId);
	if (!label) return;
	const words = translate(kind === "video" ? "videoGen.remakeAsk" : "imageGen.redrawAsk", { mention: mentionOf(label), prompt: brief(prompt) });
	useApp.getState().setComposerDraft(words, { sessionId, send: true });
}

const extension = (mimeType: string) => (mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png");

/** A drawn picture as the first frame of a video, the picture itself attached so it is `#1`. */
export async function filmFrom(sessionId: string | null, picture: { media: string; mimeType: string }, modelId: string): Promise<void> {
	const label = labelFor("video", modelId);
	if (!label) return;
	const dataUrl = await bridge.files.mediaDataUrl(sessionMediaUrl(picture.media)).catch(() => null);
	const comma = dataUrl?.indexOf(",") ?? -1;
	if (!dataUrl || comma < 0) {
		useApp.getState().notify(translate("gallery.unreadable"), "error");
		return;
	}
	const mimeType = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? picture.mimeType;
	useApp.getState().setComposerDraft(translate("imageGen.filmAsk", { mention: mentionOf(label) }), {
		sessionId,
		// The same bytes as the drawing, so the video's history starts at that picture.
		attachments: [{ id: crypto.randomUUID(), name: `image.${extension(mimeType)}`, mimeType, kind: "image", isText: false, data: dataUrl.slice(comma + 1) }],
		send: true,
	});
}
