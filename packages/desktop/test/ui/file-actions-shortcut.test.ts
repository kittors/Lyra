/**
 * 文件标题栏上「保存 ⌘S」那颗标记，读屏读到的名字也按这台机器的键盘写。
 *
 * 看得见的 tooltip 在显示时才换算（`tooltip.ts`），`aria-label` 却是原样写上去的——于是
 * Windows 的读屏念的是一个这块键盘上没有的键。
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement as h } from "react";

import { FileActions } from "../../src/features/files/FileActions.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useOpenFile } from "../../src/store/openFile.ts";
import { withKeyboard } from "../helpers/keyboard.ts";
import { mount } from "../helpers/mount.ts";

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
	useOpenFile.getState().clear();
});

/** A text file with an unsaved edit, which is when the save mark is drawn. */
function dirtyFile() {
	Reflect.set(window, "lyra", { platform: "win32", system: { openTargets: async () => [] } });
	useOpenFile.setState({
		path: "/p/a.txt",
		name: "a.txt",
		contents: { text: "a", truncated: false, bytes: 1, modifiedAt: 0 },
		drafts: { "/p/a.txt": "b" },
	});
}

test("PC 上保存标记的名字是 Ctrl+S", async () => {
	dirtyFile();
	await withKeyboard("Win32", async () => {
		const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(FileActions) }));
		try {
			const save = view.host.querySelector("button:has(.lucide-save)");
			assert.ok(save, "有未保存的改动时应画出保存标记");
			assert.equal(save.getAttribute("aria-label"), "保存 Ctrl+S");
		} finally {
			await view.unmount();
		}
	});
});
