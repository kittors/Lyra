/**
 * The sidebar drawer in a narrow window starts below the window's toolbar.
 *
 * Below 760px the sidebar is a drawer laid over the conversation, `fixed` from y=0. Every desktop
 * window with navigation now has a toolbar across its top (`WindowFrame`): 32px on Windows and Linux,
 * 40px on macOS, z-40 and a drag region all the way across. A drawer starting at y=0 has its first
 * row — search and notifications, or settings' way back to the workspace — underneath it: not visible,
 * and a press there moves the window. Only a phone has no toolbar, and its drawer still starts at the top.
 *
 * happy-dom does no layout; this reads the top the drawer declares. Occlusion in a real window is
 * measured separately.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement as h } from "react";

import { LayoutProvider, useLayout } from "../../src/app/layout.tsx";
import { NavPane } from "../../src/app/panes.tsx";
import { MAIN_TOOLBAR_HEIGHT, NATIVE_HEADER_HEIGHT } from "../../shared/window-chrome.ts";
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
async function openDrawer(platform: string, host: "desktop" | "mobile" = "desktop") {
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform, host } });
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

test("macOS: the drawer starts below the 40px toolbar", async () => {
	const { view, drawer } = await openDrawer("darwin");
	try {
		assert.equal(drawer.style.top, `${MAIN_TOOLBAR_HEIGHT}px`);
	} finally {
		await view.unmount();
	}
});

test("a phone has no toolbar, and its drawer starts at the top", async () => {
	const { view, drawer } = await openDrawer("darwin", "mobile");
	try {
		assert.equal(drawer.style.top, "");
	} finally {
		await view.unmount();
	}
});
