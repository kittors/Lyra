/**
 * What the save dialog suggests for a picture or video saved out of the conversation.
 *
 * Every picture the window shows from a conversation is `ly-media://m/<sha1>.<ext>`, or a `data:` URL
 * when it came inline, and a link's `download` name is ignored for a URL not of the page's own
 * origin — so 下载 on a drawn picture, and 另存为 in the image viewer, offered `d36d96b7….jpg`.
 * Left alone, Electron also titles the dialog with the download's URL: on Windows a data URL several
 * kilobytes long ran across the top of the dialog. The dialog still asks; only what it suggests
 * changes: the downloads folder, when the picture was saved, and a title that says what is saved.
 */

import { extname, join } from "node:path";
import { nativeText } from "./i18n.ts";

const VIDEO = new Set([".mp4", ".webm", ".mov"]);
const INLINE_PICTURE = /^data:image\/([a-z0-9.+-]+)[;,]/i;

/** `lyra-image-2026-10-11-20-58-03.jpg` — or `lyra-video-….mp4` — in local time, keeping the file's own extension. */
function mediaDownloadName(file: string, at = new Date()): string {
	const two = (value: number) => String(value).padStart(2, "0");
	const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}-${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;
	const ext = extname(file).toLowerCase();
	return `lyra-${VIDEO.has(ext) ? "video" : "image"}-${stamp}${ext || ".png"}`;
}

/** The dialog's title and suggested path, or null for a download that is not the conversation's media. */
export function mediaSaveDialog(url: string, filename: string, input: { downloads: string; scheme: string; at?: Date }): { title: string; defaultPath: string } | null {
	const inline = INLINE_PICTURE.exec(url);
	if (!inline && !url.startsWith(`${input.scheme}://`)) return null;
	const subtype = inline?.[1]?.toLowerCase();
	const file = subtype ? `picture.${subtype === "jpeg" ? "jpg" : subtype === "svg+xml" ? "svg" : subtype}` : filename;
	return {
		title: nativeText(VIDEO.has(extname(file).toLowerCase()) ? "dialog.saveVideo" : "dialog.saveImage"),
		defaultPath: join(input.downloads, mediaDownloadName(file, input.at)),
	};
}
