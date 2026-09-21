/**
 * 那张月历，画出来之后是什么样。
 *
 * `day-range.test.ts` 问的是算术；这里问的是画出来的结果：选中的那一段在屏幕上是不是一条、比最早
 * 记录还早的日子能不能点、以及面板关掉之后还在不在 DOM 里。这几件事算术答不了——它们全都发生在
 * 「函数返回了正确的值」之后。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement as h } from "react";
import { DateRangeField, rangeLabel } from "../../src/ui/inputs/DateRangeField.tsx";
import type { DayRange } from "../../src/ui/inputs/day-range.ts";
import { I18nProvider } from "../../src/i18n/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const TODAY = new Date(2026, 8, 21);

async function open(value: DayRange, earliest: string | null = "2026-08-11"): Promise<{ view: Mounted; picked: DayRange[] }> {
	const picked: DayRange[] = [];
	const view = await mount(
		h(I18nProvider, {
			locale: "zh-CN",
			children: h(DateRangeField, { value, onChange: (next: DayRange) => picked.push(next), earliest, today: TODAY, ariaLabel: "时间范围" }),
		}),
	);
	await click(view.find("[data-ly-date-range]"));
	return { view, picked };
}

/*
 * 面板在 `document.body` 上，不在挂载点里面。
 *
 * `Popover` 走 portal——每个会浮起来的东西都这样，理由写在 `portal.ts` 里（`backdrop-filter` 要
 * 对着真正在它后面的东西取样）。所以 `view.find` 在这里永远找不到日期格：它只看自己那棵子树。
 */
function inPanel<T extends Element = HTMLElement>(selector: string): T {
	const found = document.body.querySelector<T>(selector);
	if (!found) throw new Error(`面板里没有 ${selector}`);
	return found;
}

const day = (key: string) => inPanel<HTMLButtonElement>(`[data-ly-day="${key}"]`);

describe("rangeLabel", () => {
	it("两头都空是「全部时间」，不是一段空的日子", () => {
		assert.equal(rangeLabel({ from: null, to: null }), "全部时间");
	});

	it("一段日子读作从哪天到哪天", () => {
		assert.equal(rangeLabel({ from: "2026-08-01", to: "2026-09-21" }), "2026/8/1 – 2026/9/21");
	});

	it("只有一天就说那一天，不写成「9/5 – 9/5」", () => {
		assert.equal(rangeLabel({ from: "2026-09-05", to: "2026-09-05" }), "2026/9/5");
	});

	it("只选了一头的时候说清是哪一头", () => {
		assert.equal(rangeLabel({ from: "2026-09-05", to: null }), "2026/9/5 起");
		assert.equal(rangeLabel({ from: null, to: "2026-09-05" }), "2026/9/5 止");
	});
});

describe("月历", () => {
	it("点一下开，再点一下关——关掉之后不该留在 DOM 里", async () => {
		const { view } = await open({ from: null, to: null });
		try {
			assert.ok(document.body.querySelector("[data-ly-day]"), "打开之后有日期格");
			await click(view.find("[data-ly-date-range]"));
			// Popover 的退场要 120ms，所以这里只要求它开始退场——不是立刻消失。
			assert.equal(view.find("[data-ly-date-range]").getAttribute("aria-expanded"), "false");
		} finally {
			await view.unmount();
		}
	});

	it("比最早记录还早的日子点不动——那儿本来就没有东西可删", async () => {
		// 面板开在当月，所以这条要用一个落在九月视图里的下限；八月那些格子要翻页才看得到。
		const { view } = await open({ from: null, to: null }, "2026-09-05");
		try {
			assert.equal(day("2026-09-04").disabled, true);
			assert.equal(day("2026-09-05").disabled, false);
			assert.equal(day("2026-08-31").disabled, true, "补在月初的上个月那几格也一样受下限管");
		} finally {
			await view.unmount();
		}
	});

	it("以后的日子点不动", async () => {
		const { view } = await open({ from: null, to: null });
		try {
			assert.equal(day("2026-09-22").disabled, true);
			assert.equal(day("2026-09-21").disabled, false);
		} finally {
			await view.unmount();
		}
	});

	it("选中的一段在屏幕上是一条：两端标出来，中间连起来", async () => {
		const { view } = await open({ from: "2026-09-01", to: "2026-09-05" });
		try {
			assert.equal(day("2026-09-01").dataset.selected, "true");
			assert.equal(day("2026-09-05").dataset.selected, "true");
			assert.equal(day("2026-09-03").dataset.selected, undefined, "中间那些不是端点");
			// 中间铺的是一层连续的底，左右不留缝——留了缝就成了一串珠子。
			assert.match(day("2026-09-03").className, /bg-accent\/10/);
			assert.doesNotMatch(day("2026-09-03").className, /rounded-l-full|rounded-r-full/);
		} finally {
			await view.unmount();
		}
	});

	it("点一天报的是新的那一段，不是那一天", async () => {
		const { picked, view } = await open({ from: null, to: null });
		try {
			await click(day("2026-09-05"));
			assert.deepEqual(picked, [{ from: "2026-09-05", to: null }]);
		} finally {
			await view.unmount();
		}
	});

	it("「全部时间」这个快捷项报的是两头都空", async () => {
		const { picked, view } = await open({ from: "2026-09-01", to: "2026-09-05" });
		try {
			await click(inPanel('[data-ly-range-shortcut="全部时间"]'));
			assert.deepEqual(picked, [{ from: null, to: null }]);
		} finally {
			await view.unmount();
		}
	});

	it("「30 天前」从最早那天数到三十天前，而不是最近三十天", async () => {
		// 这一组的用处是清掉旧东西。读成「最近三十天」会把刚干完的活删掉。
		const { picked, view } = await open({ from: null, to: null });
		try {
			await click(inPanel('[data-ly-range-shortcut="30 天前"]'));
			assert.deepEqual(picked, [{ from: "2026-08-11", to: "2026-08-22" }]);
		} finally {
			await view.unmount();
		}
	});

	it("没有会话记录时，「30 天前」的开头是空的——不设下限", async () => {
		const { picked, view } = await open({ from: null, to: null }, null);
		try {
			await click(inPanel('[data-ly-range-shortcut="30 天前"]'));
			assert.deepEqual(picked, [{ from: null, to: "2026-08-22" }]);
		} finally {
			await view.unmount();
		}
	});
});
