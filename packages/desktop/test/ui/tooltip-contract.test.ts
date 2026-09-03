/**
 * The tooltip's two halves, tested together rather than apart.
 *
 * `Tooltip.tsx` writes an attribute; `tooltip.ts` reads it with a document-level listener. Nothing
 * in the type system connects the two — one writes the string `data-ly-tip`, the other reads
 * `dataset.lyTip`, and those match only because of the DOM's dash-case-to-camelCase rule.
 *
 * That gap has already cost once. AGENTS.md records it: the attribute was renamed on one side while
 * the reader kept looking for `dataset.dwTip`, and every tooltip in the application silently stopped
 * appearing. Type-checking was clean, the component rendered, nothing failed — the bubble just never
 * came up.
 *
 * So these tests deliberately do not assert "the component sets data-ly-tip". They assert that what
 * the component writes is findable by the selector the listener actually uses, which is the only
 * shape of assertion that would have caught it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { Tooltip } from "../../src/components/Tooltip.tsx";
import { mount } from "../helpers/mount.ts";

/*
 * The selector and the property, copied from `tooltip.ts` as literals.
 *
 * Importing them would defeat the purpose: if that file renames its property, this test has to fail
 * rather than rename along with it. These three strings are the contract, written down.
 */
const LISTENER_SELECTOR = "[data-ly-tip]";
const LISTENER_PROPERTY = "lyTip";
const LISTENER_SIDE_PROPERTY = "lyTipSide";

test("Tooltip: 包裹的元素能被 tooltip.ts 的选择器找到", async () => {
	const view = await mount(h(Tooltip, { label: "下一个", children: h("button", { type: "button" }, "→") }));

	const found = view.host.querySelector<HTMLElement>(LISTENER_SELECTOR);
	assert.ok(found, `监听器用 ${LISTENER_SELECTOR} 找目标，包裹之后必须能找到`);
	assert.equal(found.tagName, "BUTTON", "属性应该落在子元素上，而不是多包一层");

	await view.unmount();
});

test("Tooltip: 监听器读的那个 dataset 键拿得到文案", async () => {
	const view = await mount(h(Tooltip, { label: "复制到剪贴板", children: h("button", { type: "button" }) }));
	const el = view.find<HTMLElement>(LISTENER_SELECTOR);

	// 这一行就是那次事故的形状：写的键和读的键必须是同一个。
	assert.equal(el.dataset[LISTENER_PROPERTY], "复制到剪贴板");

	await view.unmount();
});

test("Tooltip: side 同样按监听器读的键写入，默认 bottom", async () => {
	const top = await mount(h(Tooltip, { label: "撤销", side: "top", children: h("button", { type: "button" }) }));
	assert.equal(top.find<HTMLElement>(LISTENER_SELECTOR).dataset[LISTENER_SIDE_PROPERTY], "top");
	await top.unmount();

	const fallback = await mount(h(Tooltip, { label: "撤销", children: h("button", { type: "button" }) }));
	assert.equal(fallback.find<HTMLElement>(LISTENER_SELECTOR).dataset[LISTENER_SIDE_PROPERTY], "bottom");
	await fallback.unmount();
});

test("Tooltip: 子元素原有的属性与内容不被吞掉", async () => {
	const view = await mount(
		h(Tooltip, {
			label: "运行",
			children: h("button", { type: "button", "aria-label": "运行", disabled: true }, "▶"),
		}),
	);
	const button = view.find<HTMLButtonElement>("button");

	assert.equal(button.getAttribute("aria-label"), "运行");
	assert.equal(button.disabled, true);
	assert.equal(view.text(), "▶");

	await view.unmount();
});

test("IconButton 经 Tooltip 之后仍然带得动提示——两个组件的接缝", async () => {
	// IconButton 内部就是用 Tooltip 包自己的；这条守的是那层包装没有在重构里被拆掉。
	const { IconButton } = await import("../../src/components/IconButton.tsx");
	const view = await mount(h(IconButton, { label: "新建会话", icon: h("svg"), onClick: () => {} }));

	const el = view.host.querySelector<HTMLElement>(LISTENER_SELECTOR);
	assert.ok(el, "启用状态的图标按钮必须挂得上提示");
	assert.equal(el.dataset[LISTENER_PROPERTY], "新建会话");
	// 同一个字符串同时是可访问名，这是 IconButton 注释里写明的设计。
	assert.equal(el.getAttribute("aria-label"), "新建会话");

	await view.unmount();
});
