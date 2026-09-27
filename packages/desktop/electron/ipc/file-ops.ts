/**
 * Changing files on the renderer's behalf: create, rename, copy, move, delete.
 *
 * Apart from `files.ts`, which only reads. Reading the wrong path leaks something; writing to it
 * destroys something, and the two deserve to be read as different files even though they share a
 * doorway. Everything here resolves its arguments through `projectPath` first and then does its IO
 * against what came back — never against the string the renderer sent.
 *
 * Failures come back as data. A name that is already taken, a directory dropped into its own
 * child, a file the OS will not move: all of them are ordinary things to do by accident, and the
 * panel has to say which one happened rather than showing "操作失败".
 */

import { ipcMain, shell } from "electron";
import { cp, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { isDescendant, uniqueName, validateName } from "../file-ops.ts";
import { nativeText } from "../i18n.ts";
import type { FileOpResult } from "../ipc-types.ts";

export interface FileOpsIpcDeps {
	/** The path, normalised, if it lies in an open project — otherwise null. */
	projectPath(target: string): string | null;
}

/**
 * The refusal for a path outside every open project, worded when it is said — a constant would
 * keep whatever language the app started in.
 */
function outside(): FileOpResult {
	return { ok: false, error: nativeText("files.outsideProject"), code: "denied" };
}

/** What the filesystem said, which is the reason a failed operation gives. */
function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function failed(error: unknown): FileOpResult {
	return { ok: false, error: reason(error) };
}

/** Whether two paths name the same file on disk, which a case-insensitive volume makes possible. */
async function sameFile(a: string, b: string): Promise<boolean> {
	const [left, right] = await Promise.all([stat(a).catch(() => null), stat(b).catch(() => null)]);
	return Boolean(left && right && left.ino === right.ino && left.dev === right.dev);
}

async function exists(path: string): Promise<boolean> {
	return (await stat(path).catch(() => null)) !== null;
}

/**
 * Settle what to do about a destination that is already occupied.
 *
 * Returns a result to hand straight back when the caller must be asked first, and null when the
 * way is clear. The case-insensitive check is the reason this is not two lines at each call site:
 * on a Mac, renaming `Readme.md` to `README.md` finds the destination "occupied" by the very file
 * being renamed, and clearing it first would delete the thing the user was renaming.
 */
async function clearDestination(from: string, to: string, overwrite: boolean): Promise<FileOpResult | null> {
	if (!(await exists(to))) return null;
	if (await sameFile(from, to)) return null;
	if (!overwrite) return { ok: false, code: "exists", error: nativeText("files.exists", { name: basename(to) }) };
	await rm(to, { recursive: true, force: true });
	return null;
}

export function registerFileOpsIpc({ projectPath }: FileOpsIpcDeps): void {
	/**
	 * A new, empty file or directory inside `rawDir`.
	 *
	 * `wx` rather than a check followed by a write: two panels creating the same name in the same
	 * millisecond is unlikely, but "check then act" is wrong for free and the flag is not.
	 */
	ipcMain.handle(
		"files:create",
		async (_event, rawDir: string, name: string, kind: "file" | "directory"): Promise<FileOpResult> => {
			const dir = projectPath(rawDir);
			if (!dir) return outside();
			const invalid = validateName(name);
			if (invalid) return { ok: false, error: invalid, code: "invalid" };

			const path = join(dir, name);
			if (await exists(path)) return { ok: false, code: "exists", error: nativeText("files.exists", { name }) };
			try {
				if (kind === "directory") await mkdir(path);
				else await writeFile(path, "", { flag: "wx" });
				return { ok: true, path };
			} catch (error) {
				return failed(error);
			}
		},
	);

	/**
	 * Rename, which is also move: the two differ only in whether the parent changed.
	 *
	 * Both ends are checked, so a rename cannot be used to write outside the project any more than
	 * a write can — and a directory cannot be moved inside itself, which `rename` would either
	 * refuse with `EINVAL` or, on some filesystems, do.
	 */
	ipcMain.handle(
		"files:rename",
		async (_event, rawFrom: string, rawTo: string, overwrite = false): Promise<FileOpResult> => {
			const from = projectPath(rawFrom);
			const to = projectPath(rawTo);
			if (!from || !to) return outside();
			const invalid = validateName(basename(to));
			if (invalid) return { ok: false, error: invalid, code: "invalid" };
			if (from === to) return { ok: true, path: to };
			if (isDescendant(from, to)) return { ok: false, code: "descendant", error: nativeText("files.moveIntoItself") };

			try {
				const blocked = await clearDestination(from, to, overwrite);
				if (blocked) return blocked;
				await rename(from, to);
				return { ok: true, path: to };
			} catch (error) {
				return failed(error);
			}
		},
	);

	/** Copy a file or a whole directory. Same checks as a rename; the source simply stays. */
	ipcMain.handle(
		"files:copy",
		async (_event, rawFrom: string, rawTo: string, overwrite = false): Promise<FileOpResult> => {
			const from = projectPath(rawFrom);
			const to = projectPath(rawTo);
			if (!from || !to) return outside();
			const invalid = validateName(basename(to));
			if (invalid) return { ok: false, error: invalid, code: "invalid" };
			// Copying a directory into itself would recurse until the disk filled.
			if (from === to || isDescendant(from, to)) {
				return { ok: false, code: "descendant", error: nativeText("files.copyIntoItself") };
			}

			try {
				const blocked = await clearDestination(from, to, overwrite);
				if (blocked) return blocked;
				await cp(from, to, { recursive: true, errorOnExist: true, force: false });
				return { ok: true, path: to };
			} catch (error) {
				return failed(error);
			}
		},
	);

	/**
	 * To the trash, where the OS can put it back.
	 *
	 * The whole selection in one call rather than one call per path, so a partial failure can be
	 * reported as one sentence instead of five notices.
	 */
	ipcMain.handle("files:trash", async (_event, rawPaths: string[]): Promise<FileOpResult> => {
		const paths = rawPaths.map((raw) => projectPath(raw));
		if (paths.some((path) => path === null)) return outside();

		for (const path of paths as string[]) {
			try {
				await shell.trashItem(path);
			} catch (error) {
				return { ok: false, error: nativeText("files.deleteFailed", { name: basename(path), reason: reason(error) }) };
			}
		}
		return { ok: true };
	});

	/** Gone for good. Separate from `files:trash` so nothing can reach it by passing a flag. */
	ipcMain.handle("files:remove", async (_event, rawPaths: string[]): Promise<FileOpResult> => {
		const paths = rawPaths.map((raw) => projectPath(raw));
		if (paths.some((path) => path === null)) return outside();

		for (const path of paths as string[]) {
			try {
				await rm(path, { recursive: true, force: true });
			} catch (error) {
				return { ok: false, error: nativeText("files.deleteFailed", { name: basename(path), reason: reason(error) }) };
			}
		}
		return { ok: true };
	});

	/**
	 * A free name in `rawDir`, for duplicating and for pasting into the folder you copied from.
	 *
	 * Worked out here because the answer depends on what is on disk right now, and the renderer's
	 * copy of the directory is a cache that a moment ago was true.
	 */
	ipcMain.handle("files:uniquePath", async (_event, rawDir: string, name: string): Promise<FileOpResult> => {
		const dir = projectPath(rawDir);
		if (!dir) return outside();
		const invalid = validateName(name);
		if (invalid) return { ok: false, error: invalid, code: "invalid" };

		const entries = await readdir(dir).catch(() => [] as string[]);
		return { ok: true, path: join(dir, uniqueName(entries, name)) };
	});

	/** Does this path still exist? The tree asks before acting on a row it read some time ago. */
	ipcMain.handle("files:exists", async (_event, raw: string): Promise<boolean> => {
		const path = projectPath(raw);
		return path ? exists(path) : false;
	});

	/**
	 * Copy paths dropped in from outside the app — the Finder, another window.
	 *
	 * The sources are not checked against the project boundary, and cannot be: the whole gesture is
	 * "bring this in from elsewhere". The *destination* is, which is the half that matters — this
	 * can only ever write inside an open project.
	 */
	ipcMain.handle("files:import", async (_event, sources: string[], rawDir: string): Promise<FileOpResult> => {
		const dir = projectPath(rawDir);
		if (!dir) return outside();

		let last = "";
		for (const source of sources) {
			// Dropping a folder onto something inside it would copy the destination into itself.
			if (dir === source || isDescendant(source, dir)) {
				return { ok: false, code: "descendant", error: nativeText("files.copyIntoItself") };
			}
			try {
				const taken = await readdir(dir).catch(() => [] as string[]);
				last = join(dir, uniqueName(taken, basename(source)));
				await cp(source, last, { recursive: true, errorOnExist: true, force: false });
			} catch (error) {
				return failed(error);
			}
		}
		return { ok: true, path: last };
	});
}
