/**
 * 标注工具栏的定位，只能有一个。
 *
 * 这条守的是一个只值一行、却让整个标注模式没法用的错误：那串类里同时写着 `fixed` 和 `relative`。
 * 类名里的先后不算数——`position` 谁赢由 Tailwind 输出的次序决定，而 `relative` 排在 `fixed`
 * 后面。于是本该浮在窗口底部的工具栏留在了文档流里，成了图片查看器那个 flex 舞台上的第二个成员：
 * 在 1280px 的窗口里，图片被推到左边界外 113px，工具栏自己落在 x=1424，被 `overflow-hidden`
 * 裁掉。按下「标注」的结果是图片跳走、工具栏消失。
 *
 * 量的是类名而不是渲染结果，因为渲染结果要真浏览器才算得出层叠——`e2e/viewer-edit-shift-probe.ts`
 * 在真窗口里量过那 203px。这一条只是让它不会悄悄回来。
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { AnnotateToolbar, FLOATING_BAR } from "../../src/features/image/AnnotateToolbar.tsx";
import { useAnnotator } from "../../src/features/image/Annotator.tsx";
import { withKeyboard } from "../helpers/keyboard.ts";

// These tests mount an empty annotator; happy-dom has no decoded bitmap constructor.
// oxlint-disable-next-line typescript/no-extraneous-class -- Only an instanceof target is needed; no bitmap is constructed.
before(() => Object.defineProperty(globalThis, "ImageBitmap", { value: class {}, configurable: true }));
after(() => { Reflect.deleteProperty(globalThis, "ImageBitmap"); });

/** Tailwind 里所有会写 `position` 的工具类。 */
const POSITIONS = new Set(["static", "fixed", "absolute", "relative", "sticky"]);

test("the floating toolbar declares exactly one position, and it is fixed", () => {
	const declared = FLOATING_BAR.split(/\s+/).filter((name) => POSITIONS.has(name));

	assert.deepEqual(
		declared,
		["fixed"],
		`工具栏必须只声明一个 position：多一个，赢的那个由 Tailwind 的输出顺序决定，而不是这里写的顺序（实际有 ${declared.join("、") || "零"} 个）`,
	);
});

test("it is placed against the window, not against whatever contains it", () => {
	// `bottom-6 left-1/2` 加上组件自己的 `translateX(-50%)` 才是「贴着窗口底边居中」。少一个，
	// 它就落在别的地方——而这三样分居两处，只有一起看才成立。
	assert.match(FLOATING_BAR, /\bbottom-6\b/);
	assert.match(FLOATING_BAR, /\bleft-1\/2\b/);
});

test("every download arrow saves a file; capture completion has its own checkmark", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let downloads = 0;
	let finishes = 0;
	function Toolbar() {
		return createElement(AnnotateToolbar, {
			annotator: useAnnotator(null), canReplace: false, requireDirty: false,
			onCancel: () => {}, onSave: () => { finishes++; },
			onDownload: () => { downloads++; }, saveLabel: "Complete capture",
		});
	}
	try {
		await act(async () => root.render(createElement(Toolbar)));
		const arrows = host.querySelectorAll<HTMLButtonElement>("button:has(.lucide-download)");
		assert.equal(arrows.length, 1, "A completion button must not promise a downloaded file");
		await act(async () => arrows[0]!.click());
		assert.equal(downloads, 1);
		assert.equal(finishes, 0);
		const complete = host.querySelector<HTMLButtonElement>('button[aria-label="Complete capture"]');
		assert.ok(complete);
		assert.ok(complete.querySelector(".lucide-check"));
		await act(async () => complete.click());
		assert.equal(finishes, 1);
		assert.equal(downloads, 1);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

test("saving an image copy still uses a download arrow without a separate download button", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let copies = 0;
	function Toolbar() {
		return createElement(AnnotateToolbar, {
			annotator: useAnnotator(null), canReplace: false, requireDirty: false,
			onCancel: () => {}, onSave: () => { copies++; },
		});
	}
	try {
		await act(async () => root.render(createElement(Toolbar)));
		const arrow = host.querySelector<HTMLButtonElement>("button:has(.lucide-download)");
		assert.ok(arrow);
		await act(async () => arrow.click());
		assert.equal(copies, 1);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

/** Mount the bar with an empty drawing and hand the host to `check`, unmounting whatever happens. */
async function withToolbar(check: (host: HTMLElement) => Promise<void> | void) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	function Toolbar() {
		return createElement(AnnotateToolbar, {
			annotator: useAnnotator(null), canReplace: false, requireDirty: false,
			onCancel: () => {}, onSave: () => {},
		});
	}
	try {
		await act(async () => root.render(createElement(Toolbar)));
		await check(host);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

test("undo and redo name a PC's keys to a screen reader too, not only in the tooltip", async () => {
	// The tooltip converts on display (`tooltip.ts`); the accessible name is read straight off the
	// attribute, so a Windows screen reader announced "⌘Z".
	await withKeyboard("Win32", () =>
		withToolbar((host) => {
			assert.equal(host.querySelector("button:has(.lucide-undo-2)")?.getAttribute("aria-label"), "撤销 Ctrl+Z");
			assert.equal(host.querySelector("button:has(.lucide-redo-2)")?.getAttribute("aria-label"), "重做 Ctrl+Shift+Z");
		}),
	);
	await withToolbar((host) => {
		assert.equal(host.querySelector("button:has(.lucide-undo-2)")?.getAttribute("aria-label"), "撤销 ⌘Z");
	});
});

/** Mount the bar over an annotator whose undo and redo only count, and press keys at the window. */
async function countingHistory(run: (press: (init: KeyboardEventInit) => Promise<void>) => Promise<void>) {
	const counts = { undo: 0, redo: 0 };
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	function Toolbar() {
		const annotator = useAnnotator(null);
		return createElement(AnnotateToolbar, {
			annotator: { ...annotator, undo: () => void counts.undo++, redo: () => void counts.redo++ },
			canReplace: false, requireDirty: false, onCancel: () => {}, onSave: () => {},
		});
	}
	try {
		await act(async () => root.render(createElement(Toolbar)));
		await run(async (init) => {
			const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
			await act(async () => window.dispatchEvent(event));
		});
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
	return counts;
}

test("PC 上 Ctrl+Y 是重做，Ctrl+Shift+Z 也仍是", async () => {
	await withKeyboard("Win32", async () => {
		const counts = await countingHistory(async (press) => {
			await press({ key: "y", code: "KeyY", ctrlKey: true });
			await press({ key: "Z", code: "KeyZ", ctrlKey: true, shiftKey: true });
			await press({ key: "z", code: "KeyZ", ctrlKey: true });
		});
		assert.deepEqual(counts, { undo: 1, redo: 2 });
	});
});

test("Mac 上 ⌘Y 不是重做：那里重做只有 ⇧⌘Z", async () => {
	const counts = await countingHistory(async (press) => {
		await press({ key: "y", code: "KeyY", metaKey: true });
		await press({ key: "z", code: "KeyZ", metaKey: true, shiftKey: true });
	});
	assert.deepEqual(counts, { undo: 0, redo: 1 });
});
