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
