/**
 * Reading and writing files on the renderer's behalf.
 *
 * The renderer can name any path it likes, so every handler here starts by asking whether the path
 * is inside a project the user actually opened. That check is the whole reason these are not just
 * `fs` calls in the renderer.
 *
 * The check hands back the *resolved* path and the handlers use that one, so what was verified and
 * what is opened are the same string — see `resolveInside`.
 */

import { ipcMain } from "electron";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { documentKind } from "../../shared/document-kind.ts";
import { readDatabase, readWorkbook, type DocumentData } from "../documents.ts";
import { join } from "node:path";
import type { FileContents, FileEntry } from "../ipc-types.ts";

export interface FilesIpcDeps {
	/** The path, normalised, if it lies in an open project — otherwise null. */
	projectPath(target: string): string | null;
}

export function registerFilesIpc({ projectPath }: FilesIpcDeps): void {
	ipcMain.handle("files:list", async (_event, raw: string): Promise<FileEntry[]> => {
		const dir = projectPath(raw);
		if (!dir) return [];
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		const out = await Promise.all(
			entries.map(async (entry) => {
				const path = join(dir, entry.name);
				const info = entry.isDirectory() ? null : await stat(path).catch(() => null);
				return { name: entry.name, path, isDirectory: entry.isDirectory(), size: info?.size ?? 0 };
			}),
		);
		// Directories first, then case-insensitive by name — the order a file list is read in.
		return out.sort((a, b) =>
			a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.isDirectory ? -1 : 1,
		);
	});

	/** Enough for any source file; past this it is generated output nobody reads in a panel. */
	const FILE_READ_CAP = 512 * 1024;
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
		const path = projectPath(raw);
		if (!path) return null;
		const info = await stat(path).catch(() => null);
		if (!info?.isFile() || info.size > DOCUMENT_READ_CAP) return null;
		return readFile(path).catch(() => null);
	});

	ipcMain.handle("files:document", async (_event, raw: string): Promise<DocumentData | null> => {
		const path = projectPath(raw);
		if (!path) return null;
		const info = await stat(path).catch(() => null);
		if (!info?.isFile()) return null;
		return documentKind(path) === "database" ? readDatabase(path) : readWorkbook(path);
	});

	ipcMain.handle("files:read", async (_event, raw: string): Promise<FileContents | null> => {
		const path = projectPath(raw);
		if (!path) return null;
		const info = await stat(path).catch(() => null);
		if (!info?.isFile()) return null;

		const buffer = await readFile(path).catch(() => null);
		if (!buffer) return null;

		// A NUL byte in the first block is the classic, and reliable enough, binary tell.
		const head = buffer.subarray(0, 8000);
		if (head.includes(0)) return { text: "", truncated: false, bytes: info.size, binary: true, modifiedAt: info.mtimeMs };

		const clipped = buffer.subarray(0, FILE_READ_CAP);
		return {
			text: clipped.toString("utf8"),
			truncated: buffer.byteLength > FILE_READ_CAP,
			bytes: info.size,
			modifiedAt: info.mtimeMs,
		};
	});

	ipcMain.handle("files:write", async (_event, raw: string, text: string) => {
		const path = projectPath(raw);
		if (!path) return { ok: false, error: "该路径不在已打开的项目内" };
		try {
			await writeFile(path, text, "utf8");
			return { ok: true };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	});
}
