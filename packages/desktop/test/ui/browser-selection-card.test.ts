/**
 * 选区卡片：长得像输入框的地方，就得真是那个输入框。
 *
 * 这张卡不是发送入口——它把「你写的字 + 这块区域是什么」凑成一段，交给主输入框，人在那边按回车
 * 发出去。但它中间那个格子看着就是个输入框，于是所有输入框的习惯都会被带过来：回车提交、内容多了
 * 自己长高、和别处一样的聚焦环。它此前是自己搭的一套裸 `<textarea rows={2}>`，一样都不成立。
 *
 * 所以这里量两件事：那块地方确实是 `ComposerShell`（`.ly-composer`，全窗口只此一副外壳），
 * 以及回车真的把东西交出去了、交的是那块区域的数据。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import type { BrowserSelection } from "../../shared/browser.ts";
import { BrowserSelectionCard } from "../../src/features/browser/BrowserSelectionCard.tsx";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

const SELECTION: BrowserSelection = {
	url: "https://example.com/pricing",
	title: "定价",
	selector: "body > main > section:nth-of-type(2)",
	screenshot: "data:image/png;base64,iVBORw0KGgo=",
	html: "<section>定价</section>",
	text: "三档方案",
	styles: { color: "rgb(0, 0, 0)" },
	bounds: { x: 10, y: 20, width: 300, height: 120 },
};

async function card() {
	useApp.setState({ activeSessionId: "s1", browserAttachment: null });
	let closed = 0;
	const view = await mount(h(BrowserSelectionCard, { selection: SELECTION, onClose: () => { closed += 1; } }));
	return { view, closed: () => closed };
}

test("the field is the app's composer, not a textarea of its own", async () => {
	const app = await card();
	try {
		const field = app.view.find("textarea");
		assert.ok(field, "卡片里得有一个输入框");
		assert.ok(
			field.closest(".ly-composer"),
			"它得住在 `ComposerShell` 里——那是回车提交、自动长高、统一聚焦环一起来的地方",
		);
	} finally {
		await app.view.unmount();
	}
});

test("Enter hands the region to the main composer, and closes", async () => {
	/*
	 * 这条是「像输入框」的实质：写完按回车。从前只有右边那个纸飞机能提交，回车什么也不做——
	 * 一个看着是输入框、回车却没反应的格子，比一个不像输入框的格子更难用。
	 */
	const app = await card();
	try {
		const field = app.view.find("textarea") as HTMLTextAreaElement;
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
		await act(async () => {
			setter?.call(field, "把这块的间距调小一点");
			field.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		});

		const handed = useApp.getState().browserAttachment;
		assert.ok(handed, "回车之后主输入框该收到东西");
		assert.ok(handed.text.includes("把这块的间距调小一点"), "带着人说的那句话");
		assert.ok(handed.text.includes(SELECTION.selector), "以及这块区域是页面上的哪一块");
		assert.equal(handed.dataUrl, SELECTION.screenshot, "区域截图跟着一起走");
		assert.equal(app.closed(), 1, "交出去了，这张卡就没有留着的理由");
	} finally {
		await app.view.unmount();
	}
});

test("sending with nothing typed still delivers the region", async () => {
	// 常见的一种用法就是「看这块」，不多说。空着提交不该是无事发生。
	const app = await card();
	try {
		const field = app.view.find("textarea") as HTMLTextAreaElement;
		await act(async () => {
			field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		});

		const handed = useApp.getState().browserAttachment;
		assert.ok(handed, "空着也要把区域交过去");
		assert.ok(handed.text.includes(SELECTION.url), "URL 在里面");
	} finally {
		await app.view.unmount();
	}
});
