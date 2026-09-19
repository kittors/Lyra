import assert from "node:assert/strict";
import { test } from "node:test";
import { Activity, createElement as h } from "react";
import { Collapse } from "../../src/ui/layout/Collapse.tsx";
import { mount } from "../helpers/mount.ts";

const content = h("div", { "data-collapse-content": "" }, "Retained process");

function render(visible: boolean, open: boolean, keepMounted = false) {
	return h(Activity, {
		mode: visible ? "visible" : "hidden",
		children: h(Collapse, { open, keepMounted, children: content }),
	});
}

test("hiding an Activity during collapse releases the cancelled closing body", async () => {
	const view = await mount(render(true, true));
	try {
		await view.rerender(render(true, false));
		assert.equal(view.all("[data-collapse-content]").length, 1, "the close animation keeps its body");
		await view.rerender(render(false, false));
		await view.rerender(render(true, false));
		assert.equal(view.all("[data-collapse-content]").length, 0, "a cancelled close cannot retain a hidden body forever");
		await view.rerender(render(true, true));
		assert.equal(view.all("[data-collapse-content]").length, 1, "the released process can be opened again");
	} finally {
		await view.unmount();
	}
});

test("an open body preserves its element across Activity hiding", async () => {
	const view = await mount(render(true, true));
	try {
		const before = view.find("[data-collapse-content]");
		await view.rerender(render(false, true));
		await view.rerender(render(true, true));
		assert.equal(view.find("[data-collapse-content]"), before);
	} finally {
		await view.unmount();
	}
});

test("keepMounted preserves a closing body across Activity hiding", async () => {
	const view = await mount(render(true, true, true));
	try {
		const before = view.find("[data-collapse-content]");
		await view.rerender(render(true, false, true));
		await view.rerender(render(false, false, true));
		await view.rerender(render(true, false, true));
		assert.equal(view.find("[data-collapse-content]"), before);
	} finally {
		await view.unmount();
	}
});
