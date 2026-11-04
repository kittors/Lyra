/**
 * Right-clicking a message: copy the selection, a link's address, a picture.
 *
 * Electron draws no context menu, and the transcript had none of its own — on the Windows test
 * machine right-clicking a reply did nothing at all, so a link's address could not be had and a
 * selection only by Ctrl+C. Things with a menu of their own (file paths, attachment marks) keep it.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { TranscriptMenu } from "../../src/features/conversation/TranscriptMenu.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { click, fire, mount, type Mounted } from "../helpers/mount.ts";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let copied: string[];
let images: string[];
let notices: string[];
let view: Mounted | undefined;

beforeEach(() => {
	copied = [];
	images = [];
	notices = [];
	Object.defineProperty(window, "lyra", {
		configurable: true,
		writable: true,
		value: {
			platform: "win32",
			clipboard: {
				write: async (text: string) => void copied.push(text),
				writeImage: async (data: string) => (images.push(data), true),
			},
			files: { mediaDataUrl: async () => PNG },
		},
	});
	useApp.setState({ notify: (text: string) => void notices.push(text) } as never);
});
afterEach(async () => {
	await view?.unmount();
	view = undefined;
	window.getSelection()?.removeAllRanges();
	Reflect.deleteProperty(window, "lyra");
});

async function transcript() {
	view = await mount(h(I18nProvider, {
		locale: "zh-CN",
		children: h(LayoutProvider, {
			children: h("div", null,
				h("div", { "data-ly-transcript-rows": "" },
					h("p", { id: "said" }, "先装依赖，再跑测试"),
					h("a", { id: "link", href: "https://example.com/guide" }, "指南"),
					h("img", { id: "picture", src: PNG, alt: "" }),
					h("img", { id: "avatar", src: PNG, alt: "" }),
					h("span", { id: "own", onContextMenu: (event: MouseEvent) => event.preventDefault() }, "src/app.ts"),
					h("textarea", { id: "editing", defaultValue: "改一下" }),
				),
				h("p", { id: "elsewhere" }, "侧栏里的字"),
				h(TranscriptMenu),
			),
		}),
	}));
	// happy-dom lays nothing out: give the picture a picture's size and the avatar an avatar's.
	const sized = (id: string, px: number) => Object.assign(document.getElementById(id) as HTMLElement, { getBoundingClientRect: () => ({ x: 0, y: 0, width: px, height: px, top: 0, left: 0, right: px, bottom: px }) });
	sized("picture", 240);
	sized("avatar", 24);
}

const rightClick = (id: string) => fire(document.getElementById(id) as HTMLElement, new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
// The label, without the shortcut hint drawn beside it (⌘C or Ctrl+C, by the host's keyboard).
const label = (row: Element) => (row.textContent ?? "").replace(/(⌘|Ctrl\+)C$/, "").trim();
const rows = () => [...document.querySelectorAll('[role="menuitem"]')].map(label);
const press = (name: string) => click([...document.querySelectorAll('[role="menuitem"]')].find((row) => label(row) === name) as HTMLElement);

function select(id: string) {
	const range = document.createRange();
	range.selectNodeContents(document.getElementById(id) as HTMLElement);
	window.getSelection()?.removeAllRanges();
	window.getSelection()?.addRange(range);
}

test("a selection in a reply offers 复制, and copies it as Ctrl+C would — the selection as it was", async () => {
	await transcript();
	const copies: string[] = [];
	// happy-dom has no execCommand; the app's copy is the browser's own, so stand in for it.
	Object.assign(document, { execCommand: (command: string) => command === "copy" && copies.push(window.getSelection()?.toString() ?? "") > 0 });
	try {
		select("said");
		await rightClick("said");
		assert.deepEqual(rows(), ["复制"]);
		// Pressing the row may move the selection; what is copied is what was selected on the right-click.
		window.getSelection()?.removeAllRanges();
		await press("复制");
		assert.deepEqual(copies, ["先装依赖，再跑测试"]);
		assert.deepEqual(copied, [], "copied with its formatting, not as a plain-text fallback");
	} finally {
		Reflect.deleteProperty(document, "execCommand");
	}
});

test("where the browser's copy is refused, the selected text still reaches the clipboard", async () => {
	await transcript();
	Object.assign(document, { execCommand: () => false });
	try {
		select("said");
		await rightClick("said");
		await press("复制");
		assert.deepEqual(copied, ["先装依赖，再跑测试"]);
	} finally {
		Reflect.deleteProperty(document, "execCommand");
	}
});

test("a link offers its address", async () => {
	await transcript();
	await rightClick("link");
	assert.deepEqual(rows(), ["复制链接"]);
	await press("复制链接");
	assert.deepEqual(copied, ["https://example.com/guide"]);
});

test("a picture offers 复制图片 and 另存为; an avatar-sized one offers nothing", async () => {
	await transcript();
	await rightClick("picture");
	assert.deepEqual(rows(), ["复制图片", "另存为"]);
	await press("复制图片");
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.deepEqual(images, [PNG]);
	assert.deepEqual(notices, []);

	await rightClick("avatar");
	assert.equal(document.querySelectorAll('[role="menuitem"]').length, 0);
});

test("a selection somewhere else is not offered on a picture's menu", async () => {
	await transcript();
	select("said");
	await rightClick("picture");
	assert.deepEqual(rows(), ["复制图片", "另存为"]);
});

test("what has a menu of its own, a field, or a place outside the transcript gets nothing from here", async () => {
	await transcript();
	for (const id of ["own", "editing", "elsewhere"]) {
		select(id === "editing" ? "said" : id);
		await rightClick(id);
		assert.equal(document.querySelectorAll('[role="menuitem"]').length, 0, id);
	}
});
