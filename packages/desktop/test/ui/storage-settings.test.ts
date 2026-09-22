/**
 * 「清除」这一块，以及挡在它前面的那道门。
 *
 * 这里删掉的是聊天记录，没有回收站。所以这几条问的全是「不该发生的没发生」：没点确认之前一条都
 * 不能删、没有记录时按钮按不动、删完之后用量页要重算。它们比「点了之后确实删了」更重要——后者
 * 错了看得见，前者错了要等到用户发现对话没了才知道。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { act, createElement as h } from "react";
import type { ClearRange, ClearResult, StorageUse } from "../../electron/session-cleanup.ts";
import { StorageSettings } from "../../src/features/settings/StorageSettings.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { click, fire, mount, type Mounted } from "../helpers/mount.ts";

const USE: StorageUse = {
	bytes: 264 * 1024 * 1024,
	sessions: 303,
	earliest: "2026-08-11",
	latest: "2026-09-21",
	days: [
		{ day: "2026-08-11", sessions: 100, bytes: 100 * 1024 * 1024 },
		{ day: "2026-09-05", sessions: 3, bytes: 4 * 1024 * 1024 },
		{ day: "2026-09-21", sessions: 200, bytes: 160 * 1024 * 1024 },
	],
};

interface Harness {
	view: Mounted;
	/** 主进程真正收到的每一次删除请求。没点确认就不该有任何一条。 */
	calls: ClearRange[];
	/** 问了几次占用情况。删完要再问一次，否则屏幕上还挂着删之前的数字。 */
	reads: number;
}

async function open(use: StorageUse | null = USE, result: ClearResult = { removed: 12, freed: 4096, skipped: 0 }): Promise<Harness> {
	const harness: Harness = { view: null as unknown as Mounted, calls: [], reads: 0 };
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			usage: {
				storage: async () => {
					harness.reads += 1;
					if (!use) throw new Error("读不到");
					return use;
				},
				clear: async (range: ClearRange) => {
					harness.calls.push(range);
					return result;
				},
			},
		},
	});
	harness.view = await mount(
		h(I18nProvider, { locale: "zh-CN", children: h(StorageSettings) }),
	);
	return harness;
}

/** 浮层都走 portal，落在 body 上，不在挂载点那棵子树里。 */
function inPanel<T extends Element = HTMLElement>(selector: string): T {
	const found = document.body.querySelector<T>(selector);
	if (!found) throw new Error(`面板里没有 ${selector}`);
	return found;
}

/** 确认框走 portal，落在 body 上，不在挂载点那棵子树里。 */
/* 按按钮上写着的字找。这两颗曾经是一个叉一个勾，动词只存在于 aria-label 里——见 `DialogAction`。 */
const confirmButton = (label: string) =>
	[...document.body.querySelectorAll<HTMLButtonElement>("[data-ly-dialog-actions] button")].find(
		(button) => button.textContent === label,
	) ?? null;

/**
 * 按下确认之后，把这件事走完。
 *
 * **那一帧要测试自己送。** `Overlay` 把「已经答应的那件事」挂在退场动画的 `animationend` 上（见
 * 它自己的注释：一个中途被卸载的对话框不能吞掉刚按下的确认），而 happy-dom 不跑 CSS 动画，于是
 * 那一帧永远不来——点下「清除」之后什么都不会发生，看起来像确认按钮没接线。
 *
 * 之后再等一拍，因为删除本身是一次 await。
 */
