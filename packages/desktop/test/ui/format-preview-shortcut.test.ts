/**
 * 格式化预览的快捷键，和编辑器、和它自己的提示是同一个键。
 *
 * 提示与编辑器在 PC 上都写 Shift+Alt+F，这个框却只认 Ctrl+Shift+F——照着提示按没反应，
 * 而 Ctrl+Shift+F 恰好是微软拼音的简繁切换，按下去先把输入法切成了繁体。
 *
 * 触发与否看的是它有没有去问格式化配置：挂上时不会自动格式化（那只在选项变了之后发生），
 * 所以问了一次就是按键触发了一次。
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement as h } from "react";

import { FormatPreview } from "../../src/features/settings/FormatPreview.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { withKeyboard } from "../helpers/keyboard.ts";
import { fire, mount } from "../helpers/mount.ts";

/** How many times the preview asked for the project's formatter config — once per format. */
function formatter(): () => number {
	let asked = 0;
	Reflect.set(window, "lyra", {
		platform: "win32",
		format: {
			config: async () => {
				asked += 1;
				return null;
			},
			external: async () => null,
		},
	});
	return () => asked;
}

function key(keyName: string, init: KeyboardEventInit) {
	const event = new KeyboardEvent("keydown", { key: keyName, code: "KeyF", bubbles: true, cancelable: true, ...init });
	Object.defineProperty(event, "getModifierState", { value: () => false });
	return event;
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

async function preview() {
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(FormatPreview, { options: {} as never }) }));
	return { view, box: view.find('textarea[aria-label="试一段代码，然后按格式化"]') };
}

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
});

test("PC 上是 Shift+Alt+F，和编辑器一样；Ctrl+Shift+F 留给输入法", async () => {
	const asked = formatter();
	await withKeyboard("Win32", async () => {
		const { view, box } = await preview();
		try {
			await fire(box, key("F", { ctrlKey: true, shiftKey: true }));
			await settle();
			assert.equal(asked(), 0, "Ctrl+Shift+F 不该格式化");
			await fire(box, key("F", { altKey: true, shiftKey: true }));
			await settle();
			assert.equal(asked(), 1, "Shift+Alt+F 应当格式化");
		} finally {
			await view.unmount();
		}
	});
});

test("Mac 上是 ⌘⇧F，不管按住 ⌘ 时 key 报的是大写还是小写", async () => {
	const asked = formatter();
	const { view, box } = await preview();
	try {
		await fire(box, key("F", { metaKey: true, shiftKey: true }));
		await settle();
		await fire(box, key("f", { metaKey: true, shiftKey: true }));
		await settle();
		assert.equal(asked(), 2);
		// ⇧⌥F cannot be the Mac key: Option composes characters there (see `CodeEditor.tsx`).
		await fire(box, key("Ï", { altKey: true, shiftKey: true }));
		await settle();
		assert.equal(asked(), 2);
	} finally {
		await view.unmount();
	}
});
