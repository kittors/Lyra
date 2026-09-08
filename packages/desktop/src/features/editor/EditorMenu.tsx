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

import { useI18n } from "../../i18n/index.ts";
import { macKeyboard } from "../../ui/keyboard.ts";
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

import { useRevealLabel } from "../files/index.ts";
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
	const { t } = useI18n();
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
				{t("common.undo")}
			</MenuItem>
			<MenuItem icon={<Redo2 {...ICON} />} hint={macKeyboard() ? "⇧⌘Z" : "Ctrl+Y"} disabled={readOnly} onClick={() => run(redo)}>
				{t("common.redo")}
			</MenuItem>

			<MenuSeparator />

			<MenuItem
				icon={<Scissors {...ICON} />}
				hint="⌘X"
				disabled={!hasSelection || readOnly}
				onClick={() => void take(true)}
			>
				{t("common.cut")}
			</MenuItem>
			<MenuItem icon={<Copy {...ICON} />} hint="⌘C" disabled={!hasSelection} onClick={() => void take(false)}>
				{t("common.copy")}
			</MenuItem>
			<MenuItem icon={<ClipboardPaste {...ICON} />} hint="⌘V" disabled={readOnly} onClick={() => void paste()}>
				{t("common.paste")}
			</MenuItem>
			<MenuItem icon={<TextSelect {...ICON} />} hint="⌘A" onClick={() => run(selectAll)}>
				{t("common.selectAll")}
			</MenuItem>

			<MenuSeparator />

			{/*
			 * Offered on every file, not only the ones with a formatter.
			 *
			 * Hiding it would mean the menu quietly answers "no formatter for this" by omission,
			 * which reads as the feature being missing rather than the language being unsupported.
			 * Pressing it says which — see `formatNow` in `CodeEditor.tsx`.
			 */}
			<MenuItem icon={<Wand2 {...ICON} />} hint={macKeyboard() ? "⇧⌘F" : "Shift+Alt+F"} disabled={readOnly} onClick={() => void onFormat()}>
				{t("common.format")}
			</MenuItem>

			<MenuSeparator />

			<MenuItem icon={<Search {...ICON} />} hint="⌘F" onClick={() => onFind(false)}>
				{t("find.find")}
			</MenuItem>
			<MenuItem icon={<Replace {...ICON} />} hint="⌥⌘F" disabled={readOnly} onClick={() => onFind(true)}>
				{t("find.replace")}
			</MenuItem>
			{/* ⌥⌘G is CodeMirror's own binding for this, from `searchKeymap`. */}
			<MenuItem icon={<ListOrdered {...ICON} />} hint="⌥⌘G" onClick={() => run(gotoLine)}>
				{t("common.goToLine")}
			</MenuItem>

			<MenuSeparator />

			<MenuItem icon={<ChevronsDownUp {...ICON} />} onClick={() => run(foldAll)}>
				{t("fileMenu.collapseAll")}
			</MenuItem>
			<MenuItem icon={<ChevronsUpDown {...ICON} />} onClick={() => run(unfoldAll)}>
				{t("common.expandAll")}
			</MenuItem>

			<MenuSeparator />

			<MenuItem icon={<Link2 {...ICON} />} onClick={() => void bridge.clipboard.write(path)}>
				{t("fileMenu.copyPath")}
			</MenuItem>
			<MenuItem icon={<CornerUpRight {...ICON} />} onClick={() => void bridge.workspace.reveal(path)}>
				{reveal}
			</MenuItem>
		</ContextMenu>
	);
}
