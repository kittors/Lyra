import assert from "node:assert/strict";
import { act, createElement as h, useEffect } from "react";
import { test } from "node:test";
import { ToolGroup } from "../../src/features/conversation/ToolGroup.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";

test("closed groups defer their cards and restore an open group without a zero-height frame", async () => {
	useApp.setState({ activeSessionId: "tool-cache-a" });
	let mounted = 0;
	function Card() {
		useEffect(() => {
			mounted++;
		}, []);
		return h("div", null, "Tool details");
	}
	const group = () => h(ToolGroup, { summary: "Read one file", stateKey: "group-a", children: h(Card) });
	let view = await mount(group());
	assert.equal(mounted, 0, "a folded group must not mount expensive hidden cards");
	assert.equal(view.all("[data-ly-run] > div")[0].hasAttribute("inert"), true);
	await click(view.find("button"));
	assert.equal(mounted, 1);
	assert.equal(view.find("button").getAttribute("aria-expanded"), "true");
	await view.unmount();
	view = await mount(group());
	assert.equal(view.find("button").getAttribute("aria-expanded"), "true");
	assert.match(view.text(), /Tool details/);
	await act(async () => {
		useApp.setState({ activeSessionId: "tool-cache-b" });
	});
	assert.equal(
		view.find("button").getAttribute("aria-expanded"),
		"false",
		"another session owns a separate disclosure state",
	);
	await view.unmount();
});
