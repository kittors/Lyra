/**
 * 图片查看器里滚一格滚轮，放大一档。
 *
 * 触控板捏合到达时是按住 ctrlKey 的 wheel、每次 deltaY 只有个位数，所以按住 Ctrl 的那一路灵敏度
 * 调得很高。而 Windows 和 Linux 上放大图片的习惯是 Ctrl+鼠标滚轮——同样按住 ctrlKey，一格却是
 * 100px 左右，套上捏合的灵敏度就是 e¹：一格 2.7 倍，两格从 100% 直接冲到 739%。
 */

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { act, createElement as h } from "react";

import { LayoutProvider } from "../../src/app/layout.tsx";
import { ImageViewer } from "../../src/features/image/ImageViewer.tsx";
import { closeViewer, openViewer } from "../../src/features/image/viewer-store.ts";
import { I18nProvider } from "../../src/i18n/index.ts";
import { fire, mount } from "../helpers/mount.ts";

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });

/** A wheel event as Chromium sends it: pixels, one notch of a mouse being about 100. */
function wheel(deltaY: number, ctrlKey: boolean) {
	const event = new Event("wheel", { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		deltaX: { value: 0 },
		deltaY: { value: deltaY },
		deltaMode: { value: 0 },
		ctrlKey: { value: ctrlKey },
		clientX: { value: 400 },
		clientY: { value: 300 },
	});
	return event;
}

/** The zoom readout in the corner, as a number. */
function percent(): number {
	const text = document.querySelector('[aria-label^="当前缩放"]')?.textContent ?? "";
	return Number(text.replace("%", ""));
}

afterEach(async () => {
	await act(async () => closeViewer());
	Reflect.deleteProperty(window, "lyra");
});

// The annotator is mounted with the viewer; happy-dom has no decoded bitmap constructor.
// oxlint-disable-next-line typescript/no-extraneous-class -- Only an instanceof target is needed; no bitmap is constructed.
before(() => Object.defineProperty(globalThis, "ImageBitmap", { value: class {}, configurable: true }));
after(() => {
	Reflect.deleteProperty(globalThis, "ImageBitmap");
});

async function viewer() {
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform: "win32" } });
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(ImageViewer) }) }));
	await act(async () => openViewer([{ src: "data:image/png;base64,iVBORw0KGgo=" }], 0, null));
	await settle();
	return view;
}

test("按住 Ctrl 滚一格鼠标滚轮，只放大一档", async () => {
	const view = await viewer();
	try {
		const dialog = document.querySelector('[role="dialog"][aria-modal]');
		assert.ok(dialog, "查看器没打开");
		assert.equal(percent(), 100);
		await fire(dialog, wheel(-100, true));
		assert.equal(percent(), 125, "一格应是放大按钮按一下的量");
		await fire(dialog, wheel(100, true));
		assert.equal(percent(), 100, "反方向一格回到原处");
	} finally {
		await view.unmount();
	}
});

test("触控板捏合的小步照旧，不被那个上限拖慢", async () => {
	const view = await viewer();
	try {
		const dialog = document.querySelector('[role="dialog"][aria-modal]');
		assert.ok(dialog);
		for (let i = 0; i < 10; i++) await fire(dialog, wheel(-2, true));
		// Ten events of e^0.02 each: e^0.2, about 122%.
		assert.equal(percent(), 122);
	} finally {
		await view.unmount();
	}
});
