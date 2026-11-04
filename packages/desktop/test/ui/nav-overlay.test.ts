/**
 * Below 900px a desktop window's sidebar floats over the content instead of pushing it.
 *
 * Snapped to half of a 1920px screen at 125% a window is 768px wide. The sidebar pushed there, left
 * about 470px for a conversation and its panels, and on the Windows test machine four panels were
 * stacked into 150px strips with the side chat's send button cut off. Floating, it costs the content
 * nothing until it is opened, and whether it was open beside the content is kept for a wider window.
 */

import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, test } from "node:test";
import { createElement as h } from "react";

import { LayoutProvider, useLayout } from "../../src/app/layout.tsx";
import { NavPane } from "../../src/app/panes.tsx";
import { click, mount } from "../helpers/mount.ts";

const width = Object.getOwnPropertyDescriptor(window, "innerWidth");

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
	if (width) Object.defineProperty(window, "innerWidth", width);
});

function Harness() {
	const { toggleNav, dismissNav, overlay, navOpen, compact } = useLayout();
	return h(
		"div",
		null,
		h("button", { "data-test-toggle": "", "data-overlay": String(overlay), "data-open": String(navOpen), "data-compact": String(compact), onClick: toggleNav }, "toggle"),
		h("button", { "data-test-dismiss": "", onClick: dismissNav }, "dismiss"),
		h(NavPane, { width: 260, label: "sidebar", children: h("p", null, "会话") }),
	);
}

async function resize(to: number) {
	Object.defineProperty(window, "innerWidth", { configurable: true, value: to });
	await act(async () => {
		window.dispatchEvent(new Event("resize"));
	});
}

const state = (view: Awaited<ReturnType<typeof mount>>) => {
	const toggle = view.find("[data-test-toggle]");
	return { overlay: toggle.getAttribute("data-overlay"), open: toggle.getAttribute("data-open"), compact: toggle.getAttribute("data-compact") };
};

test("768px (a half-screen snap): the sidebar floats, starts shut, opens over the content and is put away again", async () => {
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform: "win32", host: "desktop" } });
	Object.defineProperty(window, "innerWidth", { configurable: true, value: 768 });
	const view = await mount(h(LayoutProvider, { children: h(Harness) }));
	try {
		assert.deepEqual(state(view), { overlay: "true", open: "false", compact: "false" });
		assert.ok(view.find("[data-ly-nav-overlay]"), "the frame reserves no width");
		assert.equal(view.find('aside').getAttribute("data-pane"), "drawer", "the opaque drawer fill, lying over the transcript");
		await click(view.find("[data-test-toggle]"));
		assert.equal(state(view).open, "true");
		await click(view.find("[data-test-dismiss]"));
		assert.equal(state(view).open, "false", "choosing a conversation puts it away");
	} finally {
		await view.unmount();
	}
});

test("widening the window brings back the sidebar the user had beside the content, untouched", async () => {
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform: "darwin", host: "desktop" } });
	Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
	const view = await mount(h(LayoutProvider, { children: h(Harness) }));
	try {
		assert.deepEqual(state(view), { overlay: "false", open: "true", compact: "false" });
		await resize(853);
		assert.deepEqual(state(view), { overlay: "true", open: "false", compact: "false" });
		await click(view.find("[data-test-toggle]"));
		assert.equal(state(view).open, "true");
		await resize(1280);
		assert.deepEqual(state(view), { overlay: "false", open: "true", compact: "false" }, "the pushed sidebar is as it was");
		// And one the user had closed stays closed across the round trip.
		await click(view.find("[data-test-toggle]"));
		await resize(853);
		await resize(1280);
		assert.equal(state(view).open, "false");
	} finally {
		await view.unmount();
	}
});

/*
 * The default window is 980 wide (`MAIN_DEFAULT`). With the line at 1000 every window opened at its
 * default size — a new user's first, every e2e run — had its sidebar shut away.
 */
test("below 760 it is still the compact drawer; the default 980 window and wider push as before", async () => {
	Object.defineProperty(window, "lyra", { configurable: true, value: { platform: "win32", host: "desktop" } });
	for (const [w, expected] of [[700, { overlay: "false", compact: "true" }], [980, { overlay: "false", compact: "false" }], [900, { overlay: "false", compact: "false" }], [899, { overlay: "true", compact: "false" }], [853, { overlay: "true", compact: "false" }]] as const) {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
		const view = await mount(h(LayoutProvider, { children: h(Harness) }));
		try {
			const { overlay, compact } = state(view);
			assert.deepEqual({ overlay, compact }, expected, `${w}px`);
		} finally {
			await view.unmount();
		}
	}
});
