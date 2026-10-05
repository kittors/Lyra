/**
 * Toasts centre on what is beside the sidebar — in a window that has a sidebar.
 *
 * A popped-out panel and a conversation in its own window draw none, but the layout still carried the
 * main window's open flag and remembered width, so the stack started a sidebar's width in and every
 * toast sat half a sidebar right of the window's middle.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";
import { MAIN_RAIL_WIDTH } from "../../shared/window-chrome.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { Toaster } from "../../src/features/toast/Toaster.tsx";
import { useApp } from "../../src/store/index.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

let view: Mounted | undefined;

beforeEach(() => {
	// The layout reads the platform off the bridge for the title bar's insets.
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform: "darwin" } });
	window.localStorage.setItem("dw:sidebar-width", "280");
	useApp.getState().notify("已撤销改动", "info");
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState({ notices: [] });
	window.localStorage.clear();
	Reflect.deleteProperty(window, "lyra");
});

const stackLeft = () => document.querySelector<HTMLElement>("[data-ly-toaster]")?.style.left;

test("in the main window the stack starts past the icon rail and the open sidebar", async () => {
	view = await mount(h(LayoutProvider, { children: h(Toaster) }));
	// The rail, the panel's 1px edge, then the sidebar — see `WindowFrame`.
	assert.equal(stackLeft(), `${MAIN_RAIL_WIDTH + 1 + 280}px`);
});

test("in a window with no sidebar — a popped-out panel, a conversation of its own — it spans the window", async () => {
	view = await mount(h(LayoutProvider, { nav: false, children: h(Toaster) }));
	assert.equal(stackLeft(), "0px");
});
