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
import { openLabel, useOpenTarget, useRevealLabel } from "../../openTargets.ts";
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
	const openTarget = useOpenTarget();
	const reveal = useRevealLabel();
	const many = count > 1;
	/** Names the target once so every destructive label counts the same way. */
	const what = many ? `这 ${count} 项` : "";

	return (
		<ContextMenu anchor={anchor} onClose={onClose} width="default">
			{entry && !many && (
				<>
					{/* Only for a file. A folder opens by being clicked, and a menu row saying so
					    would be the longest way to do the shortest thing. */}
					{!entry.isDirectory && (
						<MenuItem icon={<FolderOpen {...ICON} />} onClick={() => actions.open(entry)}>
							打开
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
				在终端中打开
			</MenuItem>

			<MenuSeparator />

			{/*
			 * 新建 lands in `dir`, which is the folder itself when a folder was clicked and the
			 * parent when a file was — the same rule every editor uses, and the reason the item is
			 * offered on a file at all.
			 */}
			<MenuItem icon={<FilePlus2 {...ICON} />} onClick={() => actions.newFile(dir)}>
				新建文件
			</MenuItem>
			<MenuItem icon={<FolderPlus {...ICON} />} onClick={() => actions.newFolder(dir)}>
				新建文件夹
			</MenuItem>

			<MenuSeparator />

			{entry && (
				<>
					<MenuItem icon={<Scissors {...ICON} />} hint="⌘X" onClick={actions.cut}>
						{`剪切${what}`}
					</MenuItem>
					<MenuItem icon={<Copy {...ICON} />} hint="⌘C" onClick={actions.copy}>
						{`复制${what}`}
					</MenuItem>
				</>
			)}
			<MenuItem
				icon={<ClipboardPaste {...ICON} />}
				hint="⌘V"
				disabled={!canPaste}
				title={canPaste ? undefined : "剪贴板里没有文件"}
				onClick={() => actions.paste(dir)}
			>
				粘贴
			</MenuItem>

			{entry && (
				<>
					<MenuSeparator />
					<MenuItem icon={<Link2 {...ICON} />} hint="⌥⌘C" onClick={() => actions.copyPath(false)}>
						复制路径
					</MenuItem>
					<MenuItem icon={<Link2 {...ICON} />} hint="⌥⇧⌘C" onClick={() => actions.copyPath(true)}>
						复制相对路径
					</MenuItem>

					<MenuSeparator />
					{!many && (
						<>
							<MenuItem icon={<Pencil {...ICON} />} hint="F2" onClick={() => actions.rename(entry.path)}>
								重命名
							</MenuItem>
							<MenuItem icon={<Copy {...ICON} />} onClick={() => actions.duplicate(entry.path)}>
								创建副本
							</MenuItem>
						</>
					)}
					<MenuItem icon={<Trash2 {...ICON} />} hint="⌘⌫" danger onClick={() => actions.remove(false)}>
						{`删除${what}`}
					</MenuItem>
					<MenuItem icon={<Trash2 {...ICON} />} hint="⇧⌘⌫" danger onClick={() => actions.remove(true)}>
						{`永久删除${what}`}
					</MenuItem>
				</>
			)}

			<MenuSeparator />
			{entry?.isDirectory && !many && (
				<MenuItem icon={<FolderSearch {...ICON} />} onClick={() => actions.findInFolder(entry.path)}>
					在此文件夹中搜索
				</MenuItem>
			)}
			<MenuItem icon={<CopyMinus {...ICON} />} onClick={actions.collapseAll}>
				全部折叠
			</MenuItem>
			<MenuItem icon={<RefreshCw {...ICON} />} onClick={actions.refresh}>
				刷新
			</MenuItem>
		</ContextMenu>
	);
}
