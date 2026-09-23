/**
 * 浮层压在窗口顶上那条拖拽带上时，按下去的是浮层，不是窗口。
 *
 * Windows/Linux 那条 32px 的 header 整条是 `drag-region`，macOS 面板的标题栏也是；Electron 按几何
 * 合成拖拽区：凡是 `drag` 的矩形都交给窗口管理器，除非上面叠着一个 `no-drag` 的矩形。浮层最高
 * 贴到 y=12，自己又没说 `no-drag`，于是落在带子上的那几行菜单项画出来了、在最上层、页面里的
 * 命中测试也都过——按下去却是在拖窗口。
 *
 * 这里量不到合成结果（happy-dom 不加载样式、也没有窗口管理器），只能钉住两件事：浮层的根带着
 * 那个类，而那个类确实写的是 `-webkit-app-region: no-drag`。真窗口里的效果要另外量。
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement as h } from "react";

import { Popover } from "../../src/ui/overlay/Popover.tsx";
import { mount } from "../helpers/mount.ts";

test("浮层的根在拖拽带上挖一个洞", async () => {
	const trigger = document.createElement("button");
	document.body.append(trigger);
	const view = await mount(h(Popover, { anchor: trigger, onClose: () => {}, children: "置顶" }));
	try {
		// Portalled to the body, so looked up there rather than in the mount point.
		const root = document.querySelector("[data-ly-popover]");
		assert.ok(root, "浮层没画出来");
		assert.ok(root.classList.contains("no-drag"), `浮层根上的类：${root.className}`);
	} finally {
		await view.unmount();
		trigger.remove();
	}
});

test("那个类写的就是 no-drag", async () => {
	const css = await readFile(new URL("../../src/styles/base.css", import.meta.url), "utf8");
	assert.match(css, /@utility no-drag \{\s*-webkit-app-region: no-drag;\s*\}/);
});
