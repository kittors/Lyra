/**
 * A marked-up picture, handed to a conversation's composer.
 *
 * What 完成 means for a picture in a conversation: the marks are instructions — circle this, move
 * that — and the next message asks for the picture to be drawn again with them. `image_generate`
 * reads the newest picture in the conversation as `#1`, so attaching it is all the hand-off needs.
 *
 * Named by conversation, never "the composer": a split has one on every screen, and an unnamed
 * draft is taken by all of them at once (see `composerDraft` in the store).
 */

import { translate } from "../../i18n/translate.ts";
import { useApp } from "../../store/index.ts";

/** `from` is the drawn picture being marked up, by `session-media` name, so its history carries on through the copy. */
export function attachToComposer(sessionId: string | null, from?: string): (dataUrl: string) => void {
	return (dataUrl) => {
		const comma = dataUrl.indexOf(",");
		const mimeType = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "image/png";
		useApp.getState().setComposerDraft("", {
			sessionId,
			attachments: [{ id: crypto.randomUUID(), name: translate("annotate.attachmentName"), mimeType, kind: "image", isText: false, data: dataUrl.slice(comma + 1), ...(from ? { markedFrom: from } : {}) }],
		});
	};
}
