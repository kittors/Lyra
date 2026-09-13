/**
 * Asking the operating system to do something.
 *
 * Opening a path, launching an editor, fetching an app icon. Small, but not trivial: each one hands
 * a renderer-supplied string to the OS, so the guard matters more than the call.
 */

import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { lyraHome } from "@lyra/core";
import { clipboard, ipcMain, nativeImage, shell } from "electron";
import { remoteImage } from "../avatars.ts";
import { openExternalSafely } from "../window-security.ts";
import { openTargets, openWith, type OpenTarget } from "../open-targets.ts";

export function registerSystemIpc(): void {
	ipcMain.handle("system:openPath", async (_event, path: string) => void shell.openPath(path));

	// One door for every external link; see `window-security.ts` for what it lets through and why.
	ipcMain.handle("system:openExternal", async (_event, url: string) => openExternalSafely(url));

	/*
	 * 「用什么打开」, which is a different question on every platform — see `open-targets.ts`.
	 *
	 * `target` is an id the renderer got from `system:openTargets`, or whatever an older version of
	 * the settings happens to hold; both are resolved there rather than here.
	 */
	ipcMain.handle("system:openIn", async (_event, target: string, path: string) => openWith(target, path));

	ipcMain.handle("system:openTargets", async (): Promise<OpenTarget[]> => openTargets());

	ipcMain.handle("system:revealSkillsDir", async (_event, scope: "workspace" | "user", cwd: string) => {
		const dir = scope === "workspace" ? join(cwd, ".lyra", "skills") : join(lyraHome(), "skills");
		await mkdir(dir, { recursive: true });
		await shell.openPath(dir);
		return dir;
	});

	ipcMain.handle("system:platform", async () => process.platform);

	/*
	 * Is there still a file there.
	 *
	 * Asked before offering to open or reveal an attachment, and it cannot be `files:exists` —
	 * that one resolves against the open projects and answers `false` for everything outside
	 * them, which is where attachments overwhelmingly come from. A spreadsheet dragged in from
	 * `~/Downloads` would be reported missing while sitting right there.
	 *
	 * Unguarded like `system:openPath` beside it, and for the same reason: a renderer that can ask
	 * the OS to *open* any path is not held back by being unable to ask whether it exists. What it
	 * buys is the difference between 「这个文件已经不在原处了」 and a click that does nothing.
	 */
	ipcMain.handle("system:pathExists", async (_event, path: string): Promise<boolean> =>
		typeof path === "string" && path.length > 0 ? access(path).then(() => true).catch(() => false) : false,
	);

	/*
	 * A picture named by a Markdown file, fetched here so the page's CSP does not have to open up.
	 *
	 * The same trade as `registry:icon` and `git:avatar`, for the same reason: `img-src` is
	 * `self data: blob:` and widening it to the whole web — so that a README's build badge draws —
	 * would widen it for every screen in the app, permanently. `remoteImage` bounds what comes back
	 * (https only, an image content-type, half a megabyte, nine seconds) and caches it, so a
	 * document with twenty badges is twenty requests once and none after.
	 *
	 * Only reached for documents the user opened off their own disk — see `Markdown`'s `remoteImages`.
	 */
	ipcMain.handle("system:remoteImage", async (_event, url: string): Promise<string | null> => remoteImage(url));

	/*
	 * The clipboard, from here rather than from `navigator.clipboard`.
	 *
	 * Reading it in the renderer needs the `clipboard-read` permission, which nothing in this app
	 * grants — so a paste item in a context menu would work under the dev server, where the
	 * permission is waived, and quietly do nothing in the packaged app. Writing goes the same way
	 * only so that both halves are one mechanism.
	 */
	ipcMain.handle("clipboard:read", async () => clipboard.readText());
	ipcMain.handle("clipboard:write", async (_event, text: string) => clipboard.writeText(text));

	/*
	 * 一张图进剪贴板，作为图片而不是一串字。
	 *
	 * 「复制」一张截图，人想要的是能粘到聊天窗口、粘到文档里去的那种复制——写进去一行路径的话，粘
	 * 出来是一行路径。写文字那个方法答不了这件事：剪贴板里图片和文本是两种格式。
	 */
	ipcMain.handle("clipboard:writeImage", async (_event, dataUrl: string) => {
		const image = nativeImage.createFromDataURL(dataUrl);
		if (image.isEmpty()) return false;
		clipboard.writeImage(image);
		return true;
	});
}
