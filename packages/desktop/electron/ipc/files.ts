import { referenceFile } from "../reference-files.ts";
/**
 * Reading and writing files on the renderer's behalf.
 *
 * The renderer can name any path it likes, so every handler here starts by asking whether the path
 * is inside a project the user actually opened. That check is the whole reason these are not just
 * `fs` calls in the renderer.
 *
 * The check hands back the *resolved* path and the handlers use that one, so what was verified and
 * what is opened are the same string — see `resolveReadablePath`.
 */

import { readableArtifact } from "../readable-artifacts.ts";
import { dialog, ipcMain } from "electron";
import { readFile, stat, writeFile } from "node:fs/promises";
import { getWindow } from "../window.ts";
import { documentKind } from "../../shared/document-kind.ts";
import { readDatabase, readWorkbook, type DocumentData } from "../documents.ts";
import { extractDocumentText, type ExtractedText } from "../document-text.ts";
import type { FileContents, FileEntry } from "../ipc-types.ts";
import { listReadableFiles, readReadableFile, resolveReadablePath } from "../file-read-service.ts";

export interface FilesIpcDeps {
	projectRoots(): readonly string[];
}

export function registerFilesIpc({ projectRoots }: FilesIpcDeps): void {
	const projectPath = (target: string) => resolveReadablePath(target, projectRoots());
	ipcMain.handle("files:pick", async (_event, options?: { directory?: boolean; multiple?: boolean }): Promise<string[]> => {
		const window = getWindow();
		if (!window) return [];
		const properties: Array<"openFile" | "openDirectory" | "multiSelections"> = [];
		if (options?.directory) {
			properties.push("openDirectory");
		} else {
			properties.push("openFile");
		}
		if (options?.multiple !== false) {
			properties.push("multiSelections");
		}
		const result = await dialog.showOpenDialog(window, {
			title: options?.directory ? "选择文件夹" : "选择文件",
			properties,
		});
		if (result.canceled || !result.filePaths.length) return [];
		return result.filePaths;
	});

	ipcMain.handle("files:list", async (_event, raw: string): Promise<FileEntry[]> => listReadableFiles(await projectPath(raw)));
	/**
	 * And a much larger one for documents, which are compressed archives rather than source.
	 *
	 * A Word document with a few screenshots in it is several megabytes and perfectly ordinary; the
	 * cap is here so that a hundred-megabyte file cannot be pulled into the renderer whole.
	 */
	const DOCUMENT_READ_CAP = 32 * 1024 * 1024;

	/*
	 * A spreadsheet or a database, read into rows the window can draw.
	 *
	 * Its own channel rather than a mode of `files:read`, because what comes back is a different
	 * shape entirely — sheets of cells, not text and a flag. Same boundary as everything else here:
	 * the path has to resolve inside a project the user opened.
	 */
	/*
	 * The raw bytes of one file, for the formats the *window* parses.
	 *
	 * A `.docx` is a zip of XML and the renderer's own library walks it — so unlike a spreadsheet
	 * there is nothing for this side to turn it into. Bytes over IPC rather than a `fetch` of the
	 * media protocol: that protocol is a standard scheme, so a fetch from the page is cross-origin
	 * and needs CORS headers on every response to work at all. One channel that already has the
	 * project boundary on it is less machinery and one fewer thing to get subtly wrong.
	 */
	ipcMain.handle("files:bytes", async (_event, raw: string): Promise<Uint8Array | null> => {
		const path = await projectPath(raw);
		if (!path) return null;
		const info = await stat(path).catch(() => null);
		if (!info?.isFile() || info.size > DOCUMENT_READ_CAP) return null;
		return readFile(path).catch(() => null);
	});

	/*
	 * 一份文档里的字，抽给模型读。
	 *
	 * 走字节而不是走路径：这条通道服务的是输入框里那些**拖进来的**文件，它们是浏览器的 `File`，本来就
	 * 没有磁盘路径可言（从别的应用拖来的、粘贴板里的，尤其如此）。上面几条通道都按路径收，并在路径上
	 * 做项目边界检查；这一条收的字节是人刚刚自己交出来的，边界检查在这里没有意义。
	 *
	 * 解析放在主进程，是因为 `renderer-does-not-reach-into-main` 那条架构规则——渲染进程只能从
	 * `electron/` 拿类型。这也顺带把 pdf.js 挡在页面之外：它在主进程里解析，卡住的是一个没有界面的
	 * 进程，而不是人正在打字的那个窗口。
	 */
	ipcMain.handle(
		"files:documentText",
		async (_event, name: string, bytes: Uint8Array): Promise<ExtractedText | null> => {
			if (!name || !bytes?.byteLength) return null;
			if (bytes.byteLength > DOCUMENT_READ_CAP) return null;
			return extractDocumentText(name, new Uint8Array(bytes));
		},
	);

	ipcMain.handle("files:document", async (_event, raw: string): Promise<DocumentData | null> => {
		const path = await projectPath(raw);
		if (!path) return null;
		const info = await stat(path).catch(() => null);
		if (!info?.isFile()) return null;
		return documentKind(path) === "database" ? readDatabase(path) : readWorkbook(path);
	});

	ipcMain.handle("files:read", async (_event, raw: string): Promise<FileContents | null> => {
		const writable = await projectPath(raw);
		const path = writable ?? readableArtifact(raw) ?? await referenceFile(raw);
		return readReadableFile(path, !writable);
	});

	ipcMain.handle("files:write", async (_event, raw: string, text: string) => {
		const path = await projectPath(raw);
		if (!path) return { ok: false, error: "该路径不在已打开的项目内" };
		try {
			await writeFile(path, text, "utf8");
			return { ok: true };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	});
}
