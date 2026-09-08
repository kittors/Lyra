/**
 * What right-clicking in the file tree offers.
 *
 * Three menus that are mostly one menu: a file, a folder, and the empty space below the rows. They
 * are written together because the differences are small and worth seeing side by side — a folder
 * gets 新建 inside it, a file gets 打开, the background gets neither and keeps the rest.
 *
 * Only the rows, deliberately. Which paths an item acts on, and what each one does, belong to the
 * tree; this file decides what is offered and in what order, which is the part that has to match
 * what people already know from every other editor.
 */

import { useI18n } from "../../i18n/index.ts";
import {
	ClipboardPaste,
	Copy,
	CopyMinus,
	CornerUpRight,
	ExternalLink,
	FilePlus2,
	FolderOpen,
	FolderPlus,
	FolderSearch,
	Link2,
	Pencil,
	RefreshCw,
	Scissors,
	SquareTerminal,
	Trash2,
} from "lucide-react";

import type { FileEntry } from "../../../electron/ipc-types.ts";
import { openLabel, useOpenTarget, useRevealLabel } from "./open-targets.ts";
import { ContextMenu } from "../../ui/overlay/ContextMenu.tsx";
import { MenuItem, MenuSeparator } from "../../ui/overlay/Menu.tsx";

const ICON = { size: 13, strokeWidth: 1.8 } as const;

export interface FileMenuActions {
	open(entry: FileEntry): void;
	openWith(path: string): void;
	reveal(path: string): void;
	openInTerminal(dir: string): void;
	newFile(dir: string): void;
	newFolder(dir: string): void;
	cut(): void;
	copy(): void;
	paste(dir: string): void;
	copyPath(relative: boolean): void;
	rename(path: string): void;
	duplicate(path: string): void;
	remove(permanent: boolean): void;
	findInFolder(dir: string): void;
	collapseAll(): void;
	refresh(): void;
}

export function FileMenu({
	anchor,
	onClose,
	/** The row that was right-clicked, or null for the empty space below the rows. */
	entry,
	/** Where 新建 and 粘贴 would put things: the folder itself, a file's parent, or the root. */
	dir,
	/** How many rows the destructive items would act on. */
	count,
	canPaste,
	actions,
}: {
	anchor: { x: number; y: number } | null;
	onClose: () => void;
	entry: FileEntry | null;
	dir: string;
	count: number;
	canPaste: boolean;
	actions: FileMenuActions;
}) {
	// What 默认文件打开目标 currently names, and what this platform calls its file manager. Read
	// here rather than passed in: both are properties of the machine, not of this tree.
	const { t } = useI18n();
	const openTarget = useOpenTarget();
	const reveal = useRevealLabel();
	const many = count > 1;
	/** Names the target once so every destructive label counts the same way. */
	const what = many ? t("fileMenu.theseN", { n: count }) : "";

	return (
		<ContextMenu anchor={anchor} onClose={onClose} width="default">
			{entry && !many && (
				<>
					{/* Only for a file. A folder opens by being clicked, and a menu row saying so
					    would be the longest way to do the shortest thing. */}
					{!entry.isDirectory && (
						<MenuItem icon={<FolderOpen {...ICON} />} onClick={() => actions.open(entry)}>
							{t("common.open")}
						</MenuItem>
					)}
					<MenuItem icon={<ExternalLink {...ICON} />} onClick={() => actions.openWith(entry.path)}>
						{openLabel(openTarget)}
					</MenuItem>
				</>
			)}

			{/* On the empty space this reveals the folder the tree is showing, which is still an answer. */}
			<MenuItem icon={<CornerUpRight {...ICON} />} onClick={() => actions.reveal(entry?.path ?? dir)}>
				{reveal}
			</MenuItem>
			<MenuItem icon={<SquareTerminal {...ICON} />} onClick={() => actions.openInTerminal(dir)}>
				{t("fileMenu.openInTerminal")}
			</MenuItem>

			<MenuSeparator />

			{/*
			 * 新建 lands in `dir`, which is the folder itself when a folder was clicked and the
			 * parent when a file was — the same rule every editor uses, and the reason the item is
			 * offered on a file at all.
			 */}
			<MenuItem icon={<FilePlus2 {...ICON} />} onClick={() => actions.newFile(dir)}>
				{t("fileMenu.newFile")}
			</MenuItem>
			<MenuItem icon={<FolderPlus {...ICON} />} onClick={() => actions.newFolder(dir)}>
				{t("fileMenu.newFolder")}
			</MenuItem>

			<MenuSeparator />

			{entry && (
				<>
					<MenuItem icon={<Scissors {...ICON} />} hint="⌘X" onClick={actions.cut}>
						{t("fileMenu.cut", { what })}
					</MenuItem>
					<MenuItem icon={<Copy {...ICON} />} hint="⌘C" onClick={actions.copy}>
						{t("fileMenu.copy", { what })}
					</MenuItem>
				</>
			)}
			<MenuItem
				icon={<ClipboardPaste {...ICON} />}
				hint="⌘V"
				disabled={!canPaste}
				title={canPaste ? undefined : t("fileMenu.clipboardEmpty")}
				onClick={() => actions.paste(dir)}
			>
				{t("common.paste")}
			</MenuItem>

			{entry && (
				<>
					<MenuSeparator />
					<MenuItem icon={<Link2 {...ICON} />} hint="⌥⌘C" onClick={() => actions.copyPath(false)}>
						{t("fileMenu.copyPath")}
					</MenuItem>
					<MenuItem icon={<Link2 {...ICON} />} hint="⌥⇧⌘C" onClick={() => actions.copyPath(true)}>
						{t("fileMenu.copyRelativePath")}
					</MenuItem>

					<MenuSeparator />
					{!many && (
						<>
							<MenuItem icon={<Pencil {...ICON} />} hint="F2" onClick={() => actions.rename(entry.path)}>
								{t("common.rename")}
							</MenuItem>
							<MenuItem icon={<Copy {...ICON} />} onClick={() => actions.duplicate(entry.path)}>
								{t("fileMenu.duplicate")}
							</MenuItem>
						</>
					)}
					<MenuItem icon={<Trash2 {...ICON} />} hint="⌘⌫" danger onClick={() => actions.remove(false)}>
						{t("fileMenu.delete", { what })}
					</MenuItem>
					<MenuItem icon={<Trash2 {...ICON} />} hint="⇧⌘⌫" danger onClick={() => actions.remove(true)}>
						{t("fileMenu.deleteForever", { what })}
					</MenuItem>
				</>
			)}

			<MenuSeparator />
			{entry?.isDirectory && !many && (
				<MenuItem icon={<FolderSearch {...ICON} />} onClick={() => actions.findInFolder(entry.path)}>
					{t("fileMenu.searchHere")}
				</MenuItem>
			)}
			<MenuItem icon={<CopyMinus {...ICON} />} onClick={actions.collapseAll}>
				{t("fileMenu.collapseAll")}
			</MenuItem>
			<MenuItem icon={<RefreshCw {...ICON} />} onClick={actions.refresh}>
				{t("common.refresh")}
			</MenuItem>
		</ContextMenu>
	);
}
