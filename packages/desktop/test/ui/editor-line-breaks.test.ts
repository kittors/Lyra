/**
 * The built-in editor and the line breaks a file already has.
 *
 * CodeMirror splits on every kind of line break and joins with `\n`. Compared against the file as
 * read, that made every CRLF file — which is most of a Windows checkout under `core.autocrlf` —
 * differ on every line: opening one rewrote the document and reported the rewrite as an edit, so the
 * file showed as unsaved before a key was pressed (read-only ones included, since CodeMirror's
 * read-only stops the user, not the program), and saving it wrote the whole file back as LF.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { EditorView } from "@codemirror/view";

import { CodeEditor } from "../../src/features/editor/CodeEditor.tsx";
import { mount } from "../helpers/mount.ts";

async function open(text: string, options: { readOnly?: boolean } = {}) {
	const changes: string[] = [];
	const props = {
		// `.txt` so no grammar is fetched: this is about the document, not its highlighting.
		path: "/project/notes.txt",
		text,
		readOnly: options.readOnly,
		onChange: (next: string) => changes.push(next),
		onSave: () => {},
	};
	const mounted = await mount(h(CodeEditor, props));
	const dom = mounted.host.querySelector<HTMLElement>(".cm-editor");
	assert.ok(dom, "编辑器应该已经挂上");
	const view = EditorView.findFromDOM(dom);
	assert.ok(view, "应该能从 DOM 找到 EditorView");
	return {
		view,
		changes,
		rerender: (next: string) => mounted.rerender(h(CodeEditor, { ...props, text: next })),
		unmount: () => mounted.unmount(),
	};
}

test("打开 CRLF 文件不算改动", async () => {
	const editor = await open("alpha\r\nbeta\r\n");
	assert.deepEqual(editor.changes, [], "什么都没按，不能报出一次改动（那会生成草稿，文件显示未保存）");
	await editor.unmount();
});

test("只读的 CRLF 文件打开同样不算改动", async () => {
	const editor = await open("alpha\r\nbeta\r\n", { readOnly: true });
	assert.deepEqual(editor.changes, []);
	await editor.unmount();
});

test("换行混用的文件打开也不算改动", async () => {
	// No single line break to join with, so what the editor would hand back can never equal this.
	const editor = await open("alpha\r\nbeta\ngamma\r\n");
	assert.deepEqual(editor.changes, []);
	await editor.unmount();
});

test("编辑 CRLF 文件，交回去的文本仍是 CRLF", async () => {
	const editor = await open("alpha\r\nbeta\r\n");
	editor.view.dispatch({ changes: { from: 0, to: 5, insert: "ALPHA" } });
	assert.equal(editor.changes.at(-1), "ALPHA\r\nbeta\r\n", "只改了一个词，其余每一行的换行都不该被动");
	await editor.unmount();
});

test("往 CRLF 文件里粘贴 LF 文本：照样分行，并跟随文件用 CRLF", async () => {
	// `replaceSelection` goes through `state.toText`, the same path a real paste takes. With
	// `EditorState.lineSeparator` set to `\r\n` that path stops splitting on `\n`, and the pasted
	// lines would land as one line with a raw `\n` inside it.
	const editor = await open("alpha\r\nbeta\r\n");
	editor.view.dispatch(editor.view.state.replaceSelection("x\ny"));
	assert.equal(editor.view.state.doc.lines, 4, "粘贴进来的两行要是两行");
	assert.equal(editor.changes.at(-1), "x\r\nyalpha\r\nbeta\r\n");
	await editor.unmount();
});

test("放弃改动、回到磁盘上的原文：是采纳外部内容，不能再报成一次改动", async () => {
	// The pane's 放弃更改 hands the original back as `text`. Reporting the adoption as an edit
	// turned a mixed-line-break file straight back into a draft — the discard could never stick.
	const original = "alpha\r\nbeta\ngamma\r\n";
	const editor = await open(original);
	editor.view.dispatch({ changes: { from: 0, to: 5, insert: "ALPHA" } });
	const edits = editor.changes.length;
	await editor.rerender(editor.changes.at(-1) ?? "");
	await editor.rerender(original);
	assert.equal(editor.view.state.doc.toString(), "alpha\nbeta\ngamma\n", "编辑器要回到原文");
	assert.equal(editor.changes.length, edits, "回到原文之后不该再多出一次改动");
	await editor.unmount();
});

test("外部把文件从 CRLF 换成了 LF：之后的编辑跟着用 LF", async () => {
	const editor = await open("alpha\r\nbeta\r\n");
	await editor.rerender("one\ntwo\n");
	assert.equal(editor.view.state.doc.toString(), "one\ntwo\n");
	editor.view.dispatch({ changes: { from: 0, to: 3, insert: "ONE" } });
	assert.equal(editor.changes.at(-1), "ONE\ntwo\n");
	await editor.unmount();
});

test("文件面板：只读文件的编辑器报上来的改动一律不进草稿", async () => {
	/*
	 * CodeMirror's read-only stops the user, not the program: a transaction dispatched from code —
	 * the formatter, the sync effect — still changes the document and still reaches `onChange`.
	 * The pane is where a draft is made, so the pane is where read-only has to hold.
	 */
	(window as unknown as { lyra: unknown }).lyra = { files: { mediaUrl: (path: string) => `ly-media://f/${encodeURIComponent(path)}` } };
	const { FileViewer } = await import("../../src/features/files/FileViewer.tsx");
	const drafts: (string | undefined)[] = [];
	const mounted = await mount(
		h(FileViewer, {
			path: "/elsewhere/granted.txt",
			name: "granted.txt",
			contents: { text: "alpha\r\nbeta\r\n", readOnly: true, truncated: false, bytes: 13, modifiedAt: 0 },
			draft: undefined,
			onDraft: (text: string | undefined) => drafts.push(text),
			onSaved: () => {},
		}),
	);
	const dom = mounted.host.querySelector<HTMLElement>(".cm-editor");
	assert.ok(dom, "只读文件也应该用编辑器显示");
	const view = EditorView.findFromDOM(dom);
	assert.ok(view);
	view.dispatch({ changes: { from: 0, to: 5, insert: "ALPHA" } });
	assert.deepEqual(drafts, [], "只读文件不能生成草稿");
	await mounted.unmount();
});
