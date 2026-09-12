import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { GroupActivity } from "../../src/features/sidebar/GroupActivity.tsx";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

test("group loading only exists while collapsed and returns to the count when work stops", async () => {
	useApp.setState({ activity: { a: "running", elsewhere: "running" }, activeSessionId: "a" });
	const props = { sessions: [{ id: "a" }], count: 1 };
	const view = await mount(h(GroupActivity, { ...props, collapsed: false }));
	try {
		assert.equal(view.host.childElementCount, 0);
		await view.rerender(h(GroupActivity, { ...props, collapsed: true }));
		assert.equal(view.all("svg.ly-star").length, 1);
		assert.ok(view.host.querySelector('[aria-label="1 个会话正在执行"]'));
		assert.equal(view.text(), "");
		await view.rerender(h(GroupActivity, { ...props, collapsed: false }));
		assert.equal(view.host.childElementCount, 0);
		await view.rerender(h(GroupActivity, { ...props, collapsed: true }));
		await act(async () => { useApp.setState({ activity: { a: "done", elsewhere: "running" } }); });
		assert.equal(view.all("svg").length, 0);
		assert.equal(view.text(), "1");
	} finally { await view.unmount(); }
});

test("nested groups count each running session once and do not depict approval or failure as loading", async () => {
	useApp.setState({ activity: { a: "running", b: "running", c: "waiting", d: "failed" }, activeSessionId: null });
	const sessions = ["a", "a", "b", "c", "d"].map((id) => ({ id }));
	const view = await mount(h(GroupActivity, { sessions, count: 3, collapsed: true }));
	try {
		assert.ok(view.host.querySelector('[aria-label="2 个会话正在执行"]'));
		await act(async () => { useApp.setState({ activity: { a: "done", b: "done", c: "waiting", d: "failed" } }); });
		assert.equal(view.all("svg").length, 0);
		assert.equal(view.text(), "3");
		await view.rerender(h(GroupActivity, { sessions: [], count: 0, collapsed: true }));
		assert.equal(view.text(), "");
	} finally { await view.unmount(); }
});
