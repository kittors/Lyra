/**
 * The stylesheet actually arrived, and the design tokens actually resolve.
 *
 * This exists because it did not, and nothing said so. A `stylelint --fix` rewrote
 * `@import "tailwindcss"` into `@import url("tailwindcss")` — valid CSS, and a form Tailwind's own
 * parser does not recognise, so it emitted no utilities at all. Every layout in the application
 * collapsed into a single unstyled column.
 *
 * What makes that worth a test is how *quiet* it was. The build succeeded. Type-checking passed.
 * All 2105 unit tests passed. The 30 end-to-end tests passed — they click buttons and read text,
 * and unstyled buttons still click. The only thing that noticed was looking at it.
 *
 * So: assert the things a broken stylesheet cannot fake. A utility class has to have been
 * generated, a token has to resolve to a value, and the shell has to have a background.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

before(async () => {
	app = await startApp({ port: 9477 });
});

after(async () => {
	await app?.stop();
});

test("Tailwind 的工具类真的生成了", async () => {
	/*
	 * 量的是 `.flex` 有没有变成一条规则，而不是有没有元素带这个 class。
	 * Tailwind 不出工具类的时候，class 属性照样在 DOM 里，只是什么都不做。
	 */
	/*
	 * 递归下去找，因为 Tailwind v4 把工具类放在 `@layer utilities` 里——顶层遍历 `cssRules`
	 * 只看得到那个 layer 本身，看不到里面的规则。第一版就是这么写的，于是它在样式完好的时候
	 * 也报红。
	 */
	const generated = await app.evaluate<number>(`
		(() => {
			const wanted = /^\\.(flex|items-center|px-3|gap-2)$/;
			let found = 0;
			const walk = (rules) => {
				for (const rule of rules) {
					if (rule.selectorText && wanted.test(rule.selectorText)) found++;
					if (rule.cssRules) walk(rule.cssRules);
				}
			};
			for (const sheet of document.styleSheets) {
				try { walk(sheet.cssRules); } catch {}
			}
			return found;
		})()
	`);
	assert.ok(generated >= 3, `只找到 ${generated} 条基础工具类的规则——Tailwind 多半根本没跑`);
});

test("设计 token 解析得出值，不是空字符串", async () => {
	const tokens = await app.evaluate<Record<string, string>>(`
		(() => {
			const root = getComputedStyle(document.documentElement);
			const names = [
				"--color-shell", "--color-ink", "--color-accent",
				"--ly-t-quick", "--ly-t-base", "--ly-t-slow",
				"--ly-e-out", "--text-label",
			];
			return Object.fromEntries(names.map((n) => [n, root.getPropertyValue(n).trim()]));
		})()
	`);

	for (const [name, value] of Object.entries(tokens)) {
		// 空字符串是这个故障最典型的样子：变量没定义，用它的每一处都静默失效。
		assert.notEqual(value, "", `${name} 解析成了空——@theme 没有生效`);
	}

	// 时长要是个真的时间，不是 0 也不是 none：`--ly-t-quick` 归零意味着全应用没有过渡。
	assert.match(tokens["--ly-t-quick"] ?? "", /^[\d.]+m?s$/, "--ly-t-quick 不是一个时长");
});

test("外壳有背景色，不是透明", async () => {
	const painted = await app.evaluate<{ body: string; shell: string | null }>(`
		(() => {
			const shell = document.querySelector(".ly-shell");
			return {
				body: getComputedStyle(document.body).backgroundColor,
				shell: shell ? getComputedStyle(shell).backgroundColor : null,
			};
		})()
	`);

	// 未加样式的页面是透明的白。深色主题下的外壳必须画出来。
	assert.notEqual(painted.body, "rgba(0, 0, 0, 0)", "body 没有背景色——样式表没到");
	assert.notEqual(painted.body, "rgb(255, 255, 255)", "body 是默认白——样式表没到");
});

test("布局是横排的，不是塌成一列", async () => {
	/*
	 * 样式全丢的时候，所有东西会堆成一个单列。侧边栏和主区域并排，是这个应用最基本的形状——
	 * 也是最容易在样式出问题时第一个消失的。
	 */
	const layout = await app.evaluate<{ wide: boolean; sidebarRight: number; mainLeft: number }>(`
		(() => {
			const boxes = [...document.querySelectorAll("div")]
				.map((el) => el.getBoundingClientRect())
				.filter((r) => r.width > 100 && r.height > 300);
			if (boxes.length < 2) return { wide: false, sidebarRight: 0, mainLeft: 0 };
			const sorted = boxes.sort((a, b) => a.left - b.left);
			return {
				wide: true,
				sidebarRight: Math.round(sorted[0].right),
				mainLeft: Math.round(sorted[sorted.length - 1].left),
			};
		})()
	`);

	assert.equal(layout.wide, true, "找不到两个并排的大块——布局塌了");
	assert.ok(layout.mainLeft > 200, `主区域从 x=${layout.mainLeft} 开始，说明它没有被侧边栏推开`);
});
