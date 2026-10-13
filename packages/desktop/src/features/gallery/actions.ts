/**
 * What the gallery does to a conversation: show a picture where it was drawn, or ask for it again, changed.
 */

import { sessionMediaUrl } from "../../../shared/session-image.ts";
import { translate } from "../../i18n/translate.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { revealDrawing } from "../conversation/index.ts";
import { revealInWorkspace } from "../split/index.ts";

/** Resolves once that conversation is the one on screen, or with false when it never becomes it. */
function opened(sessionId: string, within = 10_000): Promise<boolean> {
	const ready = () => {
		const state = useApp.getState();
		return state.activeSessionId === sessionId && state.pendingSessionId == null && state.view === "chat";
	};
	if (ready()) return Promise.resolve(true);
	return new Promise((resolve) => {
		const timer = window.setTimeout(() => {
			stop();
			resolve(false);
		}, within);
		const stop = useApp.subscribe(() => {
			if (!ready()) return;
			window.clearTimeout(timer);
			stop();
			resolve(true);
		});
	});
}

/** Open the conversation a drawing is in, scrolled to it. */
export function showInConversation(sessionId: string, toolCallId: string): void {
	// Asked first: the conversation takes the request once it has been read, however long that is.
	revealDrawing(sessionId, toolCallId);
	revealInWorkspace(sessionId);
}

const extension = (mimeType: string) => (mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png");

/**
 * Ask for a picture again, changed: into its own conversation, with the picture attached.
 *
 * The bytes go back exactly as they are stored, so the attachment is the same `session-media` file as
 * the drawing — the edit made from it is recorded as made from that picture, and its history goes on
 * unbroken. A marked-up copy is a new picture, and comes in as `marked`.
 *
 * With words it is sent straight away, the way the composer sends; without, the conversation opens with
 * the picture in its composer and the caret beside it.
 */
export async function editInConversation(picture: { sessionId: string; media: string; mimeType: string }, words: string, marked?: string): Promise<boolean> {
	const dataUrl = marked ?? (await bridge.files.mediaDataUrl(sessionMediaUrl(picture.media)).catch(() => null));
	const comma = dataUrl?.indexOf(",") ?? -1;
	if (!dataUrl || comma < 0) {
		useApp.getState().notify(translate("gallery.unreadable"), "error");
		return false;
	}
	const mimeType = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? picture.mimeType;
	revealInWorkspace(picture.sessionId);
	if (!(await opened(picture.sessionId))) {
		useApp.getState().notify(translate("gallery.conversationGone"), "error");
		return false;
	}
	useApp.getState().setComposerDraft(words.trim(), {
		sessionId: picture.sessionId,
		// `image.<ext>` is a placeholder name: the composer labels it 图片 1 rather than printing a hash.
		attachments: [
			{ id: crypto.randomUUID(), name: `image.${extension(mimeType)}`, mimeType, kind: "image", isText: false, data: dataUrl.slice(comma + 1), ...(marked ? { markedFrom: picture.media } : {}) },
		],
		send: Boolean(words.trim()),
	});
	return true;
}
