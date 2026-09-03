/**
 * Doing things to files: create, rename, duplicate, copy, cut, paste, move, delete.
 *
 * All of it in one place because the operations share more than they look like they do — every one
 * of them has to decide what to do about a name that is already taken, re-read the directories it
 * disturbed, and tell the pane above whether the file it is showing just moved or stopped existing.
 * Spread across the menu, the keyboard handler and the drop handler, those three would be written
 * three times and agreed on twice.
 *
 * Questions go through `useConfirmGate`, the app's one confirmation surface, which hands back a
 * promise. A loop over five pasted files can therefore pause on the second one and carry on —
 * which reads as ordinary sequential code and is the only way it stays readable.
 */

import { useCallback, useState } from "react";

import type { FileOpResult } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { useConfirmGate } from "../../ui/overlay/Confirm.tsx";
import { baseName, dirName, joinPath, relativeTo } from "../../lib/paths.ts";
import { bridge } from "../../services/index.ts";

export type ClipMode = "copy" | "cut";

export interface FileActionDeps {
	root: string | null;
	refresh(dirs: Iterable<string>): Promise<void>;
	/** A file was renamed or moved; the pane showing it should follow rather than go blank. */
	onMoved(from: string, to: string): void;
	/** These paths are gone. Anything open from one of them has to close. */
	onRemoved(paths: string[]): void;
}

