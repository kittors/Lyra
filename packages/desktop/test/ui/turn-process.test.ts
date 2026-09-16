/**
 * 收起的一轮过程，里面的东西到底在不在 DOM 里。
 *
 * 这一行是转录里最贵的一行：一轮四百次工具调用收成一句「调用工具 400 个」，看上去什么都没有，而在
 * 这个改动之前那四百个 Run 的 DOM 节点一个不少地压在文档里——只是高度被压成了 0。量不出来是因为
 * 它们不可见，不是因为它们不存在。
 *
 * 这笔成本不是孤立的，它锁死了转录的分页：窗口只能按 Run 算（那是唯一控得住渲染量的闸门），而画出来
 * 的单位是 turn，两者对不上的后果就是点「显示更早的 60 条」时界面一动不动。所以这几条断言盯的不是
 * 「好看」，是那把锁有没有真的开。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { TurnProcess } from "../../src/features/conversation/TurnProcess.tsx";
import { click, mount } from "../helpers/mount.ts";

const COUNTS = { tools: 400, thinking: 1 };
const inside = h("div", { "data-probe": "inside" }, "四百条过程");

test("a collapsed turn does not render what is inside it", async () => {
	const view = await mount(h(TurnProcess, { counts: COUNTS, running: false, children: inside }));
	try {
		assert.equal(view.all("[data-probe]").length, 0, "收起的一轮不该把里面的东西留在 DOM 里");
		// 但那一行本身要在，而且要说清楚里面是什么——否则就只是把东西藏起来。
		assert.ok(view.find("[data-ly-turn-process]"), "行本身要在");
		assert.match(view.text(), /400/, "收起时得说清楚里面有多少");
	} finally {
		await view.unmount();
	}
});

test("opening it renders the contents, closing it takes them back out", async () => {
	const view = await mount(h(TurnProcess, { counts: COUNTS, running: false, children: inside }));
	try {
		const toggle = view.find<HTMLButtonElement>("button[aria-expanded]");

		await click(toggle);
		assert.equal(view.all("[data-probe]").length, 1, "展开之后里面的东西要真的画出来");
		assert.equal(toggle.getAttribute("aria-expanded"), "true");

		await click(toggle);
		assert.equal(view.all("[data-probe]").length, 0, "收回去之后又不该留在 DOM 里");
		assert.equal(toggle.getAttribute("aria-expanded"), "false");
	} finally {
		await view.unmount();
	}
});

test("the turn that is still running is rendered whether or not anyone opened it", async () => {
	/*
	 * 正在跑的那一轮全程摊开——那时候人就是在看着它。
	 *
	 * 这一条是上面那条的反面，缺了它，「收起即不渲染」很容易被写成「只要没点开就不渲染」，而那会让
	 * 正在跑的一轮变成一片空白。
	 */
	const view = await mount(h(TurnProcess, { counts: COUNTS, running: true, children: inside }));
	try {
		assert.equal(view.all("[data-probe]").length, 1, "正在跑的一轮必须看得见");
		assert.equal(view.all("button[aria-expanded]").length, 0, "跑的时候不画那个开关——此刻它什么也不做");
	} finally {
		await view.unmount();
	}
});

test("a collapsed body stays out of the tab order and out of the accessibility tree", async () => {
	// 不渲染已经足够挡住键盘和读屏了，但这两个属性是契约的一部分：展开动画还要靠外层这个盒子。
	const view = await mount(h(TurnProcess, { counts: COUNTS, running: false, children: inside }));
	try {
		const box = view.find(".ly-freeze");
		assert.ok(box.hasAttribute("inert"));
		assert.equal(box.getAttribute("aria-hidden"), "true");
		assert.equal(box.style.height, "0px", "收起时高度是 0，展开的过渡要从这里起步");
	} finally {
		await view.unmount();
	}
});
