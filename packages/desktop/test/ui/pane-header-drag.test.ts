/**
 * Under a header bar, a pane's title bar does not move the window.
 *
 * On Windows the window has a strip of its own across the top, and the panes' title bars sit below it,
 * mid-window. As `-webkit-app-region: drag` they were the window's title bar as far as Windows was
 * concerned: on a real Windows 11 machine a right-click on the 子 Agent pane's bar opened the system menu
 * (还原, 移动, 大小, 最小化, 最大化, 关闭) over the pane, and a double-click maximised the window.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createElement as h } from "react";
import { PaneHeader } from "../../src/features/dock/PaneHeader.tsx";
import { mount, type Mounted } from "../helpers/mount.ts";

let view: Mounted | undefined;
afterEach(async () => {
	await view?.unmount();
	view = undefined;
});

const header = (movesWindow?: boolean) =>
	h(PaneHeader, { kind: "terminal", label: "终端", maximized: false, draggable: false, carried: false, onDragStart() {}, onMove() {}, onArrowMove: () => false, onClose() {}, ...(movesWindow === undefined ? {} : { movesWindow }) });

test("a pane's bar moves the window by default — the macOS case, where it is the window's top row", async () => {
	view = await mount(header());
	assert.ok(view.find("[data-dock-header]").classList.contains("drag-region"));
});

test("told it does not, the bar is no drag region, and its controls are still there", async () => {
	view = await mount(header(false));
	const bar = view.find("[data-dock-header]");
	assert.ok(!bar.classList.contains("drag-region"), bar.className);
	assert.ok(view.all("button").length > 0, "the close button is still drawn");
});

test("the dock and the split screens both take the answer from the header bar", () => {
	const source = (path: string) => readFileSync(join(import.meta.dirname, "../../src/features", path), "utf8");
	assert.match(source("dock/DockPane.tsx"), /movesWindow=\{!headerBar\}/);
	assert.match(source("split/SplitChrome.tsx"), /headerBar \? "" : "drag-region "/);
});
