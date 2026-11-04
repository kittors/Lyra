/**
 * A picture saved out of the conversation gets a name a person can read, and a dialog that says
 * what it saves rather than its URL. See `media-save-dialog.ts`.
 */

import { app, session } from "electron";
import { mediaSaveDialog } from "./media-save-dialog.ts";
import { MEDIA_SCHEME } from "./preview-protocol.ts";

export function nameMediaDownloads(): void {
	session.defaultSession.on("will-download", (_event, item) => {
		const dialog = mediaSaveDialog(item.getURL(), item.getFilename(), { downloads: app.getPath("downloads"), scheme: MEDIA_SCHEME });
		if (dialog) item.setSaveDialogOptions(dialog);
	});
}
