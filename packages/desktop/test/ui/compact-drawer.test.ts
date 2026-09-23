/**
 * 窄窗口里的侧边栏抽屉，在有 header 的平台上从 header 底下开始。
 *
 * 宽度不到 760 时侧边栏变成一张盖在对话上的抽屉，`fixed` 从窗口顶上 y=0 画起。Windows 和 Linux
 * 顶上还有一条 32px 的 header，z-40、不透明、整条是拖拽区——抽屉最上面那一行（搜索、通知两颗
 * 按钮，设置页的「返回工作区」）被它整个盖住：看不见，也按不到，按下去是在拖窗口。
 *
 * happy-dom 不排版，这里量的是抽屉自己声明的上沿；真窗口里的遮挡要另外量。
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement as h } from "react";

import { LayoutProvider, useLayout } from "../../src/app/layout.tsx";
import { NavPane } from "../../src/app/panes.tsx";
import { NATIVE_HEADER_HEIGHT } from "../../shared/window-chrome.ts";
import { click, mount } from "../helpers/mount.ts";

const width = Object.getOwnPropertyDescriptor(window, "innerWidth");

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
	if (width) Object.defineProperty(window, "innerWidth", width);
});

function Harness() {
	const { toggleNav, compact } = useLayout();
	return h(
		"div",
		null,
		h("button", { "data-test-toggle": "", "data-compact": String(compact), onClick: toggleNav }, "toggle"),
		h(NavPane, { width: 260, label: "sidebar", children: h("p", null, "搜索") }),
	);
}

/** A 700px window — narrow enough for the drawer — on `platform`, with the drawer opened. */
async function openDrawer(platform: string) {
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform } });
	Object.defineProperty(window, "innerWidth", { configurable: true, value: 700 });
	const view = await mount(h(LayoutProvider, { children: h(Harness) }));
	assert.equal(view.find("[data-test-toggle]").getAttribute("data-compact"), "true", "700px 应当是紧凑布局");
	await click(view.find("[data-test-toggle]"));
	const drawer = view.find<HTMLElement>('aside[data-pane="drawer"]');
	return { view, drawer };
}

test("Windows、Linux：抽屉从 header 底下开始，最上面一行不被盖住", async () => {
	for (const platform of ["win32", "linux"]) {
		const { view, drawer } = await openDrawer(platform);
		try {
			assert.equal(drawer.style.top, `${NATIVE_HEADER_HEIGHT}px`, platform);
		} finally {
			await view.unmount();
		}
	}
});

test("macOS 没有那条 header，抽屉照旧从顶上开始", async () => {
	const { view, drawer } = await openDrawer("darwin");
	try {
		assert.equal(drawer.style.top, "");
	} finally {
		await view.unmount();
	}
});
