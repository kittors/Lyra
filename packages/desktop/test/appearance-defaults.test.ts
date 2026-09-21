/**
 * That the settings page's idea of "default" is the real one.
 *
 * 恢复默认 restates the appearance defaults instead of importing them, because importing a value
 * from `@lyra/core` into the renderer pulls the whole package — native modules and all — into
 * that bundle, and the build refuses. The copy is safe only while something checks it, which is
 * this: a default changed in core and not here would leave the button putting back numbers that
 * stopped being the defaults, silently and only for the people who pressed it.
 *
 * 而这不是一个假想的风险，是已经发生过的事。整页那份复本此前写在组件里，测试够不着（导进来会把
 * React 一起拖进来），于是 `theme` 在 core 改成 `system` 之后，那边还停在 `dark` 没人发现：按一下
 * 「恢复默认」，一台跟着系统走的浅色机器被按成深色，而外观页上三张卡片里亮着的也是深色——看上去
 * 就像这个应用根本没有「跟随系统」这一档。所以它搬进了 `appearance-defaults.ts`，并且现在是逐字段
 * 比的。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE } from "@lyra/core";
import { CODE_DEFAULTS, FACTORY_APPEARANCE } from "../src/features/settings/appearance-defaults.ts";

test("恢复默认 restores what the app actually defaults to", () => {
	for (const [key, value] of Object.entries(CODE_DEFAULTS)) {
		assert.equal(
			value,
			DEFAULT_APPEARANCE[key as keyof typeof DEFAULT_APPEARANCE],
			`${key} 和 core 里的默认值对不上——按下「恢复默认」会得到一个早就不是默认的值`,
		);
	}
});

test("it covers every code-appearance key, so nothing is left at whatever it was", () => {
	const covered = Object.keys(CODE_DEFAULTS);
	for (const key of Object.keys(DEFAULT_APPEARANCE)) {
		// 代码外观那一节现在还管着行内代码，它的字段以 `inlineCode` 打头而不是 `code`。
		if (!key.startsWith("code") && !key.startsWith("inlineCode")) continue;
		assert.ok(covered.includes(key), `${key} 是代码外观的设置，却不在「恢复默认」的范围里`);
	}
});

test("整页的恢复默认，就是出厂时那一套——一个字段都不差", () => {
	/*
	 * `deepEqual` 而不是逐键遍历，因为这里要抓的有两种走样，方向相反：
	 *
	 *   值对不上   `theme` 停在 `dark` 的那次，就是这一种
	 *   字段缺失   复本里没有的字段，`patch({ ...FACTORY_APPEARANCE })` 展开之后原样留在设置里。
	 *              按下按钮的人以为自己清空了一切，而代码字重、行高、字距、错误详略全都还在原处
	 *
	 * 反过来多出字段也会被这条抓住，那同样是错的：复本里有而 core 里没有的键会被写进 settings.json。
	 */
	assert.deepEqual(FACTORY_APPEARANCE, DEFAULT_APPEARANCE);
});

test("没选过主题的人，恢复默认之后还是没选过主题", () => {
	// 这一条是上面那个 deepEqual 的子集，单独写出来是因为它是那次走样的具体形状，也是这颗按钮
	// 最容易被改错的一项：把「跟随系统」写成一个具体的主题，在写的人那台机器上看不出任何问题。
	assert.equal(FACTORY_APPEARANCE.theme, "system");
});
