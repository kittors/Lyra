/**
 * Pasting from the editor's context menu, with what a Windows clipboard holds.
 *
 * The cursor was placed at `from + text.length` — the clipboard's own count. The document counts a
 * line break as one position however it was spelled, so every CRLF in the pasted text moved the
 * cursor one further than the text reached. Pasted at the end of a file, that is past the end of
 * the document, and CodeMirror refuses the transaction outright.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { EditorMenu } from "../../src/features/editor/EditorMenu.tsx";
import { mount } from "../helpers/mount.ts";

test("右键粘贴 CRLF 文本：内容按文档的换行进来，光标停在粘贴内容的末尾", async () => {
	(window as unknown as { lyra: unknown }).lyra = {
		clipboard: { read: async () => "x\r\ny\r\n", write: async () => {} },
		workspace: { reveal: async () => {} },
	};
	const parent = document.createElement("div");
	document.body.append(parent);
	const view = new EditorView({ state: EditorState.create({ doc: "ab", selection: { anchor: 2 } }), parent });

	const mounted = await mount(
		h(EditorMenu, {
			anchor: { x: 10, y: 10 },
			onClose: () => {},
			view,
			path: "/project/notes.txt",
			readOnly: false,
			onFind: () => {},
			onFormat: async () => {},
		}),
	);
	const paste = [...document.querySelectorAll<HTMLElement>("[role='menuitem'], button")].find((item) => item.textContent?.includes("粘贴"));
	assert.ok(paste, "菜单里应该有粘贴");
	paste.click();
	// The clipboard read is asynchronous; let it land.
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(view.state.doc.toString(), "abx\ny\n");
	assert.equal(view.state.selection.main.head, view.state.doc.length, "光标应该停在粘贴内容末尾，也就是文档末尾");
	await mounted.unmount();
	view.destroy();
	parent.remove();
});
