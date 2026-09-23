/**
 * The words each desktop uses for its file manager and its bin.
 *
 * macOS says Finder and Trash (访达、废纸篓), Windows says File Explorer and Recycle Bin (资源管理器、
 * 回收站), and the Linux desktops say "file manager" and Trash. Copy written for one of them sends
 * somebody on another looking for a program that is not there — 「可以在访达里找回」 on a PC.
 *
 * Chosen by the machine the files are on (`bridge.platform`, which on a phone is the desktop it is
 * paired with): the bin in question is that machine's. The words stay in the catalogs, one key per
 * system, because a bin's name is not a slot to fill — French puts an article on it, and English
 * says "the Trash" but not "the File Explorer".
 */

import type { MessageKey } from "../i18n/messages/index.ts";

type Desk = "mac" | "windows" | "linux";

const WORDS = {
	/** Showing a file where it lives. */
	reveal: { mac: "openTarget.revealFinder", windows: "openTarget.revealExplorer", linux: "openTarget.reveal" },
	/** The file tree's delete confirmation: where the file goes, and where to get it back. */
	fileToTrash: { mac: "fileAction.toTrash", windows: "fileAction.toTrashWin", linux: "fileAction.toTrashLinux" },
	fileMoveToTrash: { mac: "fileAction.moveToTrash", windows: "fileAction.moveToTrashWin", linux: "fileAction.moveToTrashLinux" },
	/** Deleting a skill, command or rule from the settings. */
	skillToTrash: { mac: "removal.skillDetail", windows: "removal.skillDetailWin", linux: "removal.skillDetailLinux" },
	definitionToTrash: { mac: "removal.fileDetail", windows: "removal.fileDetailWin", linux: "removal.fileDetailLinux" },
	definitionMoveToTrash: { mac: "removal.toTrash", windows: "removal.toTrashWin", linux: "removal.toTrashLinux" },
} as const satisfies Record<string, Record<Desk, MessageKey>>;

export type SystemWord = keyof typeof WORDS;

/** The catalog key for `word` on `platform` (a `process.platform` value). */
export function systemWord(word: SystemWord, platform: string): MessageKey {
	const desk: Desk = platform === "darwin" ? "mac" : platform === "win32" ? "windows" : "linux";
	return WORDS[word][desk];
}
