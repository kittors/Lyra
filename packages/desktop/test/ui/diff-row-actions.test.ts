/**
 * 文件行的右端：同一时间只站一样东西，而且贴着右边缘。
 *
 * 从前那两颗动作按钮平时是透明的，**位置却一直占着**——于是 `+3 −76` 被往左顶，行的右边永远
 * 空出一条用不上的空白；指到那一行，数字和按钮又并排挤在一起。透明不等于不占地方。
 *
 * 这个文件钉三件事，都是从 DOM 上量的，不是读组件的 props：
 *
 * 一、按钮脱离了布局流（`absolute`），所以不占位；
 * 二、按钮和数字的右边缘对齐到同一条线；
 * 三、看不见的时候点不到（`pointer-events-none`）——盖在数字上的透明层如果能接点击，行就点不开了。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { FileDiffList } from "../../src/features/git/FileDiffList.tsx";
import { FileDiffTree } from "../../src/features/git/FileDiffTree.tsx";
import type { WorkspaceDiffFile } from "../../electron/ipc-shapes.ts";
import { mount } from "../helpers/mount.ts";

const files: WorkspaceDiffFile[] = [
	{ path: "packages/desktop/src/i18n/messages/en.ts", status: "modified", added: 3, removed: 0, binary: false, hunks: [] },
	{ path: "packages/desktop/src/features/git/GitPanel.tsx", status: "modified", added: 39, removed: 76, binary: false, hunks: [] },
];

/** 两个视图画的是同一件事，所以两边各跑一遍同样的断言。 */
const views = [
	{ name: "列表", render: (actions: () => React.ReactNode) => h(FileDiffList, { files, actions }) },
	{ name: "树", render: (actions: () => React.ReactNode) => h(FileDiffTree, { files, actions }) },
];

for (const view of views) {
	test(`${view.name}视图：动作按钮不占位，数字才能顶到最右`, async () => {
		const mounted = await mount(view.render(() => h("button", { type: "button", "data-test-action": "" }, "↺")));
		try {
			const holder = mounted.find("[data-test-action]").parentElement;
			assert.ok(holder, "动作按钮外面该有一层容器");
			const classes = holder.className;
			/*
			 * `absolute` 是这条需求的全部技术内容：它把按钮从行的 flex 流里拿出来，数字于是能
			 * 一直伸到 `pr-1` 的边上。少了它，下面两条断言都还会过，而屏幕上那条空白还在。
			 */
			assert.ok(classes.includes("absolute"), `按钮仍在布局流里，会把数字往左顶：${classes}`);
			assert.ok(classes.includes("right-1"), "按钮要贴在行的右内边距上");
			assert.ok(classes.includes("pointer-events-none"), "透明时不能接住点击");
			assert.ok(/group-(hover|focus-within)\/[a-z-]+:pointer-events-auto/.test(classes), "指上去才恢复可点");
		} finally { await mounted.unmount(); }
	});

	test(`${view.name}视图：数字让位，两者错开而不是同时淡`, async () => {
		const mounted = await mount(view.render(() => h("button", { type: "button", "data-test-action": "" }, "↺")));
		try {
			const counts = mounted.all(".tabular-nums").find((el) => (el.textContent ?? "").includes("+3"));
			assert.ok(counts, "没找到那一行的增删数字");
			const numbers = counts.className;
			const holder = mounted.find("[data-test-action]").parentElement!;

			// 指针进来：数字立刻走（delay-0），按钮等 90ms。
			assert.ok(/group-hover\/[a-z-]+:opacity-0/.test(numbers), "指上去数字要让位");
			assert.ok(/group-hover\/[a-z-]+:delay-0/.test(numbers), "让位的那个不等人");
			assert.ok(/group-hover\/[a-z-]+:delay-\[90ms\]/.test(holder.className), "来的那个要等让位的走完");
			// 指针离开：反过来——按钮立刻走，数字等 90ms。
			assert.ok(numbers.includes("delay-[90ms]"), "数字回来时要等按钮先走");
			assert.ok(holder.className.includes("delay-0"), "按钮离开时不等人");
		} finally { await mounted.unmount(); }
	});

	test(`${view.name}视图：没有动作时，数字照样贴右边`, async () => {
		// 历史视图不传 `actions`。那时不该留下任何占位的空壳。
		const mounted = await mount(
			view.name === "列表" ? h(FileDiffList, { files }) : h(FileDiffTree, { files }),
		);
		try {
			assert.equal(mounted.all("[data-test-action]").length, 0);
			const counts = mounted.all(".tabular-nums").find((el) => (el.textContent ?? "").includes("+3"));
			assert.ok(counts, "数字还在");
		} finally { await mounted.unmount(); }
	});
}
