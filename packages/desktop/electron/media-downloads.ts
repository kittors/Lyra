/**
 * A picture saved out of the conversation gets a name a person can read.
 *
 * Every picture the window shows from a conversation is `ly-media://m/<sha1>.<ext>`, and a link's
 * `download` name is ignored for a URL not of the page's own origin — so 下载 on a drawn picture,
 * and 另存为 in the image viewer, offered `d36d96b7….jpg` in the save dialog. The dialog still asks;
 * only its suggestion changes: the downloads folder, and when the picture was saved.
 */

import { extname, join } from "node:path";
import { app, session } from "electron";
import { MEDIA_SCHEME } from "./preview-protocol.ts";

/** `lyra-image-2026-10-11-20-58-03.jpg` — or `lyra-video-….mp4` — in local time, keeping the file's own extension. */
function mediaDownloadName(file: string, at = new Date()): string {
	const two = (value: number) => String(value).padStart(2, "0");
	const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}-${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;
	const ext = extname(file).toLowerCase();
	return `lyra-${[".mp4", ".webm", ".mov"].includes(ext) ? "video" : "image"}-${stamp}${ext || ".png"}`;
}

export function nameMediaDownloads(): void {
	session.defaultSession.on("will-download", (_event, item) => {
		if (!item.getURL().startsWith(`${MEDIA_SCHEME}://`)) return;
		item.setSaveDialogOptions({ defaultPath: join(app.getPath("downloads"), mediaDownloadName(item.getFilename())) });
	});
}
