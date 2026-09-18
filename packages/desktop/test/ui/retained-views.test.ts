import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, useEffect, useState } from "react";
import { RetainedViews } from "../../src/ui/layout/RetainedViews.tsx";
import { mount, click } from "../helpers/mount.ts";

test("tab visits retain local state, suspend hidden effects, and evict the oldest page", async () => {
	const live = new Set<string>();
	function Page({ id }: { id: string }) {
		const [count, setCount] = useState(0);
		useEffect(() => { live.add(id); return () => { live.delete(id); }; }, [id]);
		return h("button", { id, onClick: () => setCount(count + 1) }, String(count));
	}
	const render = (id: string) => h(Page, { id });
	const view = await mount(h(RetainedViews, { active: "a", render, limit: 2 }));
	try {
		await click(view.find("#a"));
		await view.rerender(h(RetainedViews, { active: "b", render, limit: 2 }));
		assert.deepEqual([...live], ["b"]);
		await view.rerender(h(RetainedViews, { active: "a", render, limit: 2 }));
		assert.equal(view.find("#a").textContent, "1");
		assert.deepEqual([...live], ["a"]);
		await view.rerender(h(RetainedViews, { active: "c", render, limit: 2 }));
		assert.equal(view.host.querySelector("#b"), null);
		assert.deepEqual([...live], ["c"]);
	} finally { await view.unmount(); }
	assert.equal(live.size, 0);
});

test("the visible page is first in the tree so the live transcript is the one querySelector finds", async () => {
	const render = (id: string) => h("div", { id }, id);
	const view = await mount(h(RetainedViews, { active: "a", render, pageClassName: "" }));
	try {
		await view.rerender(h(RetainedViews, { active: "b", render, pageClassName: "" }));
		assert.equal(view.host.querySelector("[data-view]")?.getAttribute("data-view"), "b");
		assert.equal(view.host.querySelector("[data-view]")?.getAttribute("data-active"), "true");
	} finally {
		await view.unmount();
	}
});

test("the visible page is marked active so arrival motion can restart without remounting", async () => {
	const render = (id: string) => h("div", { id }, id);
	const view = await mount(h(RetainedViews, { active: "a", render, pageClassName: "ly-settings-enter" }));
	try {
		const first = view.host.querySelector("[data-view=a]");
		assert.equal(first?.getAttribute("data-active"), "true");
		assert.ok(first?.classList.contains("ly-settings-enter"));
		await view.rerender(h(RetainedViews, { active: "b", render, pageClassName: "ly-settings-enter" }));
		assert.equal(view.host.querySelector("[data-view=a]")?.getAttribute("data-active"), "false");
		assert.equal(view.host.querySelector("[data-view=b]")?.getAttribute("data-active"), "true");
	} finally {
		await view.unmount();
	}
});

test("头一回露面的那一页才播进场，回来的不播", async () => {
	const render = (id: string) => h("div", { id }, id);
	const view = await mount(h(RetainedViews, { active: "a", render, pageClassName: "ly-settings-enter" }));
	try {
		/*
		 * 这条守的是设置页里那次「内容跳一下」。
		 *
		 * 隐藏的页面是 `display: none`，内容和滚动位置都留着，所以回到一个看过的章节，它本来就
		 * 在那里。从前不分头一回还是回来，于是回去时内容先画在终点、下一帧被拽回起点再滑回来，
		 * 逐帧量是 44 → 50 → 44：一次掉头，人眼看见的就是跳。
		 */
		const fresh = (key: string) => view.host.querySelector(`[data-view=${key}]`)?.getAttribute("data-fresh");
		await view.rerender(h(RetainedViews, { active: "b", render, pageClassName: "ly-settings-enter" }));
		assert.equal(fresh("b"), "true", "头一回进 b，该播进场");
		assert.equal(fresh("a"), "false", "让开的那一页不该带着进场标记");

		await view.rerender(h(RetainedViews, { active: "a", render, pageClassName: "ly-settings-enter" }));
		assert.equal(fresh("a"), "false", "a 是回来的，内容一直在，不该再演一遍");

		await view.rerender(h(RetainedViews, { active: "c", render, pageClassName: "ly-settings-enter" }));
		assert.equal(fresh("c"), "true", "没去过的 c 仍然该播");
	} finally {
		await view.unmount();
	}
});
