/**
 * `Text`, which is the only way a size gets onto the screen.
 *
 * The stylesheet's comment records why. Sizes used to be written at the call site — nineteen of
 * them, six crowded into the 2.5px between 11 and 13.5, differences nobody could see, so they read
 * as inconsistency rather than hierarchy. And 「界面字号」 in Settings did almost nothing, because
 * 351 absolute `text-[Npx]` overrode it everywhere that mattered.
 *
 * Every size now resolves to one of seven steps, each `calc()` off `--ly-ui-size`. These assertions
 * are about that funnel staying intact.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { Text } from "../../src/components/Text.tsx";
import { mount } from "../helpers/mount.ts";

test("Text: 七级字阶各自映射到自己的类，且没有绝对像素", async () => {
	const steps = ["caption", "detail", "label", "body", "title", "heading", "display"] as const;
	const seen = new Set<string>();

	for (const size of steps) {
		const view = await mount(h(Text, { size }, "字"));
		const cls = view.find("span").className;
		assert.match(cls, new RegExp(`\\btext-${size}\\b`), `${size} 应该用 text-${size}`);
		assert.doesNotMatch(cls, /text-\[\d/, "不允许出现绝对像素的字号");
		seen.add(cls);
		await view.unmount();
	}

	assert.equal(seen.size, steps.length, "七级必须两两不同，否则层级不成立");
});

test("Text: 每一级自带默认字重，可以被 weight 覆盖", async () => {
	const auto = await mount(h(Text, { size: "heading" }, "标题"));
	const autoClass = auto.find("span").className;
	await auto.unmount();

	const forced = await mount(h(Text, { size: "heading", weight: "normal" }, "标题"));
	const forcedClass = forced.find("span").className;
	await forced.unmount();

	// 字重与字号是配好的一对；显式传 weight 要能改掉它。
	assert.notEqual(autoClass, forcedClass, "weight 必须能覆盖这一级的默认字重");
});

test("Text: as 决定渲染成什么元素，默认 span 以便嵌在句子里", async () => {
	const span = await mount(h(Text, {}, "行内"));
	assert.equal(span.find("span").tagName, "SPAN");
	await span.unmount();

	for (const as of ["p", "div", "h1", "h2", "h3", "label", "code"] as const) {
		const view = await mount(h(Text, { as }, "文"));
		assert.equal(view.find(as).tagName, as.toUpperCase(), `as="${as}" 应该渲染 <${as}>`);
		await view.unmount();
	}
});

test("Text: mono 与 numeric 是两件独立的事，可以同时开", async () => {
	const both = await mount(h(Text, { mono: true, numeric: true }, "12.5k"));
	const cls = both.find("span").className;

	assert.match(cls, /font-mono/);
	// tabular-nums 是给会原地跳动的数字用的：token 计数、计时器、diff 统计。
	assert.match(cls, /tabular-nums/);

	await both.unmount();
});

test("Text: 透传 className 与其余 HTML 属性", async () => {
	const view = await mount(h(Text, { className: "shrink-0", id: "usage", title: "已用" }, "9k"));
	const el = view.find("span");

	assert.match(el.className, /shrink-0/, "调用方给的 class 不能被吞掉");
	assert.equal(el.id, "usage");
	assert.equal(el.getAttribute("title"), "已用");
	assert.equal(view.text(), "9k");

	await view.unmount();
});
