import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { FileContents, FileEntry } from "./ipc-types.ts";
import { resolveInside } from "./file-ops.ts";

/** Enough for source and text files without pulling generated output into a renderer. */
const FILE_READ_CAP = 512 * 1024;

/** Resolve both sides before IO so project symlinks cannot grant access to files outside it. */
export async function resolveReadablePath(target: string, roots: readonly string[]): Promise<string | null> {
	if (!isAbsolute(target)) return null;
	// Listings return canonical paths, so later clicks must compare against canonical roots too.
	const [resolved, realRoots] = await Promise.all([
		realpath(target).catch(() => null),
		Promise.all(roots.filter((root) => isAbsolute(root)).map((root) => realpath(root).catch(() => null))),
	]);
	if (!resolved) return null;
	return resolveInside(resolved, realRoots.filter((root) => root !== null));
}

/** List one already-authorised directory. Path authorisation stays at the calling boundary. */
export async function listReadableFiles(dir: string | null): Promise<FileEntry[]> {
	if (!dir) return [];
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const out = await Promise.all(
		entries.map(async (entry) => {
			const path = join(dir, entry.name);
			const info = entry.isDirectory() ? null : await stat(path).catch(() => null);
			return { name: entry.name, path, isDirectory: entry.isDirectory(), size: info?.size ?? 0 };
		}),
	);
	return out.sort((a, b) =>
		a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.isDirectory ? -1 : 1,
	);
}

/** Read one already-authorised text file, with a fixed cap shared by desktop IPC and phone sync. */
export async function readReadableFile(path: string | null, readOnly: boolean): Promise<FileContents | null> {
	if (!path) return null;
	const info = await stat(path).catch(() => null);
	if (!info?.isFile()) return null;

	const buffer = await readFile(path).catch(() => null);
	if (!buffer) return null;
	const head = buffer.subarray(0, 8000);
	if (head.includes(0)) {
		return { text: "", readOnly, truncated: false, bytes: info.size, binary: true, modifiedAt: info.mtimeMs };
	}

	const clipped = buffer.subarray(0, FILE_READ_CAP);
	return {
		text: clipped.toString("utf8"),
		readOnly,
		truncated: buffer.byteLength > FILE_READ_CAP,
		bytes: info.size,
		modifiedAt: info.mtimeMs,
	};
}
