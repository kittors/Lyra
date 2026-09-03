/**
 * `IconButton`, whose contract is mostly about what it does for a reader who cannot see the icon.
 *
 * These assertions exist because the component's own comment states them as decisions: the label is
 * both the tooltip and the accessible name so that a caller cannot ship one without the other. A
 * refactor that moves this file into `ui/primitives/` has to keep every one of them true.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { IconButton } from "../../src/ui/primitives/IconButton.tsx";
import { click, mount } from "../helpers/mount.ts";

const ICON = h("svg", { "data-icon": "true" });

test("IconButton: label 成为 aria-label，图标本身不承担可访问名", async () => {
	const view = await mount(h(IconButton, { label: "复制", icon: ICON, onClick: () => {} }));
	const button = view.find<HTMLButtonElement>("button");

	assert.equal(button.getAttribute("aria-label"), "复制");
	// type 必须显式是 button：表单里缺省的 submit 会提交表单，而不是执行 onClick。
	assert.equal(button.getAttribute("type"), "button");
	assert.ok(view.find("[data-icon]"), "图标应该被渲染出来");

	await view.unmount();
});

test("IconButton: 点击调用 onClick；禁用时不调用", async () => {
	let clicks = 0;
	const view = await mount(h(IconButton, { label: "运行", icon: ICON, onClick: () => clicks++ }));
	await click(view.find("button"));
	assert.equal(clicks, 1);
	await view.unmount();

	const disabled = await mount(h(IconButton, { label: "运行", icon: ICON, disabled: true, onClick: () => clicks++ }));
	const button = disabled.find<HTMLButtonElement>("button");
	assert.equal(button.disabled, true);
	await click(button);
	assert.equal(clicks, 1, "禁用的按钮不应该触发 onClick");
	await disabled.unmount();
});

test("IconButton: active 反映为 aria-pressed，这是切换类按钮的状态", async () => {
	const on = await mount(h(IconButton, { label: "区分大小写", icon: ICON, active: true, onClick: () => {} }));
	assert.equal(on.find("button").getAttribute("aria-pressed"), "true");
	await on.unmount();

	const off = await mount(h(IconButton, { label: "区分大小写", icon: ICON, active: false, onClick: () => {} }));
	assert.equal(off.find("button").getAttribute("aria-pressed"), "false");
	await off.unmount();
});

test("IconButton: badge 为 0 或 null 时不画，正数才画", async () => {
	for (const badge of [0, null, undefined]) {
		const view = await mount(h(IconButton, { label: "更改", icon: ICON, badge, onClick: () => {} }));
		assert.equal(view.find("button").hasAttribute("data-ly-count"), false, `badge=${badge} 不应该有计数`);
		await view.unmount();
	}

	const view = await mount(h(IconButton, { label: "更改", icon: ICON, badge: 3, onClick: () => {} }));
	// 计数同时是可读的属性和画出来的文字：前者给不知道它怎么画的读者，后者给看得见的人。
	assert.equal(view.find("button").getAttribute("data-ly-count"), "3");
	assert.match(view.text(), /3/);
	await view.unmount();
});
