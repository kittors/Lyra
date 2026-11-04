/**
 * Saving a picture out of the conversation: the dialog's title and the name it suggests.
 *
 * On the Windows test machine 另存为 on a picture inline in a reply opened a dialog titled with the
 * whole data URL — several kilobytes of base64 across its top — and suggested `image-<ms>.png`.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { mediaSaveDialog } from "../electron/media-save-dialog.ts";

const AT = new Date(2026, 10, 5, 9, 8, 7);
const where = { downloads: "/home/me/Downloads", scheme: "ly-media", at: AT };

test("a picture inline in a reply is titled as a picture and named for when it was saved", () => {
	const png = mediaSaveDialog("data:image/png;base64,iVBORw0KGgo=", "image-1793816291771.png", where);
	assert.deepEqual(png, { title: "保存图片", defaultPath: join("/home/me/Downloads", "lyra-image-2026-11-05-09-08-07.png") });
	assert.equal(mediaSaveDialog("data:image/jpeg;base64,/9j/", "x", where)?.defaultPath, join("/home/me/Downloads", "lyra-image-2026-11-05-09-08-07.jpg"));
	assert.equal(mediaSaveDialog("data:image/svg+xml,%3Csvg%3E", "x", where)?.defaultPath.endsWith(".svg"), true);
});

test("a drawn picture and a video keep their own extension; a video is titled as one", () => {
	assert.deepEqual(mediaSaveDialog("ly-media://m/d36d96b7.jpg", "d36d96b7.jpg", where), { title: "保存图片", defaultPath: join("/home/me/Downloads", "lyra-image-2026-11-05-09-08-07.jpg") });
	assert.deepEqual(mediaSaveDialog("ly-media://m/a1b2.mp4", "a1b2.mp4", where), { title: "保存视频", defaultPath: join("/home/me/Downloads", "lyra-video-2026-11-05-09-08-07.mp4") });
});

test("any other download is left to Electron", () => {
	assert.equal(mediaSaveDialog("https://example.com/a.png", "a.png", where), null);
	assert.equal(mediaSaveDialog("data:text/plain,hello", "hello.txt", where), null);
});
