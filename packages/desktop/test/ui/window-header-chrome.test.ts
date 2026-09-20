/**
 * 窗口顶上那条带子，两个平台两个样子。
 *
 * 这里钉的是一次拆分：从前 `WINDOW_HEADER_HEIGHT = 44` 一个数同时决定四件事——macOS 红绿灯的
 * 居中、dock 面板标题栏的高度、Windows/Linux 那条 header，以及**传给系统去画三颗按钮的高度**。
 * 最后一条让 Windows 上的最小化/最大化/关闭比同屏任何原生窗口都大一圈，而 44 的出处是 macOS。
 *
 * 拆开之后最容易坏的不是新加的那一侧，是**没打算动的那一侧**：红绿灯的位置和 dock 面板的标题栏
 * 都挂在同一个常量上，手一滑就跟着变了。所以这个文件里 macOS 那几条比 Windows 那几条更重要。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import {
	MAC_TRAFFIC_LIGHT_POSITION,
	NATIVE_HEADER_HEIGHT,
	WINDOW_HEADER_HEIGHT,
} from "../../shared/window-chrome.ts";
import { HEADER_HEIGHT } from "../../src/features/dock/geometry.ts";
import { PanelWindow } from "../../src/app/window/PanelWindow.tsx";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { mount } from "../helpers/mount.ts";

test("macOS 那一侧一个像素都没动", () => {
	// 红绿灯是 14pt，要在带子里居中；这两个数一变，灯就和渲染进程画的图标错开。
	assert.equal(WINDOW_HEADER_HEIGHT, 44);
	assert.equal(MAC_TRAFFIC_LIGHT_POSITION.y, (44 - 14) / 2);
	assert.equal(MAC_TRAFFIC_LIGHT_POSITION.x, 16);
	// dock 里每个面板的标题栏跟着它——在 macOS 上第一行面板的标题就是窗口的顶行。
	assert.equal(HEADER_HEIGHT, WINDOW_HEADER_HEIGHT);
});

test("原生那一档是 Windows 标准的 32，且确实和 44 分开了", () => {
	assert.equal(NATIVE_HEADER_HEIGHT, 32);
	assert.notEqual(NATIVE_HEADER_HEIGHT, WINDOW_HEADER_HEIGHT);
});

/**
 * 两个平台各挂一次面板窗口，量它的带子。
 *
 * 平台从 `bridge.platform` 读，而 `hasHeaderBar` 是那条唯一的规则——伪造这一个值就够了，不必去
 * 动 `navigator`。
 */
async function headerOn(platform: string) {
	/*
	 * `panelKind: null`——这里量的是带子，不是面板。
	 *
	 * 给一个真的 kind，`renderPanel` 会把那个面板整套挂起来（终端要 `terminal.onExit`，浏览器要
	 * 一个 webview……），于是一条关于 CSS 类名的断言要先满足十几个 bridge 方法。`null` 时 header
	 * 照画，内容那一格是空的，正好是这条用例要的范围。
	 */
	Reflect.set(window, "lyra", {
		platform,
		bootWindow: { kind: "panel", panelKind: null, panelScope: "window", sessionId: null, id: "p1" },
		windows: { keepOnTop: async () => ({ ok: true, enabled: false }) },
	});
	const view = await mount(h(LayoutProvider, null, h(PanelWindow)));
	const header = view.find("[data-ly-panel-window-chrome]");
	return { view, header };
}

test("Windows：带子有底色，高度取原生那一档", async () => {
	const { view, header } = await headerOn("win32");
	try {
		assert.ok(
			header.className.includes("ly-window-header"),
			`带子没有底色就会和内容同色糊成一片：${header.className}`,
		);
		assert.equal((header as HTMLElement).style.height, `${NATIVE_HEADER_HEIGHT}px`);
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});

test("macOS：不加那条底色，高度仍是红绿灯的 44", async () => {
	const { view, header } = await headerOn("darwin");
	try {
		// 那里的红绿灯在窗口外，带子本来就该透明；加了底色等于凭空多一道横线。
		assert.ok(!header.className.includes("ly-window-header"), header.className);
		assert.equal((header as HTMLElement).style.height, `${WINDOW_HEADER_HEIGHT}px`);
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});
