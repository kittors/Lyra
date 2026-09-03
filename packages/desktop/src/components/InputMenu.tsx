/**
 * Cut, copy, paste and select-all in every ordinary text field in the app.
 *
 * Electron has no default context menu, which meant right-clicking the composer, a search box or a
 * rename field did nothing at all — a gap you find by trying it once and then never trying again.
 * Mounted once at the root and listening on the document, because the alternative is remembering to
 * attach a handler to every field ever added, and the fields are added by twenty different files.
 *
 * The code editor is excluded: it has its own menu with undo, find and folding in it, and that one
 * knows about CodeMirror's document rather than about `value`.
 *
 * Edits go through `execCommand`. It is deprecated and it is also the only way to change an input
 * from script and have React hear about it — assigning `.value` sets the DOM property without
 * dispatching anything, so a controlled field would repaint the old text on the next render.
 */

import { ClipboardPaste, Copy, Scissors, TextSelect } from "lucide-react";
import { useEffect, useState } from "react";

import { ContextMenu } from "./ContextMenu.tsx";
import { MenuItem, MenuSeparator } from "./Menu.tsx";
import { bridge } from "../services/index.ts";

const ICON = { size: 13, strokeWidth: 1.8 } as const;

/** `<input>` types that hold text somebody might want to copy out of. */
const TEXTUAL = new Set(["text", "search", "url", "tel", "email", "password", "number", ""]);

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface Aimed {
	point: { x: number; y: number };
	field: Field;
	/** Where the selection was when the menu opened — clicking the menu moves the caret away. */
	range: [number, number] | null;
	selected: string;
	editable: boolean;
}

function aim(event: MouseEvent): Aimed | null {
	const target = event.target;
	if (!(target instanceof HTMLElement)) return null;
	const field = target.closest<Field>("input, textarea, [contenteditable='true']");
	if (!field) return null;
	// The editor's own menu covers this area, and it can do considerably more than these four.
	if (field.closest(".cm-editor")) return null;
	if (field instanceof HTMLInputElement && !TEXTUAL.has(field.type)) return null;

	const box = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field : null;
	const range: [number, number] | null =
		box && box.selectionStart !== null && box.selectionEnd !== null ? [box.selectionStart, box.selectionEnd] : null;

	return {
		point: { x: event.clientX, y: event.clientY },
		field,
		range,
		selected: range ? box!.value.slice(range[0], range[1]) : (window.getSelection()?.toString() ?? ""),
		editable: box ? !box.readOnly && !box.disabled : field.isContentEditable,
	};
}

export function InputMenu() {
	const [aimed, setAimed] = useState<Aimed | null>(null);

	useEffect(() => {
		const onMenu = (event: MouseEvent) => {
			const next = aim(event);
			if (!next) return;
			event.preventDefault();
			setAimed(next);
		};
		document.addEventListener("contextmenu", onMenu);
		return () => document.removeEventListener("contextmenu", onMenu);
	}, []);

	if (!aimed) return null;

	/** Put the caret back where it was, so `execCommand` acts on what was right-clicked. */
	const restore = () => {
		aimed.field.focus();
		if (aimed.range && (aimed.field instanceof HTMLInputElement || aimed.field instanceof HTMLTextAreaElement)) {
			aimed.field.setSelectionRange(aimed.range[0], aimed.range[1]);
		}
	};

	const copy = async (remove: boolean) => {
		await bridge.clipboard.write(aimed.selected);
		restore();
		if (remove) document.execCommand("delete");
	};

	const paste = async () => {
		const text = await bridge.clipboard.read();
		restore();
		// Inserting over the restored selection is what replacing a selection by pasting means.
		if (text) document.execCommand("insertText", false, text);
	};

	const selectAll = () => {
		restore();
		if (aimed.field instanceof HTMLInputElement || aimed.field instanceof HTMLTextAreaElement) aimed.field.select();
		else document.execCommand("selectAll");
	};

	const has = aimed.selected.length > 0;

	return (
		<ContextMenu anchor={aimed.point} onClose={() => setAimed(null)} width="compact">
			<MenuItem
				icon={<Scissors {...ICON} />}
				hint="⌘X"
				disabled={!has || !aimed.editable}
				onClick={() => void copy(true)}
			>
				剪切
			</MenuItem>
			<MenuItem icon={<Copy {...ICON} />} hint="⌘C" disabled={!has} onClick={() => void copy(false)}>
				复制
			</MenuItem>
			<MenuItem
				icon={<ClipboardPaste {...ICON} />}
				hint="⌘V"
				disabled={!aimed.editable}
				onClick={() => void paste()}
			>
				粘贴
			</MenuItem>
			<MenuSeparator />
			<MenuItem icon={<TextSelect {...ICON} />} hint="⌘A" onClick={selectAll}>
				全选
			</MenuItem>
		</ContextMenu>
	);
}
