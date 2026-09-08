/**
 * 地址栏：输进去的东西是网址还是要搜的词，以及它有没有说清楚自己打算干哪一件。
 *
 * 判定本身在 `shared/browser.ts` 里，`browser-commands.test.ts` 逐条测过；这里测的是那个判定有
 * 没有真的接到输入框上——图标换没换、下拉里第一条写的是哪一件事、按下 Enter 交出去的是哪个地址。
 * 这三件事任何一件断了，用户看到的都是「我明明输了字，它却打开了别的东西」。
 *
 * 另外两条是回归：页面在你打字的中途导航完成时不能把你打了一半的字冲掉，Esc 要把地址栏还给页面。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, createRef } from "react";
import { AddressBar } from "../../src/features/browser/AddressBar.tsx";
import { fire, mount, press, type Mounted } from "../helpers/mount.ts";

const BOOKMARKS = [{ url: "https://lyra.example.com/docs", title: "Lyra 文档" }, { url: "https://other.example.com/", title: "别的" }];

async function open(url = "about:blank", search?: { searchEngine?: "bing" | "google" | "baidu" | "duckduckgo" | "custom"; searchUrl?: string }) {
	const opened: string[] = [];
	const inputRef = createRef<HTMLInputElement>();
	const view = await mount(h(AddressBar, { url, bookmarks: BOOKMARKS, search, inputRef, onOpen: (next: string) => opened.push(next) }));
	return { view, opened, inputRef, field: view.find<HTMLInputElement>("input") };
}

/** Typing the way a user does: through the native setter, so React sees a real change. */
async function type(field: HTMLInputElement, text: string) {
	// `focusin` rather than `focus`: that is the one React delegates `onFocus` from.
	await fire(field, new Event("focusin", { bubbles: true }));
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
	assert.ok(setter);
	setter.call(field, text);
	await fire(field, new Event("input", { bubbles: true }));
}

const kind = (view: Mounted) => view.find("[data-omnibox-kind]").dataset.omniboxKind;
const choices = (view: Mounted) => view.all("[data-omnibox-choice]").map((row) => `${row.dataset.omniboxChoice}:${row.textContent}`);

test("the address bar says which of the two it will do, and does that one", async () => {
	const { view, opened, field } = await open();
	try {
		assert.match(field.placeholder, /必应/);
		await type(field, "example.com/a");
		assert.equal(kind(view), "open");
		// The row shows the address that will actually be opened, scheme and all.
		assert.deepEqual(choices(view), ["open:https://example.com/a打开网址"]);
		await press(field, "Enter");
		assert.deepEqual(opened, ["https://example.com/a"]);

		await type(field, "天气 预报");
		assert.equal(kind(view), "search");
		assert.match(choices(view)[0] ?? "", /^search:天气 预报用必应搜索$/);
		await press(field, "Enter");
		assert.equal(opened[1], "https://www.bing.com/search?q=%E5%A4%A9%E6%B0%94%20%E9%A2%84%E6%8A%A5");
	} finally { await view.unmount(); }
});

test("bookmarks are offered under the action, and the arrow keys pick one", async () => {
	const { view, opened, field } = await open("about:blank", { searchEngine: "google" });
	try {
		assert.match(field.placeholder, /用Google搜索/);
		await type(field, "lyra");
		assert.deepEqual(choices(view), ["search:lyra用 Google 搜索".replace(" Google ", "Google"), "bookmark:Lyra 文档https://lyra.example.com/docs"]);
		await press(field, "ArrowDown");
		await press(field, "Enter");
		assert.deepEqual(opened, ["https://lyra.example.com/docs"]);
		// Wrapping around from the last row lands back on the search, not on nothing.
		await type(field, "lyra");
		await press(field, "ArrowUp");
		await press(field, "Enter");
		assert.equal(opened[1], "https://lyra.example.com/docs");
	} finally { await view.unmount(); }
});

test("a custom engine reads as one, rather than as 「用自定义搜索搜索」", async () => {
	const { view, field } = await open("about:blank", { searchEngine: "custom", searchUrl: "https://s.example.com/find?q=%s" });
	try {
		assert.equal(field.placeholder, "用自定义搜索，或输入网址");
		await type(field, "lyra");
		assert.deepEqual(view.all("[data-omnibox-detail]").map((row) => row.textContent), ["用自定义搜索", "https://lyra.example.com/docs"]);
	} finally { await view.unmount(); }
});

test("a page that navigates mid-word does not take the word away, and Escape gives the field back", async () => {
	const { view, field } = await open("https://example.com/one");
	try {
		assert.equal(field.value, "https://example.com/one");
		await type(field, "example.com/tw");
		// The page finishes loading something else while the address bar is being edited.
		await view.rerender(h(AddressBar, { url: "https://example.com/redirected", bookmarks: BOOKMARKS, search: undefined, inputRef: createRef<HTMLInputElement>(), onOpen: () => {} }));
		assert.equal(view.find<HTMLInputElement>("input").value, "example.com/tw");
		await press(view.find("input"), "Escape");
		assert.equal(view.find<HTMLInputElement>("input").value, "https://example.com/redirected");
		assert.equal(view.all("[data-omnibox-list]").length, 0);
	} finally { await view.unmount(); }
});
