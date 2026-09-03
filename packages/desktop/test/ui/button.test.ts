/**
 * `Button`, which exists because there were 276 hand-written ones and eight heights among them.
 *
 * The assertions worth having are the ones about what a caller *cannot* do: invent a ninth height,
 * ship an icon-only button with no accessible name, or leave a busy button pressable. Those are the
 * reasons this component exists rather than a convention.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { Button } from "../../src/ui/primitives/Button.tsx";
import { click, mount } from "../helpers/mount.ts";

test("Button: 四种变体各自可区分，且都带 data-variant", async () => {
	const seen = new Set<string>();
	for (const variant of ["primary", "ghost", "subtle", "danger"] as const) {
		const view = await mount(h(Button, { variant, children: "按" }));
		const button = view.find<HTMLButtonElement>("button");
		assert.equal(button.dataset.variant, variant);
		seen.add(button.className);
		await view.unmount();
	}
	assert.equal(seen.size, 4, "四种变体必须画得不一样，否则它们不是变体");
});

test("Button: 只有两种高度，两种都写死在组件里", async () => {
	const md = await mount(h(Button, { size: "md", children: "确定" }));
	assert.match(md.find("button").className, /h-\[32px\]/);
	await md.unmount();

	const sm = await mount(h(Button, { size: "sm", children: "确定" }));
	assert.match(sm.find("button").className, /h-\[26px\]/);
	await sm.unmount();

	// 默认是 md：对话框脚下那一排是它，两个旧组件也是在这个高度上会合的。
	const fallback = await mount(h(Button, { children: "确定" }));
	assert.match(fallback.find("button").className, /h-\[32px\]/);
	await fallback.unmount();
});

test("Button: 没有文字时变成方的，并且用 label 作可访问名", async () => {
	const view = await mount(h(Button, { icon: h("svg"), label: "刷新" }));
	const button = view.find<HTMLButtonElement>("button");

	assert.match(button.className, /w-\[32px\]/, "图标按钮是方的，一排下来才等宽");
	// 看不见文字的按钮，读屏软件要能读到它是什么。
	assert.equal(button.getAttribute("aria-label"), "刷新");
	assert.equal(button.dataset.lyTip, "刷新", "同一个字符串也是提示");

	await view.unmount();
});

test("Button: 有文字时不设 aria-label——文字本身就是名字", async () => {
	const view = await mount(h(Button, { label: "保存设置", children: "保存" }));
	const button = view.find<HTMLButtonElement>("button");

	assert.equal(button.getAttribute("aria-label"), null, "重复的可访问名会被读两遍");
	assert.equal(button.dataset.lyTip, "保存设置", "提示仍然可以补充说明");

	await view.unmount();
});

test("Button: loading 时不可点，且宽度不变", async () => {
	let clicks = 0;
	const idle = await mount(h(Button, { onClick: () => clicks++, children: "推送" }));
	const width = idle.find<HTMLButtonElement>("button").className;
	await click(idle.find("button"));
	assert.equal(clicks, 1);
	await idle.unmount();

	const busy = await mount(h(Button, { onClick: () => clicks++, loading: true, children: "推送" }));
	const button = busy.find<HTMLButtonElement>("button");

	assert.equal(button.disabled, true, "跑着的时候再点一次就是发两次请求");
	assert.equal(button.getAttribute("aria-busy"), "true");
	await click(button);
	assert.equal(clicks, 1, "loading 时点击不该穿透");

	// 文字没有被换成 spinner，所以行不会跳。
	assert.equal(busy.text(), "推送");
	assert.equal(
		button.className.replace(/\bopacity-60\b/, "").trim().split(/\s+/).sort().join(" "),
		width.split(/\s+/).sort().join(" "),
		"忙碌只该改透明度，不该改尺寸——按钮在你看着它的时候缩一下，回头就找不着了",
	);

	await busy.unmount();
});

test("Button: type 默认是 button，表单里不会误提交", async () => {
	const view = await mount(h(Button, { children: "取消" }));
	assert.equal(view.find<HTMLButtonElement>("button").type, "button");
	await view.unmount();

	const submit = await mount(h(Button, { type: "submit", children: "提交" }));
	assert.equal(submit.find<HTMLButtonElement>("button").type, "submit");
	await submit.unmount();
});

test("Button: disabled 与 loading 是两回事", async () => {
	const off = await mount(h(Button, { disabled: true, children: "不可用" }));
	assert.equal(off.find<HTMLButtonElement>("button").getAttribute("aria-busy"), null, "禁用不是忙碌");
	await off.unmount();
});