async function settle(): Promise<void> {
	const card = document.body.querySelector("[data-ly-modal]");
	if (card) await fire(card, new Event("animationend", { bubbles: true }));
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

describe("StorageCleanup", () => {
	it("先说清楚占了多少、有几条——要不要删是从这两个数字开始判断的", async () => {
		const { view } = await open();
		try {
			assert.match(view.text(), /264 MB · 303 条/);
		} finally {
			await view.unmount();
		}
	});

	it("每一行都是「说明在左、控件在右」，数字变了也不会换一种排法", async () => {
		/*
		 * 这一块从前是一行 `flex-wrap`：右边那组内容一变宽就整组换行，于是选完日期之后同一张卡片
		 * 长得完全是另一个样子——数字从右上角跑到了左下角。`Row` 是明确的两列，右边那列 `shrink-0`。
		 */
		const { view } = await open();
		try {
			const rows = view.all("[data-settings-row]");
			assert.equal(rows.length, 3, "占用、范围、清除各一行");
			const tops = rows.map((row) => row.getBoundingClientRect().top);
			await click(inPanel("[data-ly-date-range]"));
			await click(inPanel(`[data-ly-day="2026-09-05"]`));
			await click(inPanel(`[data-ly-day="2026-09-05"]`));
			assert.deepEqual(
				view.all("[data-settings-row]").map((row) => row.getBoundingClientRect().top),
				tops,
				"选完日期，三行还在原来的位置上",
			);
		} finally {
			await view.unmount();
		}
	});

	it("「无法撤销」写在按钮旁边，不是只写在确认框里", async () => {
		// 确认框是拦手滑的，不是第一次告诉人后果的地方——读到它的时候决定已经做完了。
		const { view } = await open();
		try {
			assert.match(view.text(), /无法撤销/);
			assert.match(view.text(), /对话记录/, "说清楚删的是会话本身，不是一份统计缓存");
		} finally {
			await view.unmount();
		}
	});

	it("点「清除」只是把问题摆出来，一条都还没删", async () => {
		const { view, calls } = await open();
		try {
			await click(view.find("[data-usage-clear]"));
			assert.equal(calls.length, 0, "确认之前一条都不能动");
			assert.ok(document.body.textContent?.includes("删除全部 303 条会话？"), "问题要指名道姓，不是「确定吗」");
		} finally {
			await view.unmount();
		}
	});

	it("在确认框里取消，还是一条都没删", async () => {
		const { view, calls } = await open();
		try {
			await click(view.find("[data-usage-clear]"));
			const cancel = confirmButton("取消");
			assert.ok(cancel, "确认框上要有一条退路");
			await click(cancel);
			assert.equal(calls.length, 0);
		} finally {
			await view.unmount();
		}
	});

	it("确认之后才真的删，而且把当前选的范围原样带过去", async () => {
		const { view, calls, ...rest } = await open();
		try {
			await click(view.find("[data-usage-clear]"));
			await click(confirmButton("清除") as HTMLButtonElement);
			await settle();
			assert.deepEqual(calls, [{ from: null, to: null }], "默认是全部时间");
			assert.match(view.text(), /已删除 12 条会话/);
			void rest;
		} finally {
			await view.unmount();
		}
	});

	it("删完要重新量一次占用——那些数字还挂在屏幕上的话，看起来像什么都没发生", async () => {
		const harness = await open();
		try {
			assert.equal(harness.reads, 1, "进来先问一次");
			await click(harness.view.find("[data-usage-clear]"));
			await click(confirmButton("清除") as HTMLButtonElement);
			await settle();
			assert.equal(harness.reads, 2, "删完再问一次");
		} finally {
			await harness.view.unmount();
		}
	});

	it("有会话正在跑的时候，说清楚哪几条没动", async () => {
		const { view } = await open(USE, { removed: 2, freed: 1024, skipped: 3 });
		try {
			await click(view.find("[data-usage-clear]"));
			await click(confirmButton("清除") as HTMLButtonElement);
			await settle();
			assert.match(view.text(), /3 条正在运行，没有删除/);
		} finally {
			await view.unmount();
		}
	});

	it("一条会话都没有时，按钮按不动", async () => {
		const { view } = await open({ bytes: 0, sessions: 0, earliest: null, latest: null, days: [] });
		try {
			assert.equal(view.find<HTMLButtonElement>("[data-usage-clear]").disabled, true);
			assert.match(view.text(), /暂无记录/);
		} finally {
			await view.unmount();
		}
	});

	it("读不到占用情况时按钮也按不动，而不是拿一个空范围去删", async () => {
		const { view } = await open(null);
		try {
			assert.equal(view.find<HTMLButtonElement>("[data-usage-clear]").disabled, true);
		} finally {
			await view.unmount();
		}
	});

	it("确认框问的是这一段里真有的那几条，不是总数", async () => {
		/*
		 * 这一条是真窗口探针抓出来的：面板说「删除 4 条、释放 83 KB」，实际删了 1 条、25 KB。
		 * 说多了已经够糟，同一个 bug 反过来（说 1 条删掉 4 条）就是灾难。
		 */
		const { view } = await open();
		try {
			await click(inPanel("[data-ly-date-range]"));
			await click(inPanel(`[data-ly-day="2026-09-05"]`));
			await click(inPanel(`[data-ly-day="2026-09-05"]`));
			await click(view.find("[data-usage-clear]"));
			const asked = document.body.querySelector("[data-ly-modal]")?.textContent ?? "";
			assert.match(asked, /删除 3 条会话？/, "那一天只有 3 条，不是 303 条");
			assert.match(asked, /4 MB/, "释放量也一样，按这一段算");
		} finally {
			await view.unmount();
		}
	});

	it("范围里一条会话都没有时，按钮按不动", async () => {
		const { view } = await open();
		try {
			await click(inPanel("[data-ly-date-range]"));
			await click(inPanel(`[data-ly-day="2026-09-10"]`));
			await click(inPanel(`[data-ly-day="2026-09-10"]`));
			assert.equal(view.find<HTMLButtonElement>("[data-usage-clear]").disabled, true);
			assert.match(view.text(), /这段时间里没有会话/);
		} finally {
			await view.unmount();
		}
	});
});
