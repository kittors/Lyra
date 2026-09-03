/**
 * Right-clicking inside the code editor.
 *
 * Electron ships no default context menu, so until now right-clicking in a file did nothing —
 * not even copy. Everything here is a CodeMirror command driven from the outside, except the three
 * clipboard entries: the browser will not let a script cut or paste on its own, so those go through
 * the main process (`bridge.clipboard`) and edit the document by dispatching a transaction.
 *
 * Items that would change a read-only file are disabled rather than hidden. A menu whose shape
 * changes with the file is a menu you have to read every time; one where the same item is greyed
 * says why nothing happened.
 */

import { redo, selectAll, undo } from "@codemirror/commands";
import { foldAll, unfoldAll } from "@codemirror/language";
import { gotoLine } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import {
	ChevronsDownUp,
	ChevronsUpDown,
	ClipboardPaste,
	Copy,
	CornerUpRight,
	Link2,
	ListOrdered,
	Redo2,
	Replace,
	Scissors,
	Search,
	TextSelect,
	Undo2,
	Wand2,
} from "lucide-react";

import { useRevealLabel } from "../files/open-targets.ts";
import { ContextMenu } from "../../ui/overlay/ContextMenu.tsx";
import { MenuItem, MenuSeparator } from "../../ui/overlay/Menu.tsx";
import { bridge } from "../../services/index.ts";

const ICON = { size: 13, strokeWidth: 1.8 } as const;

export function EditorMenu({
	anchor,
	onClose,
	view,
	path,
	readOnly,
	/** Opens CodeMirror's find bar, optionally with the replace half already unfolded. */
	onFind,
	/** Runs the formatter and reports the outcome. Lives in the editor, which owns the settings. */
	onFormat,
}: {
	anchor: { x: number; y: number } | null;
	onClose: () => void;
	view: EditorView | null;
	path: string;
	readOnly: boolean;
	onFind: (withReplace: boolean) => void;
	onFormat: () => Promise<void>;
}) {
	// Before the early return: a hook that only sometimes runs is a hook that runs out of order.
	const reveal = useRevealLabel();
	if (!view) return null;

	const selection = view.state.selection.main;
	const selected = view.state.sliceDoc(selection.from, selection.to);
	const hasSelection = selected.length > 0;

	/** Put the selection on the clipboard, and take it out of the document if this was a cut. */
	const take = async (remove: boolean) => {
		if (!hasSelection) return;
		await bridge.clipboard.write(selected);
		if (remove && !readOnly) {
			view.dispatch({ changes: { from: selection.from, to: selection.to, insert: "" } });
		}
		view.focus();
	};

	const paste = async () => {
		const text = await bridge.clipboard.read();
		if (!text) return;
		// Replaces the selection when there is one, which is what pasting over a selection means.
		view.dispatch({
			changes: { from: selection.from, to: selection.to, insert: text },
			selection: { anchor: selection.from + text.length },
		});
		view.focus();
	};

	/** Run a CodeMirror command and hand the keyboard back, which a menu click has taken away. */
	const run = (command: (target: EditorView) => boolean) => {
		command(view);
		view.focus();
	};

	return (
		<ContextMenu anchor={anchor} onClose={onClose} width="default">
			<MenuItem icon={<Undo2 {...ICON} />} hint="⌘Z" disabled={readOnly} onClick={() => run(undo)}>
				撤销
			</MenuItem>
			<MenuItem icon={<Redo2 {...ICON} />} hint="⇧⌘Z" disabled={readOnly} onClick={() => run(redo)}>
				重做
			</MenuItem>

			<MenuSeparator />

			<MenuItem
				icon={<Scissors {...ICON} />}
				hint="⌘X"
				disabled={!hasSelection || readOnly}
				onClick={() => void take(true)}
			>
				剪切
			</MenuItem>
			<MenuItem icon={<Copy {...ICON} />} hint="⌘C" disabled={!hasSelection} onClick={() => void take(false)}>
				复制
			</MenuItem>
			<MenuItem icon={<ClipboardPaste {...ICON} />} hint="⌘V" disabled={readOnly} onClick={() => void paste()}>
				粘贴
			</MenuItem>
			<MenuItem icon={<TextSelect {...ICON} />} hint="⌘A" onClick={() => run(selectAll)}>
				全选
			</MenuItem>

			<MenuSeparator />

			{/*
			 * Offered on every file, not only the ones with a formatter.
			 *
			 * Hiding it would mean the menu quietly answers "no formatter for this" by omission,
			 * which reads as the feature being missing rather than the language being unsupported.
			 * Pressing it says which — see `formatNow` in `CodeEditor.tsx`.
			 */}
			<MenuItem icon={<Wand2 {...ICON} />} hint="⇧⌘F" disabled={readOnly} onClick={() => void onFormat()}>
				格式化
			</MenuItem>

			<MenuSeparator />

			<MenuItem icon={<Search {...ICON} />} hint="⌘F" onClick={() => onFind(false)}>
				查找
			</MenuItem>
			<MenuItem icon={<Replace {...ICON} />} hint="⌥⌘F" disabled={readOnly} onClick={() => onFind(true)}>
				替换
			</MenuItem>
			{/* ⌥⌘G is CodeMirror's own binding for this, from `searchKeymap`. */}
			<MenuItem icon={<ListOrdered {...ICON} />} hint="⌥⌘G" onClick={() => run(gotoLine)}>
				跳转到行
			</MenuItem>

			<MenuSeparator />

			<MenuItem icon={<ChevronsDownUp {...ICON} />} onClick={() => run(foldAll)}>
				全部折叠
			</MenuItem>
			<MenuItem icon={<ChevronsUpDown {...ICON} />} onClick={() => run(unfoldAll)}>
				全部展开
			</MenuItem>

			<MenuSeparator />

			<MenuItem icon={<Link2 {...ICON} />} onClick={() => void bridge.clipboard.write(path)}>
				复制路径
			</MenuItem>
			<MenuItem icon={<CornerUpRight {...ICON} />} onClick={() => void bridge.workspace.reveal(path)}>
				{reveal}
			</MenuItem>
		</ContextMenu>
	);
}
