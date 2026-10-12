/**
 * 放大镜底下那行「按 ⌘C 复制色值」，按这台机器的键盘写。
 *
 * 取色的快捷键本来就认 Ctrl+C（`ScreenshotOverlay` 里是 `metaKey || ctrlKey`），错的只是这句话：
 * Windows 上照着它去找 ⌘ 键，找不到。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, Fragment, useLayoutEffect } from "react";

import { ScreenshotLoupe } from "../../src/features/image/ScreenshotLoupe.tsx";
import { withKeyboard } from "../helpers/keyboard.ts";
import { mount } from "../helpers/mount.ts";

const loupe = () =>
	h(ScreenshotLoupe, {
		source: null,
		at: { x: 40, y: 40 },
		scale: 2,
		viewport: { width: 800, height: 600 },
		reading: { x: 80, y: 80, hex: "#339CFF" },
		copied: false,
	});

test("PC 上提示的是 Ctrl+C", async () => {
	await withKeyboard("Win32", async () => {
		const view = await mount(loupe());
		try {
			assert.ok(view.text().includes("按 Ctrl+C 复制色值"), view.text());
			assert.ok(!view.text().includes("⌘"));
		} finally {
			await view.unmount();
		}
	});
});

test("Mac 上仍是 ⌘C", async () => {
	const view = await mount(loupe());
	try {
		assert.ok(view.text().includes("按 ⌘C 复制色值"), view.text());
	} finally {
		await view.unmount();
	}
});

test("the glass is drawn in the commit that places it, not a frame later", async (t) => {
	/*
	 * Before paint is the point: drawn after it (a passive effect), the loupe's first frame was an
	 * empty black square and every pointer move showed the old pixels in the new box. A layout effect
	 * placed after the loupe runs after the loupe's own layout effects and before any passive one, so
	 * whether the glass has been drawn by then is exactly whether it was drawn before paint.
	 */
	const draws: number[] = [];
	const proto = window.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
	const real = proto.getContext;
	proto.getContext = function () {
		return { imageSmoothingEnabled: true, clearRect() {}, drawImage() { draws.push(Date.now()); } };
	};
	t.after(() => {
		proto.getContext = real;
	});
	let drawnBeforePaint: boolean | null = null;
	function After() {
		useLayoutEffect(() => {
			drawnBeforePaint = draws.length > 0;
		}, []);
		return null;
	}
	const source = document.createElement("canvas");
	const view = await mount(
		h(Fragment, null, h(ScreenshotLoupe, { source: source as unknown as HTMLCanvasElement, at: { x: 40, y: 40 }, scale: 2, viewport: { width: 800, height: 600 }, reading: null, copied: false }), h(After)),
	);
	try {
		assert.equal(drawnBeforePaint, true, "the first frame of the loupe would be an empty square");
	} finally {
		await view.unmount();
	}
});
