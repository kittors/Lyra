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
import { fitDataUrl } from "../../lib/image-shrink.ts";

/** `from` is the drawn picture being marked up, by `session-media` name, so its history carries on through the copy. */
export function attachToComposer(sessionId: string | null, from?: string): (dataUrl: string) => void {
	return (dataUrl) => {
		// Fitted like any picture put on a composer (`lib/image-shrink.ts`): the annotator returns full size.
		void fitDataUrl(dataUrl).then((fitted) => {
			if (!fitted) return;
			useApp.getState().setComposerDraft("", {
				sessionId,
				attachments: [{ id: crypto.randomUUID(), name: translate("annotate.attachmentName"), mimeType: fitted.mimeType, kind: "image", isText: false, data: fitted.data, ...(from ? { markedFrom: from } : {}) }],
			});
		});
	};
}