export function useFileActions({ root, refresh, onMoved, onRemoved }: FileActionDeps) {
	const notify = useApp((s) => s.notify);
	const [clipboard, setClipboard] = useState<{ paths: string[]; mode: ClipMode } | null>(null);
	/*
	 * The app's confirmation, centred over the window like every other one.
	 *
	 * It used to be hung off wherever the pointer last was, on the theory that a question belongs
	 * next to what raised it. For a tree row there is no control to hang it off, and the result was
	 * a dialog that appeared in a different place every time — including, in a panel opened to full
	 * screen, halfway down the right-hand side of the window.
	 */
	const gate = useConfirmGate();
	const ask = gate.ask;

	/** Report a failure once, in the words the main process used. Returns whether it worked. */
	const report = useCallback(
		(result: FileOpResult): boolean => {
			if (!result.ok && result.error) notify(result.error, "error");
			return result.ok;
		},
		[notify],
	);

	/**
	 * Run an operation, asking about a name that is already taken and retrying if told to.
	 *
	 * The retry is what turns `code: "exists"` from an error into a question. Everything else comes
	 * straight back — a name the filesystem refuses is not something a second attempt fixes.
	 */
	const withReplace = useCallback(
		async (target: string, attempt: (overwrite: boolean) => Promise<FileOpResult>): Promise<FileOpResult> => {
			const first = await attempt(false);
			if (first.ok || first.code !== "exists") return first;

			const replace = await ask({
				title: `「${baseName(target)}」已存在`,
				detail: "替换会覆盖那里已有的内容，无法撤销。",
				confirmLabel: "替换",
			});
			return replace ? attempt(true) : { ok: false };
		},
		[ask],
	);

	const create = useCallback(
		async (dir: string, name: string, kind: "file" | "directory"): Promise<string | null> => {
			const result = await bridge.files.create(dir, name, kind);
			if (!report(result)) return null;
			await refresh([dir]);
			return result.path ?? null;
		},
		[refresh, report],
	);

	const rename = useCallback(
		async (path: string, name: string): Promise<string | null> => {
			const dir = dirName(path);
			const to = joinPath(dir, name);
			if (to === path) return path;

			const result = await withReplace(to, (overwrite) => bridge.files.rename(path, to, overwrite));
			if (!report(result)) return null;
			await refresh([dir]);
			onMoved(path, result.path ?? to);
			return result.path ?? to;
		},
		[refresh, report, withReplace, onMoved],
	);

	const duplicate = useCallback(
		async (path: string): Promise<string | null> => {
			const dir = dirName(path);
			const free = await bridge.files.uniquePath(dir, baseName(path));
			if (!report(free) || !free.path) return null;

			const result = await bridge.files.copy(path, free.path);
			if (!report(result)) return null;
			await refresh([dir]);
			return result.path ?? free.path;
		},
		[refresh, report],
	);

	/**
	 * Move — or copy, which is the same walk with a different verb.
	 *
	 * Dropping something back where it already is is a no-op rather than an error: it is the most
	 * likely way a drag ends, and refusing it with a notice would be shouting about nothing.
	 */
	const transfer = useCallback(
		async (paths: string[], dir: string, mode: ClipMode | "copy-into"): Promise<void> => {
			const copying = mode !== "cut";
			const touched = new Set<string>([dir]);

			for (const path of paths) {
				const from = dirName(path);
				touched.add(from);
				if (!copying && from === dir) continue;

				let to = joinPath(dir, baseName(path));
				// Copying into the folder it came from is duplication, and duplication renames.
				if (copying && from === dir) {
					const free = await bridge.files.uniquePath(dir, baseName(path));
					if (!report(free) || !free.path) continue;
					to = free.path;
				}

				const result = await withReplace(to, (overwrite) =>
					copying ? bridge.files.copy(path, to, overwrite) : bridge.files.rename(path, to, overwrite),
				);
				if (!report(result)) continue;
				if (!copying) onMoved(path, result.path ?? to);
			}
			await refresh(touched);
		},
		[refresh, report, withReplace, onMoved],
	);

	const paste = useCallback(
		async (dir: string): Promise<void> => {
			if (!clipboard) return;
			await transfer(clipboard.paths, dir, clipboard.mode);
			// A cut is spent once it lands; a copy can be pasted again, which is what copy is for.
			if (clipboard.mode === "cut") setClipboard(null);
		},
		[clipboard, transfer],
	);

	const remove = useCallback(
		async (paths: string[], permanent: boolean): Promise<boolean> => {
			if (paths.length === 0) return false;
			const what = paths.length === 1 ? `「${baseName(paths[0])}」` : `这 ${paths.length} 项`;
			/*
			 * Confirmed even for the trash, which the OS can undo.
			 *
			 * The house rule is that a reversible action should not ask — but this one acts on
			 * whichever row the pointer happened to be over, the tree has no undo of its own, and
			 * putting a folder back means leaving the app for the Finder. The permanent one says so
			 * in different words so the two cannot be told apart only by the button.
			 */
			const agreed = await ask({
				title: permanent ? `永久删除${what}？` : `删除${what}？`,
				detail: permanent ? "无法恢复。" : "移到废纸篓，可以在访达里找回。",
				confirmLabel: permanent ? "永久删除" : "移到废纸篓",
			});
			if (!agreed) return false;

			const result = permanent ? await bridge.files.remove(paths) : await bridge.files.trash(paths);
			if (!report(result)) return false;
			onRemoved(paths);
			await refresh(paths.map(dirName));
			return true;
		},
		[ask, refresh, report, onRemoved],
	);

	const importInto = useCallback(
		async (sources: string[], dir: string): Promise<void> => {
			if (sources.length === 0) return;
			const result = await bridge.files.importInto(sources, dir);
			if (!report(result)) return;
			await refresh([dir]);
		},
		[refresh, report],
	);

	const copyPath = useCallback(
		async (paths: string[], relative: boolean): Promise<void> => {
			const text = paths.map((path) => (relative && root ? relativeTo(root, path) : path)).join("\n");
			await bridge.clipboard.write(text);
			notify(relative ? "已复制相对路径" : "已复制路径");
		},
		[root, notify],
	);

	return {
		clipboard,
		copy: useCallback((paths: string[]) => setClipboard({ paths, mode: "copy" as const }), []),
		cut: useCallback((paths: string[]) => setClipboard({ paths, mode: "cut" as const }), []),
		clearClipboard: useCallback(() => setClipboard(null), []),
		paste,
		create,
		rename,
		duplicate,
		transfer,
		remove,
		importInto,
		copyPath,
		/** The confirmation, when one is open. The tree renders it; nothing else needs to know. */
		prompt: gate.element,
	};
}

export type FileActions = ReturnType<typeof useFileActions>;
