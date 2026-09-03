/**
 * The controls every settings page is built out of.
 *
 * They live under `components/settings/` today and are already imported from outside it, which is
 * why the plan moves them to `ui/`. These tests are what makes that move safe: they describe the
 * behaviour callers depend on, and they will run unchanged from the new location.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { Badge, Segmented, Toggle } from "../../src/components/settings/controls.tsx";
import { click, mount } from "../helpers/mount.ts";

test("Toggle: 是 switch 角色，状态走 aria-checked 而不是靠颜色", async () => {
	const view = await mount(h(Toggle, { checked: false, onChange: () => {} }));
	const button = view.find("button");

	// 读屏软件只读得到 role 和 aria-checked；轨道的颜色对它不存在。
	assert.equal(button.getAttribute("role"), "switch");
	assert.equal(button.getAttribute("aria-checked"), "false");
	assert.equal(button.getAttribute("type"), "button");

	await view.rerender(h(Toggle, { checked: true, onChange: () => {} }));
	assert.equal(view.find("button").getAttribute("aria-checked"), "true");

	await view.unmount();
});

test("Toggle: 点击把当前值取反送出，自己不持有状态", async () => {
	const seen: boolean[] = [];
	const view = await mount(h(Toggle, { checked: false, onChange: (next: boolean) => seen.push(next) }));
	await click(view.find("button"));
	assert.deepEqual(seen, [true]);

	// 受控组件：没有人改 props，再点一次送出的仍然是 !checked。
	await click(view.find("button"));
	assert.deepEqual(seen, [true, true]);

	await view.unmount();
});

test("Segmented: 每个选项一个按钮，点击送出该选项的值", async () => {
	const options = [
		{ value: "system", label: "跟随系统" },
		{ value: "light", label: "浅色" },
		{ value: "dark", label: "深色" },
	];
	let picked: string | null = null;
	const view = await mount(h(Segmented, { value: "system", options, onChange: (v: string) => (picked = v) }));

	const buttons = view.all<HTMLButtonElement>("button");
	assert.equal(buttons.length, 3);
	assert.deepEqual(
		buttons.map((b) => b.textContent),
		["跟随系统", "浅色", "深色"],
	);

	await click(buttons[2]!);
	assert.equal(picked, "dark");

	await view.unmount();
});

test("Segmented: 选中项与其余在类名上可区分，这是它唯一的状态提示", async () => {
	const options = [
		{ value: "a", label: "甲" },
		{ value: "b", label: "乙" },
	];
	const view = await mount(h(Segmented, { value: "b", options, onChange: () => {} }));
	const [first, second] = view.all<HTMLButtonElement>("button");

	assert.notEqual(first!.className, second!.className, "选中与未选中必须画得不一样");
	assert.match(second!.className, /bg-elevated/, "选中项有实底");

	await view.unmount();
});

test("Badge: 四种语气各自成立，内容原样渲染", async () => {
	for (const tone of ["ok", "muted", "danger", "accent"] as const) {
		// children 是必填的，所以第三个参数不能省——这一条是 tsc 在纳入 test/ui 之后立刻抓到的。
		const view = await mount(h(Badge, { tone, children: "已安装" }));
		assert.equal(view.text(), "已安装");
		await view.unmount();
	}
});
