/**
 * One row of the file tree.
 *
 * A `div` with `role="treeitem"`, not a button: the container owns the keyboard — one tab stop for
 * the whole tree, arrows to move within it — which is what a tree is supposed to do and what a row
 * of forty buttons cannot. Dragging is also considerably better behaved on a div than on a button,
 * where the browser's own text-drag keeps trying to take over.
 */

import { ChevronRight } from "lucide-react";

import type { FileEntry } from "../../../electron/ipc-types.ts";
import { iconColour, lookFor } from "../fileIcon.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { NameEditor } from "./NameEditor.tsx";

/** Indent per level, and where the first one starts. Kept together so they stay in proportion. */
const INDENT = 12;
const GUTTER = 6;

export interface TreeRowProps {
	entry: FileEntry;
	depth: number;
	expanded: boolean;
	selected: boolean;
	/** The keyboard cursor, which is not always the selection: ⌘-clicking moves one, not the other. */
	focused: boolean;
	/** Has unsaved edits held by the browser. */
	dirty: boolean;
	/** Waiting on a paste, so it reads as already half gone — the same as the Finder does. */
	cut: boolean;
	/** A drag is over this row and would land inside it. */
	dropping: boolean;
	renaming: boolean;
	onRename(name: string): void;
	onRenameCancel(): void;
	onClick(event: React.MouseEvent): void;
	onContextMenu(event: React.MouseEvent): void;
	onDragStart(event: React.DragEvent): void;
	onDragEnd(): void;
	onDragOver(event: React.DragEvent): void;
	onDragLeave(): void;
	onDrop(event: React.DragEvent): void;
}

export function TreeRow({
	entry,
	depth,
	expanded,
	selected,
	focused,
	dirty,
	cut,
	dropping,
	renaming,
	onRename,
	onRenameCancel,
	onClick,
	onContextMenu,
	onDragStart,
	onDragEnd,
	onDragOver,
	onDragLeave,
	onDrop,
}: TreeRowProps) {
	const look = lookFor(entry.name, entry.isDirectory, expanded);

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: the tree container owns the keyboard.
		<div
			role="treeitem"
			aria-level={depth + 1}
			aria-selected={selected}
			aria-expanded={entry.isDirectory ? expanded : undefined}
			data-path={entry.path}
			tabIndex={-1}
			// Not while renaming: starting a drag would take the field's own text selection with it.
			draggable={!renaming}
			data-ly-tip={renaming ? undefined : entry.path}
			onClick={onClick}
			onContextMenu={onContextMenu}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
			className={`ly-scroll flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-detail transition-colors ${
				selected ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover/60"
			} ${focused ? "ring-1 ring-accent/50 ring-inset" : ""} ${
				// A drop lands *inside* a folder, so the whole row is the target and says so.
				dropping ? "bg-accent/12 ring-1 ring-accent ring-inset" : ""
			} ${cut ? "opacity-45" : ""}`}
			// Indent by depth; the guide is the offset itself rather than a rule.
			style={{ paddingLeft: GUTTER + depth * INDENT }}
		>
			{entry.isDirectory ? (
				<ChevronRight
					size={11}
					strokeWidth={2.2}
					className="shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-quick)]"
					style={expanded ? { transform: "rotate(90deg)" } : undefined}
				/>
			) : (
				// Keep the chevron's width so file names line up with directory names.
				<span className="w-[11px] shrink-0" />
			)}

			<look.Icon size={12.5} strokeWidth={1.75} className="shrink-0" style={{ color: iconColour(look) }} />

			{renaming ? (
				<NameEditor initial={entry.name} onCommit={onRename} onCancel={onRenameCancel} />
			) : (
				<ScrollText text={entry.name} className="min-w-0 flex-1" />
			)}

			{dirty && !renaming && (
				// The dot is the only trace an unsaved file leaves in the tree.
				<span data-ly-tip="有未保存的修改" className="h-[5px] w-[5px] shrink-0 rounded-full bg-info" />
			)}
		</div>
	);
}

/**
 * The row a name is being typed into before the thing it names exists.
 *
 * Rendered in the tree at the position the new entry will occupy, so "which folder is this going
 * into" is answered by where the field is rather than by a sentence in a dialog.
 */
export function NewRow({
	depth,
	isDirectory,
	onCommit,
	onCancel,
}: {
	depth: number;
	isDirectory: boolean;
	onCommit: (name: string) => void;
	onCancel: () => void;
}) {
	const look = lookFor("", isDirectory, false);
	return (
		<div className="flex w-full items-center gap-1 rounded-md py-1 pr-2" style={{ paddingLeft: GUTTER + depth * INDENT }}>
			<span className="w-[11px] shrink-0" />
			<look.Icon size={12.5} strokeWidth={1.75} className="shrink-0" style={{ color: iconColour(look) }} />
			<NameEditor initial="" selectStem={false} onCommit={onCommit} onCancel={onCancel} />
		</div>
	);
}
